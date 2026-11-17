// Bot-state evidence (req-bot-fsm, req-honest-reporting; verification-suite NFR (5), code note (6)).
// One seeded headless round on Desert Compound with the real round, sim, bot AI, weapons and
// combat over the box-world physics fake: 5 bots on Normal, an unhittable player who aims at the
// first live bot and fires one shot every 2 s for 9,000 live ticks (150 s). Bots therefore see,
// hear and get hit by the player without the round ending, so they patrol, investigate, engage,
// take cover, flank, retreat and die. The tally of every
// BotStateChanged entry is written to the git-ignored game/evidence/bot-states.json, which
// REPORT.md section G.2 cites.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT_STATES, PLAYER_ID, type BotStateName, type DomainEvent } from '@sz/kernel';
import {
  aimAt,
  createTestRound,
  headOf,
  intentOf,
  type FakeSimPhysics,
} from '../support/round-driver';

type Tally = Record<BotStateName, number>;

function emptyTally(): Tally {
  const t = {} as Tally;
  for (const s of BOT_STATES) t[s] = 0;
  return t;
}

function count(events: readonly DomainEvent[], into: Tally): number {
  let n = 0;
  for (const e of events) {
    if (e.type !== 'BotStateChanged') continue;
    into[e.to]++;
    n++;
  }
  return n;
}

const SEED = 1;
const TICKS = 9000;
const SHOT_EVERY = 120;

function freeFight(): { events: readonly DomainEvent[]; phase: string; ticks: number } {
  const t = createTestRound({ botCount: 5, seed: SEED, difficulty: 'normal', durationSec: 180 });
  t.goLive();
  (t.physics() as FakeSimPhysics).untouchable.add(PLAYER_ID);
  let i = 0;
  for (; i < TICKS && t.round.state().phase === 'live'; i++) {
    const target = t.round.snapshot()?.bots.find((b) => b.alive);
    if (target) aimAt(t.round, headOf(target));
    const shoot = i % SHOT_EVERY === 0;
    t.round.tick(intentOf({ fire: shoot, firePressed: shoot }));
  }
  return { events: t.bus.emitted, phase: t.round.state().phase, ticks: i };
}

describe('bot-state evidence (game/evidence/bot-states.json)', () => {
  it('one seeded round enters all seven bot states and the tally is written', () => {
    const tally = emptyTally();
    const run = freeFight();
    const changes = count(run.events, tally);

    expect(run.ticks).toBe(TICKS);
    const missing = BOT_STATES.filter((s) => tally[s] === 0);
    expect(missing).toEqual([]);
    expect(changes).toBeGreaterThan(0);

    const dir = join(import.meta.dirname, '..', '..', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'bot-states.json'),
      `${JSON.stringify(
        {
          source: 'game/test/evidence/bot-states.test.ts',
          map: 'desert-compound',
          physics: 'box-world fake (not Rapier, not a browser)',
          round: {
            seed: SEED,
            bots: 5,
            difficulty: 'normal',
            liveTicks: run.ticks,
            phaseAtEnd: run.phase,
            player: 'unhittable; aims at the first live bot; one shot every 120 ticks',
          },
          stateChanges: changes,
          note: 'patrol is the initial state; it is counted only when re-entered',
          entries: tally,
          allSevenEntered: missing.length === 0,
        },
        null,
        2,
      )}\n`,
    );
  }, 60_000);
});
