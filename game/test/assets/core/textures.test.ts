// BR-R-03, PD-R-8, CMP-R-02: seeded procedural textures; digests are literals, not snapshots.
import {
  SPRITE_KINDS,
  SPRITE_SIZE,
  TEXTURE_SIZE,
  generateMaterialPixels,
  generateSpritePixels,
  generateTextureSet,
} from '@sz/assets/core/textures';
import { MATERIAL_PALETTE, paletteRow } from '@sz/assets/core/palette';
import { describe, expect, it } from 'vitest';
import { fnv1a } from '../../support/digest';

// Node 24 / V8 values (Math.sin is engine-approximated, so determinism is per engine).
// A deliberate texture change updates these literals in the same commit.
const DIGESTS: Record<string, string> = {
  sand: '46f05bf2',
  'packed-earth': '69099143',
  plaster: 'ff0ecadc',
  concrete: '80252e0f',
  metal: '43189793',
  'crate-wood': 'f1444fe7',
  'container-paint': 'eeefa262',
};

describe('material textures (BR-R-03)', () => {
  it('has the 7 visible materials and no invisible one', () => {
    expect(MATERIAL_PALETTE.map((r) => r.id)).toEqual([
      'sand',
      'packed-earth',
      'plaster',
      'concrete',
      'metal',
      'crate-wood',
      'container-paint',
    ]);
    expect(paletteRow('invisible')).toBeUndefined();
    expect(paletteRow('__proto__')).toBeUndefined();
    expect(paletteRow(7)).toBeUndefined();
  });

  it.each(MATERIAL_PALETTE.map((r) => [r.id, r] as const))(
    '%s: 512² RGBA, opaque, pinned FNV-1a digest',
    (id, row) => {
      const px = generateMaterialPixels(row);
      expect(px.length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * 4);
      for (let i = 3; i < px.length; i += 4096) expect(px[i]).toBe(255);
      expect(fnv1a(px)).toBe(DIGESTS[id]);
    },
  );

  it('is deterministic: the same seed gives byte-identical pixels', () => {
    const row = MATERIAL_PALETTE[3];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(fnv1a(generateMaterialPixels(row, 64))).toBe(fnv1a(generateMaterialPixels(row, 64)));
  });

  it('materials differ from each other', () => {
    const digests = new Set(MATERIAL_PALETTE.map((r) => fnv1a(generateMaterialPixels(r, 32))));
    expect(digests.size).toBe(MATERIAL_PALETTE.length);
  });

  it('a hostile size falls back to 512', () => {
    const row = MATERIAL_PALETTE[0];
    if (row === undefined) throw new Error('palette empty');
    expect(generateMaterialPixels(row, Number.NaN).length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * 4);
    expect(generateMaterialPixels(row, 3).length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  });
});

describe('texture set progress (PD-R-8)', () => {
  it('yields before each material and reports 1/7 … 7/7', async () => {
    let yields = 0;
    const reports: string[] = [];
    const set = await generateTextureSet(
      () => {
        yields += 1;
        return Promise.resolve();
      },
      (p) => reports.push(`${String(p.done)}/${String(p.total)}`),
      16,
    );
    expect(yields).toBe(7);
    expect(reports).toEqual(['1/7', '2/7', '3/7', '4/7', '5/7', '6/7', '7/7']);
    expect(set.size).toBe(7);
  });

  it('works without a progress callback', async () => {
    const set = await generateTextureSet(() => Promise.resolve(), undefined, 8);
    expect(set.size).toBe(7);
  });
});

describe('effect sprites', () => {
  it.each(SPRITE_KINDS)('%s: 64² RGBA with transparent corners and a visible centre', (kind) => {
    const px = generateSpritePixels(kind);
    expect(px.length).toBe(SPRITE_SIZE * SPRITE_SIZE * 4);
    expect(px[3]).toBe(0);
    const c = ((SPRITE_SIZE / 2) * SPRITE_SIZE + SPRITE_SIZE / 2) * 4;
    expect(px[c + 3]).toBeGreaterThan(100);
  });
});
