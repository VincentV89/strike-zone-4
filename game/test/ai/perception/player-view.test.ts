// Radar player view (BR-AI-21): staggered, one ray per checked bot, at most ceil(N/6) per tick.
import { describe, expect, it } from 'vitest';
import { createPerceptionSystem, type SightPort } from '@sz/ai/perception';
import { vec3, type ActorId, type Vec3 } from '@sz/kernel';
import { createFakePhysics } from '../../support/fakes';

const VIEW = { eye: vec3(0, 1.6, 0), yaw: 0, hFovRad: (100 * Math.PI) / 180, alive: true };
const bots = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `bot-${String(i + 1)}` as ActorId,
    chest: vec3(i - n / 2, 1, -20),
    alive: true,
  }));

function counting(inner: SightPort): SightPort & { calls: number } {
  const s = {
    calls: 0,
    lineOfSight(a: Vec3, b: Vec3) {
      s.calls++;
      return inner.lineOfSight(a, b);
    },
  };
  return s;
}

describe('updatePlayerView', () => {
  it('checks each bot once per 6 ticks and never more than ceil(N/6) per tick', () => {
    const p = createPerceptionSystem();
    const list = bots(20);
    const sight = counting(createFakePhysics());
    for (let t = 0; t < 6; t++) {
      const before = sight.calls;
      const rays = p.updatePlayerView(VIEW, list, sight, t);
      expect(rays).toBe(sight.calls - before);
      expect(rays).toBeLessThanOrEqual(4);
    }
    expect(sight.calls).toBe(20);
    for (const b of list) expect(p.playerCanSee(b.id)).toBe(true);
  });

  it('a wall, distance over 60 m, a bot behind the camera or a dead player means not seen', () => {
    const p = createPerceptionSystem();
    const wall = createFakePhysics({ boxes: [{ min: vec3(-50, 0, -6), max: vec3(50, 3, -5) }] });
    const one = [{ id: 'bot-1' as ActorId, chest: vec3(0, 1, -20), alive: true }];
    p.updatePlayerView(VIEW, one, wall, 0);
    expect(p.playerCanSee('bot-1' as ActorId)).toBe(false);
    p.updatePlayerView(VIEW, [{ ...one[0]!, chest: vec3(0, 1, -61) }], createFakePhysics(), 0);
    expect(p.playerCanSee('bot-1' as ActorId)).toBe(false);
    p.updatePlayerView(VIEW, [{ ...one[0]!, chest: vec3(0, 1, 20) }], createFakePhysics(), 0);
    expect(p.playerCanSee('bot-1' as ActorId)).toBe(false);
    p.updatePlayerView({ ...VIEW, alive: false }, one, createFakePhysics(), 0);
    expect(p.playerCanSee('bot-1' as ActorId)).toBe(false);
  });

  it('bad input casts nothing', () => {
    const p = createPerceptionSystem();
    const sight = counting(createFakePhysics());
    expect(p.updatePlayerView({ ...VIEW, yaw: NaN }, bots(3), sight, 0)).toBe(0);
    expect(p.updatePlayerView(VIEW, bots(3), sight, -1)).toBe(0);
    expect(p.updatePlayerView(VIEW, bots(3), sight, 1.5)).toBe(0);
    expect(sight.calls).toBe(0);
  });
});
