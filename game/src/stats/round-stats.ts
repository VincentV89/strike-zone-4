import { PLAYER_ID, type DomainEvent } from '@sz/kernel';
import { addSat } from './saturate';

/** Counters for one round (domain-entities-match-loop). Private to the round controller. */
export interface RoundStats {
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageReceived: number;
}

export function createRoundStats(): RoundStats {
  return {
    kills: 0,
    deaths: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    damageReceived: 0,
  };
}

/**
 * Feeds one event from the sim's tick log (BR-ML-50 to BR-ML-53). Only events with the player
 * as shooter, killer or victim count; everything else is ignored.
 */
export function recordEvent(s: RoundStats, e: DomainEvent): void {
  switch (e.type) {
    case 'ShotFired':
      if (e.shooter === PLAYER_ID) s.shotsFired = addSat(s.shotsFired, 1);
      return;
    case 'HitConfirmed':
      if (e.shooter !== PLAYER_ID) return;
      s.shotsHit = addSat(s.shotsHit, 1);
      s.damageDealt = addSat(s.damageDealt, e.damage);
      if (e.zone === 'head') s.headshots = addSat(s.headshots, 1); // Q1: kill or not
      return;
    case 'DamageTaken':
      if (e.victim === PLAYER_ID) s.damageReceived = addSat(s.damageReceived, e.amount);
      return;
    case 'ActorKilled':
      if (e.victim === PLAYER_ID) s.deaths = addSat(s.deaths, 1);
      else if (e.killer === PLAYER_ID) s.kills = addSat(s.kills, 1);
      return;
    default:
      return;
  }
}
