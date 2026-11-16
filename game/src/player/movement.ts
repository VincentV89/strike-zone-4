import {
  ZERO,
  add,
  horizontal,
  isFiniteVec,
  length,
  scale,
  sub,
  vec3,
  type CharacterMover,
  type Vec3,
} from '@sz/kernel';
import { axis } from './guards';
import type { PlayerMotion } from './motion';
import { MOVEMENT_TUNING as T } from './tuning';
import type { MoveIntent, MovementLocks, MovementOutcome } from './types';

const TINY = 1e-12;
const STRIDE_EPS = 1e-9;

/** Moves `from` toward `to` by at most maxDelta; never overshoots. */
function approach(from: Vec3, to: Vec3, maxDelta: number): Vec3 {
  const d = sub(to, from);
  const len = length(d);
  if (len <= maxDelta || len < TINY) return to;
  return add(from, scale(d, maxDelta / len));
}

function approachScalar(from: number, to: number, maxDelta: number): number {
  if (Math.abs(to - from) <= maxDelta) return to;
  return from + Math.sign(to - from) * maxDelta;
}

/** Caps the length of v at max. */
function capLength(v: Vec3, max: number): Vec3 {
  const len = length(v);
  return len > max && len > TINY ? scale(v, max / len) : v;
}

function outcomeAtRest(motion: PlayerMotion): MovementOutcome {
  return {
    grounded: motion.grounded,
    speed: 0,
    footstep: null,
    landed: false,
    outOfWorld: motion.placed && motion.position.y < T.killY,
  };
}

const UNPLACED: MovementOutcome = Object.freeze({
  grounded: false,
  speed: 0,
  footstep: null,
  landed: false,
  outOfWorld: false,
});

interface CleanIntent {
  readonly forward: -1 | 0 | 1;
  readonly right: -1 | 0 | 1;
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly jump: boolean;
}

/** Normalises axes and booleans; a move lock keeps only the current crouch (BR-P-26). */
function cleanIntent(motion: PlayerMotion, intent: MoveIntent, locks: MovementLocks): CleanIntent {
  if (!locks.move) {
    return { forward: 0, right: 0, sprint: false, crouch: motion.wantsCrouch, jump: false };
  }
  return {
    forward: axis(intent.move.forward),
    right: axis(intent.move.right),
    sprint: intent.sprint,
    crouch: intent.crouch,
    jump: intent.jump,
  };
}

/** Step 1: stance through the mover; the mover's answer is authoritative (BR-P-24, BR-P-25). */
function updateStance(motion: PlayerMotion, mover: CharacterMover, crouch: boolean): void {
  if (crouch && motion.stance === 'stand') {
    if (mover.setStance(motion.id, 'crouch')) motion.stance = 'crouch';
  } else if (!crouch && motion.stance === 'crouch') {
    if (mover.setStance(motion.id, 'stand')) motion.stance = 'stand';
  }
  motion.wantsCrouch = crouch;
}

/** Step 2: view-relative wish direction on the ground plane, normalised (BR-P-20). */
function wishDirection(yaw: number, forward: number, right: number): Vec3 {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const x = -s * forward + c * right;
  const z = -c * forward - s * right;
  const len = Math.hypot(x, z);
  return len < TINY ? ZERO : vec3(x / len, 0, z / len);
}

/** Step 3: target speed (BR-P-21). */
function targetSpeed(motion: PlayerMotion, intent: CleanIntent): number {
  if (motion.stance === 'crouch') return T.crouchSpeed;
  if (intent.sprint && intent.forward > 0 && motion.grounded) return T.sprintSpeed;
  return T.walkSpeed;
}

/** Step 4: bounded horizontal acceleration (BR-P-22, BR-P-23). */
function horizontalVelocity(motion: PlayerMotion, wish: Vec3, target: number, dt: number): Vec3 {
  const vh = horizontal(motion.velocity);
  const noInput = wish === ZERO;
  if (motion.grounded) {
    const rate = noInput ? T.groundDecel : T.groundAccel;
    return approach(vh, scale(wish, target), rate * dt);
  }
  if (noInput) return vh;
  return approach(vh, scale(wish, Math.max(target, length(vh))), T.airAccel * dt);
}

/** Step 8: footstep cadence (BR-P-50, BR-P-51). Mutates strideAccum. */
function footstep(motion: PlayerMotion, speed: number, dt: number): 'walk' | 'sprint' | null {
  const audible = motion.grounded && motion.stance === 'stand' && speed >= T.footstepMinSpeed;
  if (!audible) {
    motion.strideAccum = 0;
    return null;
  }
  const gait = speed > T.walkSpeed + T.sprintGaitMargin ? 'sprint' : 'walk';
  const stride = gait === 'sprint' ? T.sprintStride : T.walkStride;
  if (motion.strideAccum === 0) motion.strideAccum = stride / 2;
  motion.strideAccum += speed * dt;
  if (motion.strideAccum >= stride) {
    // strideAccum === 0 means "just started moving", so an exact-zero remainder is
    // stored as a tiny positive value to avoid an early half-stride step next tick.
    motion.strideAccum = Math.max(motion.strideAccum - stride, STRIDE_EPS);
    return gait;
  }
  return null;
}

/**
 * One fixed movement tick (business-logic-model §3, steps 0 to 9). Total: never throws.
 * Calls mover.move exactly once per valid placed tick and setStance at most once.
 * Position is only ever taken from the mover's MoveResult (BR-P-40).
 */
export function stepMovement(
  motion: PlayerMotion,
  intent: MoveIntent,
  mover: CharacterMover,
  dt: number,
  locks: MovementLocks,
): MovementOutcome {
  // Step 0: guards (BR-P-44, maxTickDt). NaN fails both comparisons.
  if (!motion.placed) return UNPLACED;
  if (!(dt > 0 && dt <= T.maxTickDt)) return outcomeAtRest(motion);
  const prev = motion.position;
  motion.prevPosition = prev;
  const clean = cleanIntent(motion, intent, locks);

  updateStance(motion, mover, clean.crouch);
  const wish = wishDirection(motion.yaw, clean.forward, clean.right);
  let vh = horizontalVelocity(motion, wish, targetSpeed(motion, clean), dt);

  // Step 5: vertical velocity (BR-P-30, BR-P-31).
  let vy: number;
  const jumped = motion.grounded && clean.jump && motion.stance === 'stand';
  if (jumped) vy = T.jumpVelocity;
  else if (motion.grounded) vy = T.groundStickVelocity;
  else vy = Math.max(motion.velocity.y - T.gravity * dt, -T.terminalFallSpeed);

  // Step 6: move through the port.
  const res = mover.move(motion.id, vec3(vh.x, vy, vh.z), dt);
  if (!isFiniteVec(res.position)) {
    motion.velocity = ZERO; // BR-P-42: keep the previous position
    return outcomeAtRest(motion);
  }
  const actualH = scale(horizontal(sub(res.position, prev)), 1 / dt);
  if (res.collided) vh = capLength(actualH, length(vh)); // BR-P-41
  vh = capLength(vh, T.sprintSpeed);
  const wasGrounded = motion.grounded;
  const grounded = res.grounded;
  if (res.hitCeiling && vy > 0) vy = 0; // BR-P-33
  if (grounded && !jumped) vy = 0; // BR-P-32
  vy = Math.min(Math.max(vy, -T.terminalFallSpeed), T.jumpVelocity);

  motion.position = res.position;
  motion.velocity = vec3(vh.x, vy, vh.z);
  motion.grounded = grounded;
  motion.airTimeSec = grounded ? 0 : motion.airTimeSec + dt;

  // Step 7: eye height eases toward the stance target (BR-P-25).
  const eyeTarget = motion.stance === 'crouch' ? T.crouchEyeHeight : T.standEyeHeight;
  motion.eyeHeight = approachScalar(motion.eyeHeight, eyeTarget, T.eyeLerpSpeed * dt);

  // Steps 8 and 9.
  const speed = length(actualH);
  return {
    grounded,
    speed,
    footstep: footstep(motion, speed, dt),
    landed: !wasGrounded && grounded,
    outOfWorld: motion.position.y < T.killY,
  };
}
