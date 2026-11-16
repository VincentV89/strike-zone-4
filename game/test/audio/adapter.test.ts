// Web Audio adapter against the hand-written fake (ADR-A-3).
// Covers the AudioAdapter lifecycle, BR-A-01 to BR-A-18, BR-A-35, BR-A-38, BR-A-43 to BR-A-47,
// BR-A-70 to BR-A-72 and SD-A-1 to SD-A-7.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vec3 } from '@sz/kernel';
import { createAudio, type AudioAdapter, type AudioDeps, type SoundCue } from '@sz/audio';
import { synthesizeBank } from '@sz/audio/core/bank';
import type { SoundBankPcm } from '@sz/audio/core/types';
import {
  FakeBufferSource,
  FakeGain,
  FakePanner,
  FakeWaveShaper,
  createFakeWebAudio,
  type FakeAudioContext,
  type FakeAudioOptions,
  type FakeWebAudio,
} from '../support/fake-web-audio';

const noYield = () => Promise.resolve();
let realBank: SoundBankPcm | undefined;
async function sharedBank(): Promise<SoundBankPcm> {
  realBank ??= await synthesizeBank({ yieldFn: noYield });
  return realBank;
}

interface Rig {
  readonly audio: AudioAdapter;
  readonly fake: FakeWebAudio;
  readonly warn: ReturnType<typeof vi.fn>;
}

function rig(options: FakeAudioOptions = {}, deps: Partial<AudioDeps> = {}): Rig {
  const fake = createFakeWebAudio(options);
  const warn = vi.fn();
  const audio = createAudio({
    globals: () => ({ AudioContext: fake.Ctor }),
    yieldFn: noYield,
    synthesize: () => sharedBank(),
    warn,
    ...deps,
  });
  return { audio, fake, warn };
}

async function running(options: FakeAudioOptions = {}): Promise<Rig & { ctx: FakeAudioContext }> {
  const r = rig(options);
  await r.audio.prepareBank();
  await r.audio.unlock();
  expect(r.audio.state).toBe('running');
  return { ...r, ctx: r.fake.ctx() };
}

function busGain(ctx: FakeAudioContext, index: 0 | 1): FakeGain {
  const gains = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain);
  const g = gains[index];
  if (!g) throw new Error('bus missing');
  return g;
}
const sfxBus = (ctx: FakeAudioContext) => busGain(ctx, 0);
const uiBus = (ctx: FakeAudioContext) => busGain(ctx, 1);

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled(); // req-no-console-errors
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('gesture gate (BR-A-01, BR-A-02, BR-A-08, SD-A-4)', () => {
  it('constructs nothing before unlock()', async () => {
    const { audio, fake } = rig();
    await audio.prepareBank();
    audio.setVolumes(0.5, 0.5);
    audio.setListener(vec3(1, 2, 3), 1);
    audio.duck(true);
    audio.play('ui-click');
    expect(fake.constructions).toBe(0);
    expect(audio.state).toBe('bank-ready');
  });

  it('creates the context synchronously inside unlock(), with latencyHint interactive', async () => {
    const { audio, fake } = rig();
    const p = audio.unlock();
    expect(fake.constructions).toBe(1);
    expect(fake.ctx().ctorOptions).toEqual({ latencyHint: 'interactive' });
    expect(audio.state).toBe('unlocking');
    await p;
    expect(audio.state).toBe('running');
  });

  it('BR-A-07: falls back to webkitAudioContext', async () => {
    const fake = createFakeWebAudio();
    const audio = createAudio({
      globals: () => ({ webkitAudioContext: fake.Ctor }),
      synthesize: () => sharedBank(),
    });
    await audio.unlock();
    expect(fake.constructions).toBe(1);
    expect(audio.state).toBe('running');
  });

  it('reads globalThis.AudioContext by default', async () => {
    const fake = createFakeWebAudio();
    vi.stubGlobal('AudioContext', fake.Ctor);
    const audio = createAudio({ synthesize: () => sharedBank() });
    await audio.unlock();
    expect(fake.constructions).toBe(1);
  });
});

describe('lifecycle', () => {
  it('idle → bank-ready → unlocking → running, materialising 23 mono 48 kHz buffers', async () => {
    const { audio, fake } = rig();
    expect(audio.state).toBe('idle');
    await audio.prepareBank();
    expect(audio.state).toBe('bank-ready');
    await audio.unlock();
    const ctx = fake.ctx();
    expect(ctx.buffers).toHaveLength(23);
    expect(ctx.buffers.every((b) => b.numberOfChannels === 1 && b.sampleRate === 48000)).toBe(true);
    expect(ctx.buffers.every((b) => b.copied?.length === b.length)).toBe(true);
  });

  it('unlock before the bank: running but silent until the bank arrives', async () => {
    const { audio, fake } = rig();
    await audio.unlock();
    expect(audio.state).toBe('running');
    audio.play('ui-click');
    expect(fake.ctx().sources()).toHaveLength(0);
    await audio.prepareBank();
    expect(audio.state).toBe('running');
    expect(fake.ctx().buffers).toHaveLength(23);
    audio.play('ui-click');
    expect(fake.ctx().liveSources()).toHaveLength(1);
  });

  it('BR-A-65: prepareBank is idempotent', () => {
    const synth = vi.fn(() => sharedBank());
    const { audio } = rig({}, { synthesize: synth });
    expect(audio.prepareBank()).toBe(audio.prepareBank());
    expect(synth).toHaveBeenCalledTimes(1);
  });

  it('BR-A-70: a synthesis failure rejects a BootError and a retry re-runs the step', async () => {
    const cause = new Error('boom');
    const synth = vi.fn<() => Promise<SoundBankPcm>>().mockRejectedValueOnce(cause);
    synth.mockImplementation(() => sharedBank());
    const { audio } = rig({}, { synthesize: synth });
    await expect(audio.prepareBank()).rejects.toMatchObject({
      step: 'audio',
      retryable: true,
      cause,
    });
    expect(audio.state).toBe('idle');
    await audio.prepareBank();
    expect(audio.state).toBe('bank-ready');
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it('the default synthesiser and yield work (real bank, real setTimeout)', async () => {
    const fake = createFakeWebAudio();
    const audio = createAudio({ globals: () => ({ AudioContext: fake.Ctor }) });
    await audio.prepareBank();
    expect(audio.state).toBe('bank-ready');
  });
});

describe('unlock failure containment (BR-A-03, BR-A-71, SD-A-7)', () => {
  it.each([
    ['no constructor', {}, 'no-audio-context', false],
    ['constructor throws', { constructorThrows: true }, 'context-failed:NotSupportedError', true],
    ['resume rejects', { resume: 'reject' }, 'resume-refused:NotAllowedError', true],
    ['resume throws', { resume: 'throw' }, 'resume-refused:InvalidStateError', true],
    ['context stays suspended', { resume: 'stay-suspended' }, 'context-not-running', true],
    ['buffers fail', { createBufferThrows: true }, 'buffer-failed:NotSupportedError', true],
  ] as const)('%s → muted, one warn, resolves', async (_label, options, reason, hasCtor) => {
    const fake = createFakeWebAudio(options);
    const warn = vi.fn();
    const audio = createAudio({
      globals: () => (hasCtor ? { AudioContext: fake.Ctor } : {}),
      synthesize: () => sharedBank(),
      warn,
    });
    await audio.prepareBank();
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audio.state).toBe('muted');
    await audio.unlock();
    await audio.unlock();
    expect(warn.mock.calls).toEqual([[reason]]);
    expect(fake.contexts.length).toBeLessThanOrEqual(1); // never a second context
    audio.play('ui-click'); // muted: a no-op, never throws
  });

  it('logs through console.warn by default, never console.error', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const audio = createAudio({ globals: () => ({}), synthesize: () => sharedBank() });
    await audio.unlock();
    expect(consoleWarn.mock.calls).toEqual([
      ['[strikezone] audio unavailable:', 'no-audio-context'],
    ]);
  });
});

describe('unlock idempotence (BR-A-04)', () => {
  it('returns the pending promise, then resolves at once when running', async () => {
    const { audio, fake } = rig();
    const a = audio.unlock();
    expect(audio.unlock()).toBe(a);
    await a;
    await audio.unlock();
    expect(fake.ctx().resumeCalls).toBe(1);
  });

  it('S8: a suspended context mutes, and the next unlock resumes the same context', async () => {
    const { audio, fake, ctx } = await running();
    ctx.setState('suspended');
    expect(audio.state).toBe('muted');
    audio.play('ui-click');
    expect(ctx.sources()).toHaveLength(0);
    await audio.unlock();
    expect(audio.state).toBe('running');
    expect(fake.constructions).toBe(1);
    expect(ctx.resumeCalls).toBe(2);
  });

  it('a state change while not running is ignored', async () => {
    const { audio, fake } = rig({ resume: 'stay-suspended' });
    await audio.unlock();
    fake.ctx().setState('suspended');
    expect(audio.state).toBe('muted');
  });
});

describe('graph (BR-A-46, SD-A-6)', () => {
  it('destination has exactly one inbound connection, from the ceiling WaveShaper', async () => {
    const { ctx } = await running();
    expect(ctx.destination.inputs).toHaveLength(1);
    const ceiling = ctx.destination.inputs[0];
    expect(ceiling).toBeInstanceOf(FakeWaveShaper);
    const shaper = ceiling as FakeWaveShaper;
    expect(shaper.oversample).toBe('none');
    expect(shaper.curve).toHaveLength(1025);
    expect(shaper.inputs.map((n) => n.kind)).toEqual(['compressor']);
    expect(ctx.paramCalls.filter((c) => c.param.startsWith('compressor'))).toEqual([
      { param: 'compressor.threshold', method: 'value', args: [-6] },
      { param: 'compressor.knee', method: 'value', args: [6] },
      { param: 'compressor.ratio', method: 'value', args: [12] },
      { param: 'compressor.attack', method: 'value', args: [0.003] },
      { param: 'compressor.release', method: 'value', args: [0.15] },
    ]);
    expect(sfxBus(ctx).outputs.map((n) => n.kind)).toEqual(['compressor']);
    expect(uiBus(ctx).outputs.map((n) => n.kind)).toEqual(['compressor']);
  });
});

describe('volumes and duck (BR-A-40 to BR-A-45)', () => {
  it('BR-A-44: values set before unlock are applied when the graph is built', async () => {
    const { audio, fake } = rig();
    audio.setVolumes(0.5, 0.8);
    audio.duck(true);
    await audio.unlock();
    const ctx = fake.ctx();
    expect(sfxBus(ctx).gain.value).toBeCloseTo(0.25 * 0.64 * 0.3, 12);
    expect(uiBus(ctx).gain.value).toBeCloseTo(0.25, 12);
  });

  it('BR-A-43: ramps with tau 0.015 and pins exact zero after 0.1 s', async () => {
    const { audio, ctx } = await running();
    ctx.currentTime = 2;
    ctx.paramCalls.length = 0;
    audio.setVolumes(0, 1);
    expect(ctx.paramCalls).toEqual([
      { param: sfxBus(ctx).gain.name, method: 'setTargetAtTime', args: [0, 2, 0.015] },
      { param: sfxBus(ctx).gain.name, method: 'setValueAtTime', args: [0, 2.1] },
      { param: uiBus(ctx).gain.name, method: 'setTargetAtTime', args: [0, 2, 0.015] },
      { param: uiBus(ctx).gain.name, method: 'setValueAtTime', args: [0, 2.1] },
    ]);
  });

  it('S5: effects 0 silences sfx and leaves the ui bus at full level', async () => {
    const { audio, ctx } = await running();
    audio.setVolumes(1, 0);
    expect(sfxBus(ctx).gain.value).toBe(0);
    expect(uiBus(ctx).gain.value).toBe(1);
  });

  it('BR-A-45: duck uses tau 0.08 and only touches the sfx level', async () => {
    const { audio, ctx } = await running();
    ctx.paramCalls.length = 0;
    audio.duck(true);
    expect(ctx.paramCalls.map((c) => c.args)).toEqual([
      [0.3, 0, 0.08],
      [1, 0, 0.08],
    ]);
    audio.duck('yes' as unknown as boolean);
    expect(sfxBus(ctx).gain.value).toBe(1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined, {}, 1n])(
    'SD-A-2: setVolumes(%s, …) keeps the previous value and never throws',
    async (bad) => {
      const { audio, ctx } = await running();
      audio.setVolumes(0.5, 0.5);
      audio.setVolumes(bad as number, bad as number);
      expect(uiBus(ctx).gain.value).toBeCloseTo(0.25, 12);
      expect(sfxBus(ctx).gain.value).toBeCloseTo(0.0625, 12);
    },
  );
});

describe('listener (BR-A-16 to BR-A-18)', () => {
  it('writes position and the kernel basis to the AudioListener params', async () => {
    const { audio, ctx } = await running();
    ctx.paramCalls.length = 0;
    audio.setListener(vec3(1, 2, 3), Math.PI / 2);
    const byName = Object.fromEntries(ctx.paramCalls.map((c) => [c.param, c.args[0]]));
    expect(byName['listener.positionX']).toBe(1);
    expect(byName['listener.positionZ']).toBe(3);
    expect(byName['listener.forwardX']).toBeCloseTo(-1, 12);
    expect(byName['listener.forwardZ']).toBeCloseTo(0, 12);
    expect(byName['listener.upY']).toBe(1);
  });

  it('ignores a non-finite pose', async () => {
    const { audio, ctx } = await running();
    audio.setListener(vec3(1, 2, 3), 0);
    ctx.paramCalls.length = 0;
    audio.setListener(vec3(Number.NaN, 0, 0), 0);
    audio.setListener(vec3(0, 0, 0), Number.POSITIVE_INFINITY);
    expect(ctx.paramCalls.map((c) => c.args[0]).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('BR-A-18: uses setPosition / setOrientation when AudioParams are missing', async () => {
    const { audio, ctx } = await running({ legacyParams: true });
    audio.setListener(vec3(4, 5, 6), 0);
    expect(ctx.listener.legacyPosition).toEqual([4, 5, 6]);
    expect(ctx.listener.legacyOrientation?.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
      -0, 0, -1, 0, 1, 0,
    ]);
    audio.play('fire-rifle', vec3(10, 5, 6));
    const panner = ctx.nodes.find((n): n is FakePanner => n instanceof FakePanner);
    expect(panner?.legacyPosition).toEqual([10, 5, 6]);
  });
});

describe('play (BR-A-10 to BR-A-15, BR-A-47)', () => {
  it('a centred voice: source → gain → bus, started once', async () => {
    const { audio, ctx } = await running();
    audio.play('ui-click');
    const [src] = ctx.liveSources();
    expect(src).toBeDefined();
    const s = src as FakeBufferSource;
    expect(s.buffer?.length).toBe(2400);
    const gain = s.outputs[0] as FakeGain;
    expect(gain.gain.value).toBeCloseTo(Math.pow(10, -12 / 20), 12);
    expect(gain.outputs).toEqual([uiBus(ctx)]);
  });

  it('S1/BR-A-06: the Click to enter sequence starts the click buffer', async () => {
    const { audio, fake } = rig();
    await audio.prepareBank();
    await audio.unlock().then(() => {
      audio.play('ui-click');
    });
    expect(fake.ctx().liveSources()).toHaveLength(1);
  });

  it('BR-A-15: a bot shot goes through an equal-power inverse panner at its origin', async () => {
    const { audio, ctx } = await running();
    audio.play('fire-rifle', vec3(-5, 1, 0));
    const panner = ctx.nodes.find((n): n is FakePanner => n instanceof FakePanner);
    expect(panner).toMatchObject({
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 2,
      rolloffFactor: 1,
      maxDistance: 90,
    });
    const pos = ctx.paramCalls.filter((c) => c.param.startsWith('panner')).map((c) => c.args[0]);
    expect(pos).toEqual([-5, 1, 0]);
    expect(panner?.outputs).toEqual([sfxBus(ctx)]);
  });

  it('BR-A-13: `at` on a non-spatial cue plays centred; BR-A-14: out of range is dropped', async () => {
    const { audio, ctx } = await running();
    audio.play('hit-head', vec3(5, 0, 0));
    audio.play('footstep', vec3(0, 0, 40));
    expect(ctx.nodes.some((n) => n instanceof FakePanner)).toBe(false);
    expect(ctx.liveSources()).toHaveLength(1);
  });

  it('BR-A-37: playbackRate stays within the cue jitter', async () => {
    const { audio, ctx } = await running();
    for (let i = 0; i < 6; i++) {
      ctx.currentTime += 1;
      audio.play('footstep');
    }
    for (const s of ctx.sources()) {
      expect(Math.abs(s.playbackRate.value - 1)).toBeLessThanOrEqual(0.06);
    }
  });

  it.each([
    ['__proto__', undefined, undefined],
    ['constructor', undefined, undefined],
    ['fire-rifle', vec3(Number.NaN, 0, 0), undefined],
    ['fire-rifle', null, undefined],
    ['fire-rifle', undefined, { gainScale: Number.POSITIVE_INFINITY }],
    ['fire-rifle', undefined, null],
  ])(
    'SD-A-3 / BR-A-10: play(%s, %o, %o) creates no nodes and never throws',
    async (cue, at, opts) => {
      const { audio, ctx } = await running();
      const before = ctx.nodes.length;
      expect(() => {
        audio.play(cue as SoundCue, at as never, opts as never);
      }).not.toThrow();
      if (opts === null) {
        expect(ctx.liveSources()).toHaveLength(1); // null opts means defaults
      } else {
        expect(ctx.nodes.length).toBe(before);
      }
    },
  );

  it('BR-A-11: nothing requested before unlock plays later', async () => {
    const { audio, fake } = rig();
    await audio.prepareBank();
    audio.play('victory');
    await audio.unlock();
    expect(fake.ctx().sources()).toHaveLength(0);
  });

  it('BR-A-33 / S12: two player-hurt requests in one frame play once', async () => {
    const { audio, ctx } = await running();
    audio.play('player-hurt');
    audio.play('player-hurt');
    expect(ctx.liveSources()).toHaveLength(1);
  });

  it('BR-A-72: a voice whose start() throws is discarded silently', async () => {
    const { audio, ctx, warn } = await running({ startThrows: true });
    expect(() => {
      audio.play('ui-click');
    }).not.toThrow();
    expect(ctx.connectedVoiceNodes()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('voices (BR-A-31, BR-A-35, BR-A-38, SEC-A-05)', () => {
  it('BR-A-35: the 11th bot shot steals the oldest with a 5 ms fade', async () => {
    const { audio, ctx } = await running();
    for (let i = 0; i < 10; i++) {
      ctx.currentTime = i * 0.01;
      audio.play('fire-rifle', vec3(5, 0, 0));
    }
    const oldest = ctx.sources()[0] as FakeBufferSource;
    const oldestGain = oldest.outputs[0] as FakeGain;
    const level = oldestGain.gain.value;
    ctx.currentTime = 0.2;
    ctx.paramCalls.length = 0;
    audio.play('fire-rifle', vec3(5, 0, 0));
    const calls = ctx.paramCalls.filter((c) => c.param === oldestGain.gain.name);
    expect(calls.map((c) => c.method)).toEqual(['cancel', 'setValueAtTime', 'linearRamp']);
    expect(calls[1]?.args).toEqual([level, 0.2]);
    expect(calls[2]?.args[0]).toBe(0);
    expect(calls[2]?.args[1]).toBeCloseTo(0.205, 12);
    expect(oldest.stoppedAt).toBeCloseTo(0.205, 12);
    oldest.end();
    expect(oldest.outputs).toEqual([]);
    expect(ctx.sources()).toHaveLength(11);
  });

  it('S10: a 1000-request burst stays within 24 voices and 3 nodes each, then returns to 0', async () => {
    const { audio, ctx } = await running();
    const cues: SoundCue[] = ['fire-rifle', 'footstep', 'hit-body', 'dry-fire', 'ui-click'];
    let maxLive = 0;
    for (let i = 0; i < 1000; i++) {
      ctx.advanceTo(i * 0.007);
      const cue = cues[i % cues.length] ?? 'ui-click';
      audio.play(cue, i % 2 === 0 ? vec3(i % 7, 0, 3) : undefined, { key: `k${String(i % 40)}` });
      ctx.advanceTo(i * 0.007 + 0.006); // stolen voices finish their 5 ms fade
      maxLive = Math.max(maxLive, ctx.liveSources().length);
      expect(ctx.liveSources().length).toBeLessThanOrEqual(24);
      expect(ctx.connectedVoiceNodes().length).toBeLessThanOrEqual(3 * 24);
    }
    expect(maxLive).toBeGreaterThanOrEqual(10); // the burst really saturated the caps
    ctx.advanceTo(10);
    expect(ctx.liveSources()).toEqual([]);
    expect(ctx.connectedVoiceNodes()).toEqual([]);
    expect(ctx.nodes.filter((n) => n.kind === 'destination')[0]?.inputs).toHaveLength(1);
  });

  it('a stolen voice whose stop() throws is released at once', async () => {
    const { audio, ctx } = await running();
    audio.play('victory');
    const first = ctx.sources()[0] as FakeBufferSource;
    first.stop = () => {
      throw new Error('detached');
    };
    ctx.currentTime = 1;
    audio.play('defeat'); // sting cap 1: steals the victory sting
    expect(first.outputs).toEqual([]);
    expect(ctx.liveSources()).toHaveLength(1);
  });
});
