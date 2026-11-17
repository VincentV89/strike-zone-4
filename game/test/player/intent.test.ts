import { MAX_SUBSTEPS } from '@sz/kernel';
import { EMPTY_CARRY, NEUTRAL_INTENT, distributeIntent, type PlayerInputIntent } from '@sz/player';
import { describe, expect, it } from 'vitest';

const intent = (p: Partial<PlayerInputIntent> = {}): PlayerInputIntent => ({
  ...NEUTRAL_INTENT,
  ...p,
});

describe('distributeIntent (contract-player-intent, BR-P-60 to BR-P-62)', () => {
  it('gives edges to the first tick only and repeats held states', () => {
    const frame = intent({
      move: { forward: 1, right: -1 },
      sprint: true,
      fire: true,
      jump: true,
      firePressed: true,
      reload: true,
      switchTo: 'pistol',
      look: { dx: 30, dy: -4 },
    });
    const { ticks, carry } = distributeIntent(frame, 3, EMPTY_CARRY);
    expect(ticks).toHaveLength(3);
    expect(carry).toEqual(EMPTY_CARRY);
    expect(ticks[0]).toMatchObject({
      jump: true,
      firePressed: true,
      reload: true,
      switchTo: 'pistol',
    });
    for (const t of ticks.slice(1)) {
      expect(t).toMatchObject({ jump: false, firePressed: false, reload: false, switchTo: null });
    }
    for (const t of ticks) {
      expect(t.look).toEqual({ dx: 0, dy: 0 });
      expect(t.move).toEqual({ forward: 1, right: -1 });
      expect(t.sprint).toBe(true);
      expect(t.fire).toBe(true);
    }
  });

  it('a 0-tick frame carries its edges, and the next frame ORs them in exactly once', () => {
    const a = distributeIntent(intent({ jump: true, switchTo: 'sniper' }), 0, EMPTY_CARRY);
    expect(a.ticks).toHaveLength(0);
    expect(a.carry).toEqual({ jump: true, firePressed: false, reload: false, switchTo: 'sniper' });
    const b = distributeIntent(intent({ reload: true }), 2, a.carry);
    expect(b.ticks[0]).toMatchObject({ jump: true, reload: true, switchTo: 'sniper' });
    expect(b.ticks[1]).toMatchObject({ jump: false, reload: false, switchTo: null });
    expect(b.carry).toEqual(EMPTY_CARRY);
  });

  it('switchTo takes the newest non-null value', () => {
    const a = distributeIntent(intent({ switchTo: 'rifle' }), 0, EMPTY_CARRY);
    const b = distributeIntent(intent({ switchTo: 'next' }), 1, a.carry);
    expect(b.ticks[0]!.switchTo).toBe('next');
    const c = distributeIntent(intent(), 1, a.carry);
    expect(c.ticks[0]!.switchTo).toBe('rifle');
  });

  it.each([
    [Number.NaN, 0],
    [-2, 0],
    [Infinity, 0],
    [2.9, 2],
    [99, MAX_SUBSTEPS],
  ])('steps %d → %d ticks', (steps, n) => {
    expect(distributeIntent(intent({ jump: true }), steps, EMPTY_CARRY).ticks).toHaveLength(n);
  });

  it('never loses or doubles a press across a random 0..5-step frame sequence', () => {
    let carry = EMPTY_CARRY;
    let pending = false;
    let expected = 0;
    let applied = 0;
    const pattern = [0, 0, 1, 3, 0, 5, 2, 0, 0, 0, 1, 4];
    for (let i = 0; i < 1200; i++) {
      const press = i % 7 === 0;
      const steps = pattern[i % pattern.length]!;
      // Model: presses wait until the next frame with ticks, then apply once on its first tick.
      pending ||= press;
      if (steps > 0 && pending) {
        expected++;
        pending = false;
      }
      const out = distributeIntent(intent({ jump: press }), steps, carry);
      carry = out.carry;
      applied += out.ticks.filter((t) => t.jump).length;
      expect(out.ticks.slice(1).some((t) => t.jump)).toBe(false);
    }
    expect(applied).toBe(expected);
    expect(carry.jump).toBe(pending);
  });

  it('exports frozen neutral values', () => {
    expect(Object.isFrozen(EMPTY_CARRY)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_INTENT)).toBe(true);
  });
});
