/**
 * Storage keys and envelope limits (SD-UI-8, SD-UI-7). Every storage call takes a key from
 * KEYS, so persistence never touches a key outside the strikezone:* namespace (SEC-UI-16).
 */
export const KEYS = Object.freeze({
  settings: 'strikezone:settings',
  lastSetup: 'strikezone:last-setup',
  history: 'strikezone:history',
  record: 'strikezone:record',
  probe: 'strikezone:probe',
} as const);

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

/** Raw values longer than this are rejected before JSON.parse (PD-UI-23). */
export const MAX_RAW_LENGTH = 65_536;

export const SCHEMA_VERSION = 1;
