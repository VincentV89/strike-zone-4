import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDist, findExternalUrls, findIndexHtmlProblems } from '../../scripts/check-dist.mjs';

const GOOD_INDEX =
  '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body></body></html>';

let dirs: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sz-dist-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('check-dist (SD-K-3)', () => {
  it('passes a clean build', () => {
    const root = makeRoot({ 'dist/index.html': GOOD_INDEX, 'dist/assets/index-abc.js': 'x=1;' });
    expect(checkDist(root)).toEqual([]);
  });

  it('SEC-K-13: flags inline scripts and inline event handlers', () => {
    expect(findIndexHtmlProblems('<script>alert(1)</script>')).toEqual([
      'inline <script> without src',
    ]);
    expect(findIndexHtmlProblems('<body onload="x()"></body>')).toEqual([
      'inline on* event handler attribute',
    ]);
    expect(findIndexHtmlProblems(GOOD_INDEX)).toEqual([]);
  });

  it('SEC-K-14: flags external URLs but not licence banners or source-map lines', () => {
    expect(findExternalUrls('fetch("https://cdn.example.com/x.js")')).toEqual([
      'https://cdn.example.com/x.js',
    ]);
    expect(findExternalUrls('/*! MIT https://example.com/license */ x=1;')).toEqual([]);
    expect(findExternalUrls('x=1;\n//# sourceMappingURL=http://a/b.map')).toEqual([]);
    const root = makeRoot({ 'dist/index.html': GOOD_INDEX, 'dist/assets/a.js': 'u="http://x.io"' });
    expect(checkDist(root)).toEqual(['dist/assets/a.js: external URL http://x.io']);
  });

  it('fails when index.html is missing or public/ is not empty (BR-K-59)', () => {
    const root = makeRoot({ 'dist/assets/a.js': '1', 'public/robots.txt': 'x' });
    const failures = checkDist(root);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('dist/index.html is missing');
    expect(failures[1]).toContain('public/ is not empty');
  });

  describe('Rapier notice (SD-WM-11)', () => {
    const PKG = JSON.stringify({ dependencies: { '@dimforge/rapier3d-compat': '~0.21.0' } });
    const NOTICE =
      'StrikeZone third-party notices\n@dimforge/rapier3d-compat 0.21.0\nApache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\nhttp://www.apache.org/licenses/LICENSE-2.0\n';
    const base = { 'package.json': PKG, 'dist/index.html': GOOD_INDEX };

    it('passes with exactly one notice carrying the two Apache URLs', () => {
      const root = makeRoot({ ...base, 'dist/assets/third-party-notices-Ab_1.txt': NOTICE });
      expect(checkDist(root)).toEqual([]);
    });

    it('fails when the notice is missing or duplicated', () => {
      expect(checkDist(makeRoot(base))).toEqual([
        'expected exactly one dist/assets/third-party-notices-*.txt, found 0 (SD-WM-11)',
      ]);
      const two = makeRoot({
        ...base,
        'dist/assets/third-party-notices-a.txt': NOTICE,
        'dist/assets/third-party-notices-b.txt': NOTICE,
      });
      expect(checkDist(two)[0]).toContain('found 2');
    });

    it('fails on any other URL in the notice, or on missing licence text', () => {
      const root = makeRoot({
        ...base,
        'dist/assets/third-party-notices-x.txt': NOTICE.replace(
          'Version 2.0',
          'see https://evil.example/',
        ),
      });
      expect(checkDist(root)).toEqual([
        'dist/assets/third-party-notices-x.txt: external URL https://evil.example/,',
        'dist/assets/third-party-notices-x.txt: missing "Version 2.0"',
      ]);
    });

    it('an allowed Apache URL anywhere else still fails', () => {
      const root = makeRoot({
        ...base,
        'dist/assets/third-party-notices-x.txt': NOTICE,
        'dist/assets/index-1.js': 'u="http://www.apache.org/licenses/"',
      });
      expect(checkDist(root)).toEqual([
        'dist/assets/index-1.js: external URL http://www.apache.org/licenses/',
      ]);
    });
  });
});
