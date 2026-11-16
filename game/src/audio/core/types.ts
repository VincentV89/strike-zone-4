/**
 * game-audio public and internal types (domain-entities-game-audio).
 *
 * Core is framework-free (BR-A-50): no Web Audio types appear here.
 */
import type { Vec3 } from '@sz/kernel';

export type SoundCue =
  | 'fire-rifle'
  | 'fire-pistol'
  | 'fire-sniper'
  | 'dry-fire'
  | 'reload-start'
  | 'reload-end'
  | 'hit-body'
  | 'hit-head'
  | 'enemy-death'
  | 'player-hurt'
  | 'footstep'
  | 'victory'
  | 'defeat'
  | 'ui-click';

export type CueCategory = 'gunfire' | 'weapon' | 'feedback' | 'footstep' | 'sting' | 'ui';

/** sfx is scaled by master × effects (and ducked); ui is scaled by master only. */
export type Bus = 'sfx' | 'ui';

export interface CueDefinition {
  readonly id: SoundCue;
  readonly category: CueCategory;
  readonly bus: Bus;
  /** 1 (lowest) to 5 (highest). A spatial (bot) request uses priority - 1 (BR-A-32). */
  readonly priority: number;
  /** Per-voice gain before the bus, in dB, always <= 0. */
  readonly gainDb: number;
  readonly spatialAllowed: boolean;
  /** Spatial requests farther than this from the listener are dropped (BR-A-14). */
  readonly maxRangeM: number;
  readonly variants: number;
  readonly durationSec: number;
  /** Minimum gap between two voices with the same retrigger key. 0 = no guard. */
  readonly retriggerSec: number;
  /** Uniform playbackRate jitter, ± this fraction. */
  readonly pitchJitter: number;
}

export interface CueRequest {
  readonly cue: SoundCue;
  /** Present means the request is spatial. */
  readonly at?: Vec3;
  /** Linear multiplier on the cue gain, default 1. */
  readonly gainScale?: number;
  /** Retrigger key, default the cue id. Footsteps use 'footstep:<actorId>'. */
  readonly key?: string;
}

export interface PlayOptions {
  readonly gainScale?: number;
  readonly key?: string;
}

export interface PcmClip {
  readonly samples: Float32Array<ArrayBuffer>;
  readonly sampleRate: number;
}

export interface SoundBankPcm {
  readonly sampleRate: number;
  readonly clips: ReadonlyMap<SoundCue, ReadonlyArray<PcmClip>>;
  readonly totalSamples: number;
}

/** Slider positions, linear 0..1. app-shell divides the 0..100 settings by 100. */
export interface Volumes {
  readonly master: number;
  readonly effects: number;
}

export interface BusGains {
  readonly sfx: number;
  readonly ui: number;
}

export interface ListenerPose {
  readonly pos: Vec3;
  /** Kernel convention: yaw 0 faces -Z, positive yaw turns left. */
  readonly yaw: number;
}

export interface VoiceRecord {
  readonly id: number;
  readonly cue: SoundCue;
  readonly key: string;
  readonly category: CueCategory;
  readonly priority: number;
  /** AudioContext time in seconds. */
  readonly startedAt: number;
  readonly endsAt: number;
}

export type AdmitDecision =
  | { readonly admit: true; readonly stealVoiceId?: number }
  | { readonly admit: false; readonly reason: 'retrigger' | 'category-full' | 'pool-full' };

export type AudioLifecycle = 'idle' | 'bank-ready' | 'unlocking' | 'running' | 'muted';

/** Structurally matches app-shell's BootError { step, cause, retryable }. */
export interface AudioBootError {
  readonly step: 'audio';
  readonly cause: unknown;
  readonly retryable: true;
}

export interface AudioAdapter {
  /** Boot step. Synthesises PCM only; never creates an AudioContext (BR-A-01). */
  prepareBank(): Promise<void>;
  /** Call from a user-activation handler (Click to enter). Never rejects (BR-A-03). */
  unlock(): Promise<void>;
  play(cue: SoundCue, at?: Vec3, opts?: PlayOptions): void;
  setListener(pos: Vec3, yaw: number): void;
  setVolumes(master: number, effects: number): void;
  duck(on: boolean): void;
  readonly state: AudioLifecycle;
}
