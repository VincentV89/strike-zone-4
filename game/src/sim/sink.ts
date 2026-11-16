/**
 * Step 9 event reactions (business-logic-model §3, LC-ML-07). combat emits into this sink;
 * each event is logged through the copy-and-freeze choke point first, then sim reacts to the
 * frozen copy synchronously, so a kill takes effect before the next holder fires.
 */
import { markDead } from '@sz/ai';
import type { EventSink } from '@sz/combat';
import { PLAYER_ID, STEP_SEC, type ActorId, type BotStateName, type DomainEvent } from '@sz/kernel';
import type { BotActor } from './actors';
import type { SimState } from './state';

/** Logs a bot-ai transition as BotStateChanged (BR-ML-40). */
export function logTransition(
  s: SimState,
  bot: ActorId,
  t: { readonly from: BotStateName; readonly to: BotStateName },
): void {
  s.log.log({ type: 'BotStateChanged', bot, from: t.from, to: t.to });
}

/** BR-ML-37: perception, then bot-ai (claims and route), then the capsule and hitboxes. */
function killBot(s: SimState, b: BotActor): void {
  if (!b.alive) return;
  const now = s.tick * STEP_SEC;
  b.alive = false;
  b.diedAtTick = s.tick;
  b.intent = null;
  s.perception.markDead(b.id);
  const t = markDead(b.brain, s.world, now);
  if (t) logTransition(s, b.id, t);
  s.deps.physics.removeCharacter(b.id);
}

/** BR-ML-26: the player stops being hittable; the character stays so the camera has a body. */
function killPlayer(s: SimState): void {
  const p = s.player;
  if (!p?.alive) return;
  p.alive = false;
  p.speed = 0;
  s.deps.physics.setHitboxesEnabled(PLAYER_ID, false);
}

function onDamage(s: SimState, e: Extract<DomainEvent, { type: 'DamageTaken' }>): void {
  if (e.victim === PLAYER_ID) {
    if (s.player) s.player.lastHitTick = s.tick;
    return;
  }
  const b = s.botsById.get(e.victim);
  if (!b) return;
  b.lastHitTick = s.tick;
  // BR-ML-38: only the direction toward the attacker, never its position.
  s.perception.recordDamage(b.id, e.dir, s.tick * STEP_SEC);
}

function react(s: SimState, e: DomainEvent): void {
  switch (e.type) {
    case 'DamageTaken':
      onDamage(s, e);
      return;
    case 'ShotFired':
      if (s.botsById.has(e.shooter)) s.perception.noteShot(e.shooter, s.tick * STEP_SEC);
      return;
    case 'ActorKilled': {
      if (e.victim === PLAYER_ID) {
        killPlayer(s);
        return;
      }
      const b = s.botsById.get(e.victim);
      if (b) killBot(s, b);
      return;
    }
    default:
      return;
  }
}

export function createSink(s: SimState): EventSink {
  return {
    emit(e) {
      react(s, s.log.log(e));
    },
  };
}
