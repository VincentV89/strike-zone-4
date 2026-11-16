/**
 * Seeded procedural texture pixels (PD-R-8, LC-A-1). Pure: writes RGBA8 into a Uint8Array that
 * assets/gl wraps in a DataTexture. Every tile wraps seamlessly (RepeatWrapping on the GPU).
 */
import { createRng } from '@sz/kernel';
import { MATERIAL_PALETTE, type MaterialPaletteRow, type VisibleMaterialId } from './palette';

export const TEXTURE_SIZE = 512;
export const SPRITE_SIZE = 64;

export type SpriteKind = 'muzzle' | 'puff' | 'spark' | 'decal';
export const SPRITE_KINDS: ReadonlyArray<SpriteKind> = Object.freeze([
  'muzzle',
  'puff',
  'spark',
  'decal',
]);

/** A wrapping value-noise lattice of `cells` × `cells` random values in [0, 1). */
function lattice(seed: number, cells: number): Float32Array {
  const rng = createRng(seed);
  const out = new Float32Array(cells * cells);
  for (let i = 0; i < out.length; i++) out[i] = rng.next();
  return out;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Bilinear smoothstep sample of a wrapping lattice at u, v in [0, 1). */
function sampleNoise(grid: Float32Array, cells: number, u: number, v: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const ix0 = x0 % cells;
  const iy0 = y0 % cells;
  const ix1 = (ix0 + 1) % cells;
  const iy1 = (iy0 + 1) % cells;
  const a = grid[iy0 * cells + ix0] ?? 0;
  const b = grid[iy0 * cells + ix1] ?? 0;
  const c = grid[iy1 * cells + ix0] ?? 0;
  const d = grid[iy1 * cells + ix1] ?? 0;
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

const TAU = Math.PI * 2;

/** Brightness multiplier of the material's pattern at pixel (u, v); 1 means no change. */
function patternAt(row: MaterialPaletteRow, u: number, v: number, n: number): number {
  switch (row.pattern) {
    case 'ripples':
      return 1 + 0.05 * Math.sin(TAU * (v * 12 + n * 1.5));
    case 'patches':
      return n > 0.62 ? 0.86 : 1;
    case 'plain':
      return 1;
    case 'blocks': {
      const seamX = (u * 4) % 1 < 0.012;
      const seamY = (v * 4) % 1 < 0.012;
      return seamX || seamY ? 0.7 : 1;
    }
    case 'brushed':
      return (v * 2) % 1 < 0.008 ? 0.6 : 1 + 0.04 * Math.sin(TAU * v * 96);
    case 'planks': {
      const plank = Math.floor(v * 8);
      const seam = (v * 8) % 1 < 0.05;
      const grain = 0.06 * Math.sin(TAU * (u * 3 + plank * 0.37 + n * 2));
      return seam ? 0.55 : 1 + grain + (plank % 2 === 0 ? 0.03 : -0.03);
    }
    case 'corrugated':
      return 0.88 + 0.14 * (0.5 + 0.5 * Math.sin(TAU * u * 16));
  }
}

const toByte = (x: number): number => (x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x));

/** RGBA8 pixels for one material tile, size × size, alpha 255 (BR-R-03: same seed, same bytes). */
export function generateMaterialPixels(
  row: MaterialPaletteRow,
  size: number = TEXTURE_SIZE,
): Uint8Array {
  const n = Number.isInteger(size) && size >= 4 && size <= 2048 ? size : TEXTURE_SIZE;
  const coarse = lattice(row.seed, 8);
  const fine = lattice(row.seed ^ 0x9e3779b9, 32);
  const out = new Uint8Array(n * n * 4);
  const [r, g, b] = row.base;
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const noise = 0.65 * sampleNoise(coarse, 8, u, v) + 0.35 * sampleNoise(fine, 32, u, v);
      const k = (1 + row.variation * (noise - 0.5) * 2) * patternAt(row, u, v, noise);
      const i = (y * n + x) * 4;
      out[i] = toByte(r * k);
      out[i + 1] = toByte(g * k);
      out[i + 2] = toByte(b * k);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** RGBA8 sprite pixels (64²). Colour is white/neutral; effects tint per instance. */
export function generateSpritePixels(kind: SpriteKind): Uint8Array {
  const n = SPRITE_SIZE;
  const out = new Uint8Array(n * n * 4);
  const rng = createRng(0x5b17e0 + SPRITE_KINDS.indexOf(kind));
  const jitter = new Float32Array(8);
  for (let i = 0; i < jitter.length; i++) jitter[i] = rng.next();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2; // 0 centre, 1 at the edge midpoint
      const ang = Math.atan2(dy, dx);
      let lum = 255;
      let alpha = 0;
      switch (kind) {
        case 'muzzle': {
          const rays = Math.pow(Math.abs(Math.cos(ang * 3 + (jitter[0] ?? 0))), 8);
          alpha = Math.max(0, 1 - d) * (0.45 + 0.55 * rays);
          break;
        }
        case 'puff':
          alpha = Math.max(0, 1 - d) ** 2 * 0.8;
          lum = 200;
          break;
        case 'spark':
          alpha = Math.max(0, 1 - d * 1.6) ** 1.5;
          break;
        case 'decal':
          alpha = d < 0.35 ? 1 : Math.max(0, 1 - (d - 0.35) / 0.4) * 0.8;
          lum = d < 0.35 ? 18 : 60;
          break;
      }
      const i = (y * n + x) * 4;
      out[i] = lum;
      out[i + 1] = lum;
      out[i + 2] = lum;
      out[i + 3] = toByte(alpha * 255);
    }
  }
  return out;
}

export interface TextureSetProgress {
  readonly done: number;
  readonly total: number;
  readonly id: VisibleMaterialId;
}

/**
 * Generates every material tile, yielding to the host between materials so the loading screen
 * can repaint (PD-R-8). Reports progress 1/7 … 7/7.
 */
export async function generateTextureSet(
  yieldToHost: () => Promise<void>,
  onProgress: (p: TextureSetProgress) => void = () => undefined,
  size: number = TEXTURE_SIZE,
): Promise<ReadonlyMap<VisibleMaterialId, Uint8Array>> {
  const out = new Map<VisibleMaterialId, Uint8Array>();
  let done = 0;
  for (const row of MATERIAL_PALETTE) {
    await yieldToHost();
    out.set(row.id, generateMaterialPixels(row, size));
    done += 1;
    onProgress({ done, total: MATERIAL_PALETTE.length, id: row.id });
  }
  return out;
}
