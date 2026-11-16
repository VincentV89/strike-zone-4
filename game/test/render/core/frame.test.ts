// PD-R-5, PD-R-6, RD-R-7, SD-R-2, SD-R-3, BR-R-14, BR-R-18, M1–M3: frame loop guarantees.
import { PLAYER_ID, vec3, type ActorId, type DomainEvent } from '@sz/kernel';
import {
  applyRenderSettings,
  beginRound,
  coreStats,
  stepPresentation,
} from '@sz/render/core/frame';
import { createPresentationState } from '@sz/render/core/state';
import type { SnapshotBot } from '@sz/sim';
import { describe, expect, it } from 'vitest';
import {
  RIFLE_VIEW,
  bot,
  botsAhead,
  deepFreeze,
  frame,
  impactBot,
  impactWorld,
  player,
  shot,
  snapshot,
} from '../../support/render-frames';

describe('frame guards', () => {
  it('draws nothing before the first snapshot', () => {
    const s = createPresentationState();
    const out = stepPresentation(s, frame(undefined), 16 / 9);
    expect(out.draw).toBe(false);
    expect(s.t).toBe(0);
  });

  it('100 paused frames leave every timer and buffer unchanged (RD-R-7, BR-R-14)', () => {
    const s = createPresentationState();
    const curr = snapshot({ bots: botsAhead(5) });
    stepPresentation(
      s,
      frame(curr, { events: [impactWorld(vec3(0, 1, -3), vec3(0, 0, 1))] }),
      16 / 9,
    );
    const before = JSON.stringify(coreStats(s));
    const kick = s.viewmodel.kick;
    const firstMatrix = Array.from(s.botFar[0]?.matrices.slice(0, 16) ?? []);
    for (let i = 0; i < 100; i++) {
      const out = stepPresentation(
        s,
        frame(curr, {
          paused: true,
          dtSec: 1 / 60,
          events: [shot(PLAYER_ID, vec3(0, 1.6, 0), vec3(0, 0, -1))],
        }),
        16 / 9,
      );
      expect(out.frozen).toBe(true);
    }
    expect(JSON.stringify(coreStats(s))).toBe(before);
    expect(s.viewmodel.kick).toBe(kick);
    expect(Array.from(s.botFar[0]?.matrices.slice(0, 16) ?? [])).toEqual(firstMatrix);
  });

  it('the end-of-round hold (paused false) lets a death reaction finish', () => {
    const s = createPresentationState();
    const b = bot('bot-1' as ActorId, vec3(0, 0, -5));
    stepPresentation(s, frame(snapshot({ bots: [b] })), 1);
    const kill: DomainEvent = {
      type: 'ActorKilled',
      killer: PLAYER_ID,
      victim: b.id,
      weapon: 'rifle',
      headshot: true,
    };
    const dead = snapshot({ bots: [{ ...b, alive: false }] });
    stepPresentation(s, frame(dead, { events: [kill] }), 1);
    for (let i = 0; i < 40; i++) stepPresentation(s, frame(dead, { dtSec: 1 / 60 }), 1);
    const slot = s.actors.slots[0];
    expect(s.t - (slot?.deathStart ?? 0)).toBeGreaterThan(0.6);
  });

  it('clamps dt to 0.1 s and treats hostile dt and alpha as 0', () => {
    const s = createPresentationState();
    stepPresentation(s, frame(snapshot(), { dtSec: 5 }), 1);
    expect(s.t).toBeCloseTo(0.1, 9);
    stepPresentation(
      s,
      frame(snapshot(), { dtSec: Number.NaN, alpha: Number.POSITIVE_INFINITY }),
      1,
    );
    expect(s.t).toBeCloseTo(0.1, 9);
  });

  it('player death starts the death camera; scope or death hides the viewmodel', () => {
    const s = createPresentationState();
    stepPresentation(s, frame(snapshot({ player: player({ alive: false }) })), 1);
    expect(s.playerDeathStart).toBeGreaterThanOrEqual(0);
    expect(s.vmPose.visible).toBe(false);
    stepPresentation(s, frame(snapshot()), 1);
    expect(s.playerDeathStart).toBe(-1);
    expect(s.vmPose.visible).toBe(true);
    const scoped = player({ weapon: { ...RIFLE_VIEW, equipped: 'sniper', scoped: true } });
    stepPresentation(s, frame(snapshot({ player: scoped })), 1);
    expect(s.vmPose.visible).toBe(false);
    expect(s.camera.vFovDeg).toBe(25);
    expect(s.viewmodel.weapon).toBe('sniper');
  });
});

describe('read-only inputs (SD-R-2)', () => {
  it('120 frames over deep-frozen snapshots and events (deaths, presets) never write into them', () => {
    const s = createPresentationState();
    const ids = botsAhead(5).map((b) => b.id);
    for (let i = 0; i < 120; i++) {
      const bots: SnapshotBot[] = ids.map((id, k) =>
        bot(id, vec3(k * 2, 0, -10 + i * 0.05), {
          alive: !(k === 0 && i > 60),
          hitFlash: i % 7 === 0,
        }),
      );
      const events: DomainEvent[] = [
        shot(ids[1] ?? PLAYER_ID, vec3(2, 1.6, -10), vec3(0, 0, 1)),
        impactBot(ids[2] ?? PLAYER_ID, vec3(4, 1.4, -10)),
        impactWorld(vec3(0, 1, -12), vec3(0, 0, 1)),
      ];
      if (i === 60)
        events.push({
          type: 'ActorKilled',
          killer: PLAYER_ID,
          victim: ids[0] ?? PLAYER_ID,
          weapon: 'rifle',
          headshot: false,
        });
      if (i === 30) applyRenderSettings(s, { preset: 'low' });
      if (i === 90) applyRenderSettings(s, { preset: 'high' });
      const curr = snapshot({ bots });
      const f = frame(curr, { events: deepFreeze(events) });
      expect(() => stepPresentation(s, f, 16 / 9)).not.toThrow();
    }
  });
});

describe('hostile snapshot values (SD-R-3, BR-R-19)', () => {
  it('NaN poses keep the last pose and no instance buffer gets a NaN', () => {
    const s = createPresentationState();
    const id = 'bot-1' as ActorId;
    stepPresentation(s, frame(snapshot({ bots: [bot(id, vec3(1, 0, -5))] })), 1);
    const nan = Number.NaN;
    const hostile = snapshot({
      bots: [
        bot(id, vec3(nan, 0, nan), { yaw: nan, prevPos: vec3(Infinity, 0, 0) }),
        bot('__proto__' as ActorId, vec3(0, 0, -3)),
        bot('bot-21' as ActorId, vec3(1e308, 0, -1e308)),
      ],
      player: player({ pos: vec3(nan, nan, nan), yaw: nan, pitch: Infinity, eyeHeight: nan }),
    });
    stepPresentation(s, frame(hostile, { alpha: -0 }), 1);
    const slot = s.actors.slots[s.actors.index.get(id) ?? -1];
    expect([slot?.x, slot?.z]).toEqual([1, -5]);
    for (const b of [...s.botNear, ...s.botFar]) {
      expect(b.matrices.subarray(0, b.count * 16).every(Number.isFinite)).toBe(true);
    }
    expect([s.camera.x, s.camera.y, s.camera.z, s.camera.yaw].every(Number.isFinite)).toBe(true);
  });

  it('unknown preset and non-finite FOV keep the previous settings', () => {
    const s = createPresentationState();
    applyRenderSettings(s, { preset: 'high', fovDeg: 100, reducedMotion: true });
    const kept = applyRenderSettings(s, {
      preset: '__proto__' as never,
      fovDeg: Number.NaN,
      reducedMotion: 'yes' as never,
    });
    expect(kept).toEqual({ preset: 'high', fovDeg: 100, reducedMotion: true });
    expect(applyRenderSettings(s, { fovDeg: 500 }).fovDeg).toBe(110);
    expect(Object.isFrozen(kept)).toBe(true);
  });
});

describe('allocation (PD-R-5, M1, M2)', () => {
  it('600 frames at 20 bots with sustained fire keep pool, slot and buffer identities', () => {
    const s = createPresentationState();
    applyRenderSettings(s, { preset: 'high' });
    const pools = [
      s.effects.decal.slots,
      s.effects.puff.slots,
      s.effects.spark.slots,
      s.effects.muzzle.slots,
    ];
    const slotObjs = new Set(pools.flat());
    const slots = new Set(s.actors.slots);
    const buffers = [...s.botNear, ...s.botFar].map((b) => b.matrices);
    const ids = botsAhead(20).map((b) => b.id);
    let acquisitions = 0;
    for (let i = 0; i < 600; i++) {
      const bots = ids.map((id, k) =>
        bot(id, vec3(k - 10, 0, -15 + Math.sin(i / 30)), { yaw: i * 0.01 }),
      );
      const events: DomainEvent[] = [
        shot(PLAYER_ID, vec3(0, 1.6, 0), vec3(0, 0, -1)),
        impactWorld(vec3(i % 10, 1, -20), vec3(0, 0, 1)),
        shot(ids[i % 20] ?? PLAYER_ID, vec3(0, 1.6, -15), vec3(0, 0, 1)),
      ];
      stepPresentation(s, frame(snapshot({ bots }), { events }), 16 / 9);
      acquisitions = s.acquisitions;
    }
    expect(acquisitions).toBe(600 * 3);
    expect(new Set(pools.flat()).size).toBe(slotObjs.size);
    for (const p of pools.flat()) expect(slotObjs.has(p)).toBe(true);
    for (const x of s.actors.slots) expect(slots.has(x)).toBe(true);
    [...s.botNear, ...s.botFar].forEach((b, i) => {
      expect(b.matrices).toBe(buffers[i]);
    });
    expect(s.effects.decal.live).toBeLessThanOrEqual(96);
    expect(coreStats(s).botSlots).toBe(20);
  });
});

describe('round lifecycle (BR-R-18, M3 core half)', () => {
  it('ten beginRound cycles leave core stats equal to the first round', () => {
    const s = createPresentationState();
    const play = () => {
      beginRound(s);
      for (let i = 0; i < 30; i++) {
        stepPresentation(
          s,
          frame(snapshot({ bots: botsAhead(8) }), {
            events: [impactWorld(vec3(i, 1, -9), vec3(0, 0, 1))],
          }),
          16 / 9,
        );
      }
      return JSON.stringify(coreStats(s));
    };
    const first = play();
    for (let r = 0; r < 10; r++) expect(play()).toBe(first);
    beginRound(s, 'pistol');
    const st = coreStats(s);
    expect([st.botSlots, st.effectInstances, st.t, st.poolLive.decal]).toEqual([0, 0, 0, 0]);
    expect(s.viewmodel.weapon).toBe('pistol');
  });
});
