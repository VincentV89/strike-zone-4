/**
 * Secret patterns for SEC-HI-08. Shared by the template assertion test and the bundle scan in
 * the smoke check so both look for the same things.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /aws_secret_access_key/i,
];

/** Returns the source of every pattern that matches `text`. Empty means clean. */
export function findSecretMatches(text: string): string[] {
  return SECRET_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}
