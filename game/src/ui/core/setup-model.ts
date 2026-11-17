/**
 * Match setup reducer and panel model (business-logic-model-ui-hud §10, BR-UI-01, BR-UI-02).
 * There is no free-text input; the DOM sends raw radio values and this reducer is the only place
 * they become a MatchSetup.
 */
import {
  BOT_COUNTS,
  DIFFICULTIES,
  parseMatchSetup,
  type BotCount,
  type Difficulty,
  type MapId,
  type MatchSetup,
} from '@sz/kernel';
import type { MapSummary } from '@sz/maps';
import type { Settings } from '@sz/persistence';
import { difficultyLabel, formatClock } from './format';

export type SetupField = 'mapId' | 'botCount' | 'difficulty';

const SETUP_FIELDS: ReadonlySet<string> = new Set<SetupField>(['mapId', 'botCount', 'difficulty']);
const DECIMAL_INT = /^(0|[1-9]\d{0,2})$/;

/** Returns `setup` unchanged for an unknown field or an out-of-set value (req-match-setup AC1). */
export function applySetupChange(setup: MatchSetup, field: unknown, raw: unknown): MatchSetup {
  if (typeof field !== 'string' || !SETUP_FIELDS.has(field)) return setup;
  let value: unknown = raw;
  if (field === 'botCount') {
    if (typeof raw === 'string') value = DECIMAL_INT.test(raw) ? Number(raw) : undefined;
    else if (typeof raw !== 'number') value = undefined;
  }
  const next = parseMatchSetup({
    mapId: field === 'mapId' ? value : setup.mapId,
    botCount: field === 'botCount' ? value : setup.botCount,
    difficulty: field === 'difficulty' ? value : setup.difficulty,
  });
  if (!next.ok) return setup;
  const v = next.value;
  if (
    v.mapId === setup.mapId &&
    v.botCount === setup.botCount &&
    v.difficulty === setup.difficulty
  ) {
    return setup;
  }
  return Object.freeze(v);
}

export const DIFFICULTY_COPY: ReadonlyMap<Difficulty, string> = new Map([
  ['easy', 'Slower reactions and wider aim. Bots rarely flank.'],
  ['normal', 'Balanced reactions and aim. Bots use cover and sometimes flank.'],
  ['hard', 'Fast reactions and tight aim. Bots take cover and flank often.'],
]);

export interface ChoiceOption<T> {
  readonly value: T;
  readonly label: string;
  readonly checked: boolean;
  readonly description?: string;
}

export interface SetupPanelModel {
  readonly maps: ReadonlyArray<ChoiceOption<MapId>>;
  readonly bots: ReadonlyArray<ChoiceOption<BotCount>>;
  readonly difficulties: ReadonlyArray<ChoiceOption<Difficulty>>;
  readonly difficultyDescription: string;
  /** "Round 3:00 · Graphics Medium" */
  readonly summary: string;
  readonly setup: MatchSetup;
}

const GRAPHICS_LABEL: ReadonlyMap<string, string> = new Map([
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
]);

export function graphicsLabel(g: string): string {
  return GRAPHICS_LABEL.get(g) ?? 'Medium';
}

export function toSetupPanel(
  setup: MatchSetup,
  settings: Settings,
  maps: ReadonlyArray<MapSummary>,
): SetupPanelModel {
  return Object.freeze({
    maps: Object.freeze(
      maps.map((m) =>
        Object.freeze({
          value: m.id,
          label: m.name,
          checked: m.id === setup.mapId,
          description: m.blurb,
        }),
      ),
    ),
    bots: Object.freeze(
      BOT_COUNTS.map((n) =>
        Object.freeze({ value: n, label: String(n), checked: n === setup.botCount }),
      ),
    ),
    difficulties: Object.freeze(
      DIFFICULTIES.map((d) =>
        Object.freeze({
          value: d,
          label: difficultyLabel(d),
          checked: d === setup.difficulty,
          description: DIFFICULTY_COPY.get(d) ?? '',
        }),
      ),
    ),
    difficultyDescription: DIFFICULTY_COPY.get(setup.difficulty) ?? '',
    summary: `Round ${formatClock(settings.roundDurationSec)} · Graphics ${graphicsLabel(settings.graphics)}`,
    setup,
  });
}
