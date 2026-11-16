import { describe, expect, it } from 'vitest';
import {
  LOCAL_BASE_URL,
  firstLine,
  isAllowedRequest,
  parseBaseUrl,
  siteUrlFromOutputs,
} from '../../e2e/support/policy';
import { idOfTitle } from '../../e2e/support/reporter';

const SITE = 'https://d1234abcd.cloudfront.net';

describe('isAllowedRequest (SD-VS-6)', () => {
  it.each([
    [`${SITE}/assets/index-abc.js`, true],
    [`${SITE}/`, true],
    ['data:image/png;base64,AAAA', true],
    ['blob:https://d1234abcd.cloudfront.net/uuid', true],
    ['https://example.invalid/', false],
    ['http://d1234abcd.cloudfront.net/', false], // other scheme, other origin
    ['https://d1234abcd.cloudfront.net.evil.example/', false], // look-alike host
    [`https://user@d1234abcd.cloudfront.net/`, false], // userinfo
    ['https://d1234abcd.cloudfront.net@evil.example/', false], // userinfo trick
    ['not a url', false],
  ])('%s → %s', (url, allowed) => {
    expect(isAllowedRequest(url, SITE)).toBe(allowed);
  });

  it('works for the local preview origin and rejects a broken base', () => {
    expect(isAllowedRequest(`${LOCAL_BASE_URL}/?e2e=1`, LOCAL_BASE_URL)).toBe(true);
    expect(isAllowedRequest('http://localhost:4173/', LOCAL_BASE_URL)).toBe(false);
    expect(isAllowedRequest(`${SITE}/`, '::')).toBe(false);
  });
});

describe('parseBaseUrl (SD-VS-10)', () => {
  it('accepts https and normalises a trailing slash', () => {
    expect(parseBaseUrl(` ${SITE} `)).toEqual({ ok: true, url: `${SITE}/`, origin: SITE });
    expect(parseBaseUrl(`${SITE}/sub`)).toEqual({ ok: true, url: `${SITE}/sub/`, origin: SITE });
  });

  it.each([
    [undefined, 'no-deployed-url'],
    ['', 'no-deployed-url'],
    [42, 'no-deployed-url'],
    ['::nope', 'invalid-url'],
    ['http://d1234abcd.cloudfront.net', 'not-https'],
    ['https://u:p@d1234abcd.cloudfront.net', 'userinfo'],
    [`${SITE}/?x=1`, 'query-or-hash'],
    [`${SITE}/#top`, 'query-or-hash'],
  ])('rejects %j (%s)', (raw, reason) => {
    expect(parseBaseUrl(raw)).toEqual({ ok: false, reason });
  });
});

describe('siteUrlFromOutputs', () => {
  it('reads only SiteUrl from any stack', () => {
    expect(siteUrlFromOutputs({ StrikeZoneHosting: { BucketName: 'b', SiteUrl: SITE } })).toBe(
      SITE,
    );
  });

  it.each([null, 'x', {}, { S: null }, { S: { SiteUrl: 5 } }, { S: { Other: SITE } }])(
    'returns undefined for %j',
    (v) => {
      expect(siteUrlFromOutputs(v)).toBeUndefined();
    },
  );
});

describe('firstLine', () => {
  it('prefers the dynamic-loader line, else the first non-empty line, and clips', () => {
    const msg =
      'browserType.launch: closed\n\n[pid=1][err] chrome: error while loading shared libraries: libglib-2.0.so.0\n';
    expect(firstLine(msg)).toBe(
      '[pid=1][err] chrome: error while loading shared libraries: libglib-2.0.so.0',
    );
    expect(firstLine(new Error('one\ntwo'))).toBe('one');
    expect(firstLine('x'.repeat(500), 10)).toHaveLength(10);
    expect(firstLine(undefined)).toBe('');
  });
});

describe('reporter idOfTitle', () => {
  it('recovers the catalogue id from a spec title', () => {
    expect(idOfTitle('restart-10 | restart: 10 restarts')).toBe('restart-10');
    expect(idOfTitle('no separator')).toBe('no separator');
  });
});
