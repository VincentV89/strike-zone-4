// Post-build dist check (decision SD-K-3, SEC-K-13, SEC-K-14, BR-K-59).
// Node built-ins only. Run after `vite build` and before dist/ is removed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_EXTENSIONS = /\.(html|js|mjs|css|json|svg|txt|map)$/i;

/** SEC-A-10 / BR-A-60: every sound is synthesised at boot, so no audio file may ship. */
export const AUDIO_FILE_EXTENSIONS = /\.(wav|mp3|ogg|m4a|flac|webm|aac)$/i;

/** Removes /*! ... *\/ licence banners and sourceMappingURL lines before the URL scan. */
export function stripAllowedUrlContext(text) {
  return text.replace(/\/\*![\s\S]*?\*\//g, '').replace(/^\s*\/\/# sourceMappingURL=.*$/gm, '');
}

/** SEC-K-13: inline <script> without src, or any inline on* event handler attribute. */
export function findIndexHtmlProblems(html) {
  const problems = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1] ?? '';
    if (!/\ssrc\s*=/i.test(` ${attrs}`)) problems.push('inline <script> without src');
  }
  if (/\son[a-z]+\s*=/i.test(html)) problems.push('inline on* event handler attribute');
  return problems;
}

/** SEC-K-14: http:// or https:// outside licence banners. */
export function findExternalUrls(text) {
  return [...stripAllowedUrlContext(text).matchAll(/https?:\/\/[^\s"'`)<>]*/gi)].map((m) => m[0]);
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Returns a list of human-readable failures for the package at `root`. */
export function checkDist(root) {
  const failures = [];
  const dist = join(root, 'dist');
  const indexPath = join(dist, 'index.html');
  if (!existsSync(indexPath)) {
    failures.push('dist/index.html is missing (contract-game-dist)');
  } else {
    for (const p of findIndexHtmlProblems(readFileSync(indexPath, 'utf8'))) {
      failures.push(`dist/index.html: ${p}`);
    }
  }
  if (existsSync(dist)) {
    for (const file of listFiles(dist)) {
      if (AUDIO_FILE_EXTENSIONS.test(file)) {
        failures.push(`${relative(root, file)}: audio file in dist (BR-A-60)`);
        continue;
      }
      if (!TEXT_EXTENSIONS.test(file)) continue;
      for (const url of findExternalUrls(readFileSync(file, 'utf8'))) {
        failures.push(`${relative(root, file)}: external URL ${url}`);
      }
    }
  }
  const pub = join(root, 'public');
  if (existsSync(pub) && readdirSync(pub).length > 0) {
    failures.push('public/ is not empty (BR-K-59: its files are served unhashed and immutable)');
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const failures = checkDist(root);
  if (failures.length > 0) {
    for (const f of failures) console.error(`check:dist FAIL ${f}`);
    process.exit(1);
  }
  console.log('check:dist PASS');
}
