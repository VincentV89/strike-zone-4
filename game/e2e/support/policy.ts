/**
 * Pure request and base-URL policy for the e2e guard (security-design-verification-suite
 * SD-VS-6, SD-VS-10). Uses only the WHATWG `URL` global, so it runs in Node, in Vitest and in
 * Playwright's test runner. Counted by coverage at 90/85.
 */

export const LOCAL_BASE_URL = 'http://127.0.0.1:4173';

/**
 * True for `data:` and `blob:` URLs and for URLs whose origin equals `baseOrigin` exactly after
 * parsing. Look-alike hosts and userinfo tricks (`https://site@evil.example`) parse to another
 * origin and are rejected.
 */
export function isAllowedRequest(url: string, baseOrigin: string): boolean {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(baseOrigin);
  } catch {
    return false;
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true;
  if (parsed.username !== '' || parsed.password !== '') return false;
  return parsed.origin === base.origin;
}

export type BaseUrlResult =
  | { readonly ok: true; readonly url: string; readonly origin: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Accepts only an https URL with no username, password, query or hash (SD-VS-10). Returns the
 * normalised URL with a trailing slash.
 */
export function parseBaseUrl(raw: unknown): BaseUrlResult {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'no-deployed-url' };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'userinfo' };
  if (u.search !== '' || u.hash !== '') return { ok: false, reason: 'query-or-hash' };
  const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
  return { ok: true, url: `${u.origin}${path}`, origin: u.origin };
}

/**
 * Finds `SiteUrl` in a parsed `infra/cdk-outputs.json` ({ <stack>: { SiteUrl } }). Only that
 * field is read; every other output is ignored.
 */
export function siteUrlFromOutputs(outputs: unknown): string | undefined {
  if (typeof outputs !== 'object' || outputs === null) return undefined;
  for (const stack of Object.values(outputs as Record<string, unknown>)) {
    if (typeof stack !== 'object' || stack === null) continue;
    if (!Object.hasOwn(stack, 'SiteUrl')) continue;
    const v = (stack as Record<string, unknown>)['SiteUrl'];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Cuts a captured message to one line of at most `max` characters. */
export function firstLine(text: unknown, max = 300): string {
  const raw = typeof text === 'string' ? text : text instanceof Error ? text.message : '';
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // A dynamic-loader failure is the informative line; prefer it over Playwright's preamble.
  const pick = lines.find((l) => /error while loading shared libraries/i.test(l)) ?? lines[0] ?? '';
  return pick.length > max ? `${pick.slice(0, max - 1)}…` : pick;
}
