import { horizontal, normalize, sub, type DomainEvent, type EventBus } from '@sz/kernel';
import { applyDamage } from './damage';
import type { MutableActorLookup, ShotResolution } from './types';

/** Only `emit` is used; combat never subscribes (kernel BR-K-20). */
export type EventSink = Pick<EventBus<DomainEvent>, 'emit'>;

type Hit = Extract<ShotResolution, { kind: 'hit' }>;

function impactOnActor(res: Hit | Extract<ShotResolution, { kind: 'blocked' }>): DomainEvent {
  return {
    type: 'ShotImpact',
    shooter: res.shot.shooter,
    point: res.point,
    normal: res.normal,
    surface: 'actor',
    target: res.target,
  };
}

/** BR-C-22..24. Re-checks that the target is still alive, so a second shot never kills twice. */
function applyHit(res: Hit, actors: MutableActorLookup, bus: EventSink): void {
  bus.emit(impactOnActor(res));
  const target = actors.get(res.target);
  if (target === undefined || !(target.vitals.health > 0)) return; // SEC-WC-06
  const out = applyDamage(target.vitals, res.rawDamage);
  actors.setVitals(res.target, out.vitals);
  const applied = out.healthLost + out.armorLost;
  const { shooter, weapon, origin } = res.shot;
  bus.emit({
    type: 'HitConfirmed',
    shooter,
    target: res.target,
    zone: res.zone,
    damage: applied,
    killed: out.killed,
  });
  bus.emit({
    type: 'DamageTaken',
    victim: res.target,
    from: shooter,
    dir: normalize(horizontal(sub(origin, res.point))),
    amount: applied,
    healthAfter: out.vitals.health,
    armorAfter: out.vitals.armor,
  });
  if (out.killed) {
    bus.emit({
      type: 'ActorKilled',
      killer: shooter,
      victim: res.target,
      weapon,
      headshot: res.zone === 'head',
    });
  }
}

/**
 * Applies one resolution: updates the target's vitals through `actors` and emits the shot
 * events in BR-C order. ShotFired comes first for every resolution (BR-C-20), except a
 * request rejected by resolveShot's guards, which emits nothing.
 */
export function applyResolution(
  res: ShotResolution,
  actors: MutableActorLookup,
  bus: EventSink,
): void {
  if (res.kind === 'miss' && res.rejected === true) return;
  const { shooter, weapon, origin, dir } = res.shot;
  bus.emit({ type: 'ShotFired', shooter, weapon, origin, dir });
  if (res.kind === 'miss') return;
  if (res.kind === 'world') {
    bus.emit({
      type: 'ShotImpact',
      shooter,
      point: res.point,
      normal: res.normal,
      surface: 'world',
    });
    return;
  }
  if (res.kind === 'blocked') {
    bus.emit(impactOnActor(res));
    return;
  }
  applyHit(res, actors, bus);
}
