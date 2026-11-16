/**
 * Canaries for the e2e lint override (security-design-verification-suite SD-VS-11). Each banned
 * pattern must report exactly once, and the allowed shapes must report nothing.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { E2E_IMPORT_PATTERN } from '../../eslint.zones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: tseslint.configs.disableTypeChecked as Linter.Config,
  });
});

async function hits(code: string, rel: string, ruleId: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, rel) });
  const messages = result?.messages ?? [];
  expect(
    messages.filter((m) => m.fatal === true),
    `parse error in ${rel}`,
  ).toEqual([]);
  return messages.filter((m) => m.ruleId === ruleId).length;
}

const SPEC = 'e2e/__canary__.spec.ts';
const SUPPORT = 'e2e/support/__canary__.ts';
const importOf = (spec: string): string => `import { x } from '${spec}';\nexport const y = x;\n`;

describe('e2e imports (SD-VS-11)', () => {
  it.each(E2E_IMPORT_PATTERN.samples)('bans %s', async (spec) => {
    expect(await hits(importOf(spec), SUPPORT, 'no-restricted-imports')).toBe(1);
  });

  it.each(['@playwright/test', '@axe-core/playwright', 'node:fs', 'node:path', './hook', '../x'])(
    'allows %s from a support module',
    async (spec) => {
      expect(await hits(importOf(spec), SUPPORT, 'no-restricted-imports')).toBe(0);
    },
  );

  it('bans a value import of @sz/round and allows a type-only one', async () => {
    expect(await hits(importOf('@sz/round'), SUPPORT, 'no-restricted-syntax')).toBe(1);
    const typeOnly = "import type { RoundView } from '@sz/round';\nexport type V = RoundView;\n";
    expect(await hits(typeOnly, SUPPORT, 'no-restricted-syntax')).toBe(0);
  });

  it('bans a direct value import of @playwright/test in a spec, but not types', async () => {
    expect(await hits(importOf('@playwright/test'), SPEC, 'no-restricted-syntax')).toBe(1);
    const types = "import type { Page } from '@playwright/test';\nexport type P = Page;\n";
    expect(await hits(types, SPEC, 'no-restricted-syntax')).toBe(0);
  });
});

describe('e2e syntax and globals (SD-VS-11)', () => {
  it.each([
    ['bypassCSP: true', 'export const c = { bypassCSP: true };\n'],
    ['ignoreHTTPSErrors: true', 'export const c = { ignoreHTTPSErrors: true };\n'],
    ['reuseExistingServer: true', 'export const c = { reuseExistingServer: true };\n'],
    ['a destroy command literal', "export const c = 'cdk destroy --all';\n"],
    ['an insecure browser flag', "export const c = ['--disable-web-security'];\n"],
    ['a process.env write', "process.env.X = '1';\nexport const c = 1;\n"],
    ['a default export', 'export default 1;\n'],
  ])('bans %s', async (_name, code) => {
    expect(await hits(code, SUPPORT, 'no-restricted-syntax')).toBe(1);
  });

  it.each(['fetch', 'XMLHttpRequest', 'WebSocket'])('bans the %s global', async (name) => {
    expect(await hits(`export const g = ${name};\n`, SPEC, 'no-restricted-globals')).toBe(1);
  });

  it('allows default exports only in the Playwright entry files', async () => {
    const code = 'export default 1;\n';
    for (const f of [
      'playwright.config.ts',
      'e2e/support/global-setup.ts',
      'e2e/support/reporter.ts',
    ]) {
      expect(await hits(code, f, 'no-restricted-syntax')).toBe(0);
    }
    expect(
      await hits(
        'export const c = { bypassCSP: true };\n',
        'playwright.config.ts',
        'no-restricted-syntax',
      ),
    ).toBe(1);
  });
});
