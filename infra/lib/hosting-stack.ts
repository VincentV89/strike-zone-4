import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { createSecurityHeadersPolicy } from './security-headers';

export const STACK_NAME = 'StrikeZoneHosting';
export const INDEX_DOCUMENT = 'index.html';
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The BucketDeployment default of 128 MB is slow at unzipping a bundle with inlined WASM. */
const DEPLOYMENT_HANDLER_MEMORY_MB = 512;

export interface HostingStackProps extends StackProps {
  /** Built game directory (contract-game-dist): index.html at the root, every other file hashed. */
  readonly siteDir: string;
}

/**
 * StrikeZoneHosting: private S3 bucket behind CloudFront with Origin Access Control.
 * Control IDs (SEC-HI-*) refer to security-design-hosting-infra.
 */
export class HostingStack extends Stack {
  constructor(scope: Construct, id: string, props: HostingStackProps) {
    super(scope, id, { terminationProtection: false, ...props });
    assertSiteDir(props.siteDir);

    const bucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL, // SEC-HI-01
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED, // SEC-HI-01
      encryption: BucketEncryption.S3_MANAGED, // SEC-HI-02, no KMS cost
      enforceSSL: true, // SEC-HI-03
      versioned: false,
      removalPolicy: RemovalPolicy.DESTROY, // SEC-HI-12
      autoDeleteObjects: true, // SEC-HI-12
    });

    const distribution = new Distribution(this, 'Distribution', {
      comment: 'StrikeZone game (static Vite build)',
      defaultRootObject: INDEX_DOCUMENT,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket), // SEC-HI-04
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS, // SEC-HI-05
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: createSecurityHeadersPolicy(this), // SEC-HI-06, SEC-HI-07
      },
      // OAC without s3:ListBucket makes S3 answer 403 for missing keys, so both codes map to
      // the SPA entry point (req-refresh-routing). Never grant ListBucket to "fix" the 403.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: `/${INDEX_DOCUMENT}`,
        ttl: Duration.seconds(0),
      })),
      priceClass: PriceClass.PRICE_CLASS_ALL,
      httpVersion: HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
    });

    const deployLogGroup = new LogGroup(this, 'DeployLogGroup', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY, // SEC-HI-12
    });

    // Tier 1: hashed assets, cached for a year. prune:false keeps files that an open tab may
    // still request and stops the two deployments from deleting each other's files.
    const assetsDeployment = new BucketDeployment(this, 'DeployAssets', {
      sources: [Source.asset(props.siteDir, { exclude: [INDEX_DOCUMENT] })],
      destinationBucket: bucket,
      cacheControl: [CacheControl.fromString(IMMUTABLE_CACHE_CONTROL)],
      prune: false,
      memoryLimit: DEPLOYMENT_HANDLER_MEMORY_MB,
      logGroup: deployLogGroup,
    });

    // Tier 2: index.html only, revalidated on every request, written after the assets it
    // references (NFR-HI-R5). Only this deployment invalidates the cache.
    const indexDeployment = new BucketDeployment(this, 'DeployIndex', {
      sources: [Source.asset(props.siteDir, { exclude: ['*', `!${INDEX_DOCUMENT}`] })],
      destinationBucket: bucket,
      cacheControl: [CacheControl.noCache()],
      prune: false,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: DEPLOYMENT_HANDLER_MEMORY_MB,
      logGroup: deployLogGroup,
    });
    indexDeployment.node.addDependency(assetsDeployment);

    new CfnOutput(this, 'SiteUrl', {
      description: 'Public HTTPS URL of the game',
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
  }
}

/** Fails synthesis early with a clear message instead of deploying an empty site. */
function assertSiteDir(siteDir: string): void {
  const indexPath = join(siteDir, INDEX_DOCUMENT);
  if (!existsSync(indexPath)) {
    throw new Error(
      `HostingStack: ${indexPath} not found. Build the game first (npm --prefix game run build); ` +
        'siteDir must contain index.html at its root (contract-game-dist).',
    );
  }
}
