// LC-R-4, PD-R-2, PD-R-3, BR-R-16, SC1, SC2: slots, LOD, culling, near/far shadow split.
import { vec3, type ActorId } from '@sz/kernel';
import { createPresentationState } from '@sz/render/core/state';
import {
  BOT_CAPACITY,
  SHADOW_HYSTERESIS_M,
  createActorSet,
  shortestArc,
  syncActors,
  updateActors,
} from '@sz/render/core/actors';
import { applyRenderSettings, stepPresentation } from '@sz/render/core/frame';
import { PRESETS } from '@sz/render/core/presets';
import { describe, expect, it } from 'vitest';
import { bot, botsAhead, frame, snapshot } from '../../support/render-frames';

const medium = PRESETS.get('medium');
if (medium === undefined) throw new Error('medium');

const inputs = (over: Partial<Parameters<typeof updateActors>[2]> = {}) => ({
  alpha: 0,
  dt: 1 / 60,
  t: 0,
  camX: 0,
  camY: 1.62,
  camZ: 0,
  preset: medium,
  ...over,
});

function botAt(z: number) {
  return snapshot({ bots: [bot('bot-1' as ActorId, vec3(0, 0, -z))] });
}

describe('actor slots', () => {
  it('mirrors the snapshot: creates and frees slots by id', () => {
    const set = createActorSet();
    syncActors(set, snapshot({ bots: botsAhead(5) }));
    expect(set.index.size).toBe(5);
    syncActors(set, snapshot({ bots: botsAhead(2) }));
    expect(set.index.size).toBe(2);
    expect(set.slots.filter((s) => s.id !== null)).toHaveLength(2);
    expect(set.slots).toHaveLength(BOT_CAPACITY);
  });

  it('ignores bots beyond 20 and duplicate or non-string ids', () => {
    const set = createActorSet();
    const many = Array.from({ length: 25 }, (_, i) =>
      bot(`bot-x${String(i)}` as ActorId, vec3(i, 0, 0)),
    );
    syncActors(set, snapshot({ bots: many }));
    expect(set.index.size).toBe(20);
    expect(set.index.has('bot-x20')).toBe(false);
    syncActors(set, snapshot({ bots: [bot(7 as unknown as ActorId, vec3(0, 0, 0))] }));
    expect(set.index.size).toBe(0);
  });

  it('turns on the shortest arc at most 12 rad/s', () => {
    expect(shortestArc(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
    const set = createActorSet();
    const s0 = snapshot({ bots: [bot('bot-1' as ActorId, vec3(0, 0, -5), { yaw: 0 })] });
    syncActors(set, s0);
    updateActors(set, s0, inputs());
    const s1 = snapshot({ bots: [bot('bot-1' as ActorId, vec3(0, 0, -5), { yaw: Math.PI })] });
    syncActors(set, s1);
    updateActors(set, s1, inputs({ dt: 0.1 }));
    expect(set.slots[0]?.yaw).toBeCloseTo(1.2, 9);
  });

  it('freezes the walk cycle beyond animLodM and hides bots beyond the draw distance', () => {
    const set = createActorSet();
    const far = botAt(medium.animLodM + 5);
    syncActors(set, far);
    updateActors(set, far, inputs());
    const slot = set.slots[0];
    expect(slot?.animate).toBe(false);
    expect(slot?.visible).toBe(true);
    const gone = botAt(medium.drawDistanceM + 5);
    syncActors(set, gone);
    updateActors(set, gone, inputs());
    expect(slot?.visible).toBe(false);
  });

  it('near/far shadow split with 1 m hysteresis on Medium; Low has no casters', () => {
    const set = createActorSet();
    const at = (z: number, preset = medium) => {
      const s = botAt(z);
      syncActors(set, s);
      updateActors(set, s, inputs({ preset, camY: 0 }));
      return set.slots[0]?.near;
    };
    expect(at(20)).toBe(true);
    expect(at(30 + SHADOW_HYSTERESIS_M / 2)).toBe(true);
    expect(at(31.5)).toBe(false);
    expect(at(30.5)).toBe(false);
    expect(at(29)).toBe(true);
    const low = PRESETS.get('low');
    const high = PRESETS.get('high');
    if (low === undefined || high === undefined) throw new Error('presets');
    expect(at(1, low)).toBe(false);
    expect(at(100, high)).toBe(true);
  });

  it('the first frame alive=false starts the death reaction (fallback without ActorKilled)', () => {
    const set = createActorSet();
    const s0 = botAt(5);
    syncActors(set, s0);
    updateActors(set, s0, inputs());
    const dead = snapshot({
      bots: [bot('bot-1' as ActorId, vec3(0, 0, -5), { alive: false, hitFlash: true })],
    });
    syncActors(set, dead);
    updateActors(set, dead, inputs({ t: 2 }));
    expect(set.slots[0]?.deathStart).toBe(2);
    expect(set.slots[0]?.hitFlash).toBe(false);
  });
});

describe('compacted instances (PD-R-3, NFR-R-SC2)', () => {
  it('count equals live instances; empty buffers report 0', () => {
    const s = createPresentationState();
    stepPresentation(s, frame(snapshot({ bots: botsAhead(5) })), 16 / 9);
    const near = s.botNear.reduce((n, b) => n + b.count, 0);
    const far = s.botFar.reduce((n, b) => n + b.count, 0);
    expect(near + far).toBe(5 * 12);
    stepPresentation(s, frame(snapshot({ bots: [] })), 16 / 9);
    expect(s.botNear.every((b) => b.count === 0 && b.dirty)).toBe(true);
  });

  it('Low puts every bot in the non-casting set', () => {
    const s = createPresentationState();
    applyRenderSettings(s, { preset: 'low' });
    stepPresentation(s, frame(snapshot({ bots: botsAhead(5, 3) })), 16 / 9);
    expect(s.botNear.every((b) => b.count === 0)).toBe(true);
    expect(s.botFar.reduce((n, b) => n + b.count, 0)).toBe(60);
  });
});
