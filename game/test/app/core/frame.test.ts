import type { DomainEvent } from '@sz/kernel';
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_DT_SEC, isRunning, planFrame } from '@sz/app/core/frame';
import { createHoldTimer, holdFor } from '@sz/app/core/hold';
import { roundSignals } from '@sz/app/core/signals';

describe('planFrame (PD-AS-3)', () => {
  it('feeds 0 and does not sample on the first frame', () => {
    expect(planFrame(1000, undefined)).toEqual({ dtSec: 0, frameMs: 0, sample: false });
  });

  it('passes a normal frame through and samples it', () => {
    const p = planFrame(1016, 1000);
    expect(p.dtSec).toBeCloseTo(0.016, 9);
    expect(p.frameMs).toBeCloseTo(16, 9);
    expect(p.sample).toBe(true);
  });

  it('clamps long frames to 0.25 s and does not sample them', () => {
    const p = planFrame(3000, 1000);
    expect(p.dtSec).toBe(MAX_FRAME_DT_SEC);
    expect(p.sample).toBe(false);
  });

  it('treats backwards or non-finite time as a 0 s frame', () => {
    expect(planFrame(900, 1000)).toMatchObject({ dtSec: 0, sample: false });
    expect(planFrame(Number.NaN, 1000)).toMatchObject({ dtSec: 0, sample: false });
  });
});

describe('isRunning (PD-AS-4)', () => {
  it.each([
    ['countdown', false, false, true],
    ['live', false, false, true],
    ['ready', false, false, false],
    ['loading', false, false, false],
    ['ended', false, false, false],
    ['live', true, false, false],
    ['live', false, true, false],
  ] as const)('%s paused=%s lost=%s → %s', (phase, paused, lost, expected) => {
    expect(isRunning({ phase, paused }, lost)).toBe(expected);
  });
});

describe('end hold (PD-AS-10)', () => {
  it.each([
    ['victory', false, 0.6],
    ['victory', true, 0],
    ['defeat', false, 1.5],
    ['defeat', true, 0.3],
    ['time-expired', false, 0],
    ['abandoned', true, 0],
  ] as const)('%s reduced=%s → %s s', (outcome, reduced, sec) => {
    expect(holdFor(outcome, reduced)).toBe(sec);
  });

  it('elapses once after the accumulated dt reaches the hold', () => {
    const h = createHoldTimer();
    h.start(0.6);
    let fired = 0;
    let frames = 0;
    while (frames < 100) {
      frames++;
      if (h.advance(1 / 60)) fired++;
      if (!h.active) break;
    }
    expect(fired).toBe(1);
    expect(frames).toBe(36);
    expect(h.advance(1)).toBe(false);
  });

  it('a 0 s hold elapses on the first advance, even with dt 0', () => {
    const h = createHoldTimer();
    h.start(0);
    expect(h.advance(0)).toBe(true);
  });

  it('ignores bad input and can be reset', () => {
    const h = createHoldTimer();
    expect(h.advance(1)).toBe(false);
    h.start(Number.NaN);
    expect(h.advance(Number.NaN)).toBe(true);
    h.start(1);
    h.reset();
    expect(h.active).toBe(false);
    expect(h.advance(5)).toBe(false);
  });
});

describe('roundSignals (PD-AS-8)', () => {
  const ended: DomainEvent = { type: 'RoundEnded', outcome: 'victory', durationSec: 10 };
  const ready: DomainEvent = { type: 'RoundPhaseChanged', from: 'loading', to: 'ready' };
  const live: DomainEvent = { type: 'RoundPhaseChanged', from: 'countdown', to: 'live' };

  it('returns the same frozen object when nothing matters', () => {
    const a = roundSignals([]);
    expect(roundSignals([live])).toBe(a);
    expect(a).toEqual({ ended: undefined, newRound: false });
  });

  it('finds the round end and the new-round transition in one pass', () => {
    expect(roundSignals([live, ended])).toEqual({ ended: 'victory', newRound: false });
    expect(roundSignals([ready])).toEqual({ ended: undefined, newRound: true });
  });
});
