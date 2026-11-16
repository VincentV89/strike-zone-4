/** Internal finite-first checks for bot-ai entry points (SD-AI-5). Not re-exported. */
import { isFiniteVec, type Vec3 } from '@sz/kernel';
import type { BotSelfView } from './types';

export function finiteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

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

/** Non-negative integer count, else 0. */
export function count(n: unknown): number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}

/** True when the self view can be acted on: finite position and eye. */
export function usableSelf(self: BotSelfView): boolean {
  return finiteVec(self.pos) && finiteVec(self.eye);
}
