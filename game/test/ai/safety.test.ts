// Output sanitiser, aim error, totality fuzz and death/claims (SD-AI-5, BR-AI-44, BR-AI-55,
// NFR-AI-R1, SEC-AI-20 to SEC-AI-22, SEC-AI-32).
import { describe, expect, it } from 'vitest';
import {
  AI_RULES,
  ZERO_INTENT,
  aimWithError,
  boundIntent,
  createBrain,
  decide,
  entered,
  holdDecision,
  markDead,
  stateOf,
  tick,
  zeroIntent,
  type BotIntent,
} from '@sz/ai';
import type { BotPercepts } from '@sz/ai/perception';
import {
  BOT_STATES,
  angleBetween,
  createRng,
  degToRad,
  length,
  normalize,
  vec3,
  type Vec3,
} from '@sz/kernel';
import { createCountingRng } from '../support/counting-rng';
import { BOT, NOW, P, brainIn, fakeWorld, fixedRng, selfView } from './fixtures';

const BOUND = { prevYaw: 0, dt: 1 / 60, turnRateRad: degToRad(360) };
const intent = (over: Partial<BotIntent> = {}): BotIntent => ({
  move: { velocity: vec3(1, 0, 0), stance: 'stand' },
  yaw: 0,
  pitch: 0,
  aimDir: vec3(0, 0, -1),
  trigger: { fire: true, reload: false, scope: false },
  ...over,
});

function inBounds(i: BotIntent, prevYaw: number, dt: number, turn: number): boolean {
  const v = i.move.velocity;
  const dyaw = Math.abs(Math.atan2(Math.sin(i.yaw - prevYaw), Math.cos(i.yaw - prevYaw)));
  return (
    [v.x, v.y, v.z, i.yaw, i.pitch, i.aimDir.x, i.aimDir.y, i.aimDir.z].every(Number.isFinite) &&
    v.y === 0 &&
    Math.hypot(v.x, v.z) <= AI_RULES.maxSpeed + 1e-9 &&
    Math.abs(i.pitch) <= AI_RULES.maxPitchRad + 1e-9 &&
    Math.abs(length(i.aimDir) - 1) < 1e-9 &&
    (i === ZERO_INTENT || dyaw <= turn * dt + 1e-9) &&
    !i.trigger.scope
  );
}

describe('boundIntent', () => {
  it('clamps speed to 5.5 m/s, drops vertical velocity and clamps pitch to ±60°', () => {
    const out = boundIntent(
      intent({ move: { velocity: vec3(30, 9, 40), stance: 'crouch' }, pitch: 2 }),
      BOUND,
    );
    expect(Math.hypot(out.move.velocity.x, out.move.velocity.z)).toBeCloseTo(5.5);
    expect(out.move.velocity.y).toBe(0);
    expect(out.pitch).toBeCloseTo(AI_RULES.maxPitchRad);
    expect(out.move.stance).toBe('crouch');
  });

  it('limits the yaw change to turnRate × dt', () => {
    const out = boundIntent(intent({ yaw: 3 }), BOUND);
    expect(out.yaw).toBeCloseTo(degToRad(360) / 60);
  });

  it('replaces a non-finite intent with ZERO_INTENT and forces scope off', () => {
    expect(boundIntent(intent({ yaw: NaN }), BOUND)).toBe(ZERO_INTENT);
    expect(
      boundIntent(intent({ move: { velocity: vec3(Infinity, 0, 0), stance: 'stand' } }), BOUND),
    ).toBe(ZERO_INTENT);
    expect(
      boundIntent(intent({ trigger: { fire: false, reload: true, scope: true } }), BOUND).trigger
        .scope,
    ).toBe(false);
    expect(zeroIntent(NaN, NaN)).toEqual(zeroIntent(0, 0));
  });
});

describe('aimWithError (BR-AI-55)', () => {
  it('stays inside the cone, draws exactly two values, and is never exact over many samples', () => {
    const rng = createCountingRng(5);
    const base = normalize(vec3(1, 0.2, -3));
    const err = degToRad(3.5);
    let exact = 0;
    for (let i = 0; i < 1000; i++) {
      const d = aimWithError(base, err, rng);
      const a = angleBetween(d, base);
      expect(a).toBeLessThanOrEqual(err + 1e-9);
      if (a < 1e-6) exact++;
    }
    expect(rng.draws).toBe(2000);
    expect(exact).toBeLessThan(5);
  });

  it('handles straight-up and zero bases', () => {
    const rng = createRng(1);
    const up = aimWithError(vec3(0, 1, 0), 0.05, rng);
    expect(angleBetween(up, vec3(0, 1, 0))).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(aimWithError(vec3(0, 0, 0), 0.05, rng)).toEqual(vec3(0, 0, -1));
  });
});

describe('markDead (BR-AI-44, SEC-AI-32)', () => {
  it('moves to Dead in the same call, releases route, cover and patrol claims, and returns null after', () => {
    const fw = fakeWorld();
    const b = brainIn({ state: 'flank' });
    fw.world.nav.reserveRoute(BOT, 'east');
    fw.board.claimCover(BOT, 'cover-a');
    fw.board.claimPatrol(BOT, 'patrol-a');
    const t = markDead(b, fw.world, 5);
    expect(t).toEqual({ from: 'flank', to: 'dead', guard: 'died', at: 5 });
    expect(stateOf(b)).toBe('dead');
    expect(entered(b).dead).toBe(1);
    expect(fw.nav.reserved.size).toBe(0);
    expect(fw.board.size()).toEqual({ cover: 0, patrol: 0 });
    expect(markDead(b, fw.world, 6)).toBeNull();
    expect(markDead(brainIn(), fw.world, NaN)).toBeNull();
  });

  it('a dead bot holds, stands still and never fires (BR-AI-08)', () => {
    const fw = fakeWorld();
    const b = brainIn({ state: 'engage' });
    markDead(b, fw.world, 5);
    expect(decide(b, P.seen(), selfView(), fw.world, NOW)).toBe(holdDecision('dead'));
    const i = tick(b, P.seen(), selfView(), fw.world, 1 / 60, NOW);
    expect(i.move.velocity).toEqual(vec3(0, 0, 0));
    expect(i.trigger.fire).toBe(false);
  });

  it('entered() is a frozen copy', () => {
    const b = createBrain(BOT, 'easy', createRng(1));
    const e = entered(b);
    expect(Object.isFrozen(e)).toBe(true);
    expect(e.patrol).toBe(1);
    for (const s of BOT_STATES) expect(typeof e[s]).toBe('number');
  });
});

// NFR-AI-R1 / SEC-AI-20: 10,000 seeded calls with hostile inputs never throw and stay bounded.
describe('fuzz (10,000 calls)', () => {
  const VALUES = [0, 1, -1, 1e9, -1e9, NaN, Infinity, -Infinity, 0.5, 30, 100];
  const pick = (r: () => number) => VALUES[Math.floor(r() * VALUES.length)] ?? 0;
  const vecOf = (r: () => number): Vec3 => vec3(pick(r), pick(r), pick(r));

  it('decide and tick never throw and every intent is inside the bounds', () => {
    const rng = createRng(2026);
    const r = () => rng.next();
    const fw = fakeWorld({ sight: (a) => a.x > 0 });
    const brains = BOT_STATES.map((s) =>
      brainIn({ state: s, rng: createRng(Math.floor(r() * 1e6)) }),
    );
    let calls = 0;
    for (let i = 0; i < 5000; i++) {
      const b = brains[i % brains.length];
      if (!b) continue;
      const percepts: BotPercepts =
        r() < 0.5
          ? P.seen(pick(r))
          : P.merge(P.lost(pick(r)), P.damaged(pick(r)), P.heard(pick(r)));
      const self = selfView({
        pos: r() < 0.8 ? vec3(r() * 20, 0, r() * 20) : vecOf(r),
        eye: r() < 0.8 ? vec3(0, 1.6, 0) : vecOf(r),
        health: pick(r),
        alive: r() < 0.95,
        weapon: {
          equipped: r() < 0.9 ? 'rifle' : ('__proto__' as never),
          magazine: pick(r),
          reserve: pick(r),
          status: 'ready',
        },
      });
      const now = r() < 0.9 ? i / 60 : pick(r);
      const dt = r() < 0.9 ? 1 / 60 : pick(r);
      fw.budget.resetTick();
      const prevYaw = b.aim.yaw;
      expect(() => decide(b, percepts, self, fw.world, now)).not.toThrow();
      const out = tick(b, percepts, self, fw.world, dt, now);
      calls += 2;
      expect(
        inBounds(
          out,
          Number.isFinite(prevYaw) ? prevYaw : 0,
          Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0,
          b.params.turnRateRad,
        ),
        JSON.stringify(out),
      ).toBe(true);
      expect(Number.isFinite(b.aim.yaw) && Number.isFinite(b.aim.pitch)).toBe(true);
    }
    expect(calls).toBe(10_000);
    expect(fw.counts.raycast + fw.counts.clearReservations + fw.counts.resetTick).toBe(0);
  });

  it('a fixed Rng brain survives a dead→decide→tick loop', () => {
    const b = createBrain(BOT, 'hard', fixedRng(0));
    const fw = fakeWorld();
    markDead(b, fw.world, 1);
    for (let i = 0; i < 10; i++) {
      decide(b, P.seen(), selfView(), fw.world, i);
      tick(b, P.seen(), selfView(), fw.world, 1 / 60, i);
    }
    expect(b.state).toBe('dead');
  });
});
