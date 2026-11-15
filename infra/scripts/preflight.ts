/**
 * Preflight (req-aws-preflight, SEC-HI-16): region, identity and CDK bootstrap, checked with the
 * AWS SDK v3 because no AWS CLI exists in the runtime. Stops at the first failure.
 *
 * Exit codes: 0 ready, 2 no region, 3 identity/credentials, 4 not bootstrapped or too old.
 * Preflight is not part of `verify` and never runs `cdk bootstrap` itself.
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { formatError, resolveRegion, type Logger } from './aws-env';

export const PREFLIGHT_EXIT = {
  OK: 0,
  NO_REGION: 2,
  IDENTITY: 3,
  BOOTSTRAP: 4,
} as const;

export const BOOTSTRAP_VERSION_PARAMETER = '/cdk-bootstrap/hnb659fds/version';

/**
 * Minimum bootstrap stack version the synthesized template requires. It equals the
 * `CheckBootstrapVersion` rule the DefaultStackSynthesizer emits; a test keeps the two in step.
 */
export const MIN_BOOTSTRAP_VERSION = 6;

export interface CallerIdentity {
  readonly account: string | undefined;
  readonly arn: string | undefined;
}

export interface PreflightDeps {
  resolveRegion(): Promise<string | undefined>;
  getCallerIdentity(region: string): Promise<CallerIdentity>;
  /** Resolves the SSM value, or rejects with the SDK error (for example ParameterNotFound). */
  getBootstrapVersion(region: string): Promise<string | undefined>;
}

export async function runPreflight(deps: PreflightDeps, log: Logger): Promise<number> {
  const region = await deps.resolveRegion();
  if (region === undefined) {
    log('preflight: no region resolved — set AWS_REGION or a profile region');
    return PREFLIGHT_EXIT.NO_REGION;
  }

  let identity: CallerIdentity;
  try {
    identity = await deps.getCallerIdentity(region);
  } catch (error) {
    log(`preflight: ${formatError(error)}`);
    return PREFLIGHT_EXIT.IDENTITY;
  }
  if (identity.account === undefined || identity.arn === undefined) {
    log('preflight: GetCallerIdentity returned no Account or Arn');
    return PREFLIGHT_EXIT.IDENTITY;
  }

  const bootstrapResult = await readBootstrapVersion(deps, region, identity.account);
  if (!bootstrapResult.ok) {
    log(bootstrapResult.message);
    return PREFLIGHT_EXIT.BOOTSTRAP;
  }

  log(`preflight: account ${identity.account}`);
  log(`preflight: caller ${identity.arn}`);
  log(`preflight: region ${region}`);
  log(`preflight: bootstrap version ${bootstrapResult.version} (minimum ${MIN_BOOTSTRAP_VERSION})`);
  log('preflight: OK');
  return PREFLIGHT_EXIT.OK;
}

type BootstrapResult = { ok: true; version: number } | { ok: false; message: string };

async function readBootstrapVersion(
  deps: PreflightDeps,
  region: string,
  account: string,
): Promise<BootstrapResult> {
  const notBootstrapped = `preflight: CDK not bootstrapped in ${account}/${region} — account-owner approval needed for cdk bootstrap`;
  let raw: string | undefined;
  try {
    raw = await deps.getBootstrapVersion(region);
  } catch (error) {
    if (error instanceof Error && error.name === 'ParameterNotFound') {
      return { ok: false, message: notBootstrapped };
    }
    return { ok: false, message: `preflight: ${formatError(error)}` };
  }
  const version = Number(raw);
  if (raw === undefined || !Number.isInteger(version)) {
    return { ok: false, message: notBootstrapped };
  }
  if (version < MIN_BOOTSTRAP_VERSION) {
    return {
      ok: false,
      message: `preflight: bootstrap version ${version} in ${account}/${region} is below the required ${MIN_BOOTSTRAP_VERSION} — account-owner approval needed to re-run cdk bootstrap`,
    };
  }
  return { ok: true, version };
}

/** Production dependencies: SDK v3 clients on the default credential chain. */
export function createSdkPreflightDeps(): PreflightDeps {
  return {
    resolveRegion: () => resolveRegion(),
    getCallerIdentity: async (region) => {
      const output = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
      return { account: output.Account, arn: output.Arn };
    },
    getBootstrapVersion: async (region) => {
      const output = await new SSMClient({ region }).send(
        new GetParameterCommand({ Name: BOOTSTRAP_VERSION_PARAMETER }),
      );
      return output.Parameter?.Value;
    },
  };
}

if (require.main === module) {
  void runPreflight(createSdkPreflightDeps(), (line) => {
    console.log(line);
  }).then((code) => {
    process.exitCode = code;
  });
}
