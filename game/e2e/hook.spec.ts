/**
 * Test-hook boundary (security-design-verification-suite SD-VS-8, SEC-VS-20 to SEC-VS-22).
 * Runs locally and on the deployed URL. Hostile values are built inside the page, never passed
 * as Playwright arguments, because the serialiser would change NaN and __proto__ keys.
 */
import { expect, test } from './support/fixtures';
import { specTitle } from './support/checks';

test(specTitle('hook-absent-without-flag'), async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => ({
    present: '__strikezone' in window,
    type: typeof window.__strikezone,
  }));
  expect(state).toEqual({ present: false, type: 'undefined' });
});

test(specTitle('hook-descriptor-frozen'), async ({ page }) => {
  await page.goto('/?e2e=1');
  const d = await page.evaluate(() => {
    const desc = Object.getOwnPropertyDescriptor(window, '__strikezone');
    return {
      found: desc !== undefined,
      writable: desc?.writable,
      configurable: desc?.configurable,
      enumerable: desc?.enumerable,
      frozen: Object.isFrozen(desc?.value),
    };
  });
  expect(d).toEqual({
    found: true,
    writable: false,
    configurable: false,
    enumerable: false,
    frozen: true,
  });
});

// A string script runs in sloppy mode; a function passed to evaluate might not.
const SLOPPY = `(() => {
  const before = window.__strikezone;
  const threw = [];
  try { __strikezone = {}; } catch (e) { threw.push('assign'); }
  try { window.__strikezone.inject = () => 1; } catch (e) { threw.push('member'); }
  let deleted;
  try { deleted = delete window.__strikezone; } catch (e) { threw.push('delete'); }
  return { threw, deleted, same: window.__strikezone === before, frozen: Object.isFrozen(window.__strikezone) };
})()`;

test(specTitle('hook-tamper-sloppy'), async ({ page }) => {
  await page.goto('/?e2e=1');
  const r = await page.evaluate(SLOPPY);
  expect(r).toEqual({ threw: [], deleted: false, same: true, frozen: true });
});

const STRICT = `(() => {
  'use strict';
  const before = window.__strikezone;
  const kinds = [];
  const attempt = (f) => { try { f(); kinds.push('none'); } catch (e) { kinds.push(e instanceof TypeError ? 'TypeError' : 'other'); } };
  attempt(() => { window.__strikezone = {}; });
  attempt(() => { window.__strikezone.inject = () => 1; });
  attempt(() => { delete window.__strikezone; });
  return { kinds, same: window.__strikezone === before };
})()`;

test(specTitle('hook-tamper-strict'), async ({ page }) => {
  await page.goto('/?e2e=1');
  const r = await page.evaluate(STRICT);
  expect(r).toEqual({ kinds: ['TypeError', 'TypeError', 'TypeError'], same: true });
});

const HOSTILE = `(() => {
  const h = window.__strikezone;
  const good = { mapId: 'desert-compound', botCount: 5, difficulty: 'normal' };
  const seeds = [-1, 2 ** 32, 1.5, NaN, '1', null, { valueOf: () => 7 }];
  const ticks = [0, 3601, 1.5, Infinity];
  const setups = [
    { ...good, botCount: 4 },
    { ...good, botCount: 21 },
    { ...good, mapId: 'unknown-map' },
    { ...good, difficulty: 'impossible' },
    JSON.parse('{"__proto__":{"botCount":5}}'),
  ];
  const out = [];
  for (const s of seeds) out.push(['seed', String(s), h.startMatch(good, s).ok]);
  for (const t of ticks) out.push(['ticks', String(t), h.inject({}, t).ok]);
  for (const s of setups) out.push(['setup', JSON.stringify(s), h.startMatch(s, 1).ok]);
  return { out, errors: [...h.errors()], polluted: ({}).botCount !== undefined };
})()`;

test(specTitle('hook-hostile-inputs'), async ({ page }) => {
  await page.goto('/?e2e=1');
  const r = await page.evaluate(HOSTILE);
  const typed = r as { out: [string, string, boolean][]; errors: string[]; polluted: boolean };
  expect(typed.out.filter(([, , ok]) => ok)).toEqual([]);
  expect(typed.out).toHaveLength(16);
  expect(typed.errors).toEqual([]);
  expect(typed.polluted).toBe(false);
});
