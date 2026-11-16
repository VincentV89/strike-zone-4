// Post-build dist check (decision SD-K-3, SEC-K-13, SEC-K-14, BR-K-59).
// Node built-ins only. Run after `vite build` and before dist/ is removed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const TEXT_EXTENSIONS = /\.(html|js|mjs|css|json|svg|txt|map)$/i;

/** SEC-A-10 / BR-A-60: every sound is synthesised at boot, so no audio file may ship. */
export const AUDIO_FILE_EXTENSIONS = /\.(wav|mp3|ogg|m4a|flac|webm|aac)$/i;

/** SD-R-4 / CMP-R-02: every image, model and font is procedural, so no binary asset may ship. */
export const BINARY_ASSET_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|bmp|svg|glb|gltf|bin|ktx2|basis|hdr|exr|ttf|otf|woff2?)$/i;

/**
 * SD-R-4: the only URL allowed in code is three's createElementNS namespace, by exact match.
 * Measured in three 0.187.0 (tech-stack-decisions-presentation-3d).
 */
export const CODE_ALLOWED_URLS = new Set(['http://www.w3.org/1999/xhtml']);

/** SEC-R-10: the hosting CSP has no 'unsafe-eval'; fail the build before a browser would. */
export function findDynamicCode(text) {
  const hits = [];
  if (/(?<![\w$.])eval\s*\(/.test(text)) hits.push('eval(');
  if (/\bnew\s+Function\s*\(/.test(text)) hits.push('new Function');
  return hits;
}

/**
 * NFR-R-S2: no WebGPU renderer in the bundle. Word boundaries, because three.core.js contains
 * `renderer.isWebGPURenderer` (BatchedMesh) even in a WebGL-only build.
 */
export const WEBGPU_MARKER = /\bWebGPURenderer\b/;

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

/** SD-WM-11: the Rapier Apache-2.0 notice is a hashed asset; only it may carry these two URLs. */
export const NOTICE_PATTERN = /^third-party-notices-[\w-]+\.txt$/;
export const NOTICE_ALLOWED_URLS = new Set([
  'http://www.apache.org/licenses/',
  'http://www.apache.org/licenses/LICENSE-2.0',
]);
/** Required notice text per runtime dependency (SD-WM-11, CMP-R-01). */
export const NOTICE_REQUIREMENTS = new Map([
  ['@dimforge/rapier3d-compat', ['Apache License', 'Version 2.0', '@dimforge/rapier3d-compat']],
  ['three', ['three.js authors', 'MIT License']],
]);

function runtimeDependencies(root) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return [];
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return Object.keys(pkg.dependencies ?? {});
}

/**
 * SD-UI-15: XML namespace identifiers passed to createElementNS (ui SVG) and used by three.js.
 * They are names, not fetched URLs. Allowed by exact string, in .js files only.
 */
export const XML_NAMESPACE_URLS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
]);
const JS_FILE = /\.m?js$/i;

/** True when the package at `root` ships Rapier, so the notice must be in dist/. */
export function needsRapierNotice(root) {
  return runtimeDependencies(root).includes('@dimforge/rapier3d-compat');
}

/** True when three is a runtime dependency; its MIT notice must be in dist/ (OI-L-3). */
export function needsThreeNotice(root) {
  return runtimeDependencies(root).includes('three');
}

function checkNotice(dist, failures, needles) {
  const assets = join(dist, 'assets');
  const notices = existsSync(assets)
    ? readdirSync(assets).filter((n) => NOTICE_PATTERN.test(n))
    : [];
  if (notices.length !== 1) {
    failures.push(
      `expected exactly one dist/assets/third-party-notices-*.txt, found ${notices.length} (SD-WM-11)`,
    );
    return;
  }
  const text = readFileSync(join(assets, notices[0]), 'utf8');
  for (const needle of needles) {
    if (!text.includes(needle)) failures.push(`dist/assets/${notices[0]}: missing "${needle}"`);
  }
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

/** PD-AS-13 / NFR-AS-P8: hard gate on the gzipped JS and CSS shipped under dist/assets. */
export const BUNDLE_GZIP_LIMIT = 2_500_000;

/** Gzip sizes of dist/assets/*.js|*.mjs|*.css, largest first, plus their total. */
export function bundleGzipBytes(root) {
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) return { total: 0, files: [] };
  const files = readdirSync(assets)
    .filter((n) => /\.(m?js|css)$/i.test(n))
    .map((name) => ({ name, gzip: gzipSync(readFileSync(join(assets, name))).length }))
    .sort((a, b) => b.gzip - a.gzip || a.name.localeCompare(b.name));
  return { total: files.reduce((sum, f) => sum + f.gzip, 0), files };
}

function checkBundleSize(root, failures) {
  const { total, files } = bundleGzipBytes(root);
  if (total <= BUNDLE_GZIP_LIMIT) return;
  const largest = files
    .slice(0, 3)
    .map((f) => `${f.name} ${f.gzip} B`)
    .join(', ');
  failures.push(
    `dist/assets: ${total} B gzip exceeds the ${BUNDLE_GZIP_LIMIT} B budget (NFR-AS-P8); largest: ${largest}`,
  );
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
      const rel = relative(root, file);
      if (AUDIO_FILE_EXTENSIONS.test(file)) {
        failures.push(`${rel}: audio file in dist (BR-A-60)`);
        continue;
      }
      if (BINARY_ASSET_EXTENSIONS.test(file)) {
        failures.push(`${rel}: binary asset in dist (CMP-R-02)`);
        continue;
      }
      if (!TEXT_EXTENSIONS.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      const isNotice = NOTICE_PATTERN.test(basename(file));
      const isCode = /\.m?js$/i.test(file);
      for (const url of findExternalUrls(text)) {
        if (isNotice && NOTICE_ALLOWED_URLS.has(url)) continue;
        if (JS_FILE.test(file) && XML_NAMESPACE_URLS.has(url)) continue;
        if (isCode && CODE_ALLOWED_URLS.has(url)) continue;
        failures.push(`${rel}: external URL ${url}`);
      }
      if (isCode) {
        for (const hit of findDynamicCode(text)) failures.push(`${rel}: ${hit} (SEC-R-10)`);
        if (WEBGPU_MARKER.test(text)) failures.push(`${rel}: WebGPURenderer in bundle (NFR-R-S2)`);
      }
    }
    const deps = runtimeDependencies(root);
    const needles = deps.flatMap((d) => NOTICE_REQUIREMENTS.get(d) ?? []);
    if (needles.length > 0) checkNotice(dist, failures, needles);
    checkBundleSize(root, failures);
  }
  const pub = join(root, 'public');
  if (existsSync(pub) && readdirSync(pub).length > 0) {
    failures.push('public/ is not empty (BR-K-59: its files are served unhashed and immutable)');
  }
  return failures;
}

/** NFR-R-S1: advisory raw and gzip sizes of dist/assets/*.js. Never fails the check. */
export function sizeReport(root) {
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) return [];
  let raw = 0;
  let gz = 0;
  const lines = [];
  for (const name of readdirSync(assets)
    .filter((n) => n.endsWith('.js'))
    .sort()) {
    const buf = readFileSync(join(assets, name));
    const g = gzipSync(buf).length;
    raw += buf.length;
    gz += g;
    lines.push(`check:dist size ${name}: ${buf.length} B raw, ${g} B gzip`);
  }
  lines.push(`check:dist size total: ${raw} B raw, ${gz} B gzip (advisory)`);
  const bundle = bundleGzipBytes(root);
  lines.push(
    `check:dist bundle gate: ${bundle.total} B gzip of ${BUNDLE_GZIP_LIMIT} B (js + css, NFR-AS-P8)`,
  );
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const line of sizeReport(root)) console.log(line);
  const failures = checkDist(root);
  if (failures.length > 0) {
    for (const f of failures) console.error(`check:dist FAIL ${f}`);
    process.exit(1);
  }
  console.log('check:dist PASS');
}
