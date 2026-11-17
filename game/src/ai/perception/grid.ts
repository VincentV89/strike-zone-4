/** Uniform XZ grid of live bots, rebuilt every tick (req-ai-performance "spatial grid"). */
import type { ActorId, Vec3 } from '@sz/kernel';

/** Cell coordinates stay within ±2^15, which covers any map under 262 km at 8 m cells. */
const OFFSET = 32768;

export interface SpatialGrid {
  rebuild(entries: ReadonlyArray<{ readonly id: ActorId; readonly feet: Vec3 }>): void;
  /** Ids in every cell that overlaps the square around p of half-size r. */
  near(p: Vec3, r: number): ActorId[];
  clear(): void;
  readonly size: number;
}

export function createSpatialGrid(cellSize: number): SpatialGrid {
  const cells = new Map<number, ActorId[]>();
  let size = 0;
  const cellOf = (v: number) => Math.floor(v / cellSize) + OFFSET;
  const key = (cx: number, cz: number) => cx * 65536 + cz;

  return {
    rebuild(entries) {
      cells.clear();
      size = 0;
      for (const e of entries) {
        const k = key(cellOf(e.feet.x), cellOf(e.feet.z));
        const list = cells.get(k);
        if (list) list.push(e.id);
        else cells.set(k, [e.id]);
        size++;
      }
    },
    near(p, r) {
      const out: ActorId[] = [];
      const x0 = cellOf(p.x - r);
      const x1 = cellOf(p.x + r);
      const z0 = cellOf(p.z - r);
      const z1 = cellOf(p.z + r);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const list = cells.get(key(cx, cz));
          if (list) out.push(...list);
        }
      }
      return out;
    },
    clear() {
      cells.clear();
      size = 0;
    },
    get size() {
      return size;
    },
  };
}
