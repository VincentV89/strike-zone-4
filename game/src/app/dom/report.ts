/**
 * reportError (SD-AS-11, SEC-AS-30): the only console.error caller in app-shell. Fatal frames,
 * HUD faults, bot faults and bus subscriber throws all go here, so the e2e console check fails
 * honestly and the hook's errors() sees the same messages (capped at 100, oldest dropped).
 */
import type { ReportKind } from './ports';

export const MAX_REPORTED_ERRORS = 100;

export interface Reporter {
  (kind: ReportKind, err: unknown): void;
  /** A copy of the recorded messages, oldest first. */
  errors(): ReadonlyArray<string>;
}

export type ErrorSink = (message: string, err: unknown) => void;

const consoleSink: ErrorSink = (message, err) => {
  console.error(message, err);
};

export function createReporter(sink: ErrorSink = consoleSink): Reporter {
  const ring: string[] = [];
  const report = (kind: ReportKind, err: unknown): void => {
    const message = `[strikezone] ${kind}: ${String(err)}`;
    ring.push(message);
    if (ring.length > MAX_REPORTED_ERRORS) ring.shift();
    sink(message, err);
  };
  return Object.assign(report, { errors: (): ReadonlyArray<string> => Object.freeze([...ring]) });
}
