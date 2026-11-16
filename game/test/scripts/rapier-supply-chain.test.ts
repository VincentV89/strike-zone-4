// SD-WM-10 / SEC-WM-09: the Rapier supply chain is pinned. A version bump fails here until
// someone re-runs the checklist (deps, install scripts, eval and URL scan, integrity) and
// updates these literals. The package scan also runs on the installed file, because until
// app-shell imports @sz/physics no Rapier code reaches dist/ for check-dist to see.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findExternalUrls } from '../../scripts/check-dist.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NAME = '@dimforge/rapier3d-compat';
const INTEGRITY =
  'sha512-tCl1HPGwOhn5aCQbgqWbOH+Nx/5fnr3IPAnzQuR7zIhC/raqi2yxC6LhvZqjdI2El5hQgY5RDAwDrAjAi2FdPA==';

interface LockEntry {
  readonly version?: string;
  readonly integrity?: string;
  readonly license?: string;
  readonly dependencies?: Record<string, string>;
  readonly hasInstallScript?: boolean;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Rapier supply chain', () => {
  const pkg = readJson(join(ROOT, 'package.json')) as { dependencies?: Record<string, string> };
  const lock = readJson(join(ROOT, 'package-lock.json')) as { packages: Record<string, LockEntry> };
  const entry = lock.packages[`node_modules/${NAME}`];

  it('is pinned to ~0.21.0; the only other runtime dependency is three (presentation-3d)', () => {
    expect(pkg.dependencies).toEqual({ [NAME]: '~0.21.0', three: '~0.187.0' });
  });

  it('resolves to 0.21.x from game/ despite the nested 0.12 copy under @types/three (SD-R-5)', () => {
    const require = createRequire(join(ROOT, 'package.json'));
    const root = join(dirname(require.resolve(NAME)), '..');
    const version = (readJson(join(root, 'package.json')) as { version: string }).version;
    expect(version).toMatch(/^0\.21\./);
  });

  it('lockfile pins the measured integrity, Apache-2.0, no dependencies, no install script', () => {
    expect(entry).toBeDefined();
    expect(entry?.version).toBe('0.21.0');
    expect(entry?.integrity).toBe(INTEGRITY);
    expect(entry?.license).toBe('Apache-2.0');
    expect(entry?.dependencies).toBeUndefined();
    expect(entry?.hasInstallScript).toBeUndefined();
  });

  it('the installed rapier.mjs has no eval, no new Function and no http(s) URL', () => {
    const require = createRequire(import.meta.url);
    const root = join(dirname(require.resolve(NAME)), '..');
    const installed = readJson(join(root, 'package.json')) as { version: string };
    expect(installed.version).toBe('0.21.0');
    const code = readFileSync(join(root, 'dist', 'rapier.mjs'), 'utf8');
    expect(code.length).toBeGreaterThan(1_000_000);
    expect(code.includes('eval(')).toBe(false);
    expect(/new\s+Function\s*\(/.test(code)).toBe(false);
    expect(findExternalUrls(code)).toEqual([]);
    expect(readFileSync(join(root, 'LICENSE'), 'utf8')).toContain('Apache License');
  });
});
