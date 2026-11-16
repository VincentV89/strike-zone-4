// Secret scanner and redactor (security-design-verification-suite SD-VS-10, SEC-VS-30/32/33).
// Node built-ins only. Used by root verify (tree scan), check:dist (dist text files), the e2e
// summariser and run-logged (free text before it is written).
//
// Self-match rule: this file must not contain a literal that its own patterns match, and there
// is no allow-list for it. Key names are therefore assembled from parts at load time.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_KEY_NAME = ['aws', 'secret', 'access', 'key'].join('_');
const SESSION_TOKEN_NAME = ['aws', 'session', 'token'].join('_');
const PEM_PRIVATE = '-'.repeat(5) + 'BEGIN [A-Z ]*PRIVATE KEY' + '-'.repeat(5);

/** Access key ids: AKIA (long-term) or ASIA (session) followed by 16 upper-case letters or digits. */
const KEY_ID = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;

/**
 * Strict patterns: any mention of a credential setting name fails. Used for shipped and written
 * text (dist/, evidence, results, the report), which has no reason to name these settings.
 */
export const STRICT_PATTERNS = Object.freeze([
  { kind: 'access-key-id', re: KEY_ID },
  { kind: 'secret-key-name', re: new RegExp(SECRET_KEY_NAME, 'gi') },
  { kind: 'session-token-name', re: new RegExp(SESSION_TOKEN_NAME, 'gi') },
  { kind: 'private-key', re: new RegExp(PEM_PRIVATE, 'g') },
]);

/**
 * Tree patterns: in source files a setting name only counts when a value is assigned to it.
 * hosting-infra's own secret patterns (infra/lib/secret-patterns.ts) name the setting inside a
 * regex, which is detection code, not a leaked credential (deviation recorded in code-summary).
 */
export const TREE_PATTERNS = Object.freeze([
  { kind: 'access-key-id', re: KEY_ID },
  {
    kind: 'secret-key-assignment',
    re: new RegExp(`${SECRET_KEY_NAME}["']?\\s*[=:]\\s*["']?[A-Za-z0-9/+]{8,}`, 'gi'),
  },
  {
    kind: 'session-token-assignment',
    re: new RegExp(`${SESSION_TOKEN_NAME}["']?\\s*[=:]\\s*["']?[A-Za-z0-9/+]{8,}`, 'gi'),
  },
  { kind: 'private-key', re: new RegExp(PEM_PRIVATE, 'g') },
]);

/** Returns one hit per match: { kind, line } (1-based). Matched values are never returned. */
export function findSecrets(text, patterns = STRICT_PATTERNS) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const hits = [];
  for (const { kind, re } of patterns) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ kind, line });
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC (0x1b).
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const PROFILE = /\bAWS_PROFILE=\S*/g;
const AWS_DIR = /[^\s'"`]*\.aws(?:[/\\][^\s'"`]*)?/g;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SEC-VS-33: removes credentials, the home directory, AWS config paths, profile names and ANSI
 * escapes from free text before it is written to evidence.
 */
export function redact(text, home = homedir()) {
  if (typeof text !== 'string') return '';
  let out = text.replace(ANSI, '');
  for (const { re } of STRICT_PATTERNS)
    out = out.replace(new RegExp(re.source, re.flags), '[redacted]');
  out = out.replace(PROFILE, 'AWS_PROFILE=[redacted]');
  out = out.replace(AWS_DIR, '[aws-config]');
  if (typeof home === 'string' && home.length > 1) {
    out = out.replace(new RegExp(escapeRegExp(home), 'g'), '~');
  }
  return out;
}

/** Directory names never walked. Top-level dot directories are engine-owned or git internals. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'cdk.out',
  'coverage',
  'playwright-report',
  'test-results',
  'blob-report',
]);

const BINARY =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|glb|gltf|bin|ktx2|basis|hdr|exr|ttf|otf|woff2?|wasm|zip|gz|tgz|pdf|sqlite3?)$/i;
export const MAX_SCAN_BYTES = 5 * 1024 * 1024;

/** True for files the tree scan never reads (SD-VS-10). */
export function isSkippedFile(relPath) {
  const parts = relPath.split(/[/\\]/);
  const name = parts[parts.length - 1] ?? '';
  if (name.startsWith('.env')) return true;
  if (relPath.replace(/\\/g, '/') === 'infra/cdk-outputs.json') return true;
  return BINARY.test(name);
}

/**
 * Walks `root` with fs (no git) and returns { file, kind, line } hits using TREE_PATTERNS.
 * Top-level dot directories (.git, .aidlc, .kiro, ...) are not part of the source tree.
 */
export function scanTree(root) {
  const base = resolve(root);
  const hits = [];
  const walk = (dir, depth) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(base, full);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue; // dangling symlink
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (depth === 0 && name.startsWith('.')) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!st.isFile() || st.size > MAX_SCAN_BYTES || isSkippedFile(rel)) continue;
      const text = readFileSync(full, 'utf8');
      for (const h of findSecrets(text, TREE_PATTERNS)) {
        hits.push({ file: rel.split(sep).join('/'), ...h });
      }
    }
  };
  if (existsSync(base)) walk(base, 0);
  return hits;
}

/** CLI: `node scripts/scan-secrets.mjs <root>`. Returns the exit code. */
export function main(argv, log = console) {
  const arg = argv[0] ?? '.';
  const hits = scanTree(resolve(arg));
  for (const h of hits) log.error(`scan:secrets FAIL ${h.file}:${String(h.line)} ${h.kind}`);
  if (hits.length > 0) return 1;
  log.log(`scan:secrets PASS (${arg})`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
