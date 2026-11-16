/**
 * Spawn selection (story-valid-spawns, BR-WM-27 to BR-WM-30, SD-WM-2). Only the injected
 * Rng supplies randomness, so a plan is reproducible from the round seed.
 */
import {
  MAX_BOTS,
  add,
  err,
  ok,
  vec3,
  type BotCount,
  type PhysicsQuery,
  type Result,
  type Rng,
} from '@sz/kernel';
import type { MapDefinition, SpawnError, SpawnPlan, SpawnPoint } from './types';

export const SPAWN_RULES = {
  minPlayerDistance: 20,
  minBotSpacing: 1.5,
  eyeHeight: 1.62,
  chestHeight: 1.2,
} as const;

function horizontalDistance(a: SpawnPoint, b: SpawnPoint): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
}

/** Integer in [0, n). */
function index(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng.range(0, n)));
}

function shuffle<T>(xs: ReadonlyArray<T>, rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = index(rng, i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

function rotate<T>(xs: ReadonlyArray<T>, start: number): T[] {
  return [...xs.slice(start), ...xs.slice(0, start)];
}

function eligibleBots(
  map: MapDefinition,
  player: SpawnPoint,
  los: PhysicsQuery['lineOfSight'],
): SpawnPoint[] {
  const eye = add(player.pos, vec3(0, SPAWN_RULES.eyeHeight, 0));
  return map.botSpawns.filter(
    (s) =>
      horizontalDistance(s, player) >= SPAWN_RULES.minPlayerDistance &&
      !los(eye, add(s.pos, vec3(0, SPAWN_RULES.eyeHeight, 0))) &&
      !los(eye, add(s.pos, vec3(0, SPAWN_RULES.chestHeight, 0))),
  );
}

/** Groups by area (in first-seen order), shuffles each group, then interleaves them. */
function roundRobin(spawns: ReadonlyArray<SpawnPoint>, rng: Rng): SpawnPoint[] {
  const groups = new Map<string, SpawnPoint[]>();
  for (const s of spawns) {
    const g = groups.get(s.area);
    if (g) g.push(s);
    else groups.set(s.area, [s]);
  }
  const shuffled = [...groups.values()].map((g) => shuffle(g, rng));
  if (shuffled.length === 0) return [];
  const ordered = rotate(shuffled, index(rng, shuffled.length));
  const out: SpawnPoint[] = [];
  for (let i = 0; out.length < spawns.length; i++) {
    for (const g of ordered) {
      const s = g[i];
      if (s) out.push(s);
    }
  }
  return out;
}

function isValidBotCount(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_BOTS;
}

export function selectSpawns(
  map: MapDefinition,
  botCount: BotCount,
  rng: Rng,
  los: PhysicsQuery['lineOfSight'],
): Result<SpawnPlan, SpawnError> {
  // SD-WM-2: validate before touching the rng or the physics port.
  if (!isValidBotCount(botCount)) return err('invalid-bot-count');
  if (map.playerSpawns.length === 0) return err('insufficient-spawns');
  const playerOrder = rotate(map.playerSpawns, index(rng, map.playerSpawns.length));
  for (const player of playerOrder) {
    const order = roundRobin(eligibleBots(map, player, los), rng);
    const chosen: SpawnPoint[] = [];
    for (const s of order) {
      if (chosen.every((c) => horizontalDistance(s, c) >= SPAWN_RULES.minBotSpacing)) {
        chosen.push(s);
      }
      if (chosen.length === botCount) return ok({ player, bots: chosen });
    }
  }
  return err('insufficient-spawns');
}
