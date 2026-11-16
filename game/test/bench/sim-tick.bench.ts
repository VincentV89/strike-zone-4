// Advisory CPU benchmark (tech-stack-decisions-verification-suite ADR-VS-4, PERF-VS-2). Run with
// `npm run bench`; not part of verify. It measures sim tick time only: CPU-only, NOT FPS. Frame
// rate is a manual measurement on real hardware (procedures MP-3 and MP-4).
import { bench, describe } from 'vitest';
import { desertCompound } from '@sz/maps';
import { buildNavGraph, type NavGraph } from '@sz/nav';
import { createPhysicsHost } from '@sz/physics';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';
import { createTestRound, intentOf, type TestRound } from '../support/round-driver';

const FIRE = intentOf({ fire: true, firePressed: true });

function liveRound(botCount: number, rapier: boolean): TestRound {
  if (!rapier) {
    const t = createTestRound({ botCount, difficulty: 'hard', seed: 5, durationSec: 600 });
    t.goLive();
    return t;
  }
  const host = createPhysicsHost();
  const world = host.load(desertCompound);
  const built = buildNavGraph(desertCompound, host.query);
  if (!built.ok) throw new Error('nav build failed');
  const nav: NavGraph = built.value;
  const t = createTestRound({
    botCount,
    difficulty: 'hard',
    seed: 5,
    durationSec: 600,
    physics: () => world,
    nav: () => nav,
  });
  t.goLive();
  return t;
}

for (const n of [5, 20]) {
  describe(`sim tick, ${String(n)} bots, box-world fake (CPU-only, not FPS)`, () => {
    const t = liveRound(n, false);
    bench(`round.tick with ${String(n)} bots`, () => {
      if (t.round.state().phase !== 'live') t.goLive(); // keep measuring live ticks
      t.round.tick(FIRE);
    });
  });

  describe.skipIf(!rapierAvailable)(
    `sim tick, ${String(n)} bots, real Rapier (CPU-only, not FPS)${RAPIER_SKIP_REASON}`,
    () => {
      const t = liveRound(n, true);
      bench(`round.tick with ${String(n)} bots on Rapier`, () => {
        if (t.round.state().phase !== 'live') t.goLive();
        t.round.tick(FIRE);
      });
    },
  );
}
