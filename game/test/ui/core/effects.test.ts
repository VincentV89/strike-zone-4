import { describe, expect, it } from 'vitest';
import { PLAYER_ID, vec3, type DomainEvent } from '@sz/kernel';
import {
  HEARD_SHOT_RADIUS_M,
  MAX_PINGS,
  createEffects,
  feedOpacity,
  markerOpacity,
  reduceEffects,
  takeAnnouncements,
  type EffectsContext,
  type HudEffects,
} from '@sz/ui/core/effects';
import { bot, deepFreeze } from '../../support/hud-driver';

const P = PLAYER_ID;

function ctx(now: number, extra: Partial<EffectsContext> = {}): EffectsContext {
  return {
    now,
    playerPos: vec3(0, 0, 0),
    graphics: 'medium',
    health: 100,
    alive: true,
    aliveBots: 3,
    ...extra,
  };
}

function run(
  fx: HudEffects,
  now: number,
  events: DomainEvent[],
  extra: Partial<EffectsContext> = {},
) {
  reduceEffects(fx, deepFreeze(events), ctx(now, extra));
}

const hit = (zone: 'head' | 'body', killed = false, shooter = P): DomainEvent => ({
  type: 'HitConfirmed',
  shooter,
  target: bot(1),
  zone,
  damage: 28,
  killed,
});

const damage = (x: number, z: number): DomainEvent => ({
  type: 'DamageTaken',
  victim: P,
  from: bot(1),
  dir: vec3(x, 0, z),
  amount: 10,
  healthAfter: 90,
  armorAfter: 90,
});

const killed = (victim = bot(1), killer = P, headshot = false): DomainEvent => ({
  type: 'ActorKilled',
  killer,
  victim,
  weapon: 'rifle',
  headshot,
});

const shot = (shooter = bot(2), x = 10, z = 0): DomainEvent => ({
  type: 'ShotFired',
  shooter,
  weapon: 'rifle',
  origin: vec3(x, 1.5, z),
  dir: vec3(-1, 0, 0),
});

describe('hit marker (§7.1, req-hit-feedback)', () => {
  it('shows for a player HitConfirmed and is gone 0.3 s of sim time later', () => {
    const fx = createEffects();
    run(fx, 1, [hit('body')]);
    expect(fx.marker?.kind).toBe('body');
    expect(markerOpacity(fx.marker, 1.05)).toBe(1);
    expect(markerOpacity(fx.marker, 1.2)).toBeCloseTo(0.5, 6);
    run(fx, 1.29, []);
    expect(fx.marker).toBeDefined();
    run(fx, 1.3, []);
    expect(fx.marker).toBeUndefined();
  });

  it('keeps the higher priority kind: kill > head > body', () => {
    const fx = createEffects();
    run(fx, 1, [hit('head')]);
    run(fx, 1.05, [hit('body')]);
    expect(fx.marker?.kind).toBe('head');
    run(fx, 1.1, [hit('body', true)]);
    expect(fx.marker?.kind).toBe('kill');
    run(fx, 2, [hit('body')]);
    expect(fx.marker?.kind).toBe('body');
  });

  it('ignores bot hits and misses', () => {
    const fx = createEffects();
    run(fx, 1, [hit('head', false, bot(3)), shot(P)]);
    expect(fx.marker).toBeUndefined();
  });
});

describe('damage arcs (§7.2)', () => {
  it('merges hits within 20°, keeps at most 4 and fades over 1 s', () => {
    const fx = createEffects();
    run(fx, 1, [damage(1, 0)]);
    run(fx, 1.2, [damage(Math.cos(0.2), Math.sin(0.2))]); // ~11° away: refresh
    expect(fx.arcs).toHaveLength(1);
    expect(fx.arcs[0]?.t0).toBe(1.2);
    run(fx, 1.3, [damage(-1, 0), damage(0, 1), damage(0, -1), damage(0.7, 0.7)]);
    expect(fx.arcs).toHaveLength(4);
    run(fx, 2.31, []);
    expect(fx.arcs).toHaveLength(0);
  });

  it('a zero or non-finite dir draws no arc', () => {
    const fx = createEffects();
    run(fx, 1, [damage(0, 0), damage(Number.NaN, 1)]);
    expect(fx.arcs).toHaveLength(0);
  });
});

describe('kill feed (§7.3)', () => {
  it('newest first, at most 5, visible 5 s then fades over 0.3 s', () => {
    const fx = createEffects();
    run(
      fx,
      1,
      [1, 2, 3, 4, 5, 6].map((n) => killed(bot(n))),
    );
    expect(fx.feed).toHaveLength(5);
    expect(fx.feed[0]?.victim).toBe(bot(6));
    const first = fx.feed[0];
    if (!first) throw new Error('feed empty');
    expect(feedOpacity(first, 5.9)).toBe(1);
    expect(feedOpacity(first, 6.15)).toBeCloseTo(0.5, 6);
    run(fx, 6.3, []);
    expect(fx.feed).toHaveLength(0);
  });

  it('records the killer when the player dies', () => {
    const fx = createEffects();
    run(fx, 1, [killed(P, bot(4), true)]);
    expect(fx.lastKilledBy).toEqual({ killer: bot(4), headshot: true });
  });
});

describe('radar pings (§7.4, FD-UI-7)', () => {
  it('pings bot shots within the heard radius, one per shooter, for 3 s', () => {
    const fx = createEffects();
    run(fx, 1, [shot(bot(2), 10, 0), shot(bot(3), HEARD_SHOT_RADIUS_M + 1, 0), shot(P)]);
    expect([...fx.pings.keys()]).toEqual([bot(2)]);
    run(fx, 2, [shot(bot(2), 5, 5)]);
    expect(fx.pings.get(bot(2))).toEqual({ x: 5, z: 5, t0: 2 });
    run(fx, 4.99, []);
    expect(fx.pings.size).toBe(1);
    run(fx, 5, []);
    expect(fx.pings.size).toBe(0);
  });

  it('a kill removes that bot ping; the map is capped at 20', () => {
    const fx = createEffects();
    run(fx, 1, [shot(bot(2))]);
    run(fx, 1.1, [killed(bot(2))]);
    expect(fx.pings.size).toBe(0);
    const many = Array.from({ length: 25 }, (_, i) => shot(`bot-${String(i + 1)}` as never));
    run(fx, 2, many);
    expect(fx.pings.size).toBe(MAX_PINGS);
  });

  it('no player position means no ping', () => {
    const fx = createEffects();
    run(fx, 1, [shot()], { playerPos: undefined });
    expect(fx.pings.size).toBe(0);
  });
});

describe('performance toast and advisory (§7.5)', () => {
  const adv: DomainEvent = { type: 'PerformanceAdvisory', medianFps: 41.6, botCount: 20 };

  it('shows once per round, on High only, for 8 s', () => {
    const fx = createEffects();
    run(fx, 1, [adv]);
    expect(fx.toast).toBeUndefined();
    run(fx, 1, [adv], { graphics: 'high' });
    expect(fx.toast?.text).toBe(
      'Performance is low (42 FPS). Try Medium graphics in Pause → Settings.',
    );
    expect(fx.advisory).toEqual({ fps: 42 });
    run(fx, 2, [adv], { graphics: 'high' });
    expect(fx.toast?.t0).toBe(1);
    run(fx, 9, [], { graphics: 'high' });
    expect(fx.toast).toBeUndefined();
    expect(fx.advisory).toEqual({ fps: 42 });
  });
});

describe('announcer (§7.6)', () => {
  it('announces the round start and batches kills over 2 s', () => {
    const fx = createEffects();
    run(fx, 0, [{ type: 'RoundPhaseChanged', from: 'countdown', to: 'live' }]);
    expect(takeAnnouncements(fx)).toEqual(['Round started']);
    run(fx, 1, [killed(bot(1))], { aliveBots: 4 });
    expect(takeAnnouncements(fx)).toEqual(['Enemy eliminated, 4 remaining']);
    run(fx, 1.5, [killed(bot(2))], { aliveBots: 3 });
    run(fx, 2, [killed(bot(3))], { aliveBots: 2 });
    expect(takeAnnouncements(fx)).toEqual([]);
    run(fx, 3, [], { aliveBots: 2 });
    expect(takeAnnouncements(fx)).toEqual(['2 enemies eliminated, 2 remaining']);
  });

  it('flushes pending kills on round end', () => {
    const fx = createEffects();
    run(fx, 1, [killed(bot(1))], { aliveBots: 1 });
    takeAnnouncements(fx);
    run(fx, 1.2, [killed(bot(2)), { type: 'RoundEnded', outcome: 'victory', durationSec: 1 }], {
      aliveBots: 0,
    });
    expect(takeAnnouncements(fx)).toEqual(['Enemy eliminated, 0 remaining']);
  });

  it('low health fires once per crossing and re-arms at 25', () => {
    const fx = createEffects();
    run(fx, 1, [], { health: 30 });
    run(fx, 1.1, [], { health: 20 });
    run(fx, 1.2, [], { health: 10 });
    expect(takeAnnouncements(fx)).toEqual(['Low health']);
    run(fx, 1.3, [], { health: 25 });
    run(fx, 1.4, [], { health: 24 });
    expect(takeAnnouncements(fx)).toEqual(['Low health']);
    run(fx, 1.5, [], { health: 0, alive: false });
    run(fx, 1.6, [], { health: Number.NaN });
    expect(takeAnnouncements(fx)).toEqual([]);
  });
});

describe('round bookkeeping and versioning (§7.8, PD-UI-1)', () => {
  it('a new round (loading → ready) clears everything and bumps the round number', () => {
    const fx = createEffects();
    run(fx, 1, [hit('head'), damage(1, 0), killed(P, bot(2)), shot()]);
    expect(fx.tally.headshots).toBe(1);
    run(fx, 1, [{ type: 'RoundPhaseChanged', from: 'ended', to: 'loading' }]);
    expect(fx.roundIndex).toBe(0);
    run(fx, 1, [{ type: 'RoundPhaseChanged', from: 'loading', to: 'ready' }]);
    expect(fx.roundIndex).toBe(1);
    expect(fx.marker).toBeUndefined();
    expect(fx.arcs).toHaveLength(0);
    expect(fx.feed).toHaveLength(0);
    expect(fx.pings.size).toBe(0);
    expect(fx.lastKilledBy).toBeUndefined();
    expect(fx.tally.headshots).toBe(0);
  });

  it('version changes only when a store changes', () => {
    const fx = createEffects();
    run(fx, 1, []);
    const v0 = fx.version;
    run(fx, 1.5, [{ type: 'Footstep', actor: P, pos: vec3(0, 0, 0), gait: 'walk' }]);
    expect(fx.version).toBe(v0);
    run(fx, 1.6, [hit('body')]);
    expect(fx.version).toBe(v0 + 1);
    run(fx, 1.7, []);
    expect(fx.version).toBe(v0 + 1);
    run(fx, 2, []);
    expect(fx.version).toBe(v0 + 2); // marker expired
  });

  it('an undefined sim time keeps the last time (before spawn)', () => {
    const fx = createEffects();
    run(fx, 4, []);
    reduceEffects(fx, [], ctx(4, { now: undefined }));
    expect(fx.now).toBe(4);
  });

  it('processes 420 events in one call without exceeding any store cap (PERF-UI-06)', () => {
    const fx = createEffects();
    const events: DomainEvent[] = [];
    for (let i = 0; i < 84; i++) {
      events.push(hit('body'), damage(Math.cos(i), Math.sin(i)), shot(bot((i % 20) + 1)));
      events.push(killed(bot((i % 20) + 1)), shot(P));
    }
    expect(events).toHaveLength(420);
    run(fx, 1, events);
    expect(fx.arcs.length).toBeLessThanOrEqual(4);
    expect(fx.feed.length).toBeLessThanOrEqual(5);
    expect(fx.pings.size).toBeLessThanOrEqual(20);
  });
});
