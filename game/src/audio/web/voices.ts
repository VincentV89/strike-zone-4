/**
 * Live voice registry: the pure voice policy plus the Web Audio nodes of each
 * voice (BR-A-34, BR-A-35, BR-A-38). At most 3 nodes per voice (SEC-A-05).
 */
import { STEAL_FADE_SEC } from '@sz/audio/core/mixer';
import {
  createVoicePolicy,
  type AdmitRequest,
  type VoicePolicyOptions,
} from '@sz/audio/core/voices';
import type { AdmitDecision, VoiceRecord } from '@sz/audio/core/types';
import { disconnectAll } from './graph';
import { fadeOut } from './params';

export interface VoiceNodes {
  readonly src: AudioBufferSourceNode;
  readonly gain: GainNode;
  /** Every node of the voice, in creation order (source, gain, optional panner). */
  readonly nodes: ReadonlyArray<AudioNode>;
}

export interface Voices {
  admit(req: AdmitRequest, now: number): AdmitDecision;
  started(rec: Omit<VoiceRecord, 'id'>, nodes: VoiceNodes): number;
  /** Removes the record and disconnects the nodes. Idempotent. */
  release(id: number): void;
  /** Fades a stolen voice to 0 over 5 ms, then stops it; onended releases it. */
  steal(id: number, now: number): void;
}

export function createVoices(opts: VoicePolicyOptions): Voices {
  const policy = createVoicePolicy(opts);
  const live = new Map<number, VoiceNodes>();

  function release(id: number): void {
    policy.ended(id);
    const v = live.get(id);
    if (!v) return;
    live.delete(id);
    v.src.onended = null;
    disconnectAll(v.nodes);
  }

  return {
    admit: (req, now) => policy.admit(req, now),
    started(rec, nodes) {
      const id = policy.started(rec);
      live.set(id, nodes);
      return id;
    },
    release,
    steal(id, now) {
      const v = live.get(id);
      if (!v) return;
      fadeOut(v.gain.gain, now, STEAL_FADE_SEC);
      try {
        v.src.stop(now + STEAL_FADE_SEC);
      } catch {
        release(id); // BR-A-72: a detached source is discarded silently
      }
    },
  };
}
