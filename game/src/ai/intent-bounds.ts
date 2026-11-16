/**
 * Output sanitiser (LC-AI-C16, SD-AI-5). Every tick() return passes through boundIntent, so no
 * bug in per-state logic can produce a non-finite, too-fast or over-pitched intent.
 */
import {
  BOT_STATES,
  clamp,
  dirFromYawPitch,
  vec3,
  wrapAngle,
  type BotStateName,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import type { TriggerIntent } from '@sz/weapons';
import { AI_RULES } from './rules';
import type { BotDecision, BotIntent } from './types';

export const IDLE_TRIGGER: TriggerIntent = Object.freeze({
  fire: false,
  reload: false,
  scope: false,
});

const ZERO_VELOCITY: Vec3 = Object.freeze(vec3(0, 0, 0));

/** Standing still, facing (yaw, pitch), trigger released. */
export function zeroIntent(yaw: number, pitch: number, stance: Stance = 'stand'): BotIntent {
  const y = Number.isFinite(yaw) ? wrapAngle(yaw) : 0;
  const p = Number.isFinite(pitch) ? clamp(pitch, -AI_RULES.maxPitchRad, AI_RULES.maxPitchRad) : 0;
  return Object.freeze({
    move: Object.freeze({ velocity: ZERO_VELOCITY, stance }),
    yaw: y,
    pitch: p,
    aimDir: Object.freeze(dirFromYawPitch(y, p)),
    trigger: IDLE_TRIGGER,
  });
}

export const ZERO_INTENT: BotIntent = zeroIntent(0, 0);

const HOLDS = new Map<BotStateName, BotDecision>(
  BOT_STATES.map((state) => [state, Object.freeze({ state, wantFire: false, wantReload: false })]),
);

/** No plan, no fire, no transition: the answer to an unusable input or a dead brain. */
export function holdDecision(state: BotStateName): BotDecision {
  return HOLDS.get(state) ?? Object.freeze({ state: 'patrol', wantFire: false, wantReload: false });
}

export interface BoundContext {
  /** Facing before this tick. */
  readonly prevYaw: number;
  readonly dt: number;
  readonly turnRateRad: number;
}

function finite(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x));
}

/** Clamps an intent to the BR-AI-73/76 limits or replaces it with ZERO_INTENT. */
export function boundIntent(intent: BotIntent, ctx: BoundContext): BotIntent {
  const v = intent.move.velocity;
  if (!finite(v.x, v.z, intent.yaw, intent.pitch, ctx.prevYaw, ctx.dt, ctx.turnRateRad)) {
    return ZERO_INTENT;
  }
  const speed = Math.hypot(v.x, v.z);
  const k = speed > AI_RULES.maxSpeed ? AI_RULES.maxSpeed / speed : 1;
  const maxTurn = Math.max(0, ctx.turnRateRad * ctx.dt);
  const yaw = wrapAngle(
    ctx.prevYaw + clamp(wrapAngle(intent.yaw - ctx.prevYaw), -maxTurn, maxTurn),
  );
  const pitch = clamp(intent.pitch, -AI_RULES.maxPitchRad, AI_RULES.maxPitchRad);
  const stance: Stance = intent.move.stance === 'crouch' ? 'crouch' : 'stand';
  return {
    move: { velocity: vec3(v.x * k, 0, v.z * k), stance },
    yaw,
    pitch,
    aimDir: dirFromYawPitch(yaw, pitch),
    trigger: {
      fire: intent.trigger.fire,
      reload: intent.trigger.reload,
      scope: false,
    },
  };
}
