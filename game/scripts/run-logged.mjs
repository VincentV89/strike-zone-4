// Logged runner (security-design-verification-suite SD-VS-4). Node built-ins only.
//   node game/scripts/run-logged.mjs <log-file> -- <command> [args...]
// Streams the child's output to the console and (redacted) to <log-file>, exits with the
// child's exit code (no `| tee`, which hides it in sh), then writes verify-summary.json next to
// the log with figures parsed from it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommit } from './e2e-summary.mjs';
import { findSecrets, redact } from './scan-secrets.mjs';

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC (0x1b).
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** Pure: figures the report may copy from a verify log. */
export function parseVerifyLog(text, env = {}) {
  const log = String(text ?? '').replace(ANSI, '');
  let snapshotsWritten = 0;
  for (const m of log.matchAll(/Snapshots\s+(\d+)\s+written/g)) snapshotsWritten += Number(m[1]);
  const pick = (re) => [...log.matchAll(re)].map((m) => m[1].trim());
  return {
    snapshotsWritten,
    snapshotStatus: snapshotsWritten > 0 ? 'failed' : 'passed',
    rapierSkipped: /SZ_ALLOW_RAPIER_SKIP/.test(log) || env.SZ_ALLOW_RAPIER_SKIP === '1',
    testFiles: pick(/^\s*Test Files\s+(.+)$/gm),
    tests: pick(/^\s*Tests\s+(.+)$/gm),
    coverageMisses: pick(/^(?:ERROR:\s*)?(Coverage for .+ does not meet .+)$/gm),
    bundleGate: pick(/^(check:dist bundle gate: .+)$/gm)[0] ?? null,
    checkDist: pick(/^(check:dist (?:PASS|FAIL.*))$/gm),
    secretScan: pick(/^(scan:secrets (?:PASS|FAIL).*)$/gm),
    auditSummary: pick(/^(\d+ (?:low|moderate|high|critical) severity vulnerabilit(?:y|ies))$/gm),
  };
}

/** Pure: the verify-summary.json object. */
export function buildVerifySummary({ exitCode, finishedAt, commit, log, env }) {
  return { exitCode, finishedAt, commit, ...parseVerifyLog(log, env) };
}

/**
 * Runs `cmd args` with output streamed to the console and captured. Resolves to the child's exit
 * code after writing the redacted log and verify-summary.json (or 1 if a secret survived).
 */
export function runLogged(logFile, cmd, args, { env = process.env, quiet = false } = {}) {
  const logPath = resolve(logFile);
  const chunks = [];
  return new Promise((done) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    const take = (stream) => (b) => {
      if (!quiet) stream.write(b);
      chunks.push(b);
    };
    child.stdout.on('data', take(process.stdout));
    child.stderr.on('data', take(process.stderr));
    child.on('error', (e) => {
      chunks.push(Buffer.from(`run-logged: ${e.message}\n`));
    });
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const log = redact(Buffer.concat(chunks).toString('utf8').replace(ANSI, ''));
      const summary = buildVerifySummary({
        exitCode,
        finishedAt: new Date().toISOString(),
        commit: readCommit(findRepoRoot(logPath)),
        log,
        env,
      });
      const json = `${JSON.stringify(summary, null, 2)}\n`;
      if (findSecrets(log).length > 0 || findSecrets(json).length > 0) {
        console.error('run-logged: a secret survived redaction; evidence not written');
        done(1);
        return;
      }
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, log);
      writeFileSync(join(dirname(logPath), 'verify-summary.json'), json);
      if (!quiet) console.log(`run-logged: exit ${String(exitCode)}; log ${logFile}`);
      done(exitCode);
    });
  });
}

/** Parses `<log-file> -- <command> [args...]`; undefined when the shape is wrong. */
export function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep !== 1 || argv.length <= 2) return undefined;
  return { logFile: argv[0], cmd: argv[2], args: argv.slice(3) };
}

function findRepoRoot(from) {
  let dir = dirname(from);
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

/** CLI entry. Returns the exit code. */
export async function main(argv, log = console) {
  const parsed = parseArgs(argv);
  if (parsed === undefined) {
    log.error('usage: run-logged.mjs <log-file> -- <command> [args...]');
    return 1;
  }
  return runLogged(parsed.logFile, parsed.cmd, parsed.args);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exit(await main(process.argv.slice(2)));
