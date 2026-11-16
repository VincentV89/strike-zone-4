/**
 * Web Audio adapter: lifecycle, unlock, graph and playback
 * (domain-entities-game-audio "Lifecycle: AudioAdapter", business-logic-model-game-audio
 * W1, W4, W7, W10; security-design-game-audio SD-A-4, SD-A-7).
 *
 * No Web Audio object exists before unlock() (BR-A-01). unlock() never rejects
 * (BR-A-03). play() never throws and never queues (BR-A-10, BR-A-11).
 */
import { createRng, type Vec3 } from '@sz/kernel';
import { createPlaybackRandom } from '@sz/audio/core/variants';
import { synthesizeBank, type YieldFn } from '@sz/audio/core/bank';
import { CATEGORY_CAPS, MAX_VOICES, PLAYBACK_SEED } from '@sz/audio/core/cues';
import {
  AudioBootFailure,
  createWarnOnce,
  errorName,
  type AudioWarnReason,
} from '@sz/audio/core/errors';
import { acceptPose, basis, DEFAULT_POSE } from '@sz/audio/core/listener';
import {
  DEFAULT_VOLUMES,
  DUCK_TAU,
  VOLUME_TAU,
  ZERO_PIN_DELAY,
  busGains,
  sanitizeVolume,
} from '@sz/audio/core/mixer';
import { planPlay, type PlayPlan } from '@sz/audio/core/plan';
import type {
  AudioAdapter,
  AudioLifecycle,
  ListenerPose,
  PlayOptions,
  SoundBankPcm,
  SoundCue,
  Volumes,
} from '@sz/audio/core/types';
import { buildGraph, createPanner, disconnectAll, type AudioGraph } from './graph';
import { pinParam, rampParam, setListenerPose, setParam } from './params';
import { createVoices } from './voices';

export type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

export interface AudioGlobals {
  readonly AudioContext?: AudioContextCtor | undefined;
  readonly webkitAudioContext?: AudioContextCtor | undefined;
}

export interface AudioDeps {
  /** Read at unlock() time. Default: globalThis. */
  readonly globals?: () => AudioGlobals;
  readonly yieldFn?: YieldFn;
  readonly synthesize?: (yieldFn: YieldFn) => Promise<SoundBankPcm>;
  readonly warn?: (reason: AudioWarnReason) => void;
}

const defaultYield: YieldFn = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const defaultWarn = (reason: AudioWarnReason): void => {
  console.warn('[strikezone] audio unavailable:', reason);
};

const RESOLVED: Promise<void> = Promise.resolve();

/** SD-A-2: only a real `true` ducks; any other value cast in from outside un-ducks. */
const isExactlyTrue = (v: unknown): boolean => v === true;

export function createAudio(deps: AudioDeps = {}): AudioAdapter {
  const readGlobals = deps.globals ?? ((): AudioGlobals => globalThis);
  const yieldFn = deps.yieldFn ?? defaultYield;
  const synthesize = deps.synthesize ?? ((y: YieldFn) => synthesizeBank({ yieldFn: y }));
  const warnOnce = createWarnOnce(deps.warn ?? defaultWarn);
  const random = createRng(PLAYBACK_SEED);
  const pitch = createPlaybackRandom(random);
  const voices = createVoices({ maxVoices: MAX_VOICES, caps: CATEGORY_CAPS });

  let state: AudioLifecycle = 'idle';
  let bank: SoundBankPcm | undefined;
  let bankPromise: Promise<void> | undefined;
  let ctx: AudioContext | undefined;
  let graph: AudioGraph | undefined;
  let buffers: Map<SoundCue, ReadonlyArray<AudioBuffer>> | undefined;
  let unlockPromise: Promise<void> | undefined;
  let volumes: Volumes = DEFAULT_VOLUMES;
  let ducked = false;
  let pose: ListenerPose = DEFAULT_POSE;

  function mute(reason?: AudioWarnReason): void {
    state = 'muted';
    if (reason !== undefined) warnOnce(reason);
  }

  /** Creates one mono AudioBuffer per clip, then releases the PCM. */
  function materialise(): boolean {
    if (!ctx || !bank || buffers) return true;
    try {
      const made = new Map<SoundCue, ReadonlyArray<AudioBuffer>>();
      for (const [cue, clips] of bank.clips) {
        const list = clips.map((clip) => {
          const b = ctx?.createBuffer(1, clip.samples.length, clip.sampleRate);
          if (!b) throw new TypeError('no context');
          b.copyToChannel(clip.samples, 0);
          return b;
        });
        made.set(cue, list);
      }
      buffers = made;
      bank = undefined;
      return true;
    } catch (e: unknown) {
      mute(`buffer-failed:${errorName(e)}`);
      return false;
    }
  }

  /** BR-A-43 / BR-A-44: ramp (or set, when `tau` is 0) the bus gains. */
  function applyGains(tau: number): void {
    if (!ctx || !graph) return;
    const gains = busGains(volumes, ducked);
    const now = ctx.currentTime;
    for (const [bus, node] of graph.buses) {
      const target = gains[bus];
      if (tau === 0) setParam(node.gain, target);
      else rampParam(node.gain, target, now, tau);
      if (target === 0) pinParam(node.gain, 0, now + ZERO_PIN_DELAY);
    }
  }

  function applyListener(): void {
    if (ctx) setListenerPose(ctx.listener, pose.pos, basis(pose.yaw));
  }

  function createContext(): boolean {
    const g = readGlobals();
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (Ctor === undefined) {
      mute('no-audio-context');
      return false;
    }
    try {
      const created = new Ctor({ latencyHint: 'interactive' }); // inside the gesture (BR-A-02)
      graph = buildGraph(created);
      ctx = created;
    } catch (e: unknown) {
      ctx = undefined;
      graph = undefined;
      mute(`context-failed:${errorName(e)}`);
      return false;
    }
    applyGains(0);
    applyListener();
    ctx.addEventListener('statechange', () => {
      if (state === 'running' && ctx?.state !== 'running') state = 'muted'; // no log (alt-tab)
    });
    return true;
  }

  function onResumed(): void {
    if (ctx?.state !== 'running') {
      mute('context-not-running');
      return;
    }
    if (materialise()) state = 'running';
  }

  function unlock(): Promise<void> {
    if (state === 'running') return RESOLVED;
    if (unlockPromise) return unlockPromise;
    if (!ctx && !createContext()) return RESOLVED;
    const context = ctx;
    if (!context) return RESOLVED;
    state = 'unlocking';
    let resumed: Promise<void>;
    try {
      resumed = context.resume();
    } catch (e: unknown) {
      mute(`resume-refused:${errorName(e)}`);
      return RESOLVED;
    }
    const pending = resumed
      .then(onResumed, (e: unknown) => {
        mute(`resume-refused:${errorName(e)}`);
      })
      .finally(() => {
        unlockPromise = undefined;
      });
    unlockPromise = pending;
    return pending;
  }

  function prepareBank(): Promise<void> {
    if (bankPromise) return bankPromise;
    const run = async (): Promise<void> => {
      try {
        bank = await synthesize(yieldFn);
      } catch (cause: unknown) {
        bankPromise = undefined; // a retry re-runs the whole step (BR-A-70)
        throw new AudioBootFailure(cause);
      }
      if (state === 'idle') state = 'bank-ready';
      if (state === 'running') materialise();
    };
    bankPromise = run();
    return bankPromise;
  }

  function startVoice(context: AudioContext, plan: PlayPlan, buffer: AudioBuffer): void {
    const rate = pitch.rate(plan.def.pitchJitter);
    const now = context.currentTime;
    const nodes: AudioNode[] = [];
    let id: number | undefined;
    try {
      const src = context.createBufferSource();
      nodes.push(src);
      src.buffer = buffer;
      setParam(src.playbackRate, rate);
      const gain = context.createGain();
      nodes.push(gain);
      setParam(gain.gain, plan.gain);
      src.connect(gain);
      let tail: AudioNode = gain;
      if (plan.at !== undefined) {
        const panner = createPanner(context, plan.at);
        nodes.push(panner);
        gain.connect(panner);
        tail = panner;
      }
      const bus = graph?.buses.get(plan.def.bus);
      if (!bus) throw new TypeError('no bus');
      tail.connect(bus);
      const voiceId = voices.started(
        {
          cue: plan.def.id,
          key: plan.key,
          category: plan.def.category,
          priority: plan.priority,
          startedAt: now,
          endsAt: now + plan.def.durationSec / rate,
        },
        { src, gain, nodes },
      );
      id = voiceId;
      src.onended = () => {
        voices.release(voiceId);
      };
      src.start();
    } catch {
      // BR-A-72: one voice failed; discard it silently.
      if (id === undefined) disconnectAll(nodes);
      else voices.release(id);
    }
  }

  function play(cue: SoundCue, at?: Vec3, opts?: PlayOptions): void {
    if (state !== 'running' || !ctx || !buffers) return; // BR-A-12, nothing queued (BR-A-11)
    const plan = planPlay(cue, at, opts, pose);
    if (plan === null) return;
    const list = buffers.get(plan.def.id);
    if (!list || list.length === 0) return;
    const now = ctx.currentTime;
    const decision = voices.admit(
      {
        cue: plan.def.id,
        key: plan.key,
        category: plan.def.category,
        priority: plan.priority,
        retriggerSec: plan.def.retriggerSec,
      },
      now,
    );
    if (!decision.admit) return;
    if (decision.stealVoiceId !== undefined) voices.steal(decision.stealVoiceId, now);
    const buffer = list[pitch.variant(plan.def.id, list.length)];
    if (buffer) startVoice(ctx, plan, buffer);
  }

  return {
    prepareBank,
    unlock,
    play,
    setListener(pos, yaw) {
      pose = acceptPose(pose, pos, yaw);
      applyListener();
    },
    setVolumes(master, effects) {
      volumes = {
        master: sanitizeVolume(master, volumes.master),
        effects: sanitizeVolume(effects, volumes.effects),
      };
      applyGains(VOLUME_TAU);
    },
    duck(on) {
      ducked = isExactlyTrue(on);
      applyGains(DUCK_TAU);
    },
    get state() {
      return state;
    },
  };
}
