// Public surface of persistence (`@sz/persistence`). Re-exports only. Only app-shell creates a
// store; ui and ui core import the types, defaults and pure validators.
export { KEYS, MAX_RAW_LENGTH, SCHEMA_VERSION } from './keys';
export type { StorageKey } from './keys';
export { decodeEnvelope, encodeEnvelope, isPlainRecord, own } from './envelope';
export {
  DEFAULT_SETTINGS,
  DURATIONS,
  GRAPHICS_PRESETS,
  SETTINGS_RANGES,
  SETTING_KEYS,
  isGraphicsPreset,
  isNumericSettingKey,
  isRoundDuration,
  isSettingKey,
  sanitizeSettings,
  snapNumber,
  validateSettings,
  withSetting,
} from './settings';
export type {
  GraphicsPreset,
  NumericSettingKey,
  RoundDuration,
  SettingKey,
  SettingRange,
  Settings,
} from './settings';
export {
  HISTORY_LIMIT,
  entryFromSummary,
  validateHistory,
  validateHistoryEntry,
  validateLastSetup,
  validateRecord,
} from './records';
export type { HistoryEntry } from './records';
export { SETTINGS_DEBOUNCE_MS, createStore } from './store';
export type { StorageStatus, StoragePort, Store, StoreDeps } from './store';
