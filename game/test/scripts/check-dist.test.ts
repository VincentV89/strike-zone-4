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
});
