import { describe, expect, it } from 'vitest';
import { checkCapabilities, MIN_WIDTH_PX, type EnvProbe } from '@sz/app/core/capabilities';
import { parseUrlFlags } from '@sz/app/core/url';

const DESKTOP: EnvProbe = {
  webgl2: true,
  pointerLock: true,
  finePointer: true,
  maxTouchPoints: 0,
  innerWidth: 1920,
};

describe('checkCapabilities (story-unsupported-notice)', () => {
  it('passes a desktop browser', () => {
    expect(checkCapabilities(DESKTOP)).toMatchObject({ blocked: false, canContinue: false });
  });

  it('blocks without WebGL 2 and offers no continue', () => {
    const v = checkCapabilities({ ...DESKTOP, webgl2: false });
    expect(v).toMatchObject({ webgl2: false, blocked: true, canContinue: false });
  });

  it('blocks a touch-only device (no fine pointer, touch points present)', () => {
    const v = checkCapabilities({ ...DESKTOP, finePointer: false, maxTouchPoints: 5 });
    expect(v).toMatchObject({ pointer: false, blocked: true, canContinue: false });
  });

  it('assumes a mouse when no touch points are reported', () => {
    expect(checkCapabilities({ ...DESKTOP, finePointer: false }).pointer).toBe(true);
  });

  it('blocks without pointer lock support', () => {
    expect(checkCapabilities({ ...DESKTOP, pointerLock: false }).blocked).toBe(true);
  });

  it('offers Continue anyway when width is the only failed check', () => {
    const v = checkCapabilities({ ...DESKTOP, innerWidth: MIN_WIDTH_PX - 1 });
    expect(v).toMatchObject({ widthOk: false, blocked: true, canContinue: true });
    expect(checkCapabilities({ ...DESKTOP, innerWidth: MIN_WIDTH_PX }).blocked).toBe(false);
  });

  it('treats non-finite numbers as failed checks', () => {
    const v = checkCapabilities({
      ...DESKTOP,
      innerWidth: Number.NaN,
      maxTouchPoints: Number.NaN,
      finePointer: false,
    });
    expect(v).toMatchObject({ widthOk: false, pointer: false });
  });

  it('returns a frozen verdict', () => {
    expect(Object.isFrozen(checkCapabilities(DESKTOP))).toBe(true);
  });
});

describe('parseUrlFlags (SD-AS-3)', () => {
  it.each([
    ['?e2e', true],
    ['?e2e=1', true],
    ['?x=1&e2e=0', true],
    ['', false],
    ['?E2E=1', false],
    ['?e2ex=1', false],
  ])('%s → e2e %s', (search, e2e) => {
    expect(parseUrlFlags(search).e2e).toBe(e2e);
  });

  it('ignores non-string input', () => {
    expect(parseUrlFlags(undefined).e2e).toBe(false);
    expect(parseUrlFlags(42).e2e).toBe(false);
  });
});
