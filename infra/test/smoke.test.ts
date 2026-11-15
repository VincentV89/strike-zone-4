import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPECTED_RESPONSE_HEADERS } from '../lib/security-headers';
import {
  extractAssetReferences,
  formatResult,
  hasFailures,
  readStackOutputs,
  runSmoke,
  scanBundle,
  type CheckResult,
} from '../scripts/smoke';

const SITE = 'https://d111111abcdef8.cloudfront.net';
const BUCKET = 'strikezonehosting-sitebucket-abc123';
const INDEX_HTML =
  '<!doctype html><html><head>' +
  '<script type="module" crossorigin src="/assets/index-AbC123.js"></script>' +
  '<link rel="modulepreload" href="/assets/vendor-Def456.js">' +
  '<link rel="stylesheet" crossorigin href="/assets/index-Ghi789.css">' +
  '<link rel="icon" href="data:,">' +
  '</head><body><div id="app"></div></body></html>';
const LARGE_JS = 'x'.repeat(2_000);

type Route = () => Response;

function htmlResponse(withSecurityHeaders = true): Response {
  return new Response(INDEX_HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html',
      'cache-control': 'no-cache',
      ...(withSecurityHeaders ? EXPECTED_RESPONSE_HEADERS : {}),
    },
  });
}

function assetResponse(type: string): Response {
  return new Response(LARGE_JS, {
    status: 200,
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=31536000, immutable',
      'content-encoding': 'br',
      ...EXPECTED_RESPONSE_HEADERS,
    },
  });
}

/** A healthy deployment. Tests override individual routes to inject one fault each. */
function healthyRoutes(): Record<string, Route> {
  return {
    [`${SITE}/`]: () => htmlResponse(),
    [`${SITE}/assets/index-AbC123.js`]: () => assetResponse('text/javascript'),
    [`${SITE}/assets/vendor-Def456.js`]: () => assetResponse('application/javascript'),
    [`${SITE}/assets/index-Ghi789.css`]: () => assetResponse('text/css'),
    [`${SITE}/no-such-route`]: () => htmlResponse(),
    ['http://d111111abcdef8.cloudfront.net/']: () =>
      new Response(null, { status: 301, headers: { location: `${SITE}/` } }),
    [`https://${BUCKET}.s3.eu-west-1.amazonaws.com/index.html`]: () =>
      new Response('AccessDenied', { status: 403 }),
  };
}

function fakeFetch(routes: Record<string, Route>): typeof fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const route = routes[url];
    return Promise.resolve(
      route === undefined ? new Response('not routed', { status: 599 }) : route(),
    );
  };
}

async function smoke(overrides: Record<string, Route> = {}, extra: { bucketName?: string } = {}) {
  return runSmoke({
    siteUrl: SITE,
    bucketName: 'bucketName' in extra ? extra.bucketName : BUCKET,
    region: 'eu-west-1',
    distDir: undefined,
    fetchImpl: fakeFetch({ ...healthyRoutes(), ...overrides }),
    ttfbSamples: 2,
  });
}

function byName(results: CheckResult[], fragment: string): CheckResult[] {
  return results.filter((check) => check.name.includes(fragment));
}

const tempDirs: string[] = [];
afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'strikezone-smoke-'));
  tempDirs.push(dir);
  return dir;
}

describe('smoke against a healthy deployment', () => {
  it('passes every gating check and reports the advisory figures', async () => {
    const results = await smoke();
    expect(results.filter((c) => c.status === 'FAIL')).toEqual([]);
    expect(hasFailures(results)).toBe(false);
    expect(byName(results, 'asset /assets/')).toHaveLength(3);
    expect(byName(results, 'NFR-HI-P4')[0]!.status).toBe('INFO');
    expect(byName(results, 'NFR-HI-P5')[0]!.status).toBe('INFO');
    expect(byName(results, 'SEC-HI-05')[0]!.status).toBe('PASS');
    expect(byName(results, 'SEC-HI-04')[0]!.status).toBe('PASS');
  });

  it('formats one aligned line per check', () => {
    expect(formatResult({ status: 'PASS', name: 'x', detail: 'y' })).toBe('PASS    x: y');
  });
});

describe('smoke detects faults', () => {
  it('fails when a missing asset is answered by the SPA fallback as text/html', async () => {
    const results = await smoke({ [`${SITE}/assets/index-AbC123.js`]: () => htmlResponse() });
    const [asset] = byName(results, 'asset /assets/index-AbC123.js');
    expect(asset!.status).toBe('FAIL');
    expect(asset!.detail).toContain('text/html');
  });

  it('fails when the CSP on / differs from the shared constant', async () => {
    const weakened = () => {
      const response = htmlResponse();
      response.headers.set('content-security-policy', 'default-src *');
      return response;
    };
    const results = await smoke({ [`${SITE}/`]: weakened });
    expect(byName(results, 'content-security-policy on /')[0]!.status).toBe('FAIL');
  });

  it('fails when index.html is cacheable', async () => {
    const cached = () => {
      const response = htmlResponse();
      response.headers.set('cache-control', 'max-age=86400');
      return response;
    };
    const results = await smoke({ [`${SITE}/`]: cached });
    expect(byName(results, 'NFR-HI-P1')[0]!.status).toBe('FAIL');
  });

  it('fails when a large script is served uncompressed', async () => {
    const plain = () => {
      const response = assetResponse('text/javascript');
      response.headers.delete('content-encoding');
      return response;
    };
    const results = await smoke({ [`${SITE}/assets/index-AbC123.js`]: plain });
    expect(byName(results, 'asset /assets/index-AbC123.js')[0]!.detail).toContain(
      'content-encoding',
    );
  });

  it('reports missing headers on the fallback route as a FINDING, not a failure (ADR-HI-9)', async () => {
    const results = await smoke({ [`${SITE}/no-such-route`]: () => htmlResponse(false) });
    const fallbackHeaders = byName(results, 'on /no-such-route');
    expect(fallbackHeaders.every((c) => c.status === 'FINDING')).toBe(true);
    expect(byName(results, 'NFR-HI-R2')[0]!.status).toBe('PASS');
    expect(hasFailures(results)).toBe(false);
  });

  it('fails when an unknown path returns an S3 error page', async () => {
    const results = await smoke({
      [`${SITE}/no-such-route`]: () =>
        new Response('<Error>AccessDenied</Error>', {
          status: 403,
          headers: { 'content-type': 'application/xml' },
        }),
    });
    expect(byName(results, 'NFR-HI-R2')[0]!.status).toBe('FAIL');
  });

  it('fails when plain HTTP is served instead of redirected', async () => {
    const results = await smoke({
      ['http://d111111abcdef8.cloudfront.net/']: () => htmlResponse(),
    });
    expect(byName(results, 'SEC-HI-05')[0]!.status).toBe('FAIL');
  });

  it('fails when the bucket answers a direct request, and skips without a bucket name', async () => {
    const open = await smoke({
      [`https://${BUCKET}.s3.eu-west-1.amazonaws.com/index.html`]: () => htmlResponse(),
    });
    expect(byName(open, 'SEC-HI-04')[0]!.status).toBe('FAIL');
    const skipped = await smoke({}, { bucketName: undefined });
    expect(byName(skipped, 'SEC-HI-04')[0]!.status).toBe('SKIP');
  });

  it('fails when index.html references an asset on another origin', async () => {
    const external = () =>
      new Response('<script src="https://cdn.example.com/three.js"></script>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' },
      });
    const results = await smoke({ [`${SITE}/`]: external });
    expect(byName(results, 'cdn.example.com')[0]!.status).toBe('FAIL');
  });
});

describe('smoke helpers', () => {
  it('extracts scripts, stylesheets and preloads but not icons', () => {
    expect(extractAssetReferences(INDEX_HTML).sort()).toEqual([
      '/assets/index-AbC123.js',
      '/assets/index-Ghi789.css',
      '/assets/vendor-Def456.js',
    ]);
  });

  it('scans the bundle for key material (SEC-HI-08)', () => {
    const dist = tempDir();
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    writeFileSync(join(dist, 'assets', 'clean.js'), 'console.log(1)');
    expect(scanBundle(dist).status).toBe('PASS');
    writeFileSync(join(dist, 'assets', 'leak.js'), `const k = "AKIA${'Q'.repeat(16)}";`);
    const leaked = scanBundle(dist);
    expect(leaked.status).toBe('FAIL');
    expect(leaked.detail).toContain('leak.js');
  });

  it('skips the bundle scan honestly when no build exists', () => {
    expect(scanBundle(join(tmpdir(), 'strikezone-no-such-dist')).status).toBe('SKIP');
  });

  it('reads SiteUrl and BucketName from cdk-outputs.json', () => {
    const dir = tempDir();
    const path = join(dir, 'cdk-outputs.json');
    writeFileSync(
      path,
      JSON.stringify({
        StrikeZoneHosting: { SiteUrl: SITE, BucketName: BUCKET, DistributionId: 'E1' },
      }),
    );
    expect(readStackOutputs(path)).toEqual({ siteUrl: SITE, bucketName: BUCKET });
    writeFileSync(path, JSON.stringify({ OtherStack: {} }));
    expect(() => readStackOutputs(path)).toThrow(/StrikeZoneHosting\.SiteUrl/);
  });
});
