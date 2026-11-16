/**
 * Settings reducer and dialog model (business-logic-model-ui-hud §10, security-design-ui-hud §5).
 * Raw DOM strings become numbers only here: a strict decimal check, then Number(), then the
 * persistence field validator. A rejected value returns the same Settings object.
 */
import {
  DURATIONS,
  GRAPHICS_PRESETS,
  SETTINGS_RANGES,
  isNumericSettingKey,
  isSettingKey,
  withSetting,
  type GraphicsPreset,
  type NumericSettingKey,
  type RoundDuration,
  type Settings,
} from '@sz/persistence';
import { formatClock } from './format';
import { graphicsLabel, type ChoiceOption } from './setup-model';

const DECIMAL = /^\d{1,3}(\.\d{1,2})?$/;

function coerce(key: string, raw: unknown): unknown {
  const numeric = isNumericSettingKey(key) || key === 'roundDurationSec';
  if (!numeric) return raw;
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) return undefined;
  return Number(raw);
}

export function applySettingChange(settings: Settings, key: unknown, raw: unknown): Settings {
  if (!isSettingKey(key)) return settings;
  return withSetting(settings, key, coerce(key, raw));
}

export type SettingsOrigin = 'menu' | 'pause' | 'advisory';

export interface SliderModel {
  readonly key: NumericSettingKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** Text for <output> and aria-valuetext. */
  readonly valueText: string;
}

export interface SettingsModel {
  readonly id: 'settings';
  readonly from: SettingsOrigin;
  readonly sliders: ReadonlyArray<SliderModel>;
  readonly graphics: ReadonlyArray<ChoiceOption<GraphicsPreset>>;
  readonly durations: ReadonlyArray<ChoiceOption<RoundDuration>>;
  /** "Applies from the next round." when opened from Pause (req-settings AC4). */
  readonly durationNote: string;
  readonly confirmReset: boolean;
}

const SLIDERS: ReadonlyArray<{ key: NumericSettingKey; label: string; unit: string }> = [
  { key: 'sensitivity', label: 'Mouse sensitivity', unit: '×' },
  { key: 'fovDeg', label: 'Field of view', unit: '°' },
  { key: 'masterVolume', label: 'Master volume', unit: '%' },
  { key: 'effectsVolume', label: 'Effects volume', unit: '%' },
];

export const GRAPHICS_COPY: ReadonlyMap<GraphicsPreset, string> = new Map([
  ['low', 'No shadows, fewer effects. Best for older hardware.'],
  ['medium', 'Shadows near the player. Recommended for up to 20 bots.'],
  ['high', 'Full shadows and effects.'],
]);

function valueText(key: NumericSettingKey, v: number, unit: string): string {
  return key === 'sensitivity' ? `${v.toFixed(1)}${unit}` : `${String(v)}${unit}`;
}

export function toSettingsModel(
  s: Settings,
  from: SettingsOrigin,
  confirmReset = false,
): SettingsModel {
  return Object.freeze({
    id: 'settings',
    from,
    sliders: Object.freeze(
      SLIDERS.map(({ key, label, unit }) => {
        const r = SETTINGS_RANGES[key];
        return Object.freeze({
          key,
          label,
          min: r.min,
          max: r.max,
          step: r.step,
          value: s[key],
          valueText: valueText(key, s[key], unit),
        });
      }),
    ),
    graphics: Object.freeze(
      GRAPHICS_PRESETS.map((g) =>
        Object.freeze({
          value: g,
          label: graphicsLabel(g),
          checked: g === s.graphics,
          description: GRAPHICS_COPY.get(g) ?? '',
        }),
      ),
    ),
    durations: Object.freeze(
      DURATIONS.map((d) =>
        Object.freeze({ value: d, label: formatClock(d), checked: d === s.roundDurationSec }),
      ),
    ),
    durationNote: from === 'menu' ? '' : 'Applies from the next round.',
    confirmReset,
  });
}
