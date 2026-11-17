import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildVerifySummary,
  main,
  parseArgs,
  parseVerifyLog,
  runLogged,
} from '../../scripts/run-logged.mjs';

const LOG = [
  '\u001b[32mscan:secrets PASS (..)\u001b[0m',
  ' Test Files  103 passed (103)',
  '      Tests  3134 passed (3134)',
  '   Snapshots  2 written',
  'ERROR: Coverage for lines (79%) does not meet global threshold (80%)',
  'check:dist bundle gate: 1860996 B gzip of 2500000 B (js + css, NFR-AS-P8)',
  'check:dist PASS',
  ' Test Files  6 passed (6)',
  '      Tests  80 passed (80)',
  '8 moderate severity vulnerabilities',
].join('\n');

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('parseVerifyLog (SD-VS-4)', () => {
  it('extracts the figures the report may copy', () => {
    const f = parseVerifyLog(LOG);
    expect(f).toEqual({
      snapshotsWritten: 2,
      snapshotStatus: 'failed',
      rapierSkipped: false,
      testFiles: ['103 passed (103)', '6 passed (6)'],
      tests: ['3134 passed (3134)', '80 passed (80)'],
      coverageMisses: ['Coverage for lines (79%) does not meet global threshold (80%)'],
      bundleGate: 'check:dist bundle gate: 1860996 B gzip of 2500000 B (js + css, NFR-AS-P8)',
      checkDist: ['check:dist PASS'],
      secretScan: ['scan:secrets PASS (..)'],
      auditSummary: ['8 moderate severity vulnerabilities'],
    });
  });

  it('reports a Rapier skip from the log or the environment, and passes with no snapshots', () => {
    expect(parseVerifyLog('SZ_ALLOW_RAPIER_SKIP set').rapierSkipped).toBe(true);
    const f = parseVerifyLog('', { SZ_ALLOW_RAPIER_SKIP: '1' });
    expect(f.rapierSkipped).toBe(true);
    expect(f.snapshotStatus).toBe('passed');
    expect(f.bundleGate).toBeNull();
    expect(parseVerifyLog(undefined).tests).toEqual([]);
  });

  it('builds the summary with exit code, time and commit', () => {
    expect(
      buildVerifySummary({ exitCode: 0, finishedAt: 't', commit: 'c', log: 'check:dist PASS' }),
    ).toMatchObject({ exitCode: 0, finishedAt: 't', commit: 'c', checkDist: ['check:dist PASS'] });
  });
});

describe('parseArgs', () => {
  it('needs <log> -- <command>', () => {
    expect(parseArgs(['out.log', '--', 'npm', 'run', 'verify'])).toEqual({
      logFile: 'out.log',
      cmd: 'npm',
      args: ['run', 'verify'],
    });
    expect(parseArgs(['out.log', 'npm'])).toBeUndefined();
    expect(parseArgs(['out.log', '--'])).toBeUndefined();
  });
});

describe('runLogged', () => {
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'sz-log-'));
    dirs.push(d);
    return d;
  };

  it('keeps the child exit code and writes the redacted log and summary', async () => {
    const dir = tmp();
    const log = join(dir, 'evidence', 'verify.log');
    const code = await runLogged(
      log,
      process.execPath,
      ['-e', "console.log(' Test Files  1 passed (1)'); console.error('warn'); process.exit(3)"],
      { quiet: true },
    );
    expect(code).toBe(3);
    expect(readFileSync(log, 'utf8')).toContain('Test Files  1 passed (1)');
    const summary = JSON.parse(
      readFileSync(join(dir, 'evidence', 'verify-summary.json'), 'utf8'),
    ) as {
      exitCode: number;
      testFiles: string[];
    };
    expect(summary.exitCode).toBe(3);
    expect(summary.testFiles).toEqual(['1 passed (1)']);
  });

  it('redacts a key id from the log before writing it', async () => {
    const dir = tmp();
    const log = join(dir, 'v.log');
    const code = await runLogged(
      log,
      process.execPath,
      ['-e', "console.log('AKIA' + 'Q'.repeat(16))"],
      { quiet: true },
    );
    expect(code).toBe(0);
    expect(readFileSync(log, 'utf8').trim()).toBe('[redacted]');
  });

  it('maps a child killed by a signal to exit 1', async () => {
    const dir = tmp();
    const code = await runLogged(
      join(dir, 'sig.log'),
      process.execPath,
      ['-e', "process.kill(process.pid, 'SIGTERM')"],
      { quiet: true },
    );
    expect(code).toBe(1);
  });

  it('records a command that cannot start as exit 1 or the spawn error code', async () => {
    const dir = tmp();
    const log = join(dir, 'x.log');
    const code = await runLogged(log, join(dir, 'no-such-binary'), [], { quiet: true });
    expect(code).not.toBe(0);
    expect(existsSync(log)).toBe(true);
  });
});

describe('run-logged CLI', () => {
  it('prints usage and returns 1 for bad arguments', async () => {
    const errors: string[] = [];
    expect(await main(['only-log'], { error: (m) => errors.push(m) })).toBe(1);
    expect(errors[0]).toContain('usage:');
  });

  it('runs a command from argv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sz-log-'));
    dirs.push(dir);
    const log = join(dir, 'cli.log');
    expect(await main([log, '--', process.execPath, '-e', 'process.exit(0)'])).toBe(0);
    expect(existsSync(join(dir, 'verify-summary.json'))).toBe(true);
  });
});
