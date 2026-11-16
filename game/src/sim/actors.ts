/**
 * Actor records inside the World aggregate (domain-entities-match-loop "Actors", LC-ML-03).
 * Each bot owns its own vitals, inventory, brain and RNG streams (req-bot-independence).
 */
import type { BotBrain, BotIntent } from '@sz/ai';
import type { CombatActor, MutableActorLookup, Vitals } from '@sz/combat';
import { PLAYER_ID, type ActorId, type Rng, type Stance, type Vec3 } from '@sz/kernel';
import type { PlayerMotion, PlayerPose } from '@sz/player';
import type { WeaponInventory } from '@sz/weapons';
import { SIM_RULES } from './rules';

export interface PlayerActor {
  readonly id: ActorId;
  readonly motion: PlayerMotion;
  readonly inv: WeaponInventory;
  vitals: Vitals;
  alive: boolean;
  readonly weaponRng: Rng;
  /** Respawn pose if the player falls out of the world. */
  readonly spawn: PlayerPose;
  /** Horizontal speed from the last movement tick, for weapon spread. */
  speed: number;
  lastHitTick: number;
}

export interface BotActor {
  readonly id: ActorId;
  /** 0-based, used by the scheduler and seeds. */
  readonly index: number;
  readonly brain: BotBrain;
  readonly inv: WeaponInventory;
  vitals: Vitals;
  alive: boolean;
  readonly weaponRng: Rng;
  readonly spawn: Vec3;
  pos: Vec3;
  prevPos: Vec3;
  yaw: number;
  pitch: number;
  stance: Stance;
  /** Vertical velocity, sim-owned gravity (BR-ML-35). */
  vy: number;
  grounded: boolean;
  /** This tick's bot-ai intent; read by the bot's weapon tick. */
  intent: BotIntent | null;
  lastHitTick: number;
  diedAtTick: number | null;
}

export function botEye(b: Pick<BotActor, 'pos' | 'stance'>): Vec3 {
  const h = b.stance === 'crouch' ? SIM_RULES.botEyeCrouch : SIM_RULES.botEyeStand;
  return { x: b.pos.x, y: b.pos.y + h, z: b.pos.z };
}

export function botChest(b: Pick<BotActor, 'pos'>): Vec3 {
  return { x: b.pos.x, y: b.pos.y + SIM_RULES.botChestHeight, z: b.pos.z };
}

/**
 * The combat actor table over sim's records (SEC-ML-05: a Map, never a plain-object index).
 * Vitals written by combat land on the actor record.
 */
export function createActorLookup(
  player: () => PlayerActor | undefined,
  bots: ReadonlyMap<ActorId, BotActor>,
): MutableActorLookup {
  return {
    get(id): CombatActor | undefined {
      if (id === PLAYER_ID) {
        const p = player();
        return p ? { id: p.id, side: 'player', vitals: p.vitals } : undefined;
      }
      const b = bots.get(id);
      return b ? { id: b.id, side: 'bot', vitals: b.vitals } : undefined;
    },
    setVitals(id, vitals) {
      if (id === PLAYER_ID) {
        const p = player();
        if (p) p.vitals = vitals;
        return;
      }
      const b = bots.get(id);
      if (b) b.vitals = vitals;
    },
  };
}
