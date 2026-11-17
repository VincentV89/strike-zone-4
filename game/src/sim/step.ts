/**
 * The fixed system order of one simulation tick (business-logic-model §3, BR-ML-31, LC-ML-02):
 * 0 budget and log reset, 1 player movement, 2 perception input, 3 sense, 4 scheduled decide,
 * 5 bot tick and move, 6 hitbox sync, 7 one physics step, 8a player weapon, 8b bot weapons in
 * ascending id order (9 reactions run inside the sink as shots apply), 10 player view, 11 flush.
 */
import { decide, tick as tickBrain, zeroIntent, IDLE_TRIGGER, type BotSelfView } from '@sz/ai';
import { createTargetSample } from '@sz/ai/perception';
import { applyResolution, resolveShot, type EventSink } from '@sz/combat';
import {
  PLAYER_ID,
  STEP_SEC,
  dirFromYawPitch,
  isFiniteVec,
  vec3,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import {
  applyRecoil,
  eyePosition,
  placePlayer,
  stepMovement,
  type PlayerInputIntent,
} from '@sz/player';
import { tickWeapon, weaponStats, weaponView, type ShotRequest } from '@sz/weapons';
import { botChest, botEye, type BotActor, type PlayerActor } from './actors';
import { SIM_RULES } from './rules';
import { logTransition } from './sink';
import type { SimState } from './state';
import { playerTrigger } from './trigger';

/** Countdown: {move:false, fire:false, ai:false}. Live: all true (BR-ML-13). */
export interface SimGates {
  readonly move: boolean;
  readonly fire: boolean;
  readonly ai: boolean;
}

const nowOf = (s: SimState): number => s.tick * STEP_SEC;

function selfOf(b: BotActor, now: number): BotSelfView {
  return {
    id: b.id,
    pos: b.pos,
    eye: botEye(b),
    alive: b.alive,
    health: b.vitals.health,
    weapon: weaponView(b.inv, now, false),
  };
}

/** Step 1. Footsteps go to audio only, never to perception (Q3, BR-ML-39). */
function movePlayer(s: SimState, p: PlayerActor, intent: PlayerInputIntent, gates: SimGates): void {
  if (!p.alive) return;
  const { physics, map } = s.deps;
  const o = stepMovement(p.motion, intent, physics, STEP_SEC, { move: gates.move });
  p.speed = o.speed;
  if (o.footstep !== null) {
    s.log.log({ type: 'Footstep', actor: p.id, pos: p.motion.position, gait: o.footstep });
  }
  if (o.outOfWorld || p.motion.position.y < map.bounds.killY) {
    placePlayer(p.motion, physics, p.spawn); // BR-ML-36: vitals and inventory are kept
  }
}

/** Steps 2 to 4; skipped while !gates.ai. Per-bot calls run inside containment (SD-ML-5). */
function senseAndDecide(s: SimState, p: PlayerActor, now: number): void {
  const { perception, world, containment } = s;
  perception.updatePositions(s.bots.map((b) => ({ id: b.id, feet: b.pos, alive: b.alive })));
  perception.processNoises(now);
  const target = createTargetSample(PLAYER_ID, p.motion.position, p.motion.eyeHeight, p.alive);
  for (const b of s.bots) {
    if (!b.alive) continue;
    const vision = {
      rangeM: b.brain.params.visionRangeM,
      fovRad: SIM_RULES.botFovRad,
      vFovHalfRad: SIM_RULES.botVFovHalfRad,
    };
    const bot = { id: b.id, eye: botEye(b), yaw: b.brain.aim.yaw, alive: true };
    containment.guard(b.id, () => perception.sense(bot, target, world.sight, vision, now));
  }
  for (const b of s.bots) {
    if (!b.alive || !s.scheduler.shouldDecide(b.index, s.tick)) continue;
    const d = containment.guard(b.id, () =>
      decide(b.brain, perception.perceptsFor(b.id, now), selfOf(b, now), world, now),
    );
    if (d?.transition) logTransition(s, b.id, d.transition);
  }
}

/** Step 5 vertical motion and kill-Y (BR-ML-35, BR-ML-36). */
function integrateBot(s: SimState, b: BotActor, velocity: Vec3, stance: Stance): void {
  const { physics, map } = s.deps;
  b.vy = b.grounded
    ? SIM_RULES.botStickVy
    : Math.max(b.vy - SIM_RULES.botGravity * STEP_SEC, -SIM_RULES.botTerminalFall);
  const r = physics.move(b.id, vec3(velocity.x, b.vy, velocity.z), STEP_SEC);
  b.prevPos = b.pos;
  if (isFiniteVec(r.position)) b.pos = vec3(r.position.x, r.position.y, r.position.z);
  b.grounded = r.grounded;
  if (r.grounded && b.vy < 0) b.vy = SIM_RULES.botStickVy;
  if (stance !== b.stance && physics.setStance(b.id, stance)) b.stance = stance;
  if (b.pos.y < map.bounds.killY) {
    physics.teleport(b.id, b.spawn);
    b.pos = b.spawn;
    b.prevPos = b.spawn;
    b.vy = 0;
    b.grounded = false;
  }
}

/** Step 5. A bot without an intent this tick (countdown or frozen) stands still under gravity. */
function moveBots(s: SimState, gates: SimGates, now: number): void {
  for (const b of s.bots) {
    if (!b.alive) {
      b.intent = null;
      continue;
    }
    const intent = gates.ai
      ? s.containment.guard(b.id, () =>
          tickBrain(
            b.brain,
            s.perception.perceptsFor(b.id, now),
            selfOf(b, now),
            s.world,
            STEP_SEC,
            now,
          ),
        )
      : undefined;
    const bi = intent ?? zeroIntent(b.yaw, b.pitch, b.stance);
    b.intent = intent ?? null;
    integrateBot(s, b, bi.move.velocity, bi.move.stance);
    b.yaw = bi.yaw;
    b.pitch = bi.pitch;
  }
}

/** Step 6: hitboxes follow the poses; they apply at the next physics.step (world-maps rule). */
function syncHitboxes(s: SimState, p: PlayerActor): void {
  const { physics } = s.deps;
  if (p.alive) physics.syncHitboxes(p.id, p.motion.position, p.motion.yaw, p.motion.stance);
  for (const b of s.bots) if (b.alive) physics.syncHitboxes(b.id, b.pos, b.yaw, b.stance);
}

/** Resolves and applies one shot before the next holder fires (BR-ML-32). */
function applyShot(s: SimState, shot: ShotRequest, sink: EventSink): boolean {
  const res = resolveShot(shot, s.deps.physics, s.actors);
  applyResolution(res, s.actors, sink);
  return !(res.kind === 'miss' && res.rejected === true);
}

/** BR-ML-39: each accepted player shot is one gunfire noise at the shot origin. */
function playerNoise(s: SimState, shot: ShotRequest): void {
  const stats = weaponStats(shot.weapon); // Object.hasOwn-guarded, never WEAPON_TABLE[w]
  if (stats === undefined) return;
  const e = s.log.log({
    type: 'NoiseEmitted',
    source: PLAYER_ID,
    pos: shot.origin,
    radius: stats.noiseRadiusM,
    kind: 'gunfire',
  });
  if (e.type === 'NoiseEmitted') s.perception.emitNoise(e);
}

/** Step 8a. */
function firePlayer(
  s: SimState,
  p: PlayerActor,
  intent: PlayerInputIntent,
  gates: SimGates,
  sink: EventSink,
): void {
  const now = nowOf(s);
  const res = tickWeapon(
    p.inv,
    playerTrigger(intent),
    {
      now,
      dt: STEP_SEC,
      moving: p.speed > SIM_RULES.movingSpeed,
      locked: !p.alive || !gates.fire,
      shooter: p.id,
      origin: eyePosition(p.motion),
      aimDir: dirFromYawPitch(p.motion.yaw, p.motion.pitch),
    },
    p.weaponRng,
  );
  for (const e of res.events) s.log.log(e);
  for (const shot of res.shots) if (applyShot(s, shot, sink)) playerNoise(s, shot);
  const kick = res.viewKick;
  if (p.alive && (kick.pitch !== 0 || kick.yaw !== 0)) {
    applyRecoil(p.motion, { pitchRad: kick.pitch, yawRad: kick.yaw });
  }
}

/** Step 8b. A frozen bot does not tick its weapon; a dead bot ticks locked (BR-ML-33). */
function fireBots(s: SimState, gates: SimGates, sink: EventSink): void {
  const now = nowOf(s);
  for (const b of s.bots) {
    if (s.containment.isFrozen(b.id)) continue;
    const bi = b.intent;
    const v = bi?.move.velocity;
    const ctx = {
      now,
      dt: STEP_SEC,
      moving: v !== undefined && Math.hypot(v.x, v.z) > SIM_RULES.movingSpeed,
      locked: !b.alive || !gates.fire,
      shooter: b.id,
      origin: botEye(b),
      aimDir: bi?.aimDir ?? dirFromYawPitch(b.yaw, b.pitch),
    };
    const trigger = bi?.trigger ?? IDLE_TRIGGER;
    const res = s.containment.guard(b.id, () => tickWeapon(b.inv, trigger, ctx, b.weaponRng));
    if (res === undefined) continue;
    for (const e of res.events) s.log.log(e);
    for (const shot of res.shots) applyShot(s, shot, sink);
  }
}

/** Step 10: the radar's playerCanSee answer (BR-ML-61). */
function updatePlayerView(s: SimState, p: PlayerActor): void {
  s.perception.updatePlayerView(
    {
      eye: eyePosition(p.motion),
      yaw: p.motion.yaw,
      hFovRad: SIM_RULES.playerHFovRad,
      alive: p.alive,
    },
    s.bots.map((b) => ({ id: b.id, chest: botChest(b), alive: b.alive })),
    s.world.sight,
    s.tick,
  );
}

export function stepSim(
  s: SimState,
  intent: PlayerInputIntent,
  gates: SimGates,
  sink: EventSink,
): void {
  const p = s.player;
  if (!s.spawned || s.disposed || p === undefined) return;
  // Step 0.
  s.log.clear();
  s.budget.resetTick();
  s.containment.beginTick();
  s.tick += 1;
  const now = nowOf(s);
  movePlayer(s, p, intent, gates);
  if (gates.ai) senseAndDecide(s, p, now);
  moveBots(s, gates, now);
  syncHitboxes(s, p);
  s.deps.physics.step(STEP_SEC); // step 7: exactly once, before any raycast
  firePlayer(s, p, intent, gates, sink);
  fireBots(s, gates, sink);
  updatePlayerView(s, p);
  for (const e of s.log.events()) s.deps.bus.emit(e); // step 11
}
