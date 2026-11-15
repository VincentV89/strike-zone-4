import { App, Tags, type Environment } from 'aws-cdk-lib';
import { HostingStack, STACK_NAME } from './hosting-stack';

export const COST_ALLOCATION_TAGS: Readonly<Record<string, string>> = {
  Project: 'StrikeZone',
  Environment: 'prod',
  Unit: 'hosting-infra',
  ManagedBy: 'cdk',
};

export interface BuildAppOptions {
  readonly siteDir: string;
  readonly env?: Environment;
  /** Cloud assembly directory. Tests pass a temp dir; the CLI sets it through CDK_OUTDIR. */
  readonly outdir?: string;
}

export interface StrikeZoneApp {
  readonly app: App;
  readonly hostingStack: HostingStack;
}

/** Builds the single StrikeZone CDK app (req-cdk-single-app) with exactly one stack. */
export function buildApp(options: BuildAppOptions): StrikeZoneApp {
  const app = new App(options.outdir === undefined ? {} : { outdir: options.outdir });
  for (const [key, value] of Object.entries(COST_ALLOCATION_TAGS)) {
    Tags.of(app).add(key, value);
  }
  const hostingStack = new HostingStack(app, STACK_NAME, {
    siteDir: options.siteDir,
    ...(options.env === undefined ? {} : { env: options.env }),
    description: 'StrikeZone static hosting: private S3 + CloudFront OAC (hosting-infra)',
  });
  return { app, hostingStack };
}
