/**
 * Deployed-site checks (tech-stack-decisions-verification-suite REL-VS-6, SEC-VS-13). Read-only
 * GETs and page loads on the CloudFront URL; run after `npm run deploy` (which already ran
 * preflight, stack-status and smoke). The guard only records requests here, so caching is real.
 */
import { specTitle } from '../support/checks';
import { expect, requireWebgl, test } from '../support/fixtures';
import { bootWithHook, startLive } from '../support/play';

test(specTitle('deployed-headers'), async ({ request }) => {
  for (const path of ['/', `/__sz-missing-${String(Date.now())}`]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    const h = res.headers();
    expect(h['content-type'] ?? '', path).toContain('text/html');
    const csp = h['content-security-policy'] ?? '';
    expect(csp, path).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp, path).toContain("connect-src 'self'");
    expect(csp.replace(/'wasm-unsafe-eval'/g, ''), path).not.toContain("'unsafe-eval'");
    expect(csp.split(/[\s;]+/), path).not.toContain('*');
    const hsts = /max-age=(\d+)/.exec(h['strict-transport-security'] ?? '');
    expect(Number(hsts?.[1] ?? 0), path).toBeGreaterThanOrEqual(31_536_000);
    expect(h['x-content-type-options'], path).toBe('nosniff');
  }
});

test(specTitle('deployed-refresh-deep-path'), async ({ page }) => {
  const res = await page.goto('/play/round/deep-link');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-type'] ?? '').toContain('text/html');
  await expect(page.getByTestId('ui-root')).toBeAttached({ timeout: 30_000 });
});

test(specTitle('deployed-short-round'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await bootWithHook(page, hook);
  await startLive(hook, { mapId: 'desert-compound', botCount: 5, difficulty: 'normal' }, 90);
  await hook.inject({ move: { forward: 1, right: 0 }, fire: true, firePressed: true }, 600);
  await page.waitForTimeout(11_000);
  const snap = await hook.snapshot();
  expect(snap?.bots).toHaveLength(5);
});
