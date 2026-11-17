// Sight sensing (req-bot-perception AC1-AC3, BR-AI-10 to BR-AI-15, NFR-AI-P2).
import { describe, expect, it } from 'vitest';
import {
  PERCEPTION_RULES,
  createPerceptionSystem,
  createTargetSample,
  type SightPort,
} from '@sz/ai/perception';
import { PLAYER_ID, vec3, type ActorId, type Vec3 } from '@sz/kernel';
import { createFakePhysics } from '../../support/fakes';

const BOT = 'bot-1' as ActorId;
const VISION = {
  rangeM: 45,
  fovRad: PERCEPTION_RULES.fovRad,
  vFovHalfRad: PERCEPTION_RULES.vFovHalfRad,
};
const EYE = vec3(0, 1.62, 0);
const bot = (over: Partial<{ eye: Vec3; yaw: number; alive: boolean }> = {}) => ({
  id: BOT,
  eye: EYE,
  yaw: 0,
  alive: true,
  ...over,
});
const target = (feet: Vec3, alive = true, eye = 1.62) =>
  createTargetSample(PLAYER_ID, feet, eye, alive);

function countingSight(inner: SightPort): SightPort & { calls: number } {
  const s = {
    calls: 0,
    lineOfSight(a: Vec3, b: Vec3) {
      s.calls++;
      return inner.lineOfSight(a, b);
    },
  };
  return s;
}

const open = createFakePhysics();
const wall = createFakePhysics({ boxes: [{ min: vec3(-5, 0, -6), max: vec3(5, 3, -5) }] });
const lowWall = createFakePhysics({ boxes: [{ min: vec3(-5, 0, -19), max: vec3(5, 1.3, -18) }] });

describe('sense', () => {
  it('sees a target in front, in range and in line of sight (AC1)', () => {
    const p = createPerceptionSystem();
    const s = countingSight(open);
    expect(p.sense(bot(), target(vec3(0, 0, -20)), s, VISION, 1)).toBe(1);
    const v = p.perceptsFor(BOT, 1).visibleTarget;
    expect(v?.feet).toEqual(vec3(0, 0, -20));
    expect(v?.since).toBe(1);
    expect(s.calls).toBe(1);
  });

  it('does not see through a wall (AC2), and casts at most two rays', () => {
    const p = createPerceptionSystem();
    const s = countingSight(wall);
    expect(p.sense(bot(), target(vec3(0, 0, -20)), s, VISION, 1)).toBe(2);
    expect(p.perceptsFor(BOT, 1).visibleTarget).toBeUndefined();
  });

  it('sees the head over a low wall when the chest is hidden', () => {
    const p = createPerceptionSystem();
    p.sense(bot(), target(vec3(0, 0, -20)), lowWall, VISION, 1);
    expect(p.perceptsFor(BOT, 1).visibleTarget?.pos.y).toBeCloseTo(1.62);
  });

  it.each([
    ['out of range', vec3(0, 0, -46), 0],
    ['behind', vec3(0, 0, 10), 0],
    ['outside the 110° cone', vec3(-20, 0, -10), 0],
    ['straight above (vertical FOV)', vec3(0, 30, -1), 0],
  ])('does not see a target %s and casts no ray (AC3)', (_n, feet, rays) => {
    const p = createPerceptionSystem();
    const s = countingSight(open);
    expect(p.sense(bot(), target(feet), s, VISION, 1)).toBe(rays);
    expect(p.perceptsFor(BOT, 1).visibleTarget).toBeUndefined();
  });

  it('sees inside the cone edge (54°) but not past it (56°)', () => {
    const p = createPerceptionSystem();
    const at = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return vec3(-Math.sin(r) * 20, 0, -Math.cos(r) * 20);
    };
    p.sense(bot(), target(at(54)), open, VISION, 1);
    expect(p.perceptsFor(BOT, 1).visibleTarget).toBeDefined();
    p.sense(bot(), target(at(56)), open, VISION, 2);
    expect(p.perceptsFor(BOT, 2).visibleTarget).toBeUndefined();
  });

  it('a dead target is never visible; a dead bot does not sense (BR-AI-12)', () => {
    const p = createPerceptionSystem();
    expect(p.sense(bot(), target(vec3(0, 0, -10), false), open, VISION, 1)).toBe(0);
    expect(p.perceptsFor(BOT, 1).visibleTarget).toBeUndefined();
    expect(p.sense(bot({ alive: false }), target(vec3(0, 0, -10)), open, VISION, 1)).toBe(0);
    p.markDead(BOT);
    expect(p.sense(bot(), target(vec3(0, 0, -10)), open, VISION, 2)).toBe(0);
    expect(p.perceptsFor(BOT, 2)).toEqual({});
  });

  it('keeps the sighting start across a gap of 0.5 s or less, restarts after (BR-AI-14)', () => {
    const p = createPerceptionSystem();
    const t = target(vec3(0, 0, -10));
    p.sense(bot(), t, open, VISION, 1);
    p.sense(bot(), t, wall, VISION, 1.2);
    p.sense(bot(), t, open, VISION, 1.4);
    expect(p.perceptsFor(BOT, 1.4).visibleTarget?.since).toBe(1);
    p.sense(bot(), t, wall, VISION, 1.5);
    p.sense(bot(), t, open, VISION, 2.1);
    expect(p.perceptsFor(BOT, 2.1).visibleTarget?.since).toBe(2.1);
  });

  it('last known position expires after 12 s (BR-AI-15)', () => {
    const p = createPerceptionSystem();
    p.sense(bot(), target(vec3(0, 0, -10)), open, VISION, 1);
    p.sense(bot(), target(vec3(0, 0, -10)), wall, VISION, 2);
    expect(p.perceptsFor(BOT, 13).lastKnown?.pos).toEqual(vec3(0, 0, -10));
    expect(p.perceptsFor(BOT, 13.1).lastKnown).toBeUndefined();
  });

  it.each([
    ['NaN eye', bot({ eye: vec3(NaN, 0, 0) }), target(vec3(0, 0, -5)), VISION],
    ['NaN yaw', bot({ yaw: NaN }), target(vec3(0, 0, -5)), VISION],
    ['NaN target', bot(), target(vec3(0, NaN, -5)), VISION],
    ['bad eye height', bot(), target(vec3(0, 0, -5), true, -1), VISION],
    ['NaN range', bot(), target(vec3(0, 0, -5)), { ...VISION, rangeM: NaN }],
  ])('%s is skipped without a ray or a throw (BR-AI-19)', (_n, b, t, v) => {
    const p = createPerceptionSystem();
    const s = countingSight(open);
    expect(p.sense(b, t, s, v, 1)).toBe(0);
    expect(s.calls).toBe(0);
    expect(p.perceptsFor(BOT, 1).visibleTarget).toBeUndefined();
  });

  it('ignores ids that are not bots', () => {
    const p = createPerceptionSystem();
    expect(p.sense({ ...bot(), id: PLAYER_ID }, target(vec3(0, 0, -5)), open, VISION, 1)).toBe(0);
    expect(p.stats().memories).toBe(0);
  });
});
