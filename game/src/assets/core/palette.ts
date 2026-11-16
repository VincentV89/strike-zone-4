/**
 * Procedural material palette (req-procedural-assets, CMP-R-02). One row per visible map
 * MaterialId; 'invisible' boundary solids are never drawn. Each row has a fixed seed, so texture
 * pixels are identical on every run (BR-R-03).
 */
import type { MaterialId } from '@sz/maps';

export type VisibleMaterialId = Exclude<MaterialId, 'invisible'>;

export type TexturePattern =
  'ripples' | 'patches' | 'plain' | 'blocks' | 'brushed' | 'planks' | 'corrugated';

export interface MaterialPaletteRow {
  readonly id: VisibleMaterialId;
  /** Base colour, sRGB 0..255. */
  readonly base: readonly [number, number, number];
  /** Relative brightness variation from noise, 0..1. */
  readonly variation: number;
  readonly pattern: TexturePattern;
  readonly seed: number;
}

const rows: ReadonlyArray<MaterialPaletteRow> = [
  { id: 'sand', base: [214, 188, 140], variation: 0.12, pattern: 'ripples', seed: 0x5a4e01 },
  { id: 'packed-earth', base: [150, 118, 86], variation: 0.18, pattern: 'patches', seed: 0x5a4e02 },
  { id: 'plaster', base: [222, 206, 178], variation: 0.08, pattern: 'plain', seed: 0x5a4e03 },
  { id: 'concrete', base: [160, 160, 156], variation: 0.12, pattern: 'blocks', seed: 0x5a4e04 },
  { id: 'metal', base: [128, 136, 144], variation: 0.1, pattern: 'brushed', seed: 0x5a4e05 },
  { id: 'crate-wood', base: [158, 112, 64], variation: 0.16, pattern: 'planks', seed: 0x5a4e06 },
  {
    id: 'container-paint',
    base: [52, 104, 132],
    variation: 0.1,
    pattern: 'corrugated',
    seed: 0x5a4e07,
  },
];

/** Frozen, ordered list of the 7 visible materials (1/7 … 7/7 progress order). */
export const MATERIAL_PALETTE: ReadonlyArray<MaterialPaletteRow> = Object.freeze(
  rows.map((r) => Object.freeze(r)),
);

const BY_ID: ReadonlyMap<string, MaterialPaletteRow> = new Map(
  MATERIAL_PALETTE.map((r) => [r.id, r]),
);

/** Map lookup, so '__proto__' or 'invisible' return undefined (SD-R-3). */
export function paletteRow(id: unknown): MaterialPaletteRow | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}
