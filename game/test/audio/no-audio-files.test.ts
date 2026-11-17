// SEC-A-10 / BR-A-60: no audio file is committed anywhere in game/.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIO_FILE_EXTENSIONS } from '../../scripts/check-dist.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git']);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

describe('repository (BR-A-60)', () => {
  it('contains no audio files', () => {
    expect(walk(ROOT, []).filter((f) => AUDIO_FILE_EXTENSIONS.test(f))).toEqual([]);
  });

  it('the extension list catches common formats', () => {
    for (const f of ['a.wav', 'b.MP3', 'c.ogg', 'd.m4a', 'e.flac', 'f.webm', 'g.aac']) {
      expect(AUDIO_FILE_EXTENSIONS.test(f)).toBe(true);
    }
    expect(AUDIO_FILE_EXTENSIONS.test('adapter.ts')).toBe(false);
  });
});
