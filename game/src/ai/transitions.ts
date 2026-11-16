/**
 * TRANSITIONS (business-rules-bot-ai, T01 to T28; ADR-AI-2). Row order within a `from` state is
 * the evaluation priority; the first passing guard wins. No row leaves Dead (BR-AI-43).
 */
import type { BotStateName } from '@sz/kernel';
import type { GuardId, TransitionRow } from './types';

const t = (
  id: string,
  from: BotStateName,
  to: BotStateName,
  guard: GuardId,
  urgent: boolean,
): TransitionRow => Object.freeze({ id, from, to, guard, urgent });

export const TRANSITIONS: ReadonlyArray<TransitionRow> = Object.freeze([
  t('T01', 'patrol', 'dead', 'died', true),
  t('T02', 'patrol', 'engage', 'target-seen', true),
  t('T03', 'patrol', 'take-cover', 'damaged-seek-cover', true),
  t('T04', 'patrol', 'investigate', 'stimulus', false),
  t('T05', 'investigate', 'dead', 'died', true),
  t('T06', 'investigate', 'engage', 'target-seen', true),
  t('T07', 'investigate', 'take-cover', 'damaged-seek-cover', true),
  t('T08', 'investigate', 'patrol', 'search-timeout', false),
  t('T09', 'engage', 'dead', 'died', true),
  t('T10', 'engage', 'retreat', 'disadvantaged', true),
  t('T11', 'engage', 'take-cover', 'damaged-seek-cover', true),
  t('T12', 'engage', 'take-cover', 'reload-under-fire', false),
  t('T13', 'engage', 'flank', 'target-lost-flank', false),
  t('T14', 'engage', 'investigate', 'target-lost', false),
  t('T15', 'take-cover', 'dead', 'died', true),
  t('T16', 'take-cover', 'retreat', 'disadvantaged', true),
  t('T17', 'take-cover', 'engage', 'cover-exit-engage', false),
  t('T18', 'take-cover', 'flank', 'cover-exit-flank', false),
  t('T19', 'take-cover', 'investigate', 'cover-exit-investigate', false),
  t('T20', 'flank', 'dead', 'died', true),
  t('T21', 'flank', 'engage', 'target-seen', true),
  t('T22', 'flank', 'retreat', 'disadvantaged', true),
  t('T23', 'flank', 'take-cover', 'damaged-seek-cover', true),
  t('T24', 'flank', 'investigate', 'flank-ended', false),
  t('T25', 'retreat', 'dead', 'died', true),
  t('T26', 'retreat', 'engage', 'retreat-done-seen', false),
  t('T27', 'retreat', 'investigate', 'retreat-done-known', false),
  t('T28', 'retreat', 'patrol', 'retreat-done-idle', false),
]);

const BY_STATE: ReadonlyMap<BotStateName, ReadonlyArray<TransitionRow>> = (() => {
  const m = new Map<BotStateName, TransitionRow[]>();
  for (const r of TRANSITIONS) {
    const list = m.get(r.from);
    if (list) list.push(r);
    else m.set(r.from, [r]);
  }
  return new Map([...m].map(([k, v]) => [k, Object.freeze(v)] as const));
})();

const NONE: ReadonlyArray<TransitionRow> = Object.freeze([]);

/** Rows for a state in priority order; empty for Dead or an unknown state. */
export function rowsFrom(state: BotStateName): ReadonlyArray<TransitionRow> {
  return BY_STATE.get(state) ?? NONE;
}
