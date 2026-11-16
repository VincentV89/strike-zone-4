// Arena-level gates: stuck recovery, per-tick count budgets, the 20 m duel, independence and
// round reset (req-bot-stuck-recovery, req-ai-performance, req-difficulty AC2, req-bot-engage AC2,
// req-bot-independence, NFR-AI-P1 to P4, NFR-AI-R2, NFR-AI-R4, NFR-AI-R5).
import { describe, expect, it } from 'vitest';
import { createBrain, createSquadBoard, decide, markDead, tick } from '@sz/ai';
import {
  MASK_WORLD,
  PLAYER_ID,
  createRng,
  distance,
  vec3,
  type Difficulty,
  type Vec3,
} from '@sz/kernel';
import { createArena, mapWorld, type Arena } from '../support/ai-arena';
import { BOT, NOW, P, fakeWorld, selfView } from './fixtures';

describe('stuck monitor (BR-AI-74, req-bot-stuck-recovery AC1)', () => {
  it('pinned for 2 s: side-steps, re-plans to the same goal; pinned again: the goal fails', () => {
    const fw = fakeWorld();
    const b = createBrain(BOT, 'normal', createRng(3));
    b.goal = { kind: 'point', pos: vec3(10, 0, 0) };
    b.follower = {
      points: [vec3(0, 0, 0), vec3(10, 0, 0)],
      index: 0,
      pendingPlan: false,
      failed: false,
      done: false,
      speed: 3.5,
    };
    b.stuck = {
      windowStart: 0,
      remainingAtStart: Infinity,
      strikes: 0,
      nudgeUntil: -Infinity,
      nudgeDir: vec3(0, 0, 0),
    };
    const self = selfView();
    let nudged = false;
    let t = 0;
    for (; t <= 2.2 * 60; t++) {
      const out = tick(b, P.none, self, fw.world, 1 / 60, t / 60);
      if (Math.abs(out.move.velocity.z) > 1) nudged = true;
    }
    expect(b.stuck.strikes).toBe(1);
    expect(nudged).toBe(true);
    for (; t <= 2.8 * 60; t++) tick(b, P.none, self, fw.world, 1 / 60, t / 60);
    expect(fw.counts.findPath).toBe(1);
    expect(b.follower.failed).toBe(false);
    for (; t <= 6.5 * 60; t++) tick(b, P.none, self, fw.world, 1 / 60, t / 60);
    expect(b.stuck.strikes).toBe(2);
    expect(b.follower.failed).toBe(true);
    // The next decide (at most 100 ms later) picks a new patrol goal.
    decide(b, P.none, self, fw.world, t / 60);
    expect(b.follower.failed).toBe(false);
    expect(b.follower.points.length).toBeGreaterThan(0);
  });

  it('a refused budget keeps the re-plan pending without a query', () => {
    const fw = fakeWorld({ budget: 0 });
    const b = createBrain(BOT, 'normal', createRng(3));
    b.goal = { kind: 'point', pos: vec3(10, 0, 0) };
    b.follower.pendingPlan = true;
    b.follower.points = [vec3(10, 0, 0)];
    tick(b, P.none, selfView(), fw.world, 1 / 60, NOW);
    expect(b.follower.pendingPlan).toBe(true);
    expect(fw.counts.findPath).toBe(0);
  });
});

/** Tracks how long each live bot in a moving phase stays within 1 m of one spot. */
function pinnedTracker() {
  const anchors = new Map<string, { pos: Vec3; since: number }>();
  let worst = 0;
  return {
    update(a: Arena) {
      for (const b of a.bots) {
        const moving = ['moving', 'travel'].includes(b.brain.ctx.phase) && !b.brain.follower.done;
        const prev = anchors.get(b.id);
        if (!b.alive || !moving || !prev || distance(prev.pos, b.pos) > 1) {
          anchors.set(b.id, { pos: b.pos, since: a.now });
          continue;
        }
        worst = Math.max(worst, a.now - prev.since);
      }
    },
    get worst() {
      return worst;
    },
  };
}

describe('20-bot soak (BR-AI-75, NFR-AI-R2) and count gates (NFR-AI-P1 to P4)', () => {
  it('3 simulated minutes, one blocked corridor: no bot pinned over 10 s; budgets hold every tick', () => {
    const started = performance.now();
    const a = createArena({
      botCount: 20,
      seed: 11,
      botsShoot: false,
      playerAlive: false,
      // Blocks the well square around patrol-well-s, which many patrol legs cross.
      blockers: [{ min: vec3(-3, -1, -7), max: vec3(3, 10, -1) }],
    });
    const pinned = pinnedTracker();
    const lastStrikes = new Map<string, number>();
    let strikeEvents = 0;
    a.run(3 * 60 * 60, (x) => {
      pinned.update(x);
      for (const b of x.bots) {
        if (b.brain.stuck.strikes > (lastStrikes.get(b.id) ?? 0)) strikeEvents++;
        lastStrikes.set(b.id, b.brain.stuck.strikes);
      }
    });
    const ms = performance.now() - started;
    expect(pinned.worst).toBeLessThanOrEqual(10);
    expect(strikeEvents, 'the blocked square exercised stuck recovery').toBeGreaterThan(0);
    expect(a.maxPerTick.decides).toBeLessThanOrEqual(4);
    expect(a.maxPerTick.sightCalls).toBeLessThanOrEqual(72);
    expect(a.maxPerTick.pathQueries).toBeLessThanOrEqual(4);
    expect(a.counts.raycast + a.counts.resetTick + a.counts.clearReservations).toBe(0);
    expect(a.bots.every((b) => b.brain.recentPatrol.length >= 2)).toBe(true);
    // Recorded in the code-summary (cicd-pipeline-bot-ai: shrink the scenario above 20 s).
    expect(ms).toBeGreaterThan(0);
    console.info(
      `[soak] 20 bots x 10800 ticks: ${ms.toFixed(0)} ms, worst pinned ${pinned.worst.toFixed(2)} s, ${String(strikeEvents)} stuck strikes`,
    );
  }, 60_000);

  it('20 bots fighting an invulnerable player: at most 4 decides, 72 sight rays and 4 path queries per tick', () => {
    const a = createArena({
      botCount: 20,
      seed: 5,
      playerInvulnerable: true,
      playerFeet: vec3(0, 0, -4),
    });
    a.run(20 * 60);
    expect(a.maxPerTick.decides).toBeLessThanOrEqual(4);
    expect(a.maxPerTick.sightCalls).toBeLessThanOrEqual(72);
    expect(a.maxPerTick.pathQueries).toBeLessThanOrEqual(4);
    expect(a.transitions.some((t) => t.to === 'engage')).toBe(true);
    expect(a.events.some((e) => e.type === 'ShotFired' && e.shooter !== PLAYER_ID)).toBe(true);
  });
});

/** First pair of ground nav nodes 19.5 to 20.5 m apart with a clear chest and head line. */
function duelSpots(): { bot: Vec3; player: Vec3 } {
  const { nav, query } = mapWorld();
  for (let i = 0; i < nav.nodeCount; i++) {
    const a = nav.node(i).pos;
    if (a.y !== 0) continue;
    for (let j = 0; j < nav.nodeCount; j++) {
      const b = nav.node(j).pos;
      const d = distance(a, b);
      if (b.y !== 0 || d < 19.5 || d > 20.5) continue;
      const clear = [0.4, 1.0, 1.62].every((h) =>
        query.lineOfSight(vec3(a.x, 1.62, a.z), vec3(b.x, h, b.z)),
      );
      const ground = query.raycast(vec3(b.x, 1, b.z), vec3(0, -1, 0), 2, MASK_WORLD);
      if (clear && ground && ground.distance > 0.9) return { bot: a, player: b };
    }
  }
  throw new Error('no duel spots');
}

function duel(difficulty: Difficulty): { shots: number; hits: number } {
  const spots = duelSpots();
  let shots = 0;
  let hits = 0;
  for (let seed = 1; shots < 300 && seed < 40; seed++) {
    const yaw = Math.atan2(-(spots.player.x - spots.bot.x), -(spots.player.z - spots.bot.z));
    const a = createArena({
      botCount: 1,
      seed,
      difficulty,
      playerInvulnerable: true,
      playerFeet: spots.player,
      botStarts: [spots.bot],
      botYaws: [yaw],
    });
    a.run(15 * 60);
    for (const e of a.events) {
      if (e.type === 'ShotFired' && e.shooter !== PLAYER_ID) shots++;
      if (e.type === 'HitConfirmed' && e.target === PLAYER_ID) hits++;
    }
  }
  return { shots, hits };
}

describe('20 m duel (req-difficulty AC2, req-bot-engage AC2, BR-AI-33)', () => {
  it('hit rate is Hard > Normal > Easy, and every rate is under 100%', () => {
    const rates = (['easy', 'normal', 'hard'] as const).map((d) => {
      const r = duel(d);
      expect(r.shots, d).toBeGreaterThanOrEqual(300);
      return r.hits / r.shots;
    });
    console.info(
      `[duel] hit rates easy ${rates[0]?.toFixed(3)} normal ${rates[1]?.toFixed(3)} hard ${rates[2]?.toFixed(3)}`,
    );
    const [e, n, h] = rates as [number, number, number];
    expect(h).toBeGreaterThan(n);
    expect(n).toBeGreaterThan(e);
    expect(h).toBeLessThan(1);
    expect(e).toBeGreaterThan(0);
  }, 60_000);
});

describe('independence and reset (req-bot-independence, NFR-AI-R4, NFR-AI-R5)', () => {
  it('shooting one bot changes only that bot’s health and memory', () => {
    const make = () =>
      createArena({
        botCount: 2,
        seed: 8,
        botsShoot: false,
        playerInvulnerable: true,
        botStarts: [vec3(0, 0, -4), vec3(36, 0, 0.5)],
        botYaws: [Math.PI, 0],
        playerFeet: vec3(0, 0, 10),
      });
    const a = make();
    const b = make();
    a.run(40);
    b.run(40);
    a.playerShoot('bot-1' as never);
    expect(a.vitalsOf('bot-1' as never)?.health).toBeLessThan(100);
    expect(a.vitalsOf('bot-2' as never)?.health).toBe(100);
    expect(a.perception.perceptsFor('bot-2' as never, a.now)).toEqual(
      b.perception.perceptsFor('bot-2' as never, b.now),
    );
    expect(a.bots[1]?.brain.rng.next()).toBe(b.bots[1]?.brain.rng.next());
  });

  it('round reset: perception, board and claims are empty after 10 cycles', () => {
    const fw = fakeWorld();
    const board = createSquadBoard();
    for (let cycle = 0; cycle < 10; cycle++) {
      const brain = createBrain(BOT, 'hard', createRng(cycle));
      decide(brain, P.none, selfView(), { ...fw.world, board }, NOW);
      board.claimCover(BOT, 'cover-a');
      fw.world.nav.reserveRoute(BOT, 'east');
      markDead(brain, { ...fw.world, board }, NOW + 1);
      expect(board.size()).toEqual({ cover: 0, patrol: 0 });
      expect(fw.nav.reserved.size).toBe(0);
      board.clear();
      fw.budget.resetTick();
    }
  });
});
