// ADR-PM-6: a 600-tick scripted run pinned by an FNV-1a digest literal (no snapshot file,
// because local verify runs without CI and Vitest would silently write a missing snapshot).
import { STEP_SEC, createFixedClock, vec3 } from '@sz/kernel';
import {
  EMPTY_CARRY,
  NEUTRAL_INTENT,
  applyLook,
  createPlayerMotion,
  distributeIntent,
  placePlayer,
  stepMovement,
  type PlayerInputIntent,
} from '@sz/player';
import { describe, expect, it } from 'vitest';
import { createFakeMover } from '../support/fakes';
import { fnv1a } from '../support/player-rig';

/** Frame script: frame index → intent. Varied frame lengths exercise 0..2-tick frames. */
function frameIntent(f: number): PlayerInputIntent {
  return {
    ...NEUTRAL_INTENT,
    look: { dx: f % 50 < 25 ? 3 : -2, dy: f % 90 < 45 ? 0.5 : -0.5 },
    move: { forward: f % 240 < 200 ? 1 : 0, right: f % 120 < 30 ? 1 : f % 120 > 90 ? -1 : 0 },
    sprint: f % 300 > 150,
    crouch: f % 400 > 340,
    jump: f % 97 === 0,
  };
}

function runScript(): { digest: string; ticks: number; footsteps: number } {
  const mover = createFakeMover();
  const motion = createPlayerMotion({ position: vec3(0, 0, 0), yaw: 0 });
  placePlayer(motion, mover, { position: vec3(0, 0, 0), yaw: 0.25 });
  const clock = createFixedClock({ stepHz: 60, maxSubsteps: 5 });
  const frameDts = [1 / 144, 1 / 60, 1 / 30, 1 / 90];
  let carry = EMPTY_CARRY;
  let ticks = 0;
  let footsteps = 0;
  const trace: string[] = [];
  for (let f = 0; ticks < 600; f++) {
    const intent = frameIntent(f);
    applyLook(motion, intent.look, 1.5);
    const { steps } = clock.advance(frameDts[f % frameDts.length]!);
    const out = distributeIntent(intent, steps, carry);
    carry = out.carry;
    for (const t of out.ticks) {
      if (ticks >= 600) break;
      const o = stepMovement(motion, t, mover, STEP_SEC, { move: true });
      if (o.footstep !== null) footsteps++;
      ticks++;
      const p = motion.position;
      trace.push(
        [p.x, p.y, p.z, motion.yaw, motion.pitch, motion.stance, o.footstep ?? '-']
          .map((v) => (typeof v === 'number' ? v.toFixed(9) : v))
          .join(','),
      );
    }
  }
  return { digest: fnv1a(trace.join('\n')), ticks, footsteps };
}

describe('600-tick scripted run (determinism)', () => {
  it('is reproducible and matches the pinned digest', () => {
    const a = runScript();
    const b = runScript();
    expect(a).toEqual(b);
    expect(a.ticks).toBe(600);
    expect(a.footsteps).toBeGreaterThan(0);
    expect(a.digest).toBe('32f6fd44');
  });
});
