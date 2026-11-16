// req-bot-fsm AC2 / B4 exit criterion: one seeded scenario enters all seven states. A scripted
// "director" moves the player and shoots according to the bot's state, as a human tester would.
import { describe, expect, it } from 'vitest';
import { entered } from '@sz/ai';
import {
  BOT_STATES,
  MASK_WORLD,
  dirFromYawPitch,
  vec3,
  type BotStateName,
  type Vec3,
} from '@sz/kernel';
import { createArena, mapWorld, type Arena } from '../support/ai-arena';

const HIDDEN = vec3(-14, 0, 40); // player spawn, far from the NW bot area

/** A spot 8 to 20 m in front of the bot that it can see at chest height. */
function inViewOf(botPos: Vec3, yaw: number): Vec3 | null {
  const { query } = mapWorld();
  const eye = vec3(botPos.x, botPos.y + 1.62, botPos.z);
  for (const off of [0, 0.25, -0.25, 0.5, -0.5]) {
    const f = dirFromYawPitch(yaw + off, 0);
    for (const d of [12, 9, 16, 20, 7]) {
      const p = vec3(botPos.x + f.x * d, botPos.y, botPos.z + f.z * d);
      const chest = vec3(p.x, p.y + 1.0, p.z);
      const head = vec3(p.x, p.y + 1.62, p.z);
      const down = query.raycast(vec3(p.x, p.y + 1, p.z), vec3(0, -1, 0), 3, MASK_WORLD);
      if (down === null || down.distance < 0.5) continue;
      if (query.lineOfSight(eye, chest) && query.lineOfSight(eye, head)) {
        return vec3(p.x, down.point.y, p.z);
      }
    }
  }
  return null;
}

interface Director {
  readonly arena: Arena;
  readonly seen: Set<BotStateName>;
  readonly log: string[];
}

function runDirector(seed: number, maxTicks: number): Director {
  const seen = new Set<BotStateName>(['patrol']);
  const log: string[] = [];
  let playerFeet = HIDDEN;
  let lastAct = 0;
  let wantLow = false;
  const arena: Arena = createArena({
    botCount: 1,
    seed,
    difficulty: 'hard',
    playerInvulnerable: true,
    botsShoot: false,
    // The well square has 18 cover points within 20 m (the NW ruins have none).
    botStarts: [vec3(0, 0, -4)],
    botYaws: [Math.PI],
    script: () => ({ feet: playerFeet }),
  });
  const bot = arena.bots[0];
  if (!bot) throw new Error('no bot');
  const show = () => {
    const p = inViewOf(bot.pos, bot.brain.aim.yaw);
    if (p) playerFeet = p;
  };
  for (let t = 0; t < maxTicks && seen.size < BOT_STATES.length; t++) {
    const s = bot.brain.state;
    seen.add(s);
    const since = arena.now - lastAct;
    if (since >= 1.5) {
      lastAct = arena.now;
      if (s === 'patrol' && arena.now > 3) {
        playerFeet = HIDDEN;
        arena.playerNoise(120);
      } else if (s === 'investigate') {
        show();
      } else if (s === 'engage') {
        // Hit it once; after flank has happened, make it weak first so it retreats.
        if (seen.has('flank') && !wantLow) {
          wantLow = true;
          arena.setVitals(bot.id, { health: 40, armor: 0 });
        }
        arena.playerShoot(bot.id);
      } else if (s === 'take-cover') {
        playerFeet = HIDDEN;
      } else if (s === 'flank') {
        show();
      } else if (s === 'retreat') {
        show();
        arena.playerShoot(bot.id);
      }
    }
    arena.step();
  }
  seen.add(bot.brain.state);
  for (const tr of arena.transitions)
    log.push(`${String(tr.tick)} ${tr.from}->${tr.to} (${tr.guard})`);
  return { arena, seen, log };
}

describe('arena scenario: all seven states (req-bot-fsm AC2)', () => {
  it('one bot enters patrol, investigate, engage, take-cover, flank, retreat and dead', () => {
    const { arena, seen, log } = runDirector(7, 60 * 240);
    const bot = arena.bots[0];
    expect(bot).toBeDefined();
    if (!bot) return;
    expect([...seen].sort(), log.join('\n')).toEqual([...BOT_STATES].sort());
    const counts = entered(bot.brain);
    for (const s of BOT_STATES) expect(counts[s], s).toBeGreaterThanOrEqual(1);
    // Every transition became exactly one BotStateChanged event (BR-AI-47).
    const changes = arena.events.filter((e) => e.type === 'BotStateChanged');
    expect(changes).toHaveLength(arena.transitions.length);
    // Dead is terminal: nothing follows it.
    expect(arena.transitions.at(-1)?.to).toBe('dead');
    // The world view was never used to reach raycast, budget reset or reservation wipe.
    expect(arena.counts.raycast).toBe(0);
    expect(arena.counts.resetTick).toBe(0);
    expect(arena.counts.clearReservations).toBe(0);
  });

  it('is deterministic for a seed (digest literal, ADR-AI-6)', () => {
    const a = runDirector(7, 60 * 240);
    const b = runDirector(7, 60 * 240);
    expect(a.log).toEqual(b.log);
    expect(a.arena.digest()).toBe(b.arena.digest());
    expect(a.arena.digest()).toBe('489a0d69');
  });
});
