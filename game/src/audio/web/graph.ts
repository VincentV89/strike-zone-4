/**
 * Fixed node graph and per-voice nodes (domain-entities-game-audio "Graph per voice",
 * BR-A-15, BR-A-46, SD-A-6).
 *
 *   voice → [panner] → sfx bus | ui bus → compressor → ceiling → destination
 */
import type { Vec3 } from '@sz/kernel';
import { COMPRESSOR_SETTINGS, PANNER_SETTINGS } from '@sz/audio/core/cues';
import { ceilingCurve } from '@sz/audio/core/mixer';
import type { Bus } from '@sz/audio/core/types';
import { setPannerPosition, setParam } from './params';

export interface AudioGraph {
  readonly buses: ReadonlyMap<Bus, GainNode>;
  readonly compressor: DynamicsCompressorNode;
  readonly ceiling: WaveShaperNode;
}

export function buildGraph(ctx: BaseAudioContext): AudioGraph {
  const sfx = ctx.createGain();
  const ui = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  setParam(compressor.threshold, COMPRESSOR_SETTINGS.thresholdDb);
  setParam(compressor.knee, COMPRESSOR_SETTINGS.knee);
  setParam(compressor.ratio, COMPRESSOR_SETTINGS.ratio);
  setParam(compressor.attack, COMPRESSOR_SETTINGS.attackSec);
  setParam(compressor.release, COMPRESSOR_SETTINGS.releaseSec);
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = ceilingCurve(1025);
  ceiling.oversample = 'none';
  sfx.connect(compressor);
  ui.connect(compressor);
  compressor.connect(ceiling);
  ceiling.connect(ctx.destination); // the only inbound connection to destination (SD-A-6)
  return {
    buses: new Map<Bus, GainNode>([
      ['sfx', sfx],
      ['ui', ui],
    ]),
    compressor,
    ceiling,
  };
}

export function createPanner(ctx: BaseAudioContext, at: Vec3): PannerNode {
  const panner = ctx.createPanner();
  panner.panningModel = PANNER_SETTINGS.panningModel;
  panner.distanceModel = PANNER_SETTINGS.distanceModel;
  panner.refDistance = PANNER_SETTINGS.refDistance;
  panner.rolloffFactor = PANNER_SETTINGS.rolloffFactor;
  panner.maxDistance = PANNER_SETTINGS.maxDistance;
  setPannerPosition(panner, at);
  return panner;
}

/** Disconnects every node; a detached-context throw is ignored (SD-A-7). */
export function disconnectAll(nodes: ReadonlyArray<AudioNode | undefined>): void {
  for (const node of nodes) {
    try {
      node?.disconnect();
    } catch {
      // Ignored on purpose: the node is being released.
    }
  }
}
