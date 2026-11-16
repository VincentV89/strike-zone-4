// Types for scripts/e2e-summary.mjs (used by Vitest tests and scripts/run-e2e.mjs).
import type { Check } from '../e2e/support/checks.ts';

export type Status = 'passed' | 'failed' | 'flaky' | 'manual-only' | 'not-run';

export interface RawRow {
  readonly id: string;
  readonly outcome: string;
  readonly retry?: number;
  readonly annotations?: ReadonlyArray<{ readonly type: string; readonly description?: string }>;
  readonly warnings?: ReadonlyArray<string>;
  readonly notes?: ReadonlyArray<string>;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface LaunchRecord {
  readonly ok: boolean;
  readonly webgl2: boolean;
  readonly error?: string;
}

export interface ResultRow {
  readonly id: string;
  readonly title: string;
  readonly requirements: string[];
  readonly kind: string;
  readonly status: Status;
  readonly input: 'real' | 'injected';
  readonly reason?: string;
  readonly seed?: number;
  readonly selfTest?: boolean;
  readonly warnings: string[];
  readonly notes: string[];
  readonly durationMs?: number;
}

export interface Report {
  readonly project: string;
  readonly finishedAt: string;
  readonly commit: string;
  readonly launch: LaunchRecord;
  readonly exitCode: number;
  readonly counts: Record<Status, number>;
  readonly rows: ResultRow[];
}

export interface SummariseInput {
  readonly catalogue: ReadonlyArray<Check>;
  readonly project: 'local' | 'deployed';
  readonly raw: { readonly rows?: ReadonlyArray<RawRow> } | undefined;
  readonly launch: LaunchRecord | undefined;
}

export declare const STATUSES: ReadonlyArray<Status>;
export declare const EXIT: {
  readonly pass: 0;
  readonly fail: 1;
  readonly flaky: 2;
  readonly launch: 3;
};
export declare function statusFor(
  check: Check,
  row: RawRow | undefined,
  launch: LaunchRecord | undefined,
): { status: Status; reason?: string };
export declare function summarise(input: SummariseInput): ResultRow[];
export declare function exitCodeFor(results: ReadonlyArray<ResultRow>): number;
export declare function countStatuses(results: ReadonlyArray<ResultRow>): Record<Status, number>;
export declare function toMarkdown(report: Report): string;
export declare function readCommit(repoRoot: string): string;
export declare function buildReport(
  input: SummariseInput & { readonly finishedAt: string; readonly commit: string },
): Report;
export declare function resultsName(project: string): string;
export declare function writeReport(outDir: string, report: Report): number;
export declare function summariseProject(
  gameRoot: string,
  project: 'local' | 'deployed',
): Promise<number>;
