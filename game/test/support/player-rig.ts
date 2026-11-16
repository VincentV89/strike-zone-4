// Shared helpers for player-movement tests.
import {
  PLAYER_ID,
  STEP_SEC,
  isFiniteVec,
  vec3,
  type ActorId,
  type CharacterMover,
  type MoveResult,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import {
  NEUTRAL_INTENT,
  createPlayerMotion,
  placePlayer,
  stepMovement,
  type MoveIntent,
  type MovementOutcome,
  type PlayerMotion,
} from '@sz/player';
import { createFakeMover } from './fakes';

export type IntentPatch = Partial<Omit<MoveIntent, 'move'>> & {
  readonly forward?: -1 | 0 | 1;
  readonly right?: -1 | 0 | 1;
};

export function moveIntent(p: IntentPatch = {}): MoveIntent {
  return {
    move: { forward: p.forward ?? 0, right: p.right ?? 0 },
    sprint: p.sprint ?? NEUTRAL_INTENT.sprint,
    crouch: p.crouch ?? NEUTRAL_INTENT.crouch,
    jump: p.jump ?? NEUTRAL_INTENT.jump,
  };
}

/** Counts calls on any CharacterMover. */
export function spyMover<M extends CharacterMover>(
  inner: M,
): M & { calls: { move: number; setStance: number; teleport: number } } {
  const calls = { move: 0, setStance: 0, teleport: 0 };
  return Object.assign(Object.create(inner) as M, {
    calls,
    move(id: ActorId, v: Vec3, dt: number): MoveResult {
      calls.move++;
      return inner.move(id, v, dt);
    },
    setStance(id: ActorId, s: Stance): boolean {
      calls.setStance++;
      return inner.setStance(id, s);
    },
    teleport(id: ActorId, pos: Vec3): void {
      calls.teleport++;
      inner.teleport(id, pos);
    },
  });
}

/** A mover over a height field `floorAt(x, z)`, with an optional wall at z = wallZ. */
export function createFieldMover(
  floorAt: (x: number, z: number) => number,
  opts: { readonly wallZ?: number; readonly ceilingY?: number } = {},
): CharacterMover {
  let pos: Vec3 = vec3(0, 0, 0);
  return {
    move(_id, v, dt) {
      let x = pos.x + v.x * dt;
      let z = pos.z + v.z * dt;
      let collided = false;
      if (opts.wallZ !== undefined && z < opts.wallZ) {
        z = opts.wallZ;
        collided = true;
      }
      let y = pos.y + v.y * dt;
      let hitCeiling = false;
      if (opts.ceilingY !== undefined && y + 1.8 > opts.ceilingY) {
        y = opts.ceilingY - 1.8;
        hitCeiling = true;
      }
      const floor = floorAt(x, z);
      const grounded = y <= floor;
      if (grounded) y = floor;
      x = Number.isFinite(x) ? x : pos.x;
      pos = vec3(x, y, z);
      return { position: pos, grounded, hitCeiling, collided };
    },
    setStance() {
      return true;
    },
    teleport(_id, p) {
      pos = p;
    },
  };
}

export interface Rig {
  readonly motion: PlayerMotion;
  readonly mover: CharacterMover;
  readonly run: (n: number, intent?: MoveIntent, locks?: { move: boolean }) => MovementOutcome[];
}

export function rig(mover: CharacterMover = createFakeMover(), at: Vec3 = vec3(0, 0, 0)): Rig {
  const motion = createPlayerMotion({ position: at, yaw: 0 });
  placePlayer(motion, mover, { position: at, yaw: 0 });
  return {
    motion,
    mover,
    run(n, intent = moveIntent(), locks = { move: true }) {
      const out: MovementOutcome[] = [];
      for (let i = 0; i < n; i++) out.push(stepMovement(motion, intent, mover, STEP_SEC, locks));
      return out;
    },
  };
}

export const horizontalSpeed = (m: PlayerMotion): number => Math.hypot(m.velocity.x, m.velocity.z);

export function assertFiniteMotion(m: PlayerMotion): boolean {
  return (
    isFiniteVec(m.position) &&
    isFiniteVec(m.velocity) &&
    isFiniteVec(m.prevPosition) &&
    Number.isFinite(m.yaw) &&
    Number.isFinite(m.pitch) &&
    Number.isFinite(m.eyeHeight) &&
    Number.isFinite(m.strideAccum)
  );
}

export { PLAYER_ID };

/** FNV-1a 32-bit over a string, as an 8-digit hex literal (ADR-PM-6). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
