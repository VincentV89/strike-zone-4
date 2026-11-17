/** Internal finite-first checks for perception entry points (SD-AI-5). Not re-exported. */
import { isFiniteVec, type Vec3 } from '@sz/kernel';

/** True for a vector object whose three components are finite numbers. */
export function finiteVec(v: unknown): v is Vec3 {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<Record<'x' | 'y' | 'z', unknown>>;
  return (
    typeof c.x === 'number' &&
    typeof c.y === 'number' &&
    typeof c.z === 'number' &&
    isFiniteVec(v as Vec3)
  );
}

export function finiteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
