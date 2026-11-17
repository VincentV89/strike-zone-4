// TRANSITIONS table test (req-bot-fsm AC1, AC3; ADR-AI-2). Generated from the table: every row
// has a positive case (its guard fires) and a negative case (its key condition removed).
import { describe, expect, it } from 'vitest';
import { GUARD_IDS, TRANSITIONS, decide, rowsFrom, type BotBrain, type BotSelfView } from '@sz/ai';
import type { BotPercepts } from '@sz/ai/perception';
import { BOT_STATES } from '@sz/kernel';
import { NOW, P, brainIn, fakeWorld, fixedRng, selfView, type FakeWorldOptions } from './fixtures';

interface Case {
  readonly percepts?: BotPercepts;
  readonly self?: Partial<BotSelfView>;
  readonly roll?: number;
  readonly world?: FakeWorldOptions;
  readonly brain?: (b: BotBrain) => void;
}

const lowSeen: Case = { percepts: P.seen(), self: { health: 20 } };
const dead: Case = { self: { alive: false } };
const coverHit: Case = { percepts: P.damaged(), roll: 0 };
const holdEnded = (b: BotBrain) => {
  b.ctx.phase = 'holding';
  b.ctx.holdEndsAt = NOW - 1;
};
const holding = (b: BotBrain) => {
  b.ctx.phase = 'holding';
  b.ctx.holdEndsAt = NOW + 5;
  b.stateSince = NOW - 1;
};

const POSITIVE: Record<string, Case> = {
  T01: dead,
  T02: { percepts: P.seen() },
  T03: coverHit,
  T04: { percepts: P.heard() },
  T05: dead,
  T06: { percepts: P.seen() },
  T07: coverHit,
  T08: {
    brain: (b) => {
      b.ctx.phase = 'search';
      b.ctx.searchEndsAt = NOW - 1;
      b.ctx.targetAt = NOW;
    },
  },
  T09: dead,
  T10: lowSeen,
  T11: { percepts: P.merge(P.seen(), P.damaged()), roll: 0 },
  T12: {
    percepts: P.seen(),
    self: { weapon: { equipped: 'rifle', magazine: 0, reserve: 90, status: 'ready' } },
  },
  T13: { percepts: P.lost(), roll: 0 },
  T14: { percepts: P.lost(), roll: 0.99 },
  T15: dead,
  T16: lowSeen,
  T17: { percepts: P.seen(), brain: holdEnded },
  T18: { percepts: P.lost(), roll: 0, brain: holdEnded },
  T19: { percepts: P.lost(), roll: 0.99, brain: holdEnded },
  T20: dead,
  T21: { percepts: P.seen() },
  T22: { percepts: P.damaged(), self: { health: 20 } },
  T23: coverHit,
  T24: {
    brain: (b) => {
      b.follower.done = true;
    },
  },
  T25: dead,
  T26: { percepts: P.seen(), brain: holdEnded },
  T27: { percepts: P.lost(), brain: holdEnded },
  T28: { brain: holdEnded },
};

const inState = (b: BotBrain) => {
  b.stateSince = NOW - 1;
};
const NEGATIVE: Record<string, Case> = {
  T01: {},
  T02: {},
  T03: { percepts: P.damaged(), roll: 0.99 },
  T04: {},
  T05: {},
  T06: {},
  T07: { percepts: P.damaged(), roll: 0.99 },
  T08: {
    brain: (b) => {
      b.ctx.phase = 'search';
      b.ctx.searchEndsAt = NOW + 5;
      b.ctx.targetAt = NOW;
      inState(b);
    },
  },
  T09: {},
  T10: { percepts: P.seen() },
  T11: { percepts: P.merge(P.seen(), P.damaged()), roll: 0.99 },
  T12: { percepts: P.seen() },
  T13: { percepts: P.lost(), roll: 0.99 },
  T14: { percepts: P.lost(NOW - 0.5) },
  T15: {},
  T16: { percepts: P.seen(), brain: holding },
  T17: { percepts: P.seen(), brain: holding },
  T18: { percepts: P.lost(), roll: 0.99, brain: holdEnded },
  T19: { percepts: P.lost(), brain: holding },
  T20: {},
  T21: { brain: inState },
  T22: { percepts: P.damaged(), roll: 0.99, brain: inState },
  T23: { percepts: P.damaged(), roll: 0.99, brain: inState },
  T24: { brain: inState },
  T25: {},
  T26: { percepts: P.seen(), brain: holding },
  T27: { brain: holdEnded },
  T28: { percepts: P.lost(), brain: holdEnded },
};

function run(rowId: string, c: Case) {
  const row = TRANSITIONS.find((r) => r.id === rowId);
  if (!row) throw new Error(rowId);
  const b = brainIn({ state: row.from, rng: fixedRng(c.roll ?? 0.5) });
  c.brain?.(b);
  const fw = fakeWorld(c.world);
  const d = decide(b, c.percepts ?? P.none, selfView(c.self), fw.world, NOW);
  return { row, b, d };
}

describe('TRANSITIONS', () => {
  it('has 28 rows T01..T28 with unique ids and known guards', () => {
    expect(TRANSITIONS.map((r) => r.id)).toEqual(
      Array.from({ length: 28 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`),
    );
    for (const r of TRANSITIONS) expect(GUARD_IDS).toContain(r.guard);
    expect(new Set(TRANSITIONS.map((r) => r.guard)).size).toBe(16);
    expect(Object.isFrozen(TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(TRANSITIONS[0])).toBe(true);
  });

  it('Dead is terminal and every live state has a died row (req-bot-fsm AC3)', () => {
    expect(TRANSITIONS.filter((r) => r.from === 'dead')).toEqual([]);
    expect(rowsFrom('dead')).toEqual([]);
    for (const s of BOT_STATES.filter((x) => x !== 'dead')) {
      const died = rowsFrom(s).filter((r) => r.guard === 'died');
      expect(died, s).toHaveLength(1);
      expect(died[0]?.to).toBe('dead');
      expect(rowsFrom(s)[0]?.guard, `${s}: died is checked first`).toBe('died');
    }
  });

  it('only the four urgent guards ignore dwell (BR-AI-42)', () => {
    const urgent = new Set(TRANSITIONS.filter((r) => r.urgent).map((r) => r.guard));
    expect([...urgent].sort()).toEqual([
      'damaged-seek-cover',
      'died',
      'disadvantaged',
      'target-seen',
    ]);
  });

  describe.each(TRANSITIONS.map((r) => [r.id, r] as const))('%s', (id, row) => {
    it(`${row.from} → ${row.to} when ${row.guard} passes`, () => {
      const c = POSITIVE[id];
      expect(c, `missing positive case for ${id}`).toBeDefined();
      const { d, b } = run(id, c ?? {});
      expect(d.transition).toEqual({ from: row.from, to: row.to, guard: row.guard, at: NOW });
      expect(b.state).toBe(row.to);
      expect(b.enteredCounts[row.to]).toBeGreaterThanOrEqual(1);
    });

    it(`${row.guard} does not fire when its key condition is removed`, () => {
      const c = NEGATIVE[id];
      expect(c, `missing negative case for ${id}`).toBeDefined();
      const { d } = run(id, c ?? {});
      expect(d.transition?.guard === row.guard && d.transition.to === row.to).toBe(false);
    });
  });
});

describe('decide on Dead and on bad input (BR-AI-43, BR-AI-83)', () => {
  it('a dead brain holds and never transitions', () => {
    const b = brainIn({ state: 'dead' });
    const d = decide(b, P.seen(), selfView(), fakeWorld().world, NOW);
    expect(d).toEqual({ state: 'dead', wantFire: false, wantReload: false });
  });

  it.each([
    ['NaN pos', { pos: { x: NaN, y: 0, z: 0 } }],
    ['Infinity eye', { eye: { x: 0, y: Infinity, z: 0 } }],
  ])('%s produces a hold decision', (_n, self) => {
    const b = brainIn({ state: 'engage' });
    const d = decide(b, P.seen(), selfView(self), fakeWorld().world, NOW);
    expect(d.transition).toBeUndefined();
    expect(d.wantFire).toBe(false);
    expect(b.state).toBe('engage');
  });

  it('non-urgent rows wait for the 0.5 s dwell; urgent rows do not', () => {
    const b = brainIn({ state: 'patrol', since: NOW - 0.2 });
    expect(decide(b, P.heard(), selfView(), fakeWorld().world, NOW).transition).toBeUndefined();
    const b2 = brainIn({ state: 'patrol', since: NOW - 0.2 });
    expect(decide(b2, P.seen(), selfView(), fakeWorld().world, NOW).transition?.to).toBe('engage');
  });

  it('a stimulus held back by dwell is acted on once dwell ends', () => {
    const b = brainIn({ state: 'patrol', since: NOW - 0.2 });
    const fw = fakeWorld();
    const p = P.heard(NOW - 0.1);
    expect(decide(b, p, selfView(), fw.world, NOW).transition).toBeUndefined();
    expect(decide(b, p, selfView(), fw.world, NOW + 0.4).transition?.to).toBe('investigate');
  });
});
