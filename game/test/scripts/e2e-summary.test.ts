import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKS, checksFor, specTitle, type Check } from '../../e2e/support/checks';
import {
  EXIT,
  buildReport,
  countStatuses,
  exitCodeFor,
  readCommit,
  resultsName,
  statusFor,
  summarise,
  summariseProject,
  toMarkdown,
  writeReport,
  type RawRow,
  type ResultRow,
} from '../../scripts/e2e-summary.mjs';

const OK = { ok: true, webgl2: true } as const;
const NO_GL = { ok: true, webgl2: false } as const;

const browser: Check = {
  id: 'b',
  title: 'browser check',
  requirements: ['req-x'],
  kind: 'browser',
  input: 'real',
  project: 'local',
};
const webgl: Check = { ...browser, id: 'w', kind: 'webgl', input: 'injected' };
const manual: Check = { ...browser, id: 'm', kind: 'manual', procedure: 'MP-9' };
const catalogue = [browser, webgl, manual];

const row = (id: string, outcome: string, extra: Partial<RawRow> = {}): RawRow => ({
  id,
  outcome,
  ...extra,
});

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sz-sum-'));
  dirs.push(d);
  return d;
};

describe('statusFor mapping table (SD-VS-1)', () => {
  it.each<[string, Check, RawRow | undefined, typeof OK | typeof NO_GL, string, string?]>([
    [
      'manual ignores any raw row',
      manual,
      row('m', 'expected'),
      OK,
      'manual-only',
      'procedure MP-9',
    ],
    ['no raw row', browser, undefined, OK, 'not-run', 'no result recorded'],
    ['expected first attempt', browser, row('b', 'expected'), OK, 'passed'],
    ['expected after retry', browser, row('b', 'expected', { retry: 1 }), OK, 'flaky'],
    ['flaky outcome', browser, row('b', 'flaky'), OK, 'flaky'],
    ['unexpected', browser, row('b', 'unexpected', { error: 'boom' }), OK, 'failed', 'boom'],
    [
      'labelled webgl skip without WebGL2',
      webgl,
      row('w', 'skipped', {
        annotations: [{ type: 'skip', description: 'manual-only: webgl2-unavailable' }],
      }),
      NO_GL,
      'manual-only',
    ],
    [
      'labelled skip while WebGL2 works',
      webgl,
      row('w', 'skipped', { annotations: [{ type: 'skip', description: 'manual-only: x' }] }),
      OK,
      'failed',
    ],
    [
      'labelled skip on a browser check',
      browser,
      row('b', 'skipped', { annotations: [{ type: 'skip', description: 'manual-only: x' }] }),
      NO_GL,
      'failed',
    ],
    ['unlabelled skip', webgl, row('w', 'skipped'), NO_GL, 'failed', 'unlabelled skip'],
    ['unknown outcome', browser, row('b', 'weird'), OK, 'failed'],
  ])('%s', (_name, check, raw, launch, status, reason) => {
    const r = statusFor(check, raw, launch);
    expect(r.status).toBe(status);
    if (reason !== undefined) expect(r.reason).toContain(reason);
  });

  it('marks every non-manual row not-run when the launch failed', () => {
    const r = statusFor(browser, row('b', 'expected'), {
      ok: false,
      webgl2: false,
      error: 'chrome: error while loading shared libraries: libglib-2.0.so.0',
    });
    expect(r).toEqual({
      status: 'not-run',
      reason:
        'browser-launch-failed: chrome: error while loading shared libraries: libglib-2.0.so.0',
    });
    expect(statusFor(browser, undefined, undefined).reason).toBe(
      'browser-launch-failed: no launch record',
    );
  });

  it('reports a missing deployed URL as not-run with exit 3', () => {
    const launch = { ok: false, webgl2: false, error: 'no-deployed-url' };
    expect(statusFor(browser, undefined, launch)).toEqual({
      status: 'not-run',
      reason: 'no-deployed-url',
    });
    const rows = summarise({ catalogue, project: 'local', raw: undefined, launch });
    expect(exitCodeFor(rows)).toBe(3);
  });

  it('redacts and clips free text', () => {
    const long = `${'x'.repeat(400)} AKIA${'Q'.repeat(16)}`;
    const r = statusFor(browser, row('b', 'unexpected', { error: long }), OK);
    expect(r.reason?.length).toBeLessThanOrEqual(300);
    const key = statusFor(
      browser,
      row('b', 'unexpected', { error: `k AKIA${'Q'.repeat(16)}` }),
      OK,
    );
    expect(key.reason).toBe('k [redacted]');
  });
});

describe('summarise', () => {
  it('builds one row per catalogue entry and fails uncatalogued and wrong-project rows', () => {
    const deployedOnly: Check = { ...browser, id: 'd', project: 'deployed' };
    const rows = summarise({
      catalogue: [...catalogue, deployedOnly],
      project: 'local',
      raw: { rows: [row('b', 'expected'), row('zzz', 'expected'), row('d', 'expected')] },
      launch: OK,
    });
    expect(rows.map((r) => [r.id, r.status, r.reason])).toEqual([
      ['b', 'passed', undefined],
      ['w', 'not-run', 'no result recorded'],
      ['m', 'manual-only', 'procedure MP-9'],
      ['zzz', 'failed', 'uncatalogued check'],
      ['d', 'failed', 'wrong project'],
    ]);
  });

  it('labels hook use injected and fails a real check that used the hook (SD-VS-2)', () => {
    const used = { annotations: [{ type: 'used-hook' }] };
    const rows = summarise({
      catalogue,
      project: 'local',
      raw: { rows: [row('b', 'expected', used), row('w', 'expected', used)] },
      launch: OK,
    });
    expect(rows[0]).toMatchObject({
      id: 'b',
      status: 'failed',
      input: 'injected',
      reason: 'label mismatch',
    });
    expect(rows[1]).toMatchObject({ id: 'w', status: 'passed', input: 'injected' });
  });

  it('keeps the first of duplicate rows, carries warnings, notes, seed and duration', () => {
    const seeded: Check = { ...browser, seed: 9, selfTest: true };
    const rows = summarise({
      catalogue: [seeded],
      project: 'local',
      raw: {
        rows: [
          row('b', 'expected', {
            warnings: ['audio muted', ''],
            notes: ['axe minor'],
            durationMs: 12.6,
          }),
          row('b', 'unexpected'),
        ],
      },
      launch: OK,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        status: 'passed',
        seed: 9,
        selfTest: true,
        warnings: ['audio muted'],
        notes: ['axe minor'],
        durationMs: 13,
      }),
    ]);
  });

  it('tolerates a missing or malformed raw file', () => {
    expect(summarise({ catalogue, project: 'local', raw: undefined, launch: OK })).toHaveLength(3);
    expect(
      summarise({ catalogue, project: 'local', raw: { rows: 'x' } as never, launch: OK }),
    ).toHaveLength(3);
  });
});

const r = (status: ResultRow['status'], extra: Partial<ResultRow> = {}): ResultRow => ({
  id: 'x',
  title: 't',
  requirements: [],
  kind: 'browser',
  status,
  input: 'real',
  warnings: [],
  notes: [],
  ...extra,
});

describe('exitCodeFor (ADR-VS-1)', () => {
  it.each<[string, ResultRow[], number]>([
    ['all passed with manual rows', [r('passed'), r('manual-only', { kind: 'manual' })], EXIT.pass],
    [
      'launch failure wins',
      [r('failed'), r('not-run', { reason: 'browser-launch-failed: x' })],
      EXIT.launch,
    ],
    ['any failure', [r('passed'), r('failed'), r('flaky')], EXIT.fail],
    ['flaky only', [r('passed'), r('flaky')], EXIT.flaky],
    [
      'every browser row not-run',
      [r('not-run'), r('manual-only', { kind: 'manual' })],
      EXIT.launch,
    ],
    ['some rows not recorded', [r('passed'), r('not-run')], EXIT.fail],
    ['manual rows only never exit 0', [r('manual-only', { kind: 'manual' })], EXIT.launch],
  ])('%s', (_name, rows, code) => {
    expect(exitCodeFor(rows)).toBe(code);
  });

  it('counts every status', () => {
    expect(countStatuses([r('passed'), r('passed'), r('not-run')])).toEqual({
      passed: 2,
      failed: 0,
      flaky: 0,
      'manual-only': 0,
      'not-run': 1,
    });
  });
});

describe('the real catalogue', () => {
  it('is frozen, has unique ids, and every manual check has a procedure', () => {
    expect(Object.isFrozen(CHECKS)).toBe(true);
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
    for (const c of CHECKS.filter((x) => x.kind === 'manual'))
      expect(c.procedure).toMatch(/^MP-\d$/);
  });

  it('covers bot counts 1, 5, 10 and 20 on both maps, win, lose and restart', () => {
    const ids = new Set(CHECKS.map((c) => c.id));
    for (const map of ['desert-compound', 'industrial-warehouse']) {
      for (const n of [1, 5, 10, 20]) expect(ids.has(`bot-count-${map}-${String(n)}`)).toBe(true);
      expect(ids.has(`win-${map}`) && ids.has(`lose-${map}`)).toBe(true);
    }
    expect(ids.has('restart-10')).toBe(true);
  });

  it('gives 33 local and 9 deployed browser rows', () => {
    const browserRows = (p: 'local' | 'deployed') =>
      checksFor(p).filter((c) => c.kind !== 'manual');
    expect(browserRows('local')).toHaveLength(33);
    expect(browserRows('deployed')).toHaveLength(9);
  });

  it('builds spec titles and rejects unknown ids', () => {
    expect(specTitle('restart-10')).toMatch(/^restart-10 \| /);
    expect(() => specTitle('nope')).toThrow('uncatalogued');
  });

  it('marks every row not-run with exit 3 when Chromium cannot launch (this runtime)', () => {
    const report = buildReport({
      catalogue: CHECKS,
      project: 'local',
      raw: undefined,
      launch: { ok: false, webgl2: false, error: 'libglib-2.0.so.0 missing' },
      finishedAt: '2026-11-16T00:00:00.000Z',
      commit: 'abc',
    });
    expect(report.exitCode).toBe(3);
    expect(report.counts.passed).toBe(0);
    expect(report.counts['not-run']).toBe(33);
    expect(report.counts['manual-only']).toBe(6);
  });
});

describe('report files', () => {
  it('writes JSON and Markdown and returns the report exit code', () => {
    const out = tmp();
    const report = buildReport({
      catalogue,
      project: 'deployed',
      raw: undefined,
      launch: undefined,
      finishedAt: 'now',
      commit: 'c',
    });
    expect(report.launch).toEqual({ ok: false, webgl2: false, error: 'no launch record' });
    expect(writeReport(out, report)).toBe(3);
    expect(resultsName('deployed')).toBe('results-deployed');
    const md = readFileSync(join(out, 'results-deployed.md'), 'utf8');
    expect(md).toContain('| Check | Status | Input | Requirements | Reason |');
    expect(md).toContain('Launch: failed');
    expect(JSON.parse(readFileSync(join(out, 'results-deployed.json'), 'utf8'))).toMatchObject({
      exitCode: 3,
    });
  });

  it('refuses to write when a secret survives into the report', () => {
    const out = tmp();
    const report = {
      ...buildReport({
        catalogue,
        project: 'local',
        raw: undefined,
        launch: OK,
        finishedAt: 'n',
        commit: 'c',
      }),
      commit: `AKIA${'Q'.repeat(16)}`,
    };
    expect(writeReport(out, report)).toBe(1);
  });

  it('escapes pipes in Markdown cells', () => {
    const md = toMarkdown({
      project: 'local',
      finishedAt: 'n',
      commit: 'c',
      launch: OK,
      exitCode: 0,
      counts: countStatuses([r('passed')]),
      rows: [r('passed', { id: 'a|b' })],
    });
    expect(md).toContain('| a\\|b | passed |');
    expect(md).toContain('Launch: ok; WebGL2: true');
  });

  it('summariseProject reads raw and launch files from a game root', async () => {
    const game = tmp();
    mkdirSync(join(game, 'e2e-results'));
    writeFileSync(
      join(game, 'e2e-results', 'launch-local.json'),
      JSON.stringify({ ok: false, webgl2: false, error: 'no browser' }),
    );
    expect(await summariseProject(game, 'local')).toBe(3);
    const json = JSON.parse(readFileSync(join(game, 'e2e-results', 'results.json'), 'utf8')) as {
      counts: Record<string, number>;
    };
    expect(json.counts['not-run']).toBe(33);
  });
});

describe('readCommit', () => {
  it('reads a ref, a detached head, packed refs and falls back to unknown', () => {
    const repo = tmp();
    expect(readCommit(repo)).toBe('unknown');
    mkdirSync(join(repo, '.git', 'refs', 'heads'), { recursive: true });
    const sha = 'a'.repeat(40);
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    expect(readCommit(repo)).toBe('unknown');
    writeFileSync(join(repo, '.git', 'packed-refs'), `# pack\n${sha} refs/heads/main\n`);
    expect(readCommit(repo)).toBe(sha);
    writeFileSync(join(repo, '.git', 'refs', 'heads', 'main'), `${'b'.repeat(40)}\n`);
    expect(readCommit(repo)).toBe('b'.repeat(40));
    writeFileSync(join(repo, '.git', 'HEAD'), `${'c'.repeat(40)}\n`);
    expect(readCommit(repo)).toBe('c'.repeat(40));
    writeFileSync(join(repo, '.git', 'HEAD'), 'garbage\n');
    expect(readCommit(repo)).toBe('unknown');
  });
});
