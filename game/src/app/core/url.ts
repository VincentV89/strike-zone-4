/**
 * URL flags (SD-AS-3, SEC-AS-14). Only `?e2e` is read; path and hash are never inspected, so any
 * path the SPA fallback serves boots the same app (req-refresh-routing, client side).
 */
export interface UrlFlags {
  /** Installs window.__strikezone (dec-e2e-test-hook). */
  readonly e2e: boolean;
}

export function parseUrlFlags(search: unknown): UrlFlags {
  const raw = typeof search === 'string' ? search : '';
  return Object.freeze({ e2e: new URLSearchParams(raw).has('e2e') });
}
