// Types for scripts/run-logged.mjs (used by Vitest tests).
export interface VerifyLogFigures {
  readonly snapshotsWritten: number;
  readonly snapshotStatus: 'passed' | 'failed';
  readonly rapierSkipped: boolean;
  readonly testFiles: string[];
  readonly tests: string[];
  readonly coverageMisses: string[];
  readonly bundleGate: string | null;
  readonly checkDist: string[];
  readonly secretScan: string[];
  readonly auditSummary: string[];
}

export declare function parseVerifyLog(
  text: unknown,
  env?: Readonly<Record<string, string | undefined>>,
): VerifyLogFigures;

export declare function buildVerifySummary(input: {
  readonly exitCode: number;
  readonly finishedAt: string;
  readonly commit: string;
  readonly log: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): VerifyLogFigures & { exitCode: number; finishedAt: string; commit: string };

export declare function runLogged(
  logFile: string,
  cmd: string,
  args: ReadonlyArray<string>,
  options?: { readonly env?: NodeJS.ProcessEnv; readonly quiet?: boolean },
): Promise<number>;

export declare function parseArgs(
  argv: ReadonlyArray<string>,
): { logFile: string; cmd: string; args: string[] } | undefined;

export declare function main(
  argv: ReadonlyArray<string>,
  log?: { error(msg: string): void },
): Promise<number>;
