/**
 * Live smoke check after deploy (req-deploy-verification HTTP part, NFR-HI-P1 to P5, NFR-HI-R2,
 * SEC-HI-04 to 08). Uses Node's global fetch only. Prints one line per check and exits non-zero
 * on any FAIL. FINDING lines are reported evidence that does not fail the run (ADR-HI-9).
 *
 * Usage: npm --prefix infra run smoke [-- <SiteUrl>]
 * Without an argument it reads SiteUrl and BucketName from infra/cdk-outputs.json.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { STACK_NAME } from '../lib/hosting-stack';
import { findSecretMatches } from '../lib/secret-patterns';
import { EXPECTED_RESPONSE_HEADERS, HSTS_MAX_AGE_SECONDS } from '../lib/security-headers';
import { formatError, regionFromEnv } from './aws-env';

export type CheckStatus = 'PASS' | 'FAIL' | 'FINDING' | 'SKIP' | 'INFO';

export interface CheckResult {
  readonly status: CheckStatus;
  readonly name: string;
  readonly detail: string;
}

export interface SmokeOptions {
  readonly siteUrl: string;
  readonly bucketName?: string | undefined;
  readonly region?: string | undefined;
  /** Local game build to scan for secrets (SEC-HI-08). */
  readonly distDir?: string | undefined;
  readonly fetchImpl?: typeof fetch;
  readonly ttfbSamples?: number;
}

/** CloudFront only compresses objects between 1,000 bytes and 10 MB. */
const MIN_COMPRESSIBLE_BYTES = 1_000;
const FIRST_LOAD_WARN_BYTES = 5 * 1024 * 1024;
const FALLBACK_PATH = '/no-such-route';
const ACCEPT_ENCODING = { 'accept-encoding': 'br, gzip' };

const EXPECTED_TYPES: Readonly<Record<string, readonly string[]>> = {
  '.js': ['text/javascript', 'application/javascript'],
  '.mjs': ['text/javascript', 'application/javascript'],
  '.css': ['text/css'],
  '.wasm': ['application/wasm'],
};

export interface FetchedPage {
  readonly response: Response;
  readonly body: string;
  readonly bytes: number;
}

export async function runSmoke(options: SmokeOptions): Promise<CheckResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = new URL(options.siteUrl);
  const results: CheckResult[] = [];
  const index = await fetchPage(fetchImpl, new URL('/', base));

  results.push(checkIndexDocument(index));
  results.push(...checkSecurityHeaders('/', index.response, 'FAIL'));
  const assets = await checkAssets(fetchImpl, base, index.body, results);
  results.push(firstLoadSize(index.bytes + assets.totalBytes));
  results.push(...(await checkFallback(fetchImpl, base, index.body)));
  results.push(await checkHttpRedirect(fetchImpl, base));
  results.push(await checkDirectS3(fetchImpl, options.bucketName, options.region));
  results.push(scanBundle(options.distDir));
  results.push(await measureTtfb(fetchImpl, base, options.ttfbSamples ?? 5));
  return results;
}

async function fetchPage(fetchImpl: typeof fetch, url: URL): Promise<FetchedPage> {
  const response = await fetchImpl(url, { headers: ACCEPT_ENCODING });
  const body = await response.text();
  const declared = Number(response.headers.get('content-length'));
  const bytes = Number.isFinite(declared) && declared > 0 ? declared : Buffer.byteLength(body);
  return { response, body, bytes };
}

function header(response: Response, name: string): string {
  return response.headers.get(name) ?? '';
}

function result(passed: boolean, name: string, detail: string): CheckResult {
  return { status: passed ? 'PASS' : 'FAIL', name, detail };
}

export function checkIndexDocument(index: FetchedPage): CheckResult {
  const type = header(index.response, 'content-type');
  const cacheControl = header(index.response, 'cache-control');
  const passed =
    index.response.status === 200 &&
    type.startsWith('text/html') &&
    cacheControl.includes('no-cache');
  return result(
    passed,
    'index.html served (NFR-HI-P1)',
    `status ${index.response.status}, content-type "${type}", cache-control "${cacheControl}"`,
  );
}

/** Exact comparison against the constants the CloudFront policy is built from (ADR-HI-7). */
export function checkSecurityHeaders(
  path: string,
  response: Response,
  failureStatus: 'FAIL' | 'FINDING',
): CheckResult[] {
  return Object.entries(EXPECTED_RESPONSE_HEADERS).map(([name, expected]) => {
    const actual = response.headers.get(name);
    const matches = actual === expected;
    return {
      status: matches ? 'PASS' : failureStatus,
      name: `${name} on ${path} (SEC-HI-06/07)`,
      detail: matches ? 'matches' : `expected "${expected}", got "${actual ?? '(missing)'}"`,
    };
  });
}

/** Script, stylesheet and preload references in index.html. */
export function extractAssetReferences(html: string): string[] {
  const references = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const src = match[1];
    if (src !== undefined) {
      references.add(src);
    }
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = /\brel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
    if (href !== undefined && /\b(stylesheet|modulepreload|preload)\b/.test(rel)) {
      references.add(href);
    }
  }
  return [...references];
}

async function checkAssets(
  fetchImpl: typeof fetch,
  base: URL,
  indexHtml: string,
  results: CheckResult[],
): Promise<{ totalBytes: number }> {
  const references = extractAssetReferences(indexHtml);
  if (references.length === 0) {
    results.push(result(false, 'assets referenced by index.html', 'none found'));
    return { totalBytes: 0 };
  }
  let totalBytes = 0;
  let hstsChecked = false;
  for (const reference of references) {
    const url = new URL(reference, base);
    if (url.origin !== base.origin) {
      results.push(result(false, `asset ${reference}`, 'not on the CloudFront origin'));
      continue;
    }
    const asset = await fetchPage(fetchImpl, url);
    totalBytes += asset.bytes;
    results.push(checkAsset(url.pathname, asset));
    if (!hstsChecked) {
      hstsChecked = true;
      const hsts = header(asset.response, 'strict-transport-security');
      const expected = `max-age=${HSTS_MAX_AGE_SECONDS}`;
      results.push(result(hsts === expected, `HSTS on ${url.pathname}`, `got "${hsts}"`));
    }
  }
  return { totalBytes };
}

/** NFR-HI-P2 type and status, NFR-HI-P3 caching and compression. */
export function checkAsset(path: string, asset: FetchedPage): CheckResult {
  const problems: string[] = [];
  const type = header(asset.response, 'content-type');
  const cacheControl = header(asset.response, 'cache-control');
  const encoding = header(asset.response, 'content-encoding');
  const expectedTypes = EXPECTED_TYPES[extname(path).toLowerCase()];
  if (asset.response.status !== 200) problems.push(`status ${asset.response.status}`);
  if (type.startsWith('text/html'))
    problems.push('served as text/html (missing asset answered by the SPA fallback)');
  if (expectedTypes !== undefined && !expectedTypes.some((t) => type.startsWith(t))) {
    problems.push(`content-type "${type}"`);
  }
  if (!cacheControl.includes('max-age=31536000') || !cacheControl.includes('immutable')) {
    problems.push(`cache-control "${cacheControl}"`);
  }
  const compressible = ['.js', '.mjs', '.css'].includes(extname(path).toLowerCase());
  if (compressible && asset.bytes >= MIN_COMPRESSIBLE_BYTES && !/^(br|gzip)$/.test(encoding)) {
    problems.push(`content-encoding "${encoding}"`);
  }
  const detail =
    problems.length === 0
      ? `${type}, ${encoding || 'identity'}, ${asset.bytes} B`
      : problems.join('; ');
  return result(problems.length === 0, `asset ${path} (NFR-HI-P2/P3)`, detail);
}

function firstLoadSize(totalBytes: number): CheckResult {
  const megabytes = (totalBytes / (1024 * 1024)).toFixed(2);
  if (totalBytes > FIRST_LOAD_WARN_BYTES) {
    return {
      status: 'FINDING',
      name: 'first-load transfer (NFR-HI-P4)',
      detail: `${megabytes} MB exceeds 5 MB`,
    };
  }
  return { status: 'INFO', name: 'first-load transfer (NFR-HI-P4)', detail: `${megabytes} MB` };
}

/** NFR-HI-R2: an unknown path returns the app; headers there are a FINDING if missing (ADR-HI-9). */
async function checkFallback(
  fetchImpl: typeof fetch,
  base: URL,
  indexBody: string,
): Promise<CheckResult[]> {
  const fallback = await fetchPage(fetchImpl, new URL(FALLBACK_PATH, base));
  const type = header(fallback.response, 'content-type');
  const passed =
    fallback.response.status === 200 && type.startsWith('text/html') && fallback.body === indexBody;
  return [
    result(
      passed,
      `${FALLBACK_PATH} returns index.html (NFR-HI-R2)`,
      `status ${fallback.response.status}, content-type "${type}"`,
    ),
    ...checkSecurityHeaders(FALLBACK_PATH, fallback.response, 'FINDING'),
  ];
}

/** SEC-HI-05: plain HTTP is redirected to HTTPS with 301. */
async function checkHttpRedirect(fetchImpl: typeof fetch, base: URL): Promise<CheckResult> {
  const httpUrl = new URL('/', base);
  httpUrl.protocol = 'http:';
  const response = await fetchImpl(httpUrl, { redirect: 'manual' });
  const location = header(response, 'location');
  return result(
    response.status === 301 && location.startsWith('https://'),
    'HTTP redirects to HTTPS (SEC-HI-05)',
    `status ${response.status}, location "${location}"`,
  );
}

/** SEC-HI-04: the bucket is not readable around CloudFront. */
async function checkDirectS3(
  fetchImpl: typeof fetch,
  bucketName: string | undefined,
  region: string | undefined,
): Promise<CheckResult> {
  const name = 'direct S3 request denied (SEC-HI-04)';
  if (bucketName === undefined) {
    return { status: 'SKIP', name, detail: 'no BucketName (pass cdk-outputs.json)' };
  }
  const host = region === undefined ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`;
  const url = `https://${bucketName}.${host}/index.html`;
  const response = await fetchImpl(url);
  return result(response.status === 403, name, `${url} returned ${response.status}`);
}

/** SEC-HI-08 bundle scan over the local game build. */
export function scanBundle(distDir: string | undefined): CheckResult {
  const name = 'bundle contains no AWS keys (SEC-HI-08)';
  if (distDir === undefined || !existsSync(distDir)) {
    return { status: 'SKIP', name, detail: `${distDir ?? '(none)'} not found, scan not run` };
  }
  const hits: string[] = [];
  const files = readdirSync(distDir, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  );
  for (const file of files) {
    const path = join(file.parentPath, file.name);
    for (const pattern of findSecretMatches(readFileSync(path, 'latin1'))) {
      hits.push(`${path}: /${pattern}/`);
    }
  }
  return result(
    hits.length === 0,
    name,
    hits.length === 0 ? `${files.length} files clean` : hits.join(', '),
  );
}

/** NFR-HI-P5: median time to response headers for index.html. Advisory. */
async function measureTtfb(
  fetchImpl: typeof fetch,
  base: URL,
  samples: number,
): Promise<CheckResult> {
  const timings: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const started = performance.now();
    const response = await fetchImpl(new URL('/', base), {
      headers: { 'cache-control': 'no-cache' },
    });
    timings.push(performance.now() - started);
    await response.body?.cancel();
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)] ?? 0;
  return {
    status: 'INFO',
    name: 'index.html TTFB median (NFR-HI-P5)',
    detail: `${median.toFixed(0)} ms over ${samples} requests`,
  };
}

export function formatResult(check: CheckResult): string {
  return `${check.status.padEnd(7)} ${check.name}: ${check.detail}`;
}

export function hasFailures(results: readonly CheckResult[]): boolean {
  return results.some((check) => check.status === 'FAIL');
}

interface StackOutputs {
  readonly siteUrl: string;
  readonly bucketName: string | undefined;
}

/** Reads SiteUrl and BucketName written by `cdk deploy --outputs-file cdk-outputs.json`. */
export function readStackOutputs(outputsPath: string): StackOutputs {
  const parsed = JSON.parse(readFileSync(outputsPath, 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >;
  const outputs = parsed[STACK_NAME];
  const siteUrl = outputs?.SiteUrl;
  if (siteUrl === undefined) {
    throw new Error(`${outputsPath} has no ${STACK_NAME}.SiteUrl output`);
  }
  return { siteUrl, bucketName: outputs?.BucketName };
}

async function main(): Promise<number> {
  const argument = process.argv[2];
  const outputsPath = resolve(process.cwd(), 'cdk-outputs.json');
  const outputs =
    argument === undefined
      ? readStackOutputs(outputsPath)
      : { siteUrl: argument, bucketName: undefined };
  console.log(`smoke: ${outputs.siteUrl}`);
  const results = await runSmoke({
    siteUrl: outputs.siteUrl,
    bucketName: outputs.bucketName,
    region: regionFromEnv(),
    distDir: resolve(__dirname, '../../game/dist'),
  });
  results.forEach((check) => {
    console.log(formatResult(check));
  });
  const failed = hasFailures(results);
  console.log(failed ? 'smoke: FAIL' : 'smoke: PASS');
  return failed ? 1 : 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.log(`smoke: ${formatError(error)}`);
      process.exitCode = 1;
    },
  );
}
