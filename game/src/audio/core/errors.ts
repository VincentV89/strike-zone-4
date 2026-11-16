/**
 * Boot error and warning-reason helpers (BR-A-70, BR-A-71, SD-A-7).
 * Pure: the console sink is injected by the web adapter.
 */
import type { AudioBootError } from './types';

/** Rejection value of prepareBank(). Structurally an app-shell BootError. */
export class AudioBootFailure extends Error implements AudioBootError {
  readonly step = 'audio';
  readonly retryable = true;
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super('audio boot step failed');
    this.name = 'AudioBootFailure';
    this.cause = cause;
  }
}

const ALLOWED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'NotAllowedError',
  'NotSupportedError',
  'InvalidStateError',
  'AbortError',
  'SecurityError',
  'TypeError',
  'RangeError',
]);

/** Allow-listed exception name, or 'unknown'. Never reads message or stack. */
export function errorName(e: unknown): string {
  if (typeof e !== 'object' || e === null || !('name' in e)) return 'unknown';
  const name = e.name;
  return typeof name === 'string' && ALLOWED_ERROR_NAMES.has(name) ? name : 'unknown';
}

export type AudioWarnReason =
  | 'no-audio-context'
  | 'context-not-running'
  | `context-failed:${string}`
  | `resume-refused:${string}`
  | `buffer-failed:${string}`;

export type WarnOnce = (reason: AudioWarnReason) => void;

/** Calls `sink` for the first reason only; later reasons are dropped (BR-A-71). */
export function createWarnOnce(sink: (reason: AudioWarnReason) => void): WarnOnce {
  let warned = false;
  return (reason) => {
    if (warned) return;
    warned = true;
    sink(reason);
  };
}
