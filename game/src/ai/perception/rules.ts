/** Perception tuning (business-rules-bot-ai BR-AI-10 to BR-AI-21). Tests assert invariants. */
import { degToRad } from '@sz/kernel';

export const PERCEPTION_RULES = Object.freeze({
  /** Horizontal field of view, total (BR-AI-10). */
  fovRad: degToRad(110),
  /** Vertical half-angle (FD-AI-A1). */
  vFovHalfRad: degToRad(60),
  /** Chest sample height as a fraction of eye height. */
  chestFraction: 0.62,
  /** A sighting keeps its start time across gaps up to this long (BR-AI-14). */
  sightGraceSec: 0.5,
  lastKnownTtlSec: 12,
  heardTtlSec: 8,
  damageTtlSec: 3,
  /** recentlyFired window for the radar (BR-AI-21). */
  recentShotSec: 2,
  /** Player-view range for the radar (BR-AI-21). */
  playerViewRangeM: 60,
  /** Decision stagger period, shared with the scheduler (6 ticks = 10 Hz). */
  staggerPeriod: 6,
  /** Spatial grid cell size, metres. */
  cellSize: 8,
  /** Noises kept per tick; later ones in the same tick are dropped (bounded queue). */
  maxQueuedNoises: 64,
  /** Largest noise radius honoured; bigger radii are clamped. */
  maxNoiseRadiusM: 100,
});
