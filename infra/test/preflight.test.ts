import { describe, expect, it } from 'vitest';
import {
  MIN_BOOTSTRAP_VERSION,
  PREFLIGHT_EXIT,
  runPreflight,
  type PreflightDeps,
} from '../scripts/preflight';
import { formatError, regionFromEnv } from '../scripts/aws-env';

const ACCOUNT = '123456789012';
const ARN = `arn:aws:sts::${ACCOUNT}:assumed-role/Operator/session`;

function sdkError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  // Real SDK errors carry request metadata; preflight must never print it.
  Object.assign(error, { $metadata: { requestId: 'req-SECRET-METADATA', httpStatusCode: 400 } });
  return error;
}

function deps(overrides: Partial<PreflightDeps> = {}): PreflightDeps {
  return {
    resolveRegion: () => Promise.resolve('eu-west-1'),
    getCallerIdentity: () => Promise.resolve({ account: ACCOUNT, arn: ARN }),
    getBootstrapVersion: () => Promise.resolve('28'),
    ...overrides,
  };
}

async function run(overrides: Partial<PreflightDeps> = {}) {
  const lines: string[] = [];
  const code = await runPreflight(deps(overrides), (line) => lines.push(line));
  return { code, output: lines.join('\n') };
}

describe('preflight (SEC-HI-16, req-aws-preflight)', () => {
  it('passes and records account, caller, region and bootstrap version', async () => {
    const { code, output } = await run();
    expect(code).toBe(PREFLIGHT_EXIT.OK);
    expect(output).toContain(`account ${ACCOUNT}`);
    expect(output).toContain(`caller ${ARN}`);
    expect(output).toContain('region eu-west-1');
    expect(output).toContain('bootstrap version 28');
  });

  it('exits 2 with the exact message when no region resolves', async () => {
    const getCallerIdentity = () => Promise.reject(new Error('must not be called'));
    const { code, output } = await run({
      resolveRegion: () => Promise.resolve(undefined),
      getCallerIdentity,
    });
    expect(code).toBe(PREFLIGHT_EXIT.NO_REGION);
    expect(output).toBe('preflight: no region resolved — set AWS_REGION or a profile region');
  });

  it('exits 3 and prints only name and message when credentials are missing', async () => {
    const { code, output } = await run({
      getCallerIdentity: () =>
        Promise.reject(sdkError('CredentialsProviderError', 'Could not load credentials')),
    });
    expect(code).toBe(PREFLIGHT_EXIT.IDENTITY);
    expect(output).toBe('preflight: CredentialsProviderError: Could not load credentials');
    expect(output).not.toContain('SECRET-METADATA');
  });

  it('exits 3 when the identity response is incomplete', async () => {
    const { code } = await run({
      getCallerIdentity: () => Promise.resolve({ account: undefined, arn: ARN }),
    });
    expect(code).toBe(PREFLIGHT_EXIT.IDENTITY);
  });

  it('exits 4 and asks for account-owner approval when CDK is not bootstrapped', async () => {
    const { code, output } = await run({
      getBootstrapVersion: () => Promise.reject(sdkError('ParameterNotFound', 'not found')),
    });
    expect(code).toBe(PREFLIGHT_EXIT.BOOTSTRAP);
    expect(output).toBe(
      `preflight: CDK not bootstrapped in ${ACCOUNT}/eu-west-1 — account-owner approval needed for cdk bootstrap`,
    );
  });

  it('exits 4 with both numbers when the bootstrap version is too old', async () => {
    const { code, output } = await run({
      getBootstrapVersion: () => Promise.resolve(String(MIN_BOOTSTRAP_VERSION - 1)),
    });
    expect(code).toBe(PREFLIGHT_EXIT.BOOTSTRAP);
    expect(output).toContain(`bootstrap version ${MIN_BOOTSTRAP_VERSION - 1}`);
    expect(output).toContain(`required ${MIN_BOOTSTRAP_VERSION}`);
  });

  it('exits 4 and reports the SDK error when the SSM read is denied', async () => {
    const { code, output } = await run({
      getBootstrapVersion: () => Promise.reject(sdkError('AccessDeniedException', 'denied')),
    });
    expect(code).toBe(PREFLIGHT_EXIT.BOOTSTRAP);
    expect(output).toBe('preflight: AccessDeniedException: denied');
  });

  it('prints no key material when the token has expired', async () => {
    const { output } = await run({
      getCallerIdentity: () => Promise.reject(sdkError('ExpiredToken', 'token expired')),
    });
    expect(output).not.toMatch(/AKIA|ASIA|aws_secret_access_key/i);
  });
});

describe('aws-env helpers', () => {
  it('prefers CDK_DEFAULT_REGION, then AWS_REGION, then AWS_DEFAULT_REGION', () => {
    expect(regionFromEnv({ CDK_DEFAULT_REGION: 'a', AWS_REGION: 'b' })).toBe('a');
    expect(regionFromEnv({ AWS_REGION: ' b ', AWS_DEFAULT_REGION: 'c' })).toBe('b');
    expect(regionFromEnv({ AWS_DEFAULT_REGION: 'c' })).toBe('c');
    expect(regionFromEnv({ AWS_REGION: '  ' })).toBeUndefined();
  });

  it('formats errors as name and message only', () => {
    expect(formatError(sdkError('ExpiredToken', 'expired'))).toBe('ExpiredToken: expired');
    expect(formatError('plain')).toBe('plain');
  });
});
