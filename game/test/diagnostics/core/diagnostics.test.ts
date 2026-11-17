import { describe, expect, it } from 'vitest';
import {
  ADVISORY_RULES,
  createAdvisoryRule,
  type AdvisoryInput,
} from '@sz/diagnostics/core/advisory';
import {
  MAX_INJECT_TICKS,
  MAX_SEED,
  parseSeed,
  parseTicks,
  sanitizeInjectedIntent,
} from '@sz/diagnostics/core/inject';
import { createFrameProbe } from '@sz/diagnostics/core/probe';

describe('frame probe (PD-AS-5)', () => {
  it('reports zero stats when empty', () => {
    const p = createFrameProbe(4);
    expect(p.stats()).toEqual({ samples: 0, medianFps: 0, worstMs: 0, p95Ms: 0 });
    expect(p.medianFps()).toBe(0);
  });

  it('computes median FPS, worst and p95 over the ring', () => {
    const p = createFrameProbe(5);
    for (const ms of [10, 20, 30, 40, 50]) p.sample(ms);
    expect(p.stats()).toEqual({ samples: 5, medianFps: 1000 / 30, worstMs: 50, p95Ms: 50 });
    p.sample(20); // overwrites the oldest (10)
    expect(p.count).toBe(5);
    expect(p.medianFps()).toBeCloseTo(1000 / 30, 9);
    expect(p.stats().worstMs).toBe(50);
  });

  it('uses the mean of the middle pair for an even count', () => {
    const p = createFrameProbe(10);
    for (const ms of [10, 20, 30, 40]) p.sample(ms);
    expect(p.medianFps()).toBeCloseTo(1000 / 25, 9);
  });

  it('drops invalid samples, keeps capacity fixed and resets', () => {
    const p = createFrameProbe(0);
    expect(p.capacity).toBe(60);
    for (const ms of [Number.NaN, -1, 0, Infinity]) p.sample(ms);
    expect(p.count).toBe(0);
    p.sample(16);
    p.reset();
    expect(p.count).toBe(0);
  });
});

describe('advisory rule (FD-AS-1, PD-AS-6)', () => {
  const live = (fps: number, patch: Partial<AdvisoryInput> = {}): AdvisoryInput => ({
    phase: 'live',
    paused: false,
    preset: 'high',
    medianFps: () => fps,
    ...patch,
  });

  function framesUntilFire(
    rule: ReturnType<typeof createAdvisoryRule>,
    input: AdvisoryInput,
    max = 2000,
  ) {
    for (let i = 1; i <= max; i++) if (rule.evaluate(input) !== null) return i;
    return -1;
  }

  it('fires once at frame 300 when the median is below 30 FPS', () => {
    const rule = createAdvisoryRule();
    expect(framesUntilFire(rule, live(29))).toBe(ADVISORY_RULES.minLiveFrames);
    expect(rule.fired).toBe(true);
    expect(framesUntilFire(rule, live(5), 1000)).toBe(-1);
  });

  it('does not fire at 30 FPS or above', () => {
    expect(framesUntilFire(createAdvisoryRule(), live(30), 1000)).toBe(-1);
    expect(framesUntilFire(createAdvisoryRule(), live(31), 1000)).toBe(-1);
  });

  it('only on High, live and unpaused frames; bot count is not an input', () => {
    expect(framesUntilFire(createAdvisoryRule(), live(10, { preset: 'medium' }), 1000)).toBe(-1);
    expect(framesUntilFire(createAdvisoryRule(), live(10, { preset: 'low' }), 1000)).toBe(-1);
    const paused = createAdvisoryRule();
    expect(framesUntilFire(paused, live(10, { paused: true }), 1000)).toBe(-1);
    expect(paused.liveFrames).toBe(0);
    expect(framesUntilFire(createAdvisoryRule(), live(10, { phase: 'countdown' }), 1000)).toBe(-1);
  });

  it('reads the median at most once per 60 live frames', () => {
    const rule = createAdvisoryRule();
    let reads = 0;
    const input = live(60, {
      medianFps: () => {
        reads++;
        return 60;
      },
    });
    for (let i = 0; i < 300 + 600; i++) rule.evaluate(input);
    expect(reads).toBe(11);
  });

  it('re-arms on a new round', () => {
    const rule = createAdvisoryRule();
    framesUntilFire(rule, live(10));
    rule.rearm();
    expect(rule.fired).toBe(false);
    expect(framesUntilFire(rule, live(10))).toBe(300);
  });

  it('ignores a non-finite median and rounds the reported FPS', () => {
    expect(framesUntilFire(createAdvisoryRule(), live(Number.NaN), 1000)).toBe(-1);
    const rule = createAdvisoryRule();
    for (let i = 0; i < 299; i++) rule.evaluate(live(24.6));
    expect(rule.evaluate(live(24.6))).toBe(25);
  });
});

describe('e2e inject sanitiser (SEC-AS-23)', () => {
  it('builds a fresh intent from known fields only', () => {
    const raw = {
      look: { dx: 3, dy: Number.NaN, extra: 1 },
      move: { forward: 0.5, right: -9 },
      fire: true,
      sprint: 'yes',
      firePressed: true,
      switchTo: 2,
      position: { x: 1 },
      health: 1000,
    };
    const r = sanitizeInjectedIntent(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      look: { dx: 3, dy: 0 },
      move: { forward: 1, right: -1 },
      sprint: false,
      crouch: false,
      fire: true,
      aim: false,
      jump: false,
      firePressed: true,
      reload: false,
      switchTo: 'pistol',
    });
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(r.value).not.toHaveProperty('position');
  });

  it.each([
    ['sniper', 'sniper'],
    ['next', 'next'],
    ['prev', 'prev'],
    [4, null],
    ['knife', null],
    [undefined, null],
  ])('switchTo %s → %s', (raw, expected) => {
    const r = sanitizeInjectedIntent({ switchTo: raw });
    expect(r.ok && r.value.switchTo).toBe(expected);
  });

  it('rejects non-objects and ignores inherited fields', () => {
    for (const raw of [null, 1, 'x', [1]]) expect(sanitizeInjectedIntent(raw).ok).toBe(false);
    const proto = Object.create({ fire: true }) as object;
    const r = sanitizeInjectedIntent(proto);
    expect(r.ok && r.value.fire).toBe(false);
    const neutral = sanitizeInjectedIntent({ move: 'x', look: null });
    expect(neutral.ok && neutral.value.move).toEqual({ forward: 0, right: 0 });
  });

  it.each([
    [1, true],
    [MAX_INJECT_TICKS, true],
    [0, false],
    [MAX_INJECT_TICKS + 1, false],
    [1.5, false],
    ['5', false],
  ])('ticks %s ok=%s', (raw, ok) => {
    expect(parseTicks(raw).ok).toBe(ok);
  });

  it.each([
    [0, true],
    [MAX_SEED, true],
    [-1, false],
    [2 ** 32, false],
    [1.5, false],
    [Number.NaN, false],
    ['1', false],
  ])('seed %s ok=%s (SD-AS-5)', (raw, ok) => {
    expect(parseSeed(raw).ok).toBe(ok);
  });
});
