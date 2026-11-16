import { tickCount } from './guards';
import type { EdgeCarry, PlayerInputIntent } from './types';

/** No edges pending. */
export const EMPTY_CARRY: EdgeCarry = Object.freeze({
  jump: false,
  firePressed: false,
  reload: false,
  switchTo: null,
});

/** An intent with nothing held and no edges. */
export const NEUTRAL_INTENT: PlayerInputIntent = Object.freeze({
  look: Object.freeze({ dx: 0, dy: 0 }),
  move: Object.freeze({ forward: 0, right: 0 }),
  sprint: false,
  crouch: false,
  fire: false,
  aim: false,
  jump: false,
  firePressed: false,
  reload: false,
  switchTo: null,
});

export interface DistributedIntent {
  readonly ticks: ReadonlyArray<PlayerInputIntent>;
  readonly carry: EdgeCarry;
}

const NO_LOOK = Object.freeze({ dx: 0, dy: 0 });

/**
 * Splits one frame's intent across the frame's fixed ticks (BR-P-60 to BR-P-62).
 * Held fields repeat on every tick; edges go to the first tick only; a frame with 0 ticks
 * returns its edges as carry for the next frame. Tick intents always carry look {0, 0}
 * because look is applied once per frame (BR-P-10).
 */
export function distributeIntent(
  intent: PlayerInputIntent,
  steps: number,
  carry: EdgeCarry,
): DistributedIntent {
  const edges: EdgeCarry = {
    jump: intent.jump || carry.jump,
    firePressed: intent.firePressed || carry.firePressed,
    reload: intent.reload || carry.reload,
    switchTo: intent.switchTo ?? carry.switchTo,
  };
  const n = tickCount(steps);
  if (n === 0) return { ticks: [], carry: edges };
  const held: PlayerInputIntent = { ...intent, look: NO_LOOK, ...EMPTY_CARRY };
  const ticks: PlayerInputIntent[] = [{ ...held, ...edges }];
  for (let i = 1; i < n; i++) ticks.push(held);
  return { ticks, carry: EMPTY_CARRY };
}
