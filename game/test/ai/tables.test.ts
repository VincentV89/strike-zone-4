// Difficulty table, scheduler, seeds, world view, squad board and content (req-difficulty AC1/AC3,
// req-ai-performance AC1, SEC-AI-03, SEC-AI-42, BR-AI-30 to BR-AI-34, BR-AI-80, BR-AI-92).
import { describe, expect, it } from 'vitest';
import {
  AI_RULES,
  DIFFICULTY_TABLE,
  GUARD_IDS,
  TRANSITIONS,
  createBotSight,
  createScheduler,
  createSquadBoard,
  difficultyParams,
  seedFor,
} from '@sz/ai';
import { BOT_COUNTS, BOT_STATES, DIFFICULTIES, type ActorId } from '@sz/kernel';
import { BOT_START_VITALS } from '@sz/combat';
import { denyHits } from '../support/deny-list';
import { fakeWorld } from './fixtures';

describe('DIFFICULTY_TABLE (BR-AI-30 to BR-AI-34)', () => {
  const [e, n, h] = DIFFICULTIES.map((d) => DIFFICULTY_TABLE[d]);
  it('orders reaction, aim error and burst pause down, and chances and range up', () => {
    if (!e || !n || !h) throw new Error('missing row');
    for (const [lo, hi] of [
      [n, e],
      [h, n],
    ] as const) {
      expect(lo.reactionMinSec).toBeLessThan(hi.reactionMinSec);
      expect(lo.reactionMaxSec).toBeLessThan(hi.reactionMaxSec);
      expect(lo.aimErrorRad).toBeLessThan(hi.aimErrorRad);
      expect(lo.burstPauseSec).toBeLessThan(hi.burstPauseSec);
      expect(lo.coverChance).toBeGreaterThan(hi.coverChance);
      expect(lo.flankChance).toBeGreaterThan(hi.flankChance);
      expect(lo.visionRangeM).toBeGreaterThan(hi.visionRangeM);
    }
    expect([e.visionRangeM, n.visionRangeM, h.visionRangeM]).toEqual([35, 45, 55]);
  });

  it('no difficulty aims perfectly or reacts instantly (BR-AI-31)', () => {
    for (const d of DIFFICULTIES) {
      const p = DIFFICULTY_TABLE[d];
      expect(p.aimErrorRad).toBeGreaterThan(0);
      expect(p.reactionMinSec).toBeGreaterThan(0);
      expect(p.reactionMaxSec).toBeGreaterThanOrEqual(p.reactionMinSec);
      expect(p.burstShots[0]).toBeGreaterThanOrEqual(1);
      expect(p.burstShots[1]).toBeGreaterThanOrEqual(p.burstShots[0]);
    }
  });

  it('has no health field: bots start at 100 health on every level (BR-AI-32)', () => {
    for (const d of DIFFICULTIES) expect('health' in DIFFICULTY_TABLE[d]).toBe(false);
    expect(BOT_START_VITALS.health).toBe(100);
  });

  it('is deep-frozen and resolves unknown ids to Normal (BR-AI-34)', () => {
    expect(Object.isFrozen(DIFFICULTY_TABLE)).toBe(true);
    expect(Object.isFrozen(DIFFICULTY_TABLE.hard)).toBe(true);
    expect(Object.isFrozen(DIFFICULTY_TABLE.hard.burstShots)).toBe(true);
    for (const bad of ['__proto__', 'constructor', 'HARD', '', 3, null, undefined]) {
      expect(difficultyParams(bad)).toBe(DIFFICULTY_TABLE.normal);
    }
    expect(difficultyParams('hard')).toBe(DIFFICULTY_TABLE.hard);
  });
});

describe('scheduler (BR-AI-80, NFR-AI-P1, NFR-AI-S1)', () => {
  it('20 bots over 600 ticks: each decides exactly 100 times, at most 4 per tick', () => {
    const s = createScheduler(60, 10);
    const per = new Array<number>(20).fill(0);
    for (let t = 0; t < 600; t++) {
      let n = 0;
      for (let i = 0; i < 20; i++) {
        if (s.shouldDecide(i, t)) {
          per[i] = (per[i] ?? 0) + 1;
          n++;
        }
      }
      expect(n).toBeLessThanOrEqual(4);
    }
    expect(per.every((x) => x === 100)).toBe(true);
  });

  it.each(BOT_COUNTS.map((c) => [c]))(
    '%i bots: never more than ceil(N/6) decides per tick',
    (count) => {
      const s = createScheduler();
      for (let t = 0; t < 60; t++) {
        let n = 0;
        for (let i = 0; i < count; i++) if (s.shouldDecide(i, t)) n++;
        expect(n).toBeLessThanOrEqual(s.maxPerTick(count));
      }
      expect(s.maxPerTick(count)).toBe(Math.ceil(count / 6));
    },
  );

  it('bad inputs fall back safely', () => {
    expect(createScheduler(60, 7).period).toBe(6);
    expect(createScheduler(NaN, 10).period).toBe(6);
    const s = createScheduler();
    expect(s.shouldDecide(-1, 0)).toBe(false);
    expect(s.shouldDecide(0, 1.5)).toBe(false);
    expect(s.maxPerTick(0)).toBe(0);
    expect(s.maxPerTick(NaN)).toBe(0);
  });

  it('seedFor gives distinct 32-bit seeds per bot and per match seed', () => {
    const seeds = new Set<number>();
    for (let m = 0; m < 5; m++) for (let i = 0; i < 20; i++) seeds.add(seedFor(m, i));
    expect(seeds.size).toBe(100);
    for (const s of seeds) expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
    expect(seedFor(NaN, -3)).toBe(seedFor(0, 0));
  });
});

describe('world view (SD-AI-4, SEC-AI-03)', () => {
  it('exposes only the narrow members, all frozen', () => {
    const { world } = fakeWorld();
    expect(Object.keys(world).sort()).toEqual([
      'board',
      'budget',
      'coverPoints',
      'nav',
      'patrolPoints',
      'sight',
    ]);
    expect(Object.keys(world.sight)).toEqual(['lineOfSight']);
    expect(Object.keys(world.budget)).toEqual(['tryConsume']);
    expect(Object.keys(world.nav).sort()).toEqual(
      [
        'edges',
        'findFlankPath',
        'findPath',
        'nearestNode',
        'node',
        'nodeCount',
        'releaseRoute',
        'reserveRoute',
      ].sort(),
    );
    for (const o of [
      world,
      world.sight,
      world.nav,
      world.budget,
      world.coverPoints,
      world.coverPoints[0],
      world.coverPoints[0]?.pos,
    ]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
  });

  it('wraps the real ports with closures and never calls raycast, resetTick or clearReservations', () => {
    const fw = fakeWorld({ sight: true });
    expect(fw.world.sight.lineOfSight({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(true);
    expect(fw.world.budget.tryConsume()).toBe(true);
    fw.world.nav.reserveRoute('bot-1' as ActorId, 'east');
    expect(fw.nav.reserved.get('bot-1' as ActorId)).toBe('east');
    fw.world.nav.releaseRoute('bot-1' as ActorId);
    expect(fw.nav.reserved.size).toBe(0);
    expect(fw.counts.raycast + fw.counts.resetTick + fw.counts.clearReservations).toBe(0);
    expect(fw.world.nav.nearestNode({ x: 0, y: 0, z: 0 })).toBe(0);
    expect(fw.world.nav.edges(0).length).toBeGreaterThan(0);
  });

  it('createBotSight leaves out raycast', () => {
    const s = createBotSight({ lineOfSight: () => false });
    expect(Object.keys(s)).toEqual(['lineOfSight']);
    expect(s.lineOfSight({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBe(false);
  });
});

describe('squad board (BR-AI-92)', () => {
  const a = 'bot-1' as ActorId;
  const b = 'bot-2' as ActorId;
  it('allows one bot per cover point and moves a bot’s claim', () => {
    const board = createSquadBoard();
    expect(board.claimCover(a, 'c1')).toBe(true);
    expect(board.claimCover(b, 'c1')).toBe(false);
    expect(board.claimCover(a, 'c1')).toBe(true);
    expect(board.claimCover(a, 'c2')).toBe(true);
    expect(board.coverClaimant('c1')).toBeUndefined();
    expect(board.coverClaimant('c2')).toBe(a);
  });

  it('counts patrol claims of other bots and releases everything', () => {
    const board = createSquadBoard();
    board.claimPatrol(a, 'p1');
    board.claimPatrol(b, 'p1');
    expect(board.patrolClaims('p1', a)).toBe(1);
    expect(board.patrolClaims('p1')).toBe(2);
    board.claimCover(a, 'c1');
    board.releaseAll(a);
    expect(board.size()).toEqual({ cover: 0, patrol: 1 });
    board.releasePatrol(b);
    board.claimCover(b, 'c3');
    board.clear();
    expect(board.size()).toEqual({ cover: 0, patrol: 0 });
  });
});

describe('content (SEC-AI-42)', () => {
  it('state names, guard ids, row ids and rule names use no commercial-game names', () => {
    const strings = [
      ...BOT_STATES,
      ...GUARD_IDS,
      ...TRANSITIONS.map((r) => r.id),
      ...DIFFICULTIES,
      ...Object.keys(AI_RULES),
    ];
    expect(strings.filter((s) => denyHits(s).length > 0)).toEqual([]);
  });
});
