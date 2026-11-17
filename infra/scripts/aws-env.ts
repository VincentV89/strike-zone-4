/**
 * Shared helpers for the read-only operator scripts (preflight, stack-status, smoke).
 * Credentials always come from the default AWS SDK provider chain (SEC-HI-08); nothing here
 * reads or prints credential values.
 */
import { STSClient } from '@aws-sdk/client-sts';

export type Logger = (line: string) => void;

const REGION_ENV_KEYS = ['CDK_DEFAULT_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION'] as const;

/** First non-empty region from the environment, without consulting profiles. */
export function regionFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of REGION_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolves the region the way the CDK CLI does: environment first, then the active profile
 * through the SDK region provider. Returns undefined when nothing resolves (ADR-HI-6: there is
 * deliberately no default region).
 */
export async function resolveRegion(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const fromEnv = regionFromEnv(env);
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  try {
    const fromProfile = await new STSClient({}).config.region();
    return fromProfile.trim() === '' ? undefined : fromProfile;
  } catch {
    // The SDK throws "Region is missing" when no profile region exists. That is the
    // "no region" outcome the caller reports, not an error to propagate.
    return undefined;
  }
}

/**
 * Formats an error as `name: message` only. SDK errors also carry `$metadata` and request
 * details, which are never printed (security-design, secrets handling).
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
