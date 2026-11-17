/**
 * PerceptionSystem facade (LC-AI-C08). Lives outside index.ts so its logic is counted by
 * coverage (cicd-pipeline-bot-ai). One system per round; reset() clears everything.
 */
import { isBotId, parseActorId, type ActorId, type Vec3 } from '@sz/kernel';
import { createSpatialGrid } from './grid';
import { finiteNum, finiteVec } from './guards';
import { acceptNoise, deliverNoise, recordDamageInto, type QueuedNoise } from './hearing';
import { createMemory, slot, copyInto, type Memory, type Slot } from './memory';
import { EMPTY_PERCEPTS, perceptsOf } from './percepts';
import { updateViewMemo } from './player-view';
import { PERCEPTION_RULES } from './rules';
import { senseInto } from './sense';
import type { PerceptionSystem, TargetSample } from './types';

/** The only way to build a TargetSample; match-loop calls it once per tick. */
export function createTargetSample(
  id: ActorId,
  feet: Vec3,
  eyeHeight: number,
  alive: boolean,
): TargetSample {
  return { id, feet, eyeHeight, alive } as TargetSample;
}

function botIdOf(id: unknown): ActorId | null {
  const parsed = parseActorId(id);
  return parsed.ok && isBotId(parsed.value) ? parsed.value : null;
}

export interface PerceptionOptions {
  readonly cellSize?: number;
}

export function createPerceptionSystem(opts: PerceptionOptions = {}): PerceptionSystem {
  const cell =
    finiteNum(opts.cellSize) && opts.cellSize > 0 ? opts.cellSize : PERCEPTION_RULES.cellSize;
  const grid = createSpatialGrid(cell);
  const memories = new Map<ActorId, Memory>();
  const positions = new Map<ActorId, Slot>();
  const queue: QueuedNoise[] = [];
  const shots = new Map<ActorId, number>();
  const views = new Map<ActorId, boolean>();

  function memoryFor(id: unknown): Memory | undefined {
    const bot = botIdOf(id);
    if (bot === null) return undefined;
    let m = memories.get(bot);
    if (m === undefined) {
      m = createMemory();
      memories.set(bot, m);
    }
    return m;
  }

  return {
    updatePositions(actors) {
      const live: Array<{ id: ActorId; feet: Vec3 }> = [];
      for (const a of actors) {
        const m = memoryFor(a.id);
        if (m === undefined) continue;
        if (!a.alive) m.dead = true;
        if (m.dead || !finiteVec(a.feet)) continue;
        let p = positions.get(a.id);
        if (p === undefined) {
          p = slot();
          positions.set(a.id, p);
        }
        copyInto(p, a.feet);
        live.push({ id: a.id, feet: p });
      }
      grid.rebuild(live);
    },
    emitNoise(noise) {
      const n = acceptNoise(noise);
      if (n !== null && queue.length < PERCEPTION_RULES.maxQueuedNoises) queue.push(n);
    },
    processNoises(now) {
      if (finiteNum(now)) {
        const deps = { grid, positions, memoryOf: (b: ActorId) => memories.get(b) };
        for (const n of queue) deliverNoise(n, now, deps);
      }
      queue.length = 0;
    },
    sense(bot, target, sight, vision, now) {
      const m = memoryFor(bot.id);
      return m === undefined ? 0 : senseInto(m, bot, target, sight, vision, now);
    },
    recordDamage(bot, dir, now) {
      const m = memoryFor(bot);
      if (m !== undefined) recordDamageInto(m, dir, now);
    },
    noteShot(bot, now) {
      const id = botIdOf(bot);
      if (id !== null && finiteNum(now)) shots.set(id, now);
    },
    updatePlayerView(view, bots, sight, tick) {
      return updateViewMemo(views, view, bots, sight, tick);
    },
    perceptsFor(bot, now) {
      const m = memories.get(bot);
      return m === undefined || m.dead ? EMPTY_PERCEPTS : perceptsOf(m, now);
    },
    playerCanSee: (bot) => views.get(bot) === true,
    recentlyFired(bot, now) {
      const at = shots.get(bot);
      return at !== undefined && finiteNum(now) && now - at <= PERCEPTION_RULES.recentShotSec;
    },
    markDead(bot) {
      const m = memoryFor(bot);
      if (m !== undefined) {
        m.dead = true;
        m.visibleNow = false;
      }
      positions.delete(bot);
    },
    reset() {
      memories.clear();
      positions.clear();
      queue.length = 0;
      shots.clear();
      views.clear();
      grid.clear();
    },
    stats: () => ({
      memories: memories.size,
      queuedNoises: queue.length,
      shots: shots.size,
      views: views.size,
      gridActors: grid.size,
    }),
  };
}
