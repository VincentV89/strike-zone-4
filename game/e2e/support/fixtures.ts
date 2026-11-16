/**
 * Guarded test fixture (security-design-verification-suite SD-VS-6). Every spec imports `test`
 * and `expect` from here; importing @playwright/test in a spec is lint-banned. The auto `guard`
 * fixture records console errors, page errors, crashes and every request with no allow-list,
 * aborts cross-origin requests on local runs, and fails the test at teardown if anything was
 * recorded or if the hook's own errors() list is not empty.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { redact } from '../../scripts/scan-secrets.mjs';
import { HookClient } from './hook';
import { LOCAL_BASE_URL, isAllowedRequest } from './policy';

const MAX_MESSAGE = 300;
const clip = (s: string): string => {
  const one = redact(s).replace(/\s+/g, ' ').trim();
  return one.length > MAX_MESSAGE ? `${one.slice(0, MAX_MESSAGE - 1)}…` : one;
};

interface GuardLog {
  readonly errors: string[];
  readonly warnings: string[];
  readonly requests: string[];
  readonly blocked: string[];
}

function attachPage(page: Page, log: GuardLog): void {
  page.on('console', (m) => {
    const type = m.type();
    if (type === 'error') log.errors.push(`console.error: ${clip(m.text())}`);
    else if (type === 'warning') log.warnings.push(clip(m.text()));
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${clip(e.message)}`));
  page.on('crash', () => log.errors.push('page crashed'));
}

async function hookErrors(page: Page): Promise<ReadonlyArray<string>> {
  if (page.isClosed()) return [];
  try {
    return await page.evaluate(() => [...(window.__strikezone?.errors() ?? [])]);
  } catch {
    return []; // navigation in progress or page gone: nothing to read
  }
}

async function routeLocal(context: BrowserContext, origin: string, log: GuardLog): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (isAllowedRequest(url, origin)) await route.continue();
    else {
      log.blocked.push(clip(url));
      await route.abort('blockedbyclient');
    }
  });
}

export interface Fixtures {
  /** Auto fixture; specs never use it directly. */
  readonly guard: GuardLog;
  /** Typed client for window.__strikezone; marks the test `injected` on first use. */
  readonly hook: HookClient;
}

export const test = base.extend<Fixtures>({
  guard: [
    async ({ context, page, baseURL }, use, testInfo) => {
      const origin = new URL(baseURL ?? LOCAL_BASE_URL).origin;
      const log: GuardLog = { errors: [], warnings: [], requests: [], blocked: [] };
      context.on('page', (p) => {
        attachPage(p, log);
      });
      attachPage(page, log);
      context.on('request', (r) => {
        const url = r.url();
        log.requests.push(url);
        if (!isAllowedRequest(url, origin)) log.blocked.push(clip(url));
      });
      // Local runs abort every other origin. Deployed runs only record: routing disables the
      // HTTP cache, and the deployed run must see real caching (SD-VS-6 step 4).
      if (testInfo.project.name === 'local') await routeLocal(context, origin, log);
      await use(log);
      const fromHook = await hookErrors(page);
      for (const w of log.warnings) testInfo.annotations.push({ type: 'warning', description: w });
      const blocked = [...new Set(log.blocked)];
      expect(log.errors, 'console errors, page errors or crashes').toEqual([]);
      expect(blocked, 'requests to another origin').toEqual([]);
      expect([...fromHook].map(clip), '__strikezone.errors()').toEqual([]);
    },
    { auto: true },
  ],
  hook: async ({ page }, use, testInfo) => {
    await use(new HookClient(page, testInfo));
  },
});

export { expect };

/**
 * SD-VS-3: rendering-dependent checks call this first. When the launch probe found no WebGL2,
 * the test is skipped with the only skip annotation the summariser maps to `manual-only`.
 */
export function requireWebgl(project: string): void {
  const path = join(import.meta.dirname, '..', '..', 'e2e-results', `launch-${project}.json`);
  const rec: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  const webgl2 =
    typeof rec === 'object' && rec !== null && Object.hasOwn(rec, 'webgl2')
      ? (rec as { webgl2: unknown }).webgl2 === true
      : false;
  test.skip(!webgl2, 'manual-only: webgl2-unavailable');
}
