/**
 * All-or-nothing spawn (business-logic-model §4, BR-ML-41 to BR-ML-44, SEC-ML-34). Every
 * character is added and checked before any brain, inventory or motion record is created, so
 * a failed spawn leaves no characters and no actors behind.
 */
import { createBrain } from '@sz/ai';
import { BOT_START_VITALS, PLAYER_START_VITALS } from '@sz/combat';
import {
  PLAYER_ID,
  botIds,
  createRng,
  err,
  ok,
  vec3,
  type ActorId,
  type Result,
  type Vec3,
} from '@sz/kernel';
import type { SpawnPlan, SpawnPoint } from '@sz/maps';
import { createPlayerMotion, placePlayer, type PlayerMotion, type PlayerPose } from '@sz/player';
import { BOT_LOADOUT, PLAYER_LOADOUT, createInventory } from '@sz/weapons';
import type { BotActor } from './actors';
import { botWeaponSeed, brainSeed, playerWeaponSeed } from './seeds';
import type { SimState } from './state';

export type SpawnError = 'spawn-failed';

function fail(s: SimState): Result<void, SpawnError> {
  s.deps.physics.removeAllCharacters();
  return err('spawn-failed');
}

const copy = (p: Vec3): Vec3 => Object.freeze(vec3(p.x, p.y, p.z));

/** Adds every character; returns the bots in id order, or null on any failure. */
function addCharacters(
  s: SimState,
  plan: SpawnPlan,
  ids: ReadonlyArray<ActorId>,
): { motion: PlayerMotion; pose: PlayerPose; bots: { id: ActorId; sp: SpawnPoint }[] } | null {
  const { physics, characterSpec } = s.deps;
  const pose: PlayerPose = { position: copy(plan.player.pos), yaw: plan.player.yaw };
  if (!physics.addCharacter(PLAYER_ID, characterSpec, pose.position)) return null;
  const motion = createPlayerMotion(pose);
  if (!placePlayer(motion, physics, pose)) return null;
  const bots: { id: ActorId; sp: SpawnPoint }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const sp = plan.bots[i];
    if (id === undefined || sp === undefined) return null;
    if (!physics.addCharacter(id, characterSpec, sp.pos)) return null;
    bots.push({ id, sp });
  }
  return physics.stats().characters === ids.length + 1 ? { motion, pose, bots } : null;
}

function createBot(s: SimState, id: ActorId, index: number, sp: SpawnPoint): BotActor {
  const { setup, seed } = s.deps;
  const pos = copy(sp.pos);
  return {
    id,
    index,
    brain: createBrain(id, setup.difficulty, createRng(brainSeed(seed, index)), {
      yaw: sp.yaw,
      now: 0,
    }),
    inv: createInventory(BOT_LOADOUT),
    vitals: BOT_START_VITALS,
    alive: true,
    weaponRng: createRng(botWeaponSeed(seed, index)),
    spawn: pos,
    pos,
    prevPos: pos,
    yaw: sp.yaw,
    pitch: 0,
    stance: 'stand',
    vy: 0,
    grounded: false,
    intent: null,
    lastHitTick: -Infinity,
    diedAtTick: null,
  };
}

export function spawnActors(s: SimState, plan: SpawnPlan): Result<void, SpawnError> {
  const { setup, seed, nav } = s.deps;
  if (s.spawned || s.disposed) return err('spawn-failed');
  if (plan.bots.length !== setup.botCount) return err('spawn-failed'); // nothing added yet
  nav.clearReservations();
  s.board.clear();
  s.perception.reset();
  s.containment.resetRound();
  const ids = botIds(setup.botCount);
  const added = addCharacters(s, plan, ids);
  if (added === null) return fail(s);
  s.player = {
    id: PLAYER_ID,
    motion: added.motion,
    inv: createInventory(PLAYER_LOADOUT),
    vitals: PLAYER_START_VITALS,
    alive: true,
    weaponRng: createRng(playerWeaponSeed(seed)),
    spawn: added.pose,
    speed: 0,
    lastHitTick: -Infinity,
  };
  s.bots = added.bots.map(({ id, sp }, i) => createBot(s, id, i, sp));
  for (const b of s.bots) s.botsById.set(b.id, b);
  s.tick = 0;
  s.spawned = true;
  return ok(undefined);
}
