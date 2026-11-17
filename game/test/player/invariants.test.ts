// SEC-P-02 / SEC-P-05: seeded fuzz over a hostile mover. No snapshots (ADR-PM-6).
import { STEP_SEC, createRng, degToRad, vec3, type CharacterMover, type Rng } from '@sz/kernel';
import {
  MOVEMENT_TUNING as T,
  applyLook,
  applyRecoil,
  createPlayerMotion,
  placePlayer,
  stepMovement,
} from '@sz/player';
import { describe, expect, it } from 'vitest';
import { createFakeMover } from '../support/fakes';
import { assertFiniteMotion, horizontalSpeed } from '../support/player-rig';

const HOSTILE = [Number.NaN, Infinity, -Infinity, 1e308, -1e308, 0];

function hostileMover(rng: Rng): CharacterMover {
  const inner = createFakeMover();
  return {
    move(id, v, dt) {
      const res = inner.move(id, v, dt);
      const r = rng.next();
      if (r < 0.02) return { ...res, position: vec3(Number.NaN, res.position.y, 0) };
      return {
        position: res.position,
        grounded: res.grounded || rng.next() < 0.05,
        hitCeiling: rng.next() < 0.05,
        collided: r < 0.12,
      };
    },
    setStance: (id, s) => rng.next() < 0.7 && inner.setStance(id, s),
    teleport: (id, p) => {
      inner.teleport(id, p);
    },
  };
}

const pick = <X>(rng: Rng, xs: ReadonlyArray<X>): X => rng.pick(xs) ?? xs[0]!;
const ax = (rng: Rng): -1 | 0 | 1 => pick(rng, [-1, 0, 1] as const);
const hostileOr = (rng: Rng, normal: number): number =>
  rng.next() < 0.1 ? pick(rng, HOSTILE) : normal;

describe.each([1, 2, 3])('invariants under seed %d (10 000 calls)', (seed) => {
  it('state stays finite and within bounds; nothing throws', () => {
    const rng = createRng(seed);
    const mover = hostileMover(rng);
    const motion = createPlayerMotion({ position: vec3(0, 0, 0), yaw: 0 });
    placePlayer(motion, mover, { position: vec3(0, 0, 0), yaw: 0 });
    const pitchLimit = degToRad(89);
    for (let i = 0; i < 10_000; i++) {
      const op = rng.next();
      if (op < 0.2) {
        applyLook(
          motion,
          { dx: hostileOr(rng, rng.range(-500, 500)), dy: hostileOr(rng, rng.range(-500, 500)) },
          hostileOr(rng, rng.range(0, 6)),
        );
      } else if (op < 0.25) {
        applyRecoil(motion, { pitchRad: hostileOr(rng, 0.02), yawRad: hostileOr(rng, -0.01) });
      } else if (op < 0.27) {
        placePlayer(motion, mover, {
          position: vec3(0, hostileOr(rng, 0), 0),
          yaw: rng.range(-9, 9),
        });
      } else {
        const dt = rng.next() < 0.05 ? pick(rng, HOSTILE) : STEP_SEC;
        stepMovement(
          motion,
          {
            move: { forward: ax(rng), right: ax(rng) },
            sprint: rng.next() < 0.5,
            crouch: rng.next() < 0.2,
            jump: rng.next() < 0.1,
          },
          mover,
          dt,
          { move: rng.next() < 0.9 },
        );
      }
      expect(assertFiniteMotion(motion)).toBe(true);
      expect(Math.abs(motion.pitch)).toBeLessThanOrEqual(pitchLimit);
      expect(motion.yaw).toBeGreaterThan(-Math.PI);
      expect(motion.yaw).toBeLessThanOrEqual(Math.PI);
      expect(horizontalSpeed(motion)).toBeLessThanOrEqual(T.sprintSpeed + 1e-9);
      expect(motion.velocity.y).toBeGreaterThanOrEqual(-T.terminalFallSpeed);
      expect(motion.velocity.y).toBeLessThanOrEqual(T.jumpVelocity);
      expect(motion.eyeHeight).toBeGreaterThanOrEqual(T.crouchEyeHeight - 1e-12);
      expect(motion.eyeHeight).toBeLessThanOrEqual(T.standEyeHeight + 1e-12);
    }
  });
});
