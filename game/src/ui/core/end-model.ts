/**
 * End-of-round model (business-logic-model-ui-hud §10.2, req-end-of-round). Every number comes
 * from the authoritative RoundSummary, never from the HUD tally (AC1). No positions.
 */
import type { ActorId } from '@sz/kernel';
import type { RoundSummary } from '@sz/stats';
import { actorLabel, formatAccuracy, formatClock, recordLine } from './format';

export interface StatItem {
  readonly label: string;
  readonly value: string;
}

export interface EndScreenModel {
  readonly id: 'end';
  readonly outcome: RoundSummary['outcome'];
  readonly title: string;
  readonly subtitle: string;
  readonly primary: ReadonlyArray<StatItem>;
  readonly secondary: ReadonlyArray<StatItem>;
  readonly recordLine: string;
}

export interface KilledBy {
  readonly killer: ActorId;
  readonly headshot: boolean;
}

const stat = (label: string, value: string): StatItem => Object.freeze({ label, value });

function titleOf(s: RoundSummary, killedBy: KilledBy | undefined): [string, string] {
  switch (s.outcome) {
    case 'victory':
      return [
        '★ Victory',
        `All ${String(s.setup.botCount)} enemies eliminated · ${formatClock(s.durationSec)}`,
      ];
    case 'time-expired':
      return ['⏱ Defeat', `Time expired · ${String(s.enemiesRemaining)} enemies left`];
    case 'abandoned':
      return ['✕ Defeat', 'Round abandoned'];
    case 'defeat':
      return [
        '✕ Defeat',
        killedBy
          ? `Killed by ${actorLabel(killedBy.killer)}${killedBy.headshot ? ' (headshot)' : ''}`
          : 'You were killed',
      ];
  }
}

export function toEndModel(s: RoundSummary, killedBy: KilledBy | undefined): EndScreenModel {
  const [title, subtitle] = titleOf(s, killedBy);
  return Object.freeze({
    id: 'end',
    outcome: s.outcome,
    title,
    subtitle,
    primary: Object.freeze([
      stat('Kills', String(s.kills)),
      stat('Headshots', String(s.headshots)),
      stat('Accuracy', formatAccuracy(s.accuracyPct)),
      stat('Damage dealt', String(s.damageDealt)),
      stat('Duration', formatClock(s.durationSec)),
    ]),
    secondary: Object.freeze([
      stat('Damage taken', String(s.damageReceived)),
      stat('Shots hit', `${String(s.shotsHit)} / ${String(s.shotsFired)}`),
      stat('Deaths', String(s.deaths)),
    ]),
    recordLine: recordLine(s.totals),
  });
}
