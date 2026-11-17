// One 5-bot round per shipped map against the real Rapier adapter (BR-ML-71). This is the first
// place bot steering runs against real capsule collision (tech-stack-decisions-bot-ai gap).
// Wiring mirrors app-shell: one PhysicsHost, nav built on host.query, the world reused per map.
import { afterAll, describe, expect, it } from 'vitest';
import { PLAYER_ID } from '@sz/kernel';
import { buildNavGraph, type NavGraph } from '@sz/nav';
import { DEFAULT_CHARACTER, createPhysicsHost, type PhysicsHost } from '@sz/physics';
import { NEUTRAL_INTENT } from '@sz/player';
import { createRound } from '@sz/round';
import { createSim } from '@sz/sim';
import { SHIPPED_MAPS } from '../maps/shipped-maps';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';
import { createRecordingBus } from '../support/recording-bus';
import { intentOf } from '../support/round-driver';

const hosts: PhysicsHost[] = [];
afterAll(() => {
  for (const h of hosts) h.dispose();
});

describe.skipIf(!rapierAvailable)(`round on real Rapier${RAPIER_SKIP_REASON}`, () => {
  it.each(SHIPPED_MAPS.map((m) => [m.id, m] as const))(
    '%s: a 5-bot round runs 1,800 live ticks, then restarts with no leak',
    (_id, map) => {
      const host = createPhysicsHost();
      hosts.push(host);
      const world = host.load(map);
      const built = buildNavGraph(map, host.query);
      expect(built.ok).toBe(true);
      const nav = (built as { ok: true; value: NavGraph }).value;
      const bus = createRecordingBus();
      const reports: unknown[] = [];
      let steps = 0;
      const physics = new Proxy(world, {
        get(target, key, receiver) {
          if (key === 'step') {
            return (dt: number) => {
              steps++;
              target.step(dt);
            };
          }
          const v: unknown = Reflect.get(target, key, receiver);
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
      const round = createRound({
        bus,
        nextSeed: () => 99,
        buildSimulation: (c) =>
          createSim({
            map,
            physics,
            characterSpec: DEFAULT_CHARACTER,
            nav,
            setup: c.setup,
            seed: c.seed,
            bus,
            report: (bot, err) => reports.push([bot, err]),
          }),
      });
      const setup = { mapId: map.id, botCount: 5, difficulty: 'normal' };
      expect(round.start({ setup, durationSec: 300, seed: 5 }).ok).toBe(true);
      expect(world.stats().characters).toBe(6);
      const first = world.stats();
      round.beginCountdown();
      for (let i = 0; i < 180; i++) round.tick(NEUTRAL_INTENT);
      expect(round.state().phase).toBe('live');
      const start = round.snapshot()!;
      for (let i = 0; i < 1800 && round.state().phase === 'live'; i++) {
        round.tick(intentOf({ move: { forward: 0, right: i % 240 < 120 ? 1 : -1 } }));
      }
      const end = round.snapshot()!;
      expect(steps).toBe(end.tick);
      expect(reports).toEqual([]);
      // Bots stay inside the map and above the kill plane; at least one moved off its spawn.
      for (const b of end.bots) {
        expect(b.pos.y).toBeGreaterThan(map.bounds.killY);
        expect(Math.abs(b.pos.x)).toBeLessThanOrEqual(map.bounds.max.x);
        expect(Math.abs(b.pos.z)).toBeLessThanOrEqual(map.bounds.max.z);
      }
      const moved = end.bots.filter((b, i) => {
        const s = start.bots[i]!;
        return Math.hypot(b.pos.x - s.pos.x, b.pos.z - s.pos.z) > 2;
      });
      expect(moved.length).toBeGreaterThan(0);
      expect(end.player.pos.y).toBeGreaterThan(map.bounds.killY);
      expect(bus.emitted.some((e) => e.type === 'Footstep' && e.actor === PLAYER_ID)).toBe(true);
      // Restart reuses the world and leaves the same body and collider counts.
      expect(round.restart().start.ok).toBe(true);
      expect(world.stats()).toEqual(first);
      expect(host.liveWorlds()).toBe(1);
      round.quitToMenu();
      expect(world.stats().characters).toBe(0);
    },
    60_000,
  );
});
