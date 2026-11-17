/**
 * Match history dialog model (business-logic-model-ui-hud §10, req-match-history, BR-UI-12).
 * Dates are formatted by an injected function: ui core has no wall clock or locale access.
 */
import type { MapId } from '@sz/kernel';
import type { HistoryEntry } from '@sz/persistence';
import type { SessionTotals } from '@sz/stats';
import { difficultyLabel, formatAccuracy, mapName, recordLine } from './format';

export interface HistoryRow {
  readonly key: string;
  readonly date: string;
  readonly map: string;
  readonly bots: string;
  readonly difficulty: string;
  readonly result: string;
  readonly kills: string;
  readonly accuracy: string;
}

export interface HistoryModel {
  readonly id: 'history';
  readonly rows: ReadonlyArray<HistoryRow>;
  /** "No rounds played yet. Start a match to see results." when there are no rows. */
  readonly emptyText: string;
  readonly recordLine: string;
  readonly confirmClear: boolean;
}

export const HISTORY_EMPTY_TEXT = 'No rounds played yet. Start a match to see results.';

const RESULT_LABELS: ReadonlyMap<HistoryEntry['outcome'], string> = new Map([
  ['victory', 'Victory'],
  ['defeat', 'Defeat'],
  ['time-expired', 'Time expired'],
  ['abandoned', 'Abandoned'],
]);

export function toHistoryModel(
  entries: ReadonlyArray<HistoryEntry>,
  record: SessionTotals,
  confirmClear: boolean,
  formatDate: (epochMs: number) => string,
  nameOf: (id: MapId) => string = mapName,
): HistoryModel {
  return Object.freeze({
    id: 'history',
    rows: Object.freeze(
      entries.map((e) =>
        Object.freeze({
          key: String(e.seq),
          date: formatDate(e.at),
          map: nameOf(e.setup.mapId),
          bots: String(e.setup.botCount),
          difficulty: difficultyLabel(e.setup.difficulty),
          result: RESULT_LABELS.get(e.outcome) ?? 'Defeat',
          kills: String(e.kills),
          accuracy: formatAccuracy(e.accuracyPct),
        }),
      ),
    ),
    emptyText: entries.length === 0 ? HISTORY_EMPTY_TEXT : '',
    recordLine: recordLine(record),
    confirmClear,
  });
}
