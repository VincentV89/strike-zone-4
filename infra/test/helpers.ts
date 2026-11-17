import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type StrikeZoneApp } from '../lib/app';

/** Fixture site: a dummy index.html plus one hashed .js, so tests never need a game build. */
export const FIXTURE_SITE_DIR = join(__dirname, 'fixtures', 'site');

/** Fixed dummy environment so synthesis needs no credentials. */
export const TEST_ENV = { account: '111111111111', region: 'us-east-1' } as const;

export const BOOTSTRAP_ASSET_BUCKET = `cdk-hnb659fds-assets-${TEST_ENV.account}-${TEST_ENV.region}`;

export interface SynthesizedFixture extends StrikeZoneApp {
  readonly outdir: string;
  dispose(): void;
}

/** Builds the app into an OS temp directory (cdk.out never lands on the workspace disk). */
export function synthesizeFixture(siteDir: string = FIXTURE_SITE_DIR): SynthesizedFixture {
  const outdir = mkdtempSync(join(tmpdir(), 'strikezone-cdk-'));
  let built: StrikeZoneApp;
  try {
    built = buildApp({ siteDir, env: TEST_ENV, outdir });
  } catch (error) {
    rmSync(outdir, { recursive: true, force: true });
    throw error;
  }
  return {
    ...built,
    outdir,
    dispose: () => {
      rmSync(outdir, { recursive: true, force: true });
    },
  };
}

export type CfnResource = {
  Type: string;
  Properties?: Record<string, unknown>;
  DependsOn?: string | string[];
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};

export type CfnTemplate = {
  Resources: Record<string, CfnResource>;
  Outputs?: Record<string, { Value: unknown }>;
  Rules?: Record<string, unknown>;
};

export function resourcesOfType(template: CfnTemplate, type: string): [string, CfnResource][] {
  return Object.entries(template.Resources).filter(([, resource]) => resource.Type === type);
}

export function onlyResourceOfType(template: CfnTemplate, type: string): [string, CfnResource] {
  const matches = resourcesOfType(template, type);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${type}, found ${matches.length}`);
  }
  return matches[0]!;
}

/** True when a CloudFormation value (Ref, GetAtt, Join) mentions the logical ID. */
export function refersTo(value: unknown, logicalId: string): boolean {
  return JSON.stringify(value).includes(`"${logicalId}"`);
}

export type PolicyStatement = {
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource?: unknown;
  Principal?: unknown;
  Condition?: unknown;
};

export function statementsOf(resource: CfnResource): PolicyStatement[] {
  const document = resource.Properties?.PolicyDocument as { Statement: PolicyStatement[] };
  return document.Statement;
}

export function actionsOf(statement: PolicyStatement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}
