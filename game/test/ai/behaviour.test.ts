// Per-state behaviour on the Desert graph and fake worlds (req-bot-patrol, req-bot-engage,
// req-bot-cover, req-bot-flank, req-bot-coordination, req-bot-retreat, req-bot-no-cheat AC2).
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_TABLE, createBrain, decide, seedFor, tick } from '@sz/ai';
import { createRng, DIFFICULTIES, distance, vec3, type ActorId } from '@sz/kernel';
import { createArena, mapWorld } from '../support/ai-arena';
import { NOW, P, brainIn, fakeWorld, fixedRng, selfView } from './fixtures';

describe('patrol (req-bot-patrol AC1, AC2)', () => {
  it.each([1, 2, 3])(
    'seed %i: reaches at least two different patrol points within 30 s, never the same twice in a row',
    (seed) => {
      const a = createArena({ botCount: 3, seed, botsShoot: false, playerAlive: false });
      a.run(30 * 60);
      for (const b of a.bots) {
        const visited = b.brain.recentPatrol;
        expect(new Set(visited).size, b.id).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < visited.length; i++) expect(visited[i]).not.toBe(visited[i - 1]);
        expect(b.brain.state).toBe('patrol');
      }
    },
  );

  it('a refused budget keeps the bot choosing and retries at the next decide (BR-AI-71)', () => {
    const fw = fakeWorld({ budget: 0 });
    const b = brainIn({ state: 'patrol' });
    decide(b, P.none, selfView(), fw.world, NOW);
    expect(b.ctx.phase).toBe('choose');
    expect(fw.counts.refused).toBe(1);
    expect(fw.counts.findPath).toBe(0);
  });

  it('null paths: tries three points, then waits (BR-AI-72)', () => {
    const fw = fakeWorld({ pathNone: true });
    const b = brainIn({ state: 'patrol' });
    decide(b, P.none, selfView(), fw.world, NOW);
    expect(fw.counts.findPath).toBe(3);
    expect(b.ctx.phase).toBe('choose');
  });
});

describe('engage (req-bot-engage, req-bot-no-cheat AC2)', () => {
  it('never fires on a tick where the target is not visible, even with wantFire set', () => {
    const fw = fakeWorld({ sight: true });
    const b = brainIn({ state: 'engage' });
    const d = decide(b, P.seen(NOW - 2), selfView(), fw.world, NOW);
    expect(d.wantFire).toBe(true);
    for (let i = 1; i <= 60; i++) {
      const out = tick(b, P.lost(NOW), selfView(), fw.world, 1 / 60, NOW + i / 60);
      expect(out.trigger.fire).toBe(false);
    }
  });

  it.each(DIFFICULTIES.map((d) => [d]))(
    '%s: no shot before the reaction time across 50 seeds (AC1)',
    (diff) => {
      const params = DIFFICULTY_TABLE[diff];
      let fired = 0;
      for (let seed = 0; seed < 50; seed++) {
        const fw = fakeWorld({ sight: true });
        const b = createBrain('bot-1' as ActorId, diff, createRng(seedFor(seed, 0)));
        b.state = 'engage';
        b.ctx.phase = 'fighting';
        b.aim.yaw = 0;
        const since = 5;
        let firstFire = Infinity;
        for (let k = 0; k < 120; k++) {
          const now = since + k / 60;
          const p = P.seen(since);
          fw.budget.resetTick();
          if (k % 6 === 0) decide(b, p, selfView(), fw.world, now);
          if (tick(b, p, selfView(), fw.world, 1 / 60, now).trigger.fire)
            firstFire = Math.min(firstFire, now);
        }
        if (Number.isFinite(firstFire)) fired++;
        expect(firstFire - since).toBeGreaterThanOrEqual(params.reactionMinSec - 1e-9);
      }
      expect(fired).toBeGreaterThan(40);
    },
  );

  it('changes position within 2 s of entering Engage (AC3)', () => {
    const a = createArena({
      botCount: 1,
      seed: 4,
      botsShoot: false,
      playerInvulnerable: true,
      botStarts: [vec3(0, 0, -4)],
      botYaws: [Math.PI],
      playerFeet: vec3(0, 0, 10),
    });
    const b = a.bots[0]!;
    a.run(30);
    expect(b.brain.state).toBe('engage');
    const start = b.pos;
    a.run(120);
    expect(distance(start, b.pos)).toBeGreaterThan(0.5);
  });

  it('no ammo never fires (BR-AI-61); empty magazine asks for a reload', () => {
    const fw = fakeWorld({ sight: true });
    const b = brainIn({ state: 'engage' });
    const empty = selfView({
      weapon: { equipped: 'rifle', magazine: 0, reserve: 0, status: 'ready' },
    });
    expect(decide(b, P.seen(), empty, fw.world, NOW).wantFire).toBe(false);
    const reload = selfView({
      weapon: { equipped: 'rifle', magazine: 0, reserve: 30, status: 'ready' },
    });
    const b2 = brainIn({ state: 'engage', since: NOW - 0.1 });
    expect(decide(b2, P.seen(), reload, fw.world, NOW).wantReload).toBe(true);
  });
});

describe('take cover (req-bot-cover AC1, AC2)', () => {
  it('picks a cover point hidden from the threat and claims it', () => {
    const hiddenOnly = (_a: unknown, b: { x: number }) => b.x > 0; // only cover-a (x = 5) is hidden
    const fw = fakeWorld({ sight: (a, b) => !hiddenOnly(a, b) });
    const b = brainIn({ state: 'engage', rng: fixedRng(0) });
    const d = decide(b, P.merge(P.seen(), P.damaged()), selfView(), fw.world, NOW);
    expect(d.transition?.to).toBe('take-cover');
    expect(b.goal).toMatchObject({ kind: 'cover', coverId: 'cover-a' });
    expect(fw.board.coverClaimant('cover-a')).toBe('bot-1');
    expect(fw.counts.lineOfSight).toBeLessThanOrEqual(6);
  });

  it('no cover point visible-free: the guard fails and the bot keeps fighting (NFR-AI-R6)', () => {
    const fw = fakeWorld({ sight: true });
    const b = brainIn({ state: 'engage', rng: fixedRng(0) });
    expect(
      decide(b, P.merge(P.seen(), P.damaged()), selfView(), fw.world, NOW).transition,
    ).toBeUndefined();
    const fw2 = fakeWorld({ cover: [] });
    expect(
      decide(
        brainIn({ state: 'engage', rng: fixedRng(0) }),
        P.merge(P.seen(), P.damaged()),
        selfView(),
        fw2.world,
        NOW,
      ).transition,
    ).toBeUndefined();
  });

  it('a claimed point is skipped by teammates', () => {
    const fw = fakeWorld();
    fw.board.claimCover('bot-2' as ActorId, 'cover-a');
    fw.board.claimCover('bot-3' as ActorId, 'cover-c');
    const b = brainIn({ state: 'engage', rng: fixedRng(0) });
    const d = decide(b, P.merge(P.seen(), P.damaged()), selfView(), fw.world, NOW);
    expect(d.transition?.to).toBe('take-cover');
    expect(b.goal).toMatchObject({ coverId: 'cover-b' });
  });

  it('seen while holding: relocates (at most twice), then is compromised and leaves (AC2)', () => {
    const fw = fakeWorld();
    const b = brainIn({ state: 'take-cover', since: NOW - 2 });
    b.ctx.phase = 'holding';
    b.ctx.holdEndsAt = NOW + 10;
    b.goal = { kind: 'cover', coverId: 'cover-a', pos: vec3(5, 0, 5), crouch: false };
    // A bad decide time keeps the guards quiet; run upkeep through decide with seen percepts.
    const d1 = decide(b, P.seen(), selfView(), fw.world, NOW);
    expect(d1.transition).toBeUndefined();
    expect(b.ctx.relocations).toBe(1);
    expect(b.ctx.phase).toBe('moving');
    b.ctx.phase = 'holding';
    decide(b, P.seen(), selfView(), fw.world, NOW + 0.1);
    b.ctx.phase = 'holding';
    decide(b, P.seen(), selfView(), fw.world, NOW + 0.2);
    expect(b.ctx.relocations).toBe(2);
    expect(b.ctx.compromised).toBe(true);
    const d4 = decide(b, P.seen(), selfView(), fw.world, NOW + 0.3);
    expect(d4.transition?.to).toBe('engage');
    expect(fw.board.size().cover).toBe(0);
  });

  it('crouches at a crouch-only point and reloads under half a magazine', () => {
    const fw = fakeWorld();
    const b = brainIn({ state: 'take-cover', since: NOW - 1 });
    b.goal = { kind: 'cover', coverId: 'cover-b', pos: vec3(-5, 0, 6), crouch: true };
    b.follower.done = true;
    const d = decide(
      b,
      P.none,
      selfView({ weapon: { equipped: 'rifle', magazine: 10, reserve: 30, status: 'ready' } }),
      fw.world,
      NOW,
    );
    expect(b.ctx.phase).toBe('holding');
    expect(d.wantReload).toBe(true);
    expect(tick(b, P.none, selfView(), fw.world, 1 / 60, NOW).move.stance).toBe('crouch');
  });
});

describe('flank and coordination (req-bot-flank AC1, AC2, req-bot-coordination AC1)', () => {
  const { nav } = mapWorld();
  const target = vec3(-14, 0, 35);

  it('two bots flanking together get different routes sharing under 50% of nodes', () => {
    nav.clearReservations();
    const a = createArena({ botCount: 2, seed: 9, botsShoot: false });
    const fw = a.world;
    const brains = [
      brainIn({ state: 'engage', rng: fixedRng(0) }),
      createBrain('bot-2' as ActorId, 'normal', fixedRng(0)),
    ];
    brains[1]!.state = 'engage';
    const starts = [vec3(20, 0, -31), vec3(22, 0, -31)];
    const routes: (string | null)[] = [];
    const nodes: number[][] = [];
    brains.forEach((b, i) => {
      const d = decide(
        b,
        Object.freeze({ lastKnown: { pos: target, at: NOW - 2 } }),
        selfView({ id: b.id, pos: starts[i]!, eye: vec3(starts[i]!.x, 1.62, starts[i]!.z) }),
        fw,
        NOW,
      );
      expect(d.transition?.to, b.id).toBe('flank');
      routes.push(b.lastFlankRoute);
      nodes.push(b.follower.points.map((p) => nav.nearestNode(p)));
    });
    expect(routes[0]).not.toBeNull();
    expect(routes[0]).not.toBe(routes[1]);
    const shared = nodes[0]!.filter((n) => nodes[1]!.includes(n)).length;
    expect(shared / Math.max(nodes[0]!.length, nodes[1]!.length)).toBeLessThan(0.5);
    expect(nav.reservations().size).toBe(2);
    nav.clearReservations();
  });

  it('a second flank by the same bot avoids its previous route', () => {
    const fw = fakeWorld({ routeId: 'east' });
    const b = brainIn({ state: 'engage', rng: fixedRng(0) });
    decide(b, P.lost(NOW - 2), selfView(), fw.world, NOW);
    expect(b.lastFlankRoute).toBe('east');
    expect(fw.nav.reserved.get(b.id)).toBe('east');
    const calls: Array<string | undefined> = [];
    const orig = fw.nav.findFlankPath.bind(fw.nav);
    fw.nav.findFlankPath = (f, t, avoid) => {
      calls.push(avoid);
      return orig(f, t, avoid);
    };
    b.state = 'engage';
    b.stateSince = NOW;
    decide(b, P.lost(NOW + 1), selfView(), fw.world, NOW + 3);
    expect(calls).toEqual(['east']);
  });

  it('no flank path: the bot investigates instead and does not retry the same flank', () => {
    const fw = fakeWorld({ flankNone: true });
    const b = brainIn({ state: 'engage', rng: fixedRng(0) });
    const d = decide(b, P.lost(NOW - 2), selfView(), fw.world, NOW);
    expect(d.transition?.to).toBe('investigate');
    expect(b.rolls.flank).toBe(false);
  });

  it('leaving Flank releases the route', () => {
    const fw = fakeWorld();
    const b = brainIn({ state: 'engage', rng: fixedRng(0) });
    decide(b, P.lost(NOW - 2), selfView(), fw.world, NOW);
    expect(fw.nav.reserved.size).toBe(1);
    decide(b, P.seen(), selfView(), fw.world, NOW + 0.1);
    expect(b.state).toBe('engage');
    expect(fw.nav.reserved.size).toBe(0);
  });
});

describe('retreat (req-bot-retreat AC1, AC2)', () => {
  it('at low health the bot runs to a spot away from the threat and its distance grows', () => {
    const a = createArena({
      botCount: 1,
      seed: 2,
      botsShoot: false,
      playerInvulnerable: true,
      botStarts: [vec3(0, 0, -4)],
      botYaws: [Math.PI],
      playerFeet: vec3(0, 0, 10),
    });
    const b = a.bots[0]!;
    a.run(30);
    expect(b.brain.state).toBe('engage');
    a.setVitals(b.id, { health: 25, armor: 0 });
    a.run(12);
    expect(b.brain.state).toBe('retreat');
    expect(b.brain.retreatedLowHealth).toBe(true);
    const d0 = distance(b.pos, a.player.feet);
    a.run(90);
    expect(distance(b.pos, a.player.feet)).toBeGreaterThan(d0);
  });

  it('low-health retreat happens once per life; out of ammo has no limit (BR-AI-48)', () => {
    const fw = fakeWorld();
    const b = brainIn({ state: 'engage' });
    b.retreatedLowHealth = true;
    expect(decide(b, P.seen(), selfView({ health: 10 }), fw.world, NOW).transition?.to).not.toBe(
      'retreat',
    );
    const dry = selfView({
      weapon: { equipped: 'rifle', magazine: 0, reserve: 0, status: 'ready' },
    });
    expect(decide(b, P.seen(), dry, fw.world, NOW + 0.1).transition?.to).toBe('retreat');
  });
});
