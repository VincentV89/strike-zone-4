/**
 * SD-VS-5 two-tier clean and SD-VS-13 dependency shape. Pure reads of package.json and
 * .gitignore; a stand-in for `npm ls --omit=dev` that needs no network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const GAME = join(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(GAME, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const gitignore = readFileSync(join(GAME, '.gitignore'), 'utf8')
  .split('\n')
  .map((l) => l.trim().replace(/^\//, '').replace(/\/$/, '')); // anchored or not

const BUILD_OUTPUTS = ['dist', 'coverage', 'playwright-report', 'test-results', 'blob-report'];
const EVIDENCE = ['e2e-results', 'evidence'];
const listed = (script: string): string[] => {
  const arr = /\[([^\]]*)\]/.exec(pkg.scripts[script] ?? '')?.[1] ?? '';
  return [...arr.matchAll(/'([\w-]+)'/g)].map((m) => m[1] ?? '');
};

describe('two-tier clean (SD-VS-5)', () => {
  it('clean removes build outputs only, so root verify keeps evidence/', () => {
    expect(listed('clean').sort()).toEqual([...BUILD_OUTPUTS].sort());
  });

  it('clean:evidence removes e2e-results and evidence only', () => {
    expect(listed('clean:evidence').sort()).toEqual([...EVIDENCE].sort());
  });

  it.each([...BUILD_OUTPUTS, ...EVIDENCE])('%s is git-ignored', (dir) => {
    expect(gitignore).toContain(dir);
  });

  it('evidence ignores are anchored, so game/test/evidence/ (the evidence test) is tracked', () => {
    const raw = readFileSync(join(GAME, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    expect(raw).toContain('/evidence/');
    expect(raw).toContain('/e2e-results/');
  });
});

describe('dependencies (SD-VS-13, SEC-VS-40)', () => {
  it('runtime dependencies are exactly Rapier and three', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@dimforge/rapier3d-compat', 'three']);
  });

  it('Playwright and axe are pinned devDependencies', () => {
    expect(pkg.devDependencies['@playwright/test']).toBe('~1.65.1');
    expect(pkg.devDependencies['@axe-core/playwright']).toBe('4.14.0');
  });

  it('e2e scripts keep the summariser exit code and e2e is not part of verify (ADR-VS-1)', () => {
    expect(pkg.scripts['e2e']).toContain('node scripts/run-e2e.mjs --project local');
    expect(pkg.scripts['e2e:deployed']).toBe('node scripts/run-e2e.mjs --project deployed');
    expect(pkg.scripts['verify']).not.toContain('e2e');
  });
});
