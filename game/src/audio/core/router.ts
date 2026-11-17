/**
 * Event-to-sound mapping (business-logic-model-game-audio W6, BR-A-20 to BR-A-30).
 * Pure and total (BR-A-73): any unmapped event or actor yields no request.
 */
import { isBotId, parseActorId, type ActorId, type DomainEvent } from '@sz/kernel';
import { FIRE_CUE_BY_WEAPON, SPRINT_GAIN_SCALE } from './cues';
import type { CueRequest } from './types';

const NONE: ReadonlyArray<CueRequest> = Object.freeze([]);

type Who = 'player' | 'bot' | 'other';

/** 'player' for the local player, 'bot' for a valid bot id, 'other' for anything else. */
export function who(id: unknown, playerId: ActorId): Who {
  if (id === playerId) return 'player';
  const parsed = parseActorId(id);
  return parsed.ok && isBotId(parsed.value) ? 'bot' : 'other';
}

const one = (r: CueRequest): ReadonlyArray<CueRequest> => [r];

function shotFired(e: Extract<DomainEvent, { type: 'ShotFired' }>, playerId: ActorId) {
  const cue = FIRE_CUE_BY_WEAPON.get(e.weapon);
  if (cue === undefined) return NONE;
  switch (who(e.shooter, playerId)) {
    case 'player':
      return one({ cue });
    case 'bot':
      return one({ cue, at: e.origin });
    case 'other':
      return NONE;
  }
}

function footstep(e: Extract<DomainEvent, { type: 'Footstep' }>, playerId: ActorId) {
  const gainScale = e.gait === 'sprint' ? SPRINT_GAIN_SCALE : 1;
  switch (who(e.actor, playerId)) {
    case 'player':
      return one({ cue: 'footstep', gainScale, key: 'footstep:player' });
    case 'bot':
      return one({ cue: 'footstep', at: e.pos, gainScale, key: `footstep:${e.actor}` });
    case 'other':
      return NONE;
  }
}

function roundEnded(e: Extract<DomainEvent, { type: 'RoundEnded' }>) {
  switch (e.outcome) {
    case 'victory':
      return one({ cue: 'victory' });
    case 'defeat':
    case 'time-expired':
      return one({ cue: 'defeat' });
    case 'abandoned':
      return NONE;
  }
  return NONE;
}

const ifPlayer = (id: ActorId, playerId: ActorId, r: CueRequest): ReadonlyArray<CueRequest> =>
  who(id, playerId) === 'player' ? one(r) : NONE;

export function cuesForEvent(e: DomainEvent, playerId: ActorId): ReadonlyArray<CueRequest> {
  switch (e.type) {
    case 'ShotFired':
      return shotFired(e, playerId);
    case 'DryFire':
      return ifPlayer(e.actor, playerId, { cue: 'dry-fire' });
    case 'ReloadStarted':
      return ifPlayer(e.actor, playerId, { cue: 'reload-start' });
    case 'ReloadDone':
      return ifPlayer(e.actor, playerId, { cue: 'reload-end' });
    case 'HitConfirmed':
      return ifPlayer(e.shooter, playerId, { cue: e.zone === 'head' ? 'hit-head' : 'hit-body' });
    case 'DamageTaken':
      return ifPlayer(e.victim, playerId, { cue: 'player-hurt' });
    case 'ActorKilled':
      return who(e.victim, playerId) === 'bot' ? one({ cue: 'enemy-death' }) : NONE;
    case 'Footstep':
      return footstep(e, playerId);
    case 'RoundEnded':
      return roundEnded(e);
    default:
      return NONE;
  }
}
