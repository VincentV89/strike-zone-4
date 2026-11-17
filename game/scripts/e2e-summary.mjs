// e2e results summariser (security-design-verification-suite SD-VS-1 to SD-VS-3, ADR-VS-2).
// Node built-ins only. `summarise` is pure; the CLI reads the raw rows written by the Playwright
// reporter and the launch probe, and writes e2e-results/results[-deployed].{json,md}.
//
// This is the only code that writes a status. No flag, env var or argument changes the mapping.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSecrets, redact } from './scan-secrets.mjs';

export const STATUSES = Object.freeze(['passed', 'failed', 'flaky', 'manual-only', 'not-run']);
export const EXIT = Object.freeze({ pass: 0, fail: 1, flaky: 2, launch: 3 });

const LAUNCH_PREFIX = 'browser-launch-failed';
const MAX_TEXT = 300;

const clip = (s) => {
  const one = redact(String(s ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 1)}…` : one;
};

const annotationsOf = (row) => (Array.isArray(row?.annotations) ? row.annotations : []);

function skipReason(row) {
  const skip = annotationsOf(row).find((a) => a?.type === 'skip');
  return typeof skip?.description === 'string' ? skip.description : '';
}

/** Maps one catalogue entry and its raw row (if any) to a status and reason. */
export function statusFor(check, row, launch) {
  if (check.kind === 'manual') {
    return { status: 'manual-only', reason: `procedure ${check.procedure ?? 'missing'}` };
  }
  if (launch?.ok !== true) {
    const why = launch === undefined ? 'no launch record' : (launch.error ?? 'unknown');
    // No deployed URL is not a browser failure; the run is still incomplete (exit 3).
    if (why === 'no-deployed-url') return { status: 'not-run', reason: 'no-deployed-url' };
    return { status: 'not-run', reason: `${LAUNCH_PREFIX}: ${clip(why)}` };
  }
  if (row === undefined) return { status: 'not-run', reason: 'no result recorded' };
  switch (row.outcome) {
    case 'expected':
      return (row.retry ?? 0) > 0
        ? { status: 'flaky', reason: `passed on attempt ${String((row.retry ?? 0) + 1)}` }
        : { status: 'passed' };
    case 'flaky':
      return { status: 'flaky', reason: 'passed only after a retry' };
    case 'unexpected':
      return { status: 'failed', reason: clip(row.error ?? 'failed') };
    case 'skipped': {
      const why = skipReason(row);
      const webglMissing = launch.webgl2 === false;
      if (check.kind === 'webgl' && webglMissing && why.startsWith('manual-only:')) {
        return { status: 'manual-only', reason: clip(why) };
      }
      return { status: 'failed', reason: `unlabelled skip${why ? `: ${clip(why)}` : ''}` };
    }
    default:
      return { status: 'failed', reason: `unknown outcome ${clip(row.outcome)}` };
  }
}

/** SD-VS-2: a row that used the hook is `injected`; a `real` check that used it fails. */
function labelFor(check, row, status) {
  const usedHook = annotationsOf(row).some((a) => a?.type === 'used-hook');
  if (!usedHook) return { input: check.input, status };
  if (check.input === 'real') {
    return { input: 'injected', status: { status: 'failed', reason: 'label mismatch' } };
  }
  return { input: 'injected', status };
}

const texts = (list) => (Array.isArray(list) ? list.map(clip).filter((t) => t.length > 0) : []);

/**
 * Pure: builds result rows from the catalogue for one project.
 * input: { catalogue, project, raw: { rows }, launch: { ok, webgl2, error } | undefined }
 */
export function summarise({ catalogue, project, raw, launch }) {
  const rows = Array.isArray(raw?.rows) ? raw.rows : [];
  const byId = new Map();
  for (const r of rows) if (typeof r?.id === 'string' && !byId.has(r.id)) byId.set(r.id, r);
  const wanted = catalogue.filter((c) => c.project === project || c.project === 'both');
  const known = new Set(catalogue.map((c) => c.id));
  const results = wanted.map((check) => {
    const row = check.kind === 'manual' ? undefined : byId.get(check.id);
    const base = statusFor(check, row, launch);
    const { input, status } =
      row === undefined ? { input: check.input, status: base } : labelFor(check, row, base);
    return {
      id: check.id,
      title: check.title,
      requirements: [...check.requirements],
      kind: check.kind,
      status: status.status,
      input,
      ...(status.reason ? { reason: status.reason } : {}),
      ...(check.seed !== undefined ? { seed: check.seed } : {}),
      ...(check.selfTest ? { selfTest: true } : {}),
      warnings: texts(row?.warnings),
      notes: texts(row?.notes),
      ...(typeof row?.durationMs === 'number' ? { durationMs: Math.round(row.durationMs) } : {}),
    };
  });
  const wantedIds = new Set(wanted.map((c) => c.id));
  for (const [id] of byId) {
    if (wantedIds.has(id)) continue;
    results.push({
      id: clip(id),
      title: known.has(id) ? 'catalogued for another project' : 'uncatalogued',
      requirements: [],
      kind: 'browser',
      status: 'failed',
      input: 'real',
      reason: known.has(id) ? 'wrong project' : 'uncatalogued check',
      warnings: [],
      notes: [],
    });
  }
  return results;
}

/** Exit code from written statuses only (ADR-VS-1). */
export function exitCodeFor(results) {
  if (results.some((r) => r.reason?.startsWith(LAUNCH_PREFIX))) return EXIT.launch;
  if (results.some((r) => r.status === 'failed')) return EXIT.fail;
  const browserRows = results.filter((r) => r.kind !== 'manual');
  // Nothing ran (no browser rows, or every one not-run): never green.
  if (browserRows.every((r) => r.status === 'not-run')) return EXIT.launch;
  // A row that should have run but recorded nothing makes the run incomplete, never green.
  if (results.some((r) => r.status === 'not-run')) return EXIT.fail;
  if (results.some((r) => r.status === 'flaky')) return EXIT.flaky;
  return EXIT.pass;
}

export function countStatuses(results) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of results) counts[r.status] += 1;
  return counts;
}

const cell = (s) => String(s).replace(/\|/g, '\\|');

/** Markdown table for the final report, status column exactly as written. */
export function toMarkdown(report) {
  const lines = [
    `### e2e results (${report.project})`,
    '',
    `Finished ${report.finishedAt}, commit ${report.commit}, exit code ${String(report.exitCode)}.`,
    `Launch: ${report.launch?.ok === true ? 'ok' : 'failed'}; WebGL2: ${String(report.launch?.webgl2 ?? false)}.`,
    '',
    '| Check | Status | Input | Requirements | Reason |',
    '|---|---|---|---|---|',
  ];
  for (const r of report.rows) {
    lines.push(
      `| ${cell(r.id)} | ${r.status} | ${r.input} | ${cell(r.requirements.join(', '))} | ${cell(r.reason ?? '')} |`,
    );
  }
  const c = report.counts;
  lines.push(
    '',
    `Totals: ${String(c.passed)} passed, ${String(c.failed)} failed, ${String(c.flaky)} flaky, ${String(c['manual-only'])} manual-only, ${String(c['not-run'])} not-run.`,
  );
  return `${lines.join('\n')}\n`;
}

/** Reads the current commit from .git with fs only (no git process). */
export function readCommit(repoRoot) {
  const headPath = join(repoRoot, '.git', 'HEAD');
  if (!existsSync(headPath)) return 'unknown';
  const head = readFileSync(headPath, 'utf8').trim();
  if (!head.startsWith('ref: ')) return /^[0-9a-f]{40}$/.test(head) ? head : 'unknown';
  const ref = head.slice(5);
  const refPath = join(repoRoot, '.git', ref);
  if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim();
  const packed = join(repoRoot, '.git', 'packed-refs');
  if (!existsSync(packed)) return 'unknown';
  const line = readFileSync(packed, 'utf8')
    .split('\n')
    .find((l) => l.endsWith(` ${ref}`));
  return line?.split(' ')[0] ?? 'unknown';
}

/** Builds the full report object. Pure apart from the values passed in. */
export function buildReport({ catalogue, project, raw, launch, finishedAt, commit }) {
  const rows = summarise({ catalogue, project, raw, launch });
  return {
    project,
    finishedAt,
    commit,
    launch: launch === undefined ? { ok: false, webgl2: false, error: 'no launch record' } : launch,
    exitCode: exitCodeFor(rows),
    counts: countStatuses(rows),
    rows,
  };
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);

export const resultsName = (project) => (project === 'local' ? 'results' : `results-${project}`);

/**
 * Writes results JSON and Markdown after a final secret check. Returns the exit code; a secret
 * that survives redaction blocks the write and returns 1 (SD-VS-10).
 */
export function writeReport(outDir, report) {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const md = toMarkdown(report);
  if (findSecrets(json).length > 0 || findSecrets(md).length > 0) return EXIT.fail;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${resultsName(report.project)}.json`), json);
  writeFileSync(join(outDir, `${resultsName(report.project)}.md`), md);
  return report.exitCode;
}

/** CLI and run-e2e entry: summarise one project from files under game/e2e-results. */
export async function summariseProject(gameRoot, project) {
  const { CHECKS } = await import('../e2e/support/checks.ts');
  const outDir = join(gameRoot, 'e2e-results');
  const report = buildReport({
    catalogue: CHECKS,
    project,
    raw: readJson(join(outDir, `raw-${project}.json`)),
    launch: readJson(join(outDir, `launch-${project}.json`)),
    finishedAt: new Date().toISOString(),
    commit: readCommit(dirname(gameRoot)),
  });
  const code = writeReport(outDir, report);
  const c = report.counts;
  console.log(
    `e2e summary (${project}): ${String(c.passed)} passed, ${String(c.failed)} failed, ${String(c.flaky)} flaky, ${String(c['manual-only'])} manual-only, ${String(c['not-run'])} not-run; exit ${String(code)}`,
  );
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--project');
  const project = i >= 0 ? process.argv[i + 1] : 'local';
  if (project !== 'local' && project !== 'deployed') {
    console.error('e2e-summary: --project must be local or deployed');
    process.exit(1);
  }
  const gameRoot = fileURLToPath(new URL('..', import.meta.url));
  process.exit(await summariseProject(gameRoot, project));
}
