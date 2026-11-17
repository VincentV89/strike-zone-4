// SD-R-5 / SEC-R-12: three is pinned by lockfile integrity, MIT, with no dependencies or install
// scripts. A version bump fails here until the checklist (eval, URL, WebGPU marker, notice) is rerun.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const INTEGRITY =
  'sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==';

interface LockEntry {
  readonly version?: string;
  readonly integrity?: string;
  readonly license?: string;
  readonly dependencies?: Record<string, string>;
  readonly hasInstallScript?: boolean;
  readonly dev?: boolean;
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

describe('three supply chain', () => {
  const pkg = readJson(join(ROOT, 'package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = readJson(join(ROOT, 'package-lock.json')) as { packages: Record<string, LockEntry> };

  it('three ~0.187.0 is a runtime dependency; @types/three ~0.187.0 is dev only', () => {
    expect(pkg.dependencies?.three).toBe('~0.187.0');
    expect(pkg.devDependencies?.['@types/three']).toBe('~0.187.0');
    expect(pkg.dependencies?.['@types/three']).toBeUndefined();
  });

  it('lockfile pins 0.187.0 with the measured integrity, MIT, no deps, no install script', () => {
    const e = lock.packages['node_modules/three'];
    expect(e?.version).toBe('0.187.0');
    expect(e?.integrity).toBe(INTEGRITY);
    expect(e?.license).toBe('MIT');
    expect(e?.dependencies ?? {}).toEqual({});
    expect(e?.hasInstallScript ?? false).toBe(false);
    expect(lock.packages['node_modules/@types/three']?.dev).toBe(true);
  });

  it('ships a LICENSE with the MIT notice text and no URLs', () => {
    const require = createRequire(join(ROOT, 'package.json'));
    const root = join(dirname(require.resolve('three')), '..');
    const licence = readFileSync(join(root, 'LICENSE'), 'utf8');
    expect(licence).toContain('three.js authors');
    expect(licence).toContain('MIT License');
    expect(licence).not.toMatch(/https?:\/\//);
  });
});
