import { lengthSq, normalize, type ActorId, type Rng } from '@sz/kernel';
import { requestReload, setScoped, switchWeapon } from './commands';
import { cleanContext, cleanIntent, type CleanContext, type CleanIntent } from './guards';
import { equippedSlot, statusOf } from './inventory';
import { currentSpread, sampleCone, yawKick } from './spread';
import type {
  ShotRequest,
  TriggerIntent,
  ViewKick,
  WeaponEvent,
  WeaponInventory,
  WeaponSlot,
  WeaponTickContext,
  WeaponTickResult,
} from './types';
import { TIME_EPS, WEAPON_TABLE } from './weapon-table';

// Idle ticks share these frozen values, so a tick that does nothing allocates nothing (PERF-WC-05).
const NO_SHOTS: ReadonlyArray<ShotRequest> = Object.freeze([]);
const NO_EVENTS: ReadonlyArray<WeaponEvent> = Object.freeze([]);
const NO_KICK: ViewKick = Object.freeze({ pitch: 0, yaw: 0 });
const IDLE: WeaponTickResult = Object.freeze({
  shots: NO_SHOTS,
  events: NO_EVENTS,
  viewKick: NO_KICK,
});

interface Fired {
  readonly shot: ShotRequest;
  readonly kick: ViewKick;
}

/** Moves outbox events into `events`, stamping the holder id, and clears the outbox. */
function flush(inv: WeaponInventory, actor: ActorId, events: WeaponEvent[]): void {
  for (const e of inv.outbox.splice(0)) events.push({ ...e, actor });
}

/** Step 1, BR-W-40: ammo moves only when the reload completes. Runs on locked ticks too. */
function completeReload(
  inv: WeaponInventory,
  slot: WeaponSlot,
  c: CleanContext,
  events: WeaponEvent[],
): void {
  if (inv.reloadEndsAt === null || c.now < inv.reloadEndsAt - TIME_EPS) return;
  const stats = WEAPON_TABLE[slot.weapon];
  const moved = Math.min(stats.magazineSize - slot.magazine, slot.reserve);
  slot.magazine += moved;
  slot.reserve -= moved;
  inv.reloadEndsAt = null;
  events.push({
    type: 'ReloadDone',
    actor: c.shooter,
    weapon: slot.weapon,
    magazine: slot.magazine,
    reserve: slot.reserve,
  });
}

/** BR-W-66 and BR-W-34: one DryFire per press, then an automatic reload if one is allowed. */
function dryFire(
  inv: WeaponInventory,
  slot: WeaponSlot,
  c: CleanContext,
  events: WeaponEvent[],
): void {
  if (!inv.dryLatched) {
    events.push({ type: 'DryFire', actor: c.shooter, weapon: slot.weapon });
    inv.dryLatched = true;
  }
  if (requestReload(inv, c.now)) flush(inv, c.shooter, events);
}

/** Step 5, BR-W-60 to BR-W-70. At most one shot per holder per tick; exactly 3 Rng draws per shot. */
function fire(
  inv: WeaponInventory,
  slot: WeaponSlot,
  input: CleanIntent,
  c: CleanContext,
  rng: Rng,
  events: WeaponEvent[],
): Fired | null {
  const stats = WEAPON_TABLE[slot.weapon];
  const attempt = stats.fireMode === 'auto' ? input.fire : input.fire && !inv.triggerWasHeld;
  if (!attempt || statusOf(inv, slot, c.now) !== 'ready') return null;
  if (slot.magazine <= 0) {
    dryFire(inv, slot, c, events);
    return null;
  }
  const aim = c.aimValid ? normalize(c.aimDir) : null;
  if (aim === null || lengthSq(aim) === 0) return null; // BR-W-65: no shot, no ammo used
  const spread = currentSpread(inv, stats, c.moving);
  const dir = sampleCone(aim, spread, rng);
  const kickU = rng.next();
  slot.magazine -= 1;
  slot.nextFireAt = c.now + stats.fireIntervalSec;
  inv.lastShotAt = c.now;
  inv.bloom = Math.min(stats.bloomMax, inv.bloom + stats.bloomPerShot);
  const shot = {
    shooter: c.shooter,
    weapon: slot.weapon,
    origin: c.origin,
    dir,
    rangeM: stats.rangeM,
    spread,
  };
  return { shot, kick: { pitch: stats.kickPitch, yaw: yawKick(stats, kickU) } };
}

/** Steps 2 to 5 for a tick that is not locked. */
function act(
  inv: WeaponInventory,
  input: CleanIntent,
  c: CleanContext,
  rng: Rng,
  events: WeaponEvent[],
): Fired | null {
  if (input.switchTo !== undefined) switchWeapon(inv, input.switchTo, c.now);
  if (input.reload) requestReload(inv, c.now);
  flush(inv, c.shooter, events);
  const slot = equippedSlot(inv);
  if (slot === undefined) return null;
  const status = statusOf(inv, slot, c.now);
  setScoped(inv, input.scope && status !== 'drawing' && status !== 'reloading');
  return fire(inv, slot, input, c, rng, events);
}

/** Step 6, BR-W-80: bloom recovers once recoveryDelaySec has passed since the last shot. */
function recover(inv: WeaponInventory, c: CleanContext): void {
  const slot = equippedSlot(inv);
  if (slot === undefined) return;
  const stats = WEAPON_TABLE[slot.weapon];
  if (c.now - inv.lastShotAt < stats.recoveryDelaySec - TIME_EPS) return;
  inv.bloom = Math.max(0, inv.bloom - stats.recoveryRate * c.dt);
}

function result(events: WeaponEvent[], fired: Fired | null): WeaponTickResult {
  if (fired === null)
    return events.length === 0 ? IDLE : { shots: NO_SHOTS, events, viewKick: NO_KICK };
  return {
    shots: [fired.shot],
    events: events.length === 0 ? NO_EVENTS : events,
    viewKick: fired.kick,
  };
}

/**
 * Advances one holder's weapon by one simulation tick (business-logic-model-weapons-combat).
 * Fixed order: reload completion, switch, reload request, scope, fire, recovery.
 * A locked tick (countdown, dead) skips steps 2 to 5 and forces scope off (BR-W-15).
 * Total: a non-finite `now` or a corrupted inventory gives an idle result.
 */
export function tickWeapon(
  inv: WeaponInventory,
  intent: TriggerIntent,
  ctx: WeaponTickContext,
  rng: Rng,
): WeaponTickResult {
  const c = cleanContext(ctx);
  if (c === null) return IDLE;
  const input = cleanIntent(intent);
  const events: WeaponEvent[] = [];
  flush(inv, c.shooter, events);
  const slot = equippedSlot(inv);
  if (slot === undefined) return result(events, null);
  completeReload(inv, slot, c, events);
  let fired: Fired | null = null;
  if (c.locked) inv.scoped = false;
  else fired = act(inv, input, c, rng, events);
  if (!input.fire) inv.dryLatched = false;
  inv.triggerWasHeld = input.fire; // BR-W-67: locked ticks update it too
  recover(inv, c);
  return result(events, fired);
}
