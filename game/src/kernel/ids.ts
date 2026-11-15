import { MAX_BOTS } from './constants';
import { err, ok } from './result';
import type { ActorId, BotCount, Result } from './types';

export const PLAYER_ID = 'player' as ActorId;

const BOT_PREFIX = 'bot-';
const MAX_ACTOR_ID_LENGTH = 6; // 'player' and 'bot-20' are both 6 characters.
const CHAR_0 = 48;
const CHAR_9 = 57;

/** bot-1 … bot-<count>, 1-based to match on-screen names (BR-K-11). */
export function botIds(count: BotCount): ReadonlyArray<ActorId> {
  const ids: ActorId[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${BOT_PREFIX}${String(i)}` as ActorId);
  }
  return ids;
}

function digitAt(s: string, index: number): number {
  const code = s.charCodeAt(index);
  return code >= CHAR_0 && code <= CHAR_9 ? code - CHAR_0 : -1;
}

/**
 * Parses the bot number after the prefix: one or two decimal digits, no leading
 * zero, 1..MAX_BOTS. Returns 0 for anything else. Integer logic, no regex (SD-K-1).
 */
function parseBotNumber(s: string): number {
  const digits = s.length - BOT_PREFIX.length;
  if (digits < 1 || digits > 2) return 0;
  const first = digitAt(s, BOT_PREFIX.length);
  if (first <= 0) return 0; // non-digit or leading zero
  if (digits === 1) return first;
  const second = digitAt(s, BOT_PREFIX.length + 1);
  if (second < 0) return 0;
  const n = first * 10 + second;
  return n <= MAX_BOTS ? n : 0;
}

/**
 * Accepts exactly 'player' or bot-1 … bot-20 (BR-K-10). Length is checked first,
 * so the cost is constant for any input (SEC-K-03). Never echoes the input.
 */
export function parseActorId(s: unknown): Result<ActorId, 'invalid-actor-id'> {
  if (typeof s !== 'string' || s.length > MAX_ACTOR_ID_LENGTH) return err('invalid-actor-id');
  if (s === PLAYER_ID) return ok(PLAYER_ID);
  if (!s.startsWith(BOT_PREFIX)) return err('invalid-actor-id');
  return parseBotNumber(s) > 0 ? ok(s as ActorId) : err('invalid-actor-id');
}

export function isBotId(id: ActorId): boolean {
  return id.startsWith(BOT_PREFIX);
}
