/** Navigation entry guards (SD-WM-7). Internal; not re-exported from the barrel. */
import { isFiniteVec, type Vec3 } from '@sz/kernel';

/** Finite and inside a generous world box, so NaN comparisons never pass a range check. */
export function okPoint(p: Vec3): boolean {
  return (
    isFiniteVec(p) && Math.abs(p.x) <= 10_000 && Math.abs(p.y) <= 10_000 && Math.abs(p.z) <= 10_000
  );
}

export function okNodeId(id: number, count: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < count;
}
