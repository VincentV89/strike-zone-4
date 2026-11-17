/**
 * Percepts builder (LC-AI-03, SD-AI-3 freeze-out). Returns a deep-frozen BotPercepts and
 * rebuilds it only when the memory changed or a time-to-live boundary was crossed, so a
 * steady state allocates nothing per tick.
 */
import { frozenCopy, type Memory } from './memory';
import { PERCEPTION_RULES } from './rules';
import type { BotPercepts } from './types';

export const EMPTY_PERCEPTS: BotPercepts = Object.freeze({});

const VISIBLE = 1;
const KNOWN = 2;
const HEARD = 4;
const DAMAGED = 8;

function maskOf(m: Memory, now: number): number {
  let mask = 0;
  if (m.visibleNow) mask |= VISIBLE;
  if (now - m.lastSeenAt <= PERCEPTION_RULES.lastKnownTtlSec) mask |= KNOWN;
  if (now - m.heardAt <= PERCEPTION_RULES.heardTtlSec) mask |= HEARD;
  if (now - m.damageAt <= PERCEPTION_RULES.damageTtlSec) mask |= DAMAGED;
  return mask;
}

function build(m: Memory, mask: number): BotPercepts {
  const p: { -readonly [K in keyof BotPercepts]: BotPercepts[K] } = {};
  if ((mask & VISIBLE) !== 0) {
    p.visibleTarget = Object.freeze({
      pos: frozenCopy(m.lastSeenPoint),
      feet: frozenCopy(m.lastSeenFeet),
      since: m.visibleSince,
    });
  }
  if ((mask & KNOWN) !== 0) {
    p.lastKnown = Object.freeze({ pos: frozenCopy(m.lastSeenFeet), at: m.lastSeenAt });
  }
  if ((mask & HEARD) !== 0) {
    p.heardNoise = Object.freeze({ pos: frozenCopy(m.heardPos), at: m.heardAt, kind: m.heardKind });
  }
  if ((mask & DAMAGED) !== 0) {
    p.recentDamageFrom = Object.freeze({ dir: frozenCopy(m.damageDir), at: m.damageAt });
  }
  return mask === 0 ? EMPTY_PERCEPTS : Object.freeze(p);
}

export function perceptsOf(m: Memory | undefined, now: number): BotPercepts {
  if (m === undefined || !Number.isFinite(now)) return EMPTY_PERCEPTS;
  const mask = maskOf(m, now);
  if (m.cache !== undefined && m.cacheVersion === m.version && m.cacheMask === mask) {
    return m.cache;
  }
  const value = build(m, mask);
  m.cache = value;
  m.cacheVersion = m.version;
  m.cacheMask = mask;
  return value;
}
