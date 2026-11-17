import type { ActorId, Stance, Vec3, WeaponId } from '@sz/kernel';

/** Spawn pose in kernel types; match-loop maps a map-catalog SpawnPoint to it. */
export interface PlayerPose {
  readonly position: Vec3;
  readonly yaw: number;
}

/** Raw mouse movement in CSS pixels since the previous frame. */
export interface LookDelta {
  readonly dx: number;
  readonly dy: number;
}

/** -1, 0 or 1 per axis: forward = W − S, right = D − A. */
export interface MoveAxes {
  readonly forward: -1 | 0 | 1;
  readonly right: -1 | 0 | 1;
}

export type SwitchRequest = WeaponId | 'next' | 'prev' | null;

/** Produced by the input adapter once per frame (contract-player-intent). */
export interface PlayerInputIntent {
  readonly look: LookDelta;
  readonly move: MoveAxes;
  /** Held states. */
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly fire: boolean;
  readonly aim: boolean;
  /** Edges: true if pressed at least once since the previous poll. */
  readonly jump: boolean;
  readonly firePressed: boolean;
  readonly reload: boolean;
  /** Last switch request since the previous poll, or null. */
  readonly switchTo: SwitchRequest;
}

/** The movement subset stepMovement reads. */
export type MoveIntent = Pick<PlayerInputIntent, 'move' | 'sprint' | 'crouch' | 'jump'>;

/** Gates supplied by simulation; `move: false` during the countdown and after death (BR-P-26). */
export interface MovementLocks {
  readonly move: boolean;
}

export interface MovementOutcome {
  readonly grounded: boolean;
  /** Horizontal speed actually achieved this tick, m/s; weapons uses it for movement spread. */
  readonly speed: number;
  readonly footstep: 'walk' | 'sprint' | null;
  readonly landed: boolean;
  /** position.y fell below killY; match-loop respawns the player (BR-P-45). */
  readonly outOfWorld: boolean;
}

/** Edges carried over a frame that ran zero fixed ticks (BR-P-61). */
export interface EdgeCarry {
  readonly jump: boolean;
  readonly firePressed: boolean;
  readonly reload: boolean;
  readonly switchTo: SwitchRequest;
}

/** Read-only view copied into SimSnapshot.player by simulation. */
export interface PlayerMotionView {
  readonly id: ActorId;
  readonly position: Vec3;
  readonly prevPosition: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly stance: Stance;
  readonly eyeHeight: number;
  readonly grounded: boolean;
}

/** View kick from weapons-combat, applied by simulation after a shot (BR-P-15). */
export interface RecoilKick {
  readonly pitchRad: number;
  readonly yawRad: number;
}
