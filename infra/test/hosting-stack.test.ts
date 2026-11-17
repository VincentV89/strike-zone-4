import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COST_ALLOCATION_TAGS } from '../lib/app';
import { IMMUTABLE_CACHE_CONTROL, STACK_NAME } from '../lib/hosting-stack';
import { findSecretMatches } from '../lib/secret-patterns';
import { CSP, HSTS_MAX_AGE_SECONDS } from '../lib/security-headers';
import { MIN_BOOTSTRAP_VERSION } from '../scripts/preflight';
import {
  BOOTSTRAP_ASSET_BUCKET,
  actionsOf,
  asArray,
  onlyResourceOfType,
  refersTo,
  resourcesOfType,
  statementsOf,
  synthesizeFixture,
  type CfnTemplate,
  type SynthesizedFixture,
} from './helpers';

/** SEC-HI-14. A new type must be added here on purpose, with the reason in the code summary. */
const RESOURCE_TYPE_ALLOW_LIST = new Set([
  'AWS::S3::Bucket',
  'AWS::S3::BucketPolicy',
  'AWS::CloudFront::Distribution',
  'AWS::CloudFront::OriginAccessControl',
  'AWS::CloudFront::ResponseHeadersPolicy',
  'AWS::Lambda::Function',
  'AWS::Lambda::LayerVersion',
  'AWS::IAM::Role',
  'AWS::IAM::Policy',
  'AWS::Logs::LogGroup',
  'Custom::CDKBucketDeployment',
  'Custom::S3AutoDeleteObjects',
  'AWS::CDK::Metadata',
]);

/** req-cost-control / story-secure-private-hosting AC3: always-on or cost-amplifying services. */
const FORBIDDEN_TYPE_PREFIXES = [
  'AWS::EC2::',
  'AWS::ECS::',
  'AWS::EKS::',
  'AWS::ElasticLoadBalancing',
  'AWS::RDS::',
  'AWS::DynamoDB::',
  'AWS::WAFv2::',
  'AWS::KMS::',
];

let fixture: SynthesizedFixture;
let template: Template;
let json: CfnTemplate;

beforeAll(() => {
  fixture = synthesizeFixture();
  template = Template.fromStack(fixture.hostingStack);
  json = template.toJSON() as CfnTemplate;
});

afterAll(() => {
  fixture.dispose();
});

function siteBucketId(): string {
  return onlyResourceOfType(json, 'AWS::S3::Bucket')[0];
}

function distributionId(): string {
  return onlyResourceOfType(json, 'AWS::CloudFront::Distribution')[0];
}

function distributionConfig(): Record<string, unknown> {
  const [, distribution] = onlyResourceOfType(json, 'AWS::CloudFront::Distribution');
  return distribution.Properties!.DistributionConfig as Record<string, unknown>;
}

function behaviours(): Record<string, unknown>[] {
  const config = distributionConfig();
  const extra = (config.CacheBehaviors as Record<string, unknown>[] | undefined) ?? [];
  return [config.DefaultCacheBehavior as Record<string, unknown>, ...extra];
}

function bucketPolicyStatements() {
  return statementsOf(onlyResourceOfType(json, 'AWS::S3::BucketPolicy')[1]);
}

/** The singleton BucketDeployment handler role, found through the custom resource ServiceToken. */
function bucketDeploymentHandlerPolicyStatements() {
  const deployments = resourcesOfType(json, 'Custom::CDKBucketDeployment');
  const tokens = new Set(deployments.map(([, r]) => JSON.stringify(r.Properties!.ServiceToken)));
  expect(tokens.size, 'both deployments share one handler').toBe(1);
  const [functionId] = Object.entries(json.Resources).find(
    ([id, r]) => r.Type === 'AWS::Lambda::Function' && [...tokens][0]!.includes(`"${id}"`),
  )!;
  const handler = json.Resources[functionId]!;
  const roleId = (handler.Properties!.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
  const policies = resourcesOfType(json, 'AWS::IAM::Policy').filter(([, p]) =>
    refersTo(p.Properties!.Roles, roleId),
  );
  return { functionId, handler, roleId, statements: policies.flatMap(([, p]) => statementsOf(p)) };
}

describe('origin bucket (SEC-HI-01 to SEC-HI-03)', () => {
  it('blocks all public access, enforces bucket-owner ownership and has no website hosting', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      WebsiteConfiguration: Match.absent(),
    });
  });

  it('encrypts with SSE-S3 and creates no KMS key', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
    template.resourceCountIs('AWS::KMS::Key', 0);
  });

  it('denies every request that does not use TLS', () => {
    const deny = bucketPolicyStatements().find((s) => s.Effect === 'Deny');
    expect(deny).toMatchObject({
      Principal: { AWS: '*' },
      Action: 's3:*',
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    });
  });
});

describe('origin access (SEC-HI-04, SEC-HI-11)', () => {
  it('uses one SigV4 Origin Access Control and no legacy OAI', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: {
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
        OriginAccessControlOriginType: 's3',
      },
    });
    template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
  });

  it('lets only this distribution read objects', () => {
    const reads = bucketPolicyStatements().filter(
      (s) => s.Effect === 'Allow' && actionsOf(s).includes('s3:GetObject'),
    );
    expect(reads).toHaveLength(1);
    const [read] = reads;
    expect(read!.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    const sourceArn = (read!.Condition as { StringEquals: Record<string, unknown> }).StringEquals[
      'AWS:SourceArn'
    ];
    expect(refersTo(sourceArn, distributionId())).toBe(true);
  });

  it('has no Allow statement for a wildcard principal', () => {
    const allows = bucketPolicyStatements().filter((s) => s.Effect === 'Allow');
    for (const statement of allows) {
      expect(statement.Principal).not.toBe('*');
      expect(statement.Principal).not.toEqual({ AWS: '*' });
    }
  });

  it('never allows writes through the bucket policy', () => {
    for (const statement of bucketPolicyStatements().filter((s) => s.Effect === 'Allow')) {
      expect(actionsOf(statement).some((a) => a.startsWith('s3:PutObject'))).toBe(false);
    }
  });

  it('scopes the auto-delete statements to the auto-delete provider role only', () => {
    const autoDelete = bucketPolicyStatements().filter((s) =>
      actionsOf(s).includes('s3:PutBucketPolicy'),
    );
    expect(autoDelete).toHaveLength(1);
    expect(JSON.stringify(autoDelete[0]!.Principal)).toContain('CustomS3AutoDeleteObjects');
  });
});

describe('edge behaviour (SEC-HI-05 to SEC-HI-07, req-refresh-routing)', () => {
  it('redirects HTTP to HTTPS on every behaviour', () => {
    for (const behaviour of behaviours()) {
      expect(behaviour.ViewerProtocolPolicy).toBe('redirect-to-https');
    }
  });

  it('attaches the security headers policy to every behaviour', () => {
    const [policyId] = onlyResourceOfType(json, 'AWS::CloudFront::ResponseHeadersPolicy');
    for (const behaviour of behaviours()) {
      expect(refersTo(behaviour.ResponseHeadersPolicyId, policyId)).toBe(true);
    }
  });

  it('builds the headers policy from the shared constants', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        Name: Match.anyValue(),
        SecurityHeadersConfig: {
          ContentSecurityPolicy: { ContentSecurityPolicy: CSP, Override: true },
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
          StrictTransportSecurity: {
            AccessControlMaxAgeSec: HSTS_MAX_AGE_SECONDS,
            IncludeSubdomains: false,
            Preload: false,
            Override: true,
          },
        },
      },
    });
    expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CSP).not.toContain("'unsafe-eval'");
  });

  it('maps 403 and 404 to /index.html with status 200 and TTL 0', () => {
    expect(distributionConfig().CustomErrorResponses).toEqual(
      expect.arrayContaining(
        [403, 404].map((code) => ({
          ErrorCode: code,
          ResponseCode: 200,
          ResponsePagePath: '/index.html',
          ErrorCachingMinTTL: 0,
        })),
      ),
    );
  });

  it('serves index.html at the root over HTTP/2+3 and IPv6 with managed caching', () => {
    expect(distributionConfig()).toMatchObject({
      DefaultRootObject: 'index.html',
      HttpVersion: 'http2and3',
      IPV6Enabled: true,
      PriceClass: 'PriceClass_All',
    });
    const [defaultBehaviour] = behaviours();
    expect(defaultBehaviour).toMatchObject({
      // Managed CachingOptimized policy ID.
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
      Compress: true,
      AllowedMethods: ['GET', 'HEAD'],
    });
  });
});

describe('least privilege for CDK helpers (SEC-HI-10, SEC-HI-11)', () => {
  it('scopes the deployment handler to the site bucket and the bootstrap asset bucket', () => {
    const { statements } = bucketDeploymentHandlerPolicyStatements();
    const s3Statements = statements.filter((s) => actionsOf(s).some((a) => a.startsWith('s3:')));
    expect(s3Statements.length).toBeGreaterThan(0);
    for (const statement of s3Statements) {
      for (const resource of asArray(statement.Resource)) {
        const serialized = JSON.stringify(resource);
        const allowed =
          refersTo(resource, siteBucketId()) || serialized.includes(BOOTSTRAP_ASSET_BUCKET);
        expect(allowed, `unexpected S3 resource ${serialized}`).toBe(true);
      }
    }
  });

  it('grants no wildcard actions and only the two invalidation actions on CloudFront', () => {
    const { statements } = bucketDeploymentHandlerPolicyStatements();
    for (const statement of statements) {
      expect(actionsOf(statement)).not.toContain('*');
      expect(actionsOf(statement)).not.toContain('s3:*');
    }
    const cloudFront = statements.flatMap(actionsOf).filter((a) => a.startsWith('cloudfront:'));
    expect(new Set(cloudFront)).toEqual(
      new Set(['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation']),
    );
    const invalidation = statements.find((s) =>
      actionsOf(s).includes('cloudfront:CreateInvalidation'),
    )!;
    // Residual risk 7: the pinned aws-cdk-lib may use Resource '*'. Accept either form, report it.
    const form = invalidation.Resource === '*' ? "'*'" : 'distribution ARN';
    console.log(`[SEC-HI-10] BucketDeployment invalidation resource: ${form}`);
    expect(invalidation.Resource === '*' || refersTo(invalidation.Resource, distributionId())).toBe(
      true,
    );
  });

  it('gives s3:PutObject only to the deployment handler role', () => {
    const { roleId } = bucketDeploymentHandlerPolicyStatements();
    for (const [, policy] of resourcesOfType(json, 'AWS::IAM::Policy')) {
      const writes = statementsOf(policy)
        .flatMap(actionsOf)
        .some((a) => a.startsWith('s3:PutObject'));
      if (writes) {
        expect(refersTo(policy.Properties!.Roles, roleId)).toBe(true);
      }
    }
  });
});

describe('destroyability (SEC-HI-12, req-cdk-destroy-all)', () => {
  it('deletes the bucket and its objects with the stack', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
    template.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
  });

  it('gives every log group an explicit Delete policy and the app log group 7 days', () => {
    const logGroups = resourcesOfType(json, 'AWS::Logs::LogGroup');
    expect(logGroups.length).toBeGreaterThan(0);
    for (const [, logGroup] of logGroups) {
      expect(logGroup.DeletionPolicy).toBe('Delete');
    }
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });

  it('retains or snapshots nothing', () => {
    for (const [id, resource] of Object.entries(json.Resources)) {
      expect(['Retain', 'RetainExceptOnCreate', 'Snapshot'], id).not.toContain(
        resource.DeletionPolicy,
      );
    }
  });

  it('turns termination protection off', () => {
    expect(fixture.hostingStack.terminationProtection).toBe(false);
  });
});

describe('resource footprint (SEC-HI-14, req-cost-control)', () => {
  it('uses only allow-listed resource types', () => {
    const unexpected = Object.values(json.Resources)
      .map((r) => r.Type)
      .filter((type) => !RESOURCE_TYPE_ALLOW_LIST.has(type));
    expect(unexpected).toEqual([]);
  });

  it('contains no always-on or cost-amplifying services', () => {
    for (const resource of Object.values(json.Resources)) {
      expect(
        FORBIDDEN_TYPE_PREFIXES.some((p) => resource.Type.startsWith(p)),
        resource.Type,
      ).toBe(false);
    }
  });

  it('contains no AWS key material (SEC-HI-08)', () => {
    expect(findSecretMatches(JSON.stringify(json))).toEqual([]);
  });
});

describe('two-tier deployment (NFR-HI-R5)', () => {
  function deployment(prefix: string) {
    const match = resourcesOfType(json, 'Custom::CDKBucketDeployment').find(([id]) =>
      id.startsWith(prefix),
    );
    expect(match, `${prefix} custom resource`).toBeDefined();
    return match!;
  }

  it('uploads hashed assets as immutable without pruning or invalidating', () => {
    const [, assets] = deployment('DeployAssets');
    expect(assets.Properties).toMatchObject({
      Prune: false,
      SystemMetadata: { 'cache-control': IMMUTABLE_CACHE_CONTROL },
    });
    expect(assets.Properties!.DistributionPaths).toBeUndefined();
  });

  it('writes index.html as no-cache after the assets and invalidates /*', () => {
    const [assetsId] = deployment('DeployAssets');
    const [, index] = deployment('DeployIndex');
    expect(index.Properties).toMatchObject({
      Prune: false,
      SystemMetadata: { 'cache-control': 'no-cache' },
      DistributionPaths: ['/*'],
    });
    expect(refersTo(index.Properties!.DistributionId, distributionId())).toBe(true);
    expect(asArray(index.DependsOn)).toContain(assetsId);
  });

  it('runs the shared handler with 512 MB and logs to the app-owned log group', () => {
    const { handler } = bucketDeploymentHandlerPolicyStatements();
    const [logGroupId] = onlyResourceOfType(json, 'AWS::Logs::LogGroup');
    expect(handler.Properties!.MemorySize).toBe(512);
    expect(refersTo(handler.Properties!.LoggingConfig, logGroupId)).toBe(true);
  });

  it('stages index.html and the hashed assets as separate sources', () => {
    const stagedDirs = readdirSync(fixture.outdir)
      .filter((name) => name.startsWith('asset.'))
      .map((name) => join(fixture.outdir, name))
      .filter((path) => statSync(path).isDirectory())
      .map((path) => readdirSync(path, { recursive: true }).map(String).sort());
    expect(stagedDirs).toContainEqual(['index.html']);
    expect(stagedDirs).toContainEqual(['assets', join('assets', 'index-a1b2c3d4.js')]);
  });
});

describe('stack contract', () => {
  it('exports SiteUrl, DistributionId and BucketName (NFR-HI-O1)', () => {
    template.hasOutput('SiteUrl', {
      Value: { 'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [distributionId(), 'DomainName'] }]] },
    });
    template.hasOutput('DistributionId', { Value: { Ref: distributionId() } });
    template.hasOutput('BucketName', { Value: { Ref: siteBucketId() } });
  });

  it('builds one stack named StrikeZoneHosting with cost allocation tags', () => {
    const stacks = fixture.app.node.children.filter((child) => child.node.id === STACK_NAME);
    expect(stacks).toHaveLength(1);
    expect(fixture.hostingStack.stackName).toBe(STACK_NAME);
    const [, bucket] = onlyResourceOfType(json, 'AWS::S3::Bucket');
    const tags = bucket.Properties!.Tags as { Key: string; Value: string }[];
    for (const [key, value] of Object.entries(COST_ALLOCATION_TAGS)) {
      expect(tags).toContainEqual({ Key: key, Value: value });
    }
  });

  it('requires the bootstrap version that preflight checks for', () => {
    // The synthesizer rejects every version below its minimum; preflight's minimum must match.
    const rejected = Array.from({ length: MIN_BOOTSTRAP_VERSION - 1 }, (_, i) => String(i + 1));
    const rule = JSON.stringify(json.Rules?.CheckBootstrapVersion);
    expect(rule).toContain(JSON.stringify(rejected));
    expect(rule).toContain(`version ${MIN_BOOTSTRAP_VERSION} required`);
  });

  it('fails synthesis with a clear message when index.html is missing', () => {
    const emptySite = mkdtempSync(join(tmpdir(), 'strikezone-empty-site-'));
    try {
      expect(() => synthesizeFixture(emptySite)).toThrow(/index\.html not found/);
    } finally {
      rmSync(emptySite, { recursive: true, force: true });
    }
  });
});
