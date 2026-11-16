/**
 * One pass over the frame's drained events for the signals app-shell reacts to (PD-AS-8): a round
 * end, and the loading → ready change that marks a new round (HUD reset, advisory re-arm).
 */
import type { DomainEvent, RoundOutcome } from '@sz/kernel';

export interface RoundSignals {
  readonly ended: RoundOutcome | undefined;
  readonly newRound: boolean;
}

const NONE: RoundSignals = Object.freeze({ ended: undefined, newRound: false });

export function roundSignals(events: ReadonlyArray<DomainEvent>): RoundSignals {
  let ended: RoundOutcome | undefined;
  let newRound = false;
  for (const e of events) {
    if (e.type === 'RoundEnded') ended = e.outcome;
    else if (e.type === 'RoundPhaseChanged' && e.from === 'loading' && e.to === 'ready') {
      newRound = true;
    }
  }
  return ended === undefined && !newRound ? NONE : { ended, newRound };
}
