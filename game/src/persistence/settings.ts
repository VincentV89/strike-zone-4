/**
 * Settings entity (business-logic-model-ui-hud §4.1, §5.2; BR-UI-03, BR-UI-07).
 * Every field is validated on its own, so one bad stored field never resets the others.
 */
import { isPlainRecord, own } from './envelope';

export type GraphicsPreset = 'low' | 'medium' | 'high';
export type RoundDuration = 120 | 180 | 300 | 600;

export interface Settings {
  readonly sensitivity: number;
  readonly fovDeg: number;
  readonly masterVolume: number;
  readonly effectsVolume: number;
  readonly graphics: GraphicsPreset;
  readonly roundDurationSec: RoundDuration;
}

export type SettingKey = keyof Settings;
export type NumericSettingKey = 'sensitivity' | 'fovDeg' | 'masterVolume' | 'effectsVolume';

export interface SettingRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Slider ranges. Sensitivity has one decimal; the others are integers. */
export const SETTINGS_RANGES: Readonly<Record<NumericSettingKey, SettingRange>> = Object.freeze({
  sensitivity: Object.freeze({ min: 0.1, max: 5, step: 0.1 }),
  fovDeg: Object.freeze({ min: 60, max: 110, step: 1 }),
  masterVolume: Object.freeze({ min: 0, max: 100, step: 1 }),
  effectsVolume: Object.freeze({ min: 0, max: 100, step: 1 }),
});

/** Pinned equal to @sz/round ROUND_DURATIONS by a test (persistence may not import round). */
export const DURATIONS: ReadonlyArray<RoundDuration> = Object.freeze([120, 180, 300, 600]);
export const GRAPHICS_PRESETS: ReadonlyArray<GraphicsPreset> = Object.freeze([
  'low',
  'medium',
  'high',
]);
export const SETTING_KEYS: ReadonlyArray<SettingKey> = Object.freeze([
  'sensitivity',
  'fovDeg',
  'masterVolume',
  'effectsVolume',
  'graphics',
  'roundDurationSec',
]);

/** First run: graphics Medium (FD-UI-3), round 3:00. */
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  sensitivity: 1,
  fovDeg: 90,
  masterVolume: 80,
  effectsVolume: 70,
  graphics: 'medium',
  roundDurationSec: 180,
});

export function isNumericSettingKey(k: unknown): k is NumericSettingKey {
  return k === 'sensitivity' || k === 'fovDeg' || k === 'masterVolume' || k === 'effectsVolume';
}

export function isSettingKey(k: unknown): k is SettingKey {
  return typeof k === 'string' && (SETTING_KEYS as ReadonlyArray<string>).includes(k);
}

export function isGraphicsPreset(v: unknown): v is GraphicsPreset {
  return v === 'low' || v === 'medium' || v === 'high';
}

export function isRoundDuration(v: unknown): v is RoundDuration {
  return typeof v === 'number' && (DURATIONS as ReadonlyArray<number>).includes(v);
}

/** Snaps a finite in-range number to its step; undefined for anything else. */
export function snapNumber(key: NumericSettingKey, v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const r = SETTINGS_RANGES[key];
  if (v < r.min || v > r.max) return undefined;
  return key === 'sensitivity' ? Math.round(v * 10) / 10 : Math.round(v);
}

function build(get: (k: SettingKey) => unknown, fallback: Settings): Settings {
  const graphics = get('graphics');
  const duration = get('roundDurationSec');
  return Object.freeze({
    sensitivity: snapNumber('sensitivity', get('sensitivity')) ?? fallback.sensitivity,
    fovDeg: snapNumber('fovDeg', get('fovDeg')) ?? fallback.fovDeg,
    masterVolume: snapNumber('masterVolume', get('masterVolume')) ?? fallback.masterVolume,
    effectsVolume: snapNumber('effectsVolume', get('effectsVolume')) ?? fallback.effectsVolume,
    graphics: isGraphicsPreset(graphics) ? graphics : fallback.graphics,
    roundDurationSec: isRoundDuration(duration) ? duration : fallback.roundDurationSec,
  });
}

/** Repairs field by field; a non-object root gives DEFAULT_SETTINGS (BR-UI-03). */
export function sanitizeSettings(x: unknown): Settings {
  if (!isPlainRecord(x)) return DEFAULT_SETTINGS;
  return build((k) => own(x, k), DEFAULT_SETTINGS);
}

/** Strict form: null if any field is missing, off-step or out of range. */
export function validateSettings(x: unknown): Settings | null {
  if (!isPlainRecord(x)) return null;
  const s = sanitizeSettings(x);
  for (const k of SETTING_KEYS) if (own(x, k) !== s[k]) return null;
  return s;
}

/**
 * Returns `s` unchanged when the value is invalid or equal to the current one, so nothing is
 * saved or applied; otherwise a new frozen Settings.
 */
export function withSetting(s: Settings, key: SettingKey, value: unknown): Settings {
  let accepted: unknown;
  if (isNumericSettingKey(key)) accepted = snapNumber(key, value);
  else if (key === 'graphics') accepted = isGraphicsPreset(value) ? value : undefined;
  else accepted = isRoundDuration(value) ? value : undefined;
  if (accepted === undefined || accepted === s[key]) return s;
  return build((k) => (k === key ? accepted : s[k]), s);
}

/** The stored shape: an explicit literal of validated fields (SD-UI-11). */
export function settingsData(s: Settings): Settings {
  return {
    sensitivity: s.sensitivity,
    fovDeg: s.fovDeg,
    masterVolume: s.masterVolume,
    effectsVolume: s.effectsVolume,
    graphics: s.graphics,
    roundDurationSec: s.roundDurationSec,
  };
}
