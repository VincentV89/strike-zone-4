import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkDist,
  findDynamicCode,
  findExternalUrls,
  findIndexHtmlProblems,
  sizeReport,
} from '../../scripts/check-dist.mjs';

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

  it('SEC-A-10: fails on audio files in dist (BR-A-60)', () => {
    const root = makeRoot({
      'dist/index.html': GOOD_INDEX,
      'dist/assets/shot-abc.wav': 'RIFF',
      'dist/assets/music.MP3': 'ID3',
    });
    expect(checkDist(root).sort()).toEqual([
      'dist/assets/music.MP3: audio file in dist (BR-A-60)',
      'dist/assets/shot-abc.wav: audio file in dist (BR-A-60)',
    ]);
  });

  describe('XML namespace allow-list (SD-UI-15)', () => {
    it('allows the SVG and XHTML namespace strings in .js files', () => {
      const root = makeRoot({
        'dist/index.html': GOOD_INDEX,
        'dist/assets/index-1.js': 'a="http://www.w3.org/2000/svg";b="http://www.w3.org/1999/xhtml"',
      });
      expect(checkDist(root)).toEqual([]);
    });

    it('rejects near misses and the namespace in non-js files', () => {
      const root = makeRoot({
        'dist/index.html': GOOD_INDEX,
        'dist/assets/index-1.js': 'a="http://www.w3.org/2000/svgx"',
        'dist/assets/index-1.css': 'a{b:"http://www.w3.org/2000/svg"}',
      });
      expect(checkDist(root).sort()).toEqual([
        'dist/assets/index-1.css: external URL http://www.w3.org/2000/svg',
        'dist/assets/index-1.js: external URL http://www.w3.org/2000/svgx',
      ]);
    });
  });

  describe('presentation-3d rules (SD-R-4)', () => {
    it('allows only the exact XHTML namespace URL in code', () => {
      const ok = makeRoot({
        'dist/index.html': GOOD_INDEX,
        'dist/assets/three-1.js': 'createElementNS("http://www.w3.org/1999/xhtml","canvas")',
      });
      expect(checkDist(ok)).toEqual([]);
      const bad = makeRoot({
        'dist/index.html': GOOD_INDEX,
        'dist/assets/a.js':
          'a="http://www.w3.org/1999/xhtml-evil";b="https://www.w3.org/1999/xhtml"',
        'dist/assets/n.css': 'x{u:"http://www.w3.org/1999/xhtml"}',
      });
      expect(checkDist(bad).sort()).toEqual([
        'dist/assets/a.js: external URL http://www.w3.org/1999/xhtml-evil',
        'dist/assets/a.js: external URL https://www.w3.org/1999/xhtml',
        'dist/assets/n.css: external URL http://www.w3.org/1999/xhtml',
      ]);
    });

    it('fails on binary assets (CMP-R-02)', () => {
      const root = makeRoot({
        'dist/index.html': GOOD_INDEX,
        'dist/assets/tex.png': 'x',
        'dist/assets/m.glb': 'x',
        'dist/favicon.svg': '<svg/>',
      });
      expect(checkDist(root).sort()).toEqual([
        'dist/assets/m.glb: binary asset in dist (CMP-R-02)',
        'dist/assets/tex.png: binary asset in dist (CMP-R-02)',
        'dist/favicon.svg: binary asset in dist (CMP-R-02)',
      ]);
    });

    it('fails on eval( and new Function in code (SEC-R-10)', () => {
      expect(findDynamicCode('x=eval("1")')).toEqual(['eval(']);
      expect(findDynamicCode('f=new Function("a","return a")')).toEqual(['new Function']);
      expect(findDynamicCode('retrieval(1); o.eval(2); evaluate(3)')).toEqual([]);
      const root = makeRoot({ 'dist/index.html': GOOD_INDEX, 'dist/assets/a.js': 'eval (x)' });
      expect(checkDist(root)).toEqual(['dist/assets/a.js: eval( (SEC-R-10)']);
    });

    it('WebGPU marker matches the class name but not isWebGPURenderer (NFR-R-S2)', () => {
      const ok = makeRoot({
        'dist/index.html': GOOD_INDEX,
        'dist/assets/a.js': 'if(r.isWebGPURenderer){}',
      });
      expect(checkDist(ok)).toEqual([]);
      for (const code of ['class WebGPURenderer{}', 'n="WebGPURenderer"']) {
        const bad = makeRoot({ 'dist/index.html': GOOD_INDEX, 'dist/assets/a.js': code });
        expect(checkDist(bad)).toEqual(['dist/assets/a.js: WebGPURenderer in bundle (NFR-R-S2)']);
      }
    });

    it('requires the three MIT notice when three is a dependency (CMP-R-01)', () => {
      const pkg = JSON.stringify({ dependencies: { three: '~0.187.0' } });
      const base = { 'package.json': pkg, 'dist/index.html': GOOD_INDEX };
      expect(checkDist(makeRoot(base))[0]).toContain('found 0');
      const good = 'three 0.187.0 (MIT License)\nCopyright © 2010-2026 three.js authors\n';
      expect(
        checkDist(makeRoot({ ...base, 'dist/assets/third-party-notices-q.txt': good })),
      ).toEqual([]);
      expect(
        checkDist(makeRoot({ ...base, 'dist/assets/third-party-notices-q.txt': 'MIT License' })),
      ).toEqual(['dist/assets/third-party-notices-q.txt: missing "three.js authors"']);
    });

    it("needs both packages' notice text when Rapier and three ship", () => {
      const pkg = JSON.stringify({
        dependencies: { three: '~0.187.0', '@dimforge/rapier3d-compat': '~0.21.0' },
      });
      const notice =
        'three.js authors MIT License\n@dimforge/rapier3d-compat Apache License Version 2.0';
      const root = makeRoot({
        'package.json': pkg,
        'dist/index.html': GOOD_INDEX,
        'dist/assets/third-party-notices-z.txt': notice,
      });
      expect(checkDist(root)).toEqual([]);
    });

    it('prints an advisory size line per chunk and a total', () => {
      const root = makeRoot({
        'dist/index.html': GOOD_INDEX,
        'dist/assets/b.js': 'x=1;',
        'dist/assets/a.js': 'y',
      });
      const lines = sizeReport(root);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatch(/^check:dist size a\.js: 1 B raw, \d+ B gzip$/);
      expect(lines[2]).toMatch(/total: 5 B raw/);
      expect(sizeReport(makeRoot({}))).toEqual([]);
    });
  });
});
