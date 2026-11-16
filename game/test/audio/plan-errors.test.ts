// Play planning (W7, BR-A-10, BR-A-13, BR-A-14, BR-A-32, SD-A-2, SD-A-3) and error helpers (SD-A-7).
import { describe, expect, it, vi } from 'vitest';
import { vec3 } from '@sz/kernel';
import { AudioBootFailure, createWarnOnce, errorName } from '@sz/audio/core/errors';
import { DEFAULT_POSE } from '@sz/audio/core/listener';
import { dbToGain } from '@sz/audio/core/mixer';
import { planPlay } from '@sz/audio/core/plan';

describe('planPlay', () => {
  it('plans a centred voice with the cue defaults', () => {
    const plan = planPlay('fire-rifle', undefined, undefined, DEFAULT_POSE);
    expect(plan).toMatchObject({ key: 'fire-rifle', priority: 4 });
    expect(plan?.at).toBeUndefined();
    expect(plan?.gain).toBeCloseTo(dbToGain(-6), 12);
  });

  it('BR-A-32: a spatial request is one priority lower', () => {
    const plan = planPlay('fire-rifle', vec3(5, 0, 0), undefined, DEFAULT_POSE);
    expect(plan).toMatchObject({ priority: 3, at: vec3(5, 0, 0) });
  });

  it('BR-A-13: `at` is ignored for a non-spatial cue', () => {
    const plan = planPlay('hit-head', vec3(5, 0, 0), undefined, DEFAULT_POSE);
    expect(plan?.at).toBeUndefined();
    expect(plan?.priority).toBe(4);
  });

  it('BR-A-14: drops spatial requests out of range', () => {
    expect(planPlay('footstep', vec3(0, 0, 26), undefined, DEFAULT_POSE)).toBeNull();
    expect(planPlay('footstep', vec3(0, 0, 24), undefined, DEFAULT_POSE)).not.toBeNull();
  });

  it('uses gainScale and key options', () => {
    const plan = planPlay(
      'footstep',
      undefined,
      { gainScale: 1.41, key: 'footstep:player' },
      DEFAULT_POSE,
    );
    expect(plan?.key).toBe('footstep:player');
    expect(plan?.gain).toBeCloseTo(dbToGain(-16) * 1.41, 12);
  });

  it.each([
    ['__proto__', undefined, undefined],
    ['constructor', undefined, undefined],
    [42, undefined, undefined],
    ['fire-rifle', vec3(Number.NaN, 0, 0), undefined],
    ['fire-rifle', null, undefined],
    ['hit-body', { x: 1 }, undefined],
    ['fire-rifle', undefined, { gainScale: Number.NaN }],
    ['fire-rifle', undefined, { gainScale: '2' }],
    ['fire-rifle', undefined, { gainScale: null }],
  ])('BR-A-10: rejects cue %s at %o opts %o', (cue, at, opts) => {
    expect(planPlay(cue, at, opts, DEFAULT_POSE)).toBeNull();
  });

  it('bad keys fall back to the cue id', () => {
    for (const key of [42, '', 'x'.repeat(33), null]) {
      expect(planPlay('ui-click', undefined, { key }, DEFAULT_POSE)?.key).toBe('ui-click');
    }
    expect(planPlay('ui-click', undefined, 'junk', DEFAULT_POSE)?.key).toBe('ui-click');
  });
});

describe('errors', () => {
  it('AudioBootFailure matches the BootError shape', () => {
    const cause = new Error('x');
    const e = new AudioBootFailure(cause);
    expect(e).toMatchObject({ step: 'audio', retryable: true, cause });
    expect(e).toBeInstanceOf(Error);
  });

  it.each([
    [Object.assign(new Error('m'), { name: 'NotAllowedError' }), 'NotAllowedError'],
    [new TypeError('x'), 'TypeError'],
    [new RangeError('x'), 'RangeError'],
    [Object.assign(new Error('secret path'), { name: 'WeirdError' }), 'unknown'],
    [{ name: 'SecurityError' }, 'SecurityError'],
    [{ name: 42 }, 'unknown'],
    ['NotAllowedError', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ])('errorName(%o) → %s', (e, name) => {
    expect(errorName(e)).toBe(name);
  });

  it('BR-A-71: warnOnce forwards only the first reason', () => {
    const sink = vi.fn();
    const warn = createWarnOnce(sink);
    warn('no-audio-context');
    warn('resume-refused:NotAllowedError');
    expect(sink.mock.calls).toEqual([['no-audio-context']]);
  });
});
