// Hand-written Web Audio fake for game-audio unit tests (ADR-A-3, SD-A-1).
// Implements only the surface the adapter uses. Every AudioParam write with a
// non-finite value throws TypeError, as real engines do, so a missing guard fails a test.
import type { AudioContextCtor } from '@sz/audio';

export type ResumeBehaviour = 'run' | 'reject' | 'stay-suspended' | 'throw';

export interface FakeAudioOptions {
  readonly resume?: ResumeBehaviour;
  /** Listener and panner without positionX/forwardX AudioParams (BR-A-18). */
  readonly legacyParams?: boolean;
  readonly constructorThrows?: boolean;
  readonly startThrows?: boolean;
  readonly createBufferThrows?: boolean;
}

export interface ParamCall {
  readonly param: string;
  readonly method: 'value' | 'setValueAtTime' | 'setTargetAtTime' | 'linearRamp' | 'cancel';
  readonly args: ReadonlyArray<number>;
}

function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

function assertFinite(...xs: ReadonlyArray<number>): void {
  for (const x of xs) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError('non-finite value');
  }
}

export class FakeAudioParam {
  private current: number;
  constructor(
    private readonly ctx: FakeAudioContext,
    readonly name: string,
    initial: number,
  ) {
    this.current = initial;
  }
  get value(): number {
    return this.current;
  }
  set value(v: number) {
    assertFinite(v);
    this.current = v;
    this.ctx.paramCalls.push({ param: this.name, method: 'value', args: [v] });
  }
  setValueAtTime(v: number, t: number): this {
    assertFinite(v, t);
    this.current = v;
    this.ctx.paramCalls.push({ param: this.name, method: 'setValueAtTime', args: [v, t] });
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number): this {
    assertFinite(v, t, tau);
    this.current = v;
    this.ctx.paramCalls.push({ param: this.name, method: 'setTargetAtTime', args: [v, t, tau] });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    assertFinite(v, t);
    this.current = v;
    this.ctx.paramCalls.push({ param: this.name, method: 'linearRamp', args: [v, t] });
    return this;
  }
  cancelScheduledValues(t: number): this {
    assertFinite(t);
    this.ctx.paramCalls.push({ param: this.name, method: 'cancel', args: [t] });
    return this;
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  readonly inputs: FakeNode[] = [];
  constructor(
    readonly ctx: FakeAudioContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }
  connect(dest: FakeNode): FakeNode {
    this.outputs.push(dest);
    dest.inputs.push(this);
    return dest;
  }
  disconnect(): void {
    for (const d of this.outputs) d.inputs.splice(d.inputs.indexOf(this), 1);
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeAudioParam;
  constructor(ctx: FakeAudioContext, label: string) {
    super(ctx, 'gain');
    this.gain = new FakeAudioParam(ctx, `${label}.gain`, 1);
  }
}

export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  readonly playbackRate: FakeAudioParam;
  onended: (() => void) | null = null;
  started = false;
  startedAt = 0;
  stoppedAt: number | undefined;
  ended = false;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'source');
    this.playbackRate = new FakeAudioParam(ctx, 'source.playbackRate', 1);
  }
  start(): void {
    if (this.ctx.options.startThrows === true) throw domError('InvalidStateError');
    this.started = true;
    this.startedAt = this.ctx.currentTime;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
  /** Test helper: the browser finished playing this buffer. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
  /** Context time at which the browser would fire `ended`. */
  endTime(): number {
    const natural =
      this.startedAt +
      (this.buffer ? this.buffer.length / this.buffer.sampleRate : 0) / this.playbackRate.value;
    return Math.min(natural, this.stoppedAt ?? Number.POSITIVE_INFINITY);
  }
}

export class FakePanner extends FakeNode {
  panningModel = 'HRTF';
  distanceModel = 'inverse';
  refDistance = 1;
  rolloffFactor = 1;
  maxDistance = 10000;
  legacyPosition: ReadonlyArray<number> | undefined;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'panner');
    if (ctx.options.legacyParams !== true) {
      Object.assign(this, {
        positionX: new FakeAudioParam(ctx, 'panner.positionX', 0),
        positionY: new FakeAudioParam(ctx, 'panner.positionY', 0),
        positionZ: new FakeAudioParam(ctx, 'panner.positionZ', 0),
      });
    }
  }
  setPosition(x: number, y: number, z: number): void {
    assertFinite(x, y, z);
    this.legacyPosition = [x, y, z];
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold: FakeAudioParam;
  readonly knee: FakeAudioParam;
  readonly ratio: FakeAudioParam;
  readonly attack: FakeAudioParam;
  readonly release: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'compressor');
    this.threshold = new FakeAudioParam(ctx, 'compressor.threshold', -24);
    this.knee = new FakeAudioParam(ctx, 'compressor.knee', 30);
    this.ratio = new FakeAudioParam(ctx, 'compressor.ratio', 12);
    this.attack = new FakeAudioParam(ctx, 'compressor.attack', 0.003);
    this.release = new FakeAudioParam(ctx, 'compressor.release', 0.25);
  }
}

export class FakeWaveShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = '2x';
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'waveshaper');
  }
}

export class FakeBuffer {
  copied: Float32Array | undefined;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  copyToChannel(source: Float32Array, channel: number): void {
    if (channel !== 0) throw new RangeError('mono only');
    this.copied = source;
  }
}

export class FakeListener {
  legacyPosition: ReadonlyArray<number> | undefined;
  legacyOrientation: ReadonlyArray<number> | undefined;
  constructor(ctx: FakeAudioContext) {
    if (ctx.options.legacyParams === true) return;
    const p = (name: string, v: number) => new FakeAudioParam(ctx, `listener.${name}`, v);
    Object.assign(this, {
      positionX: p('positionX', 0),
      positionY: p('positionY', 0),
      positionZ: p('positionZ', 0),
      forwardX: p('forwardX', 0),
      forwardY: p('forwardY', 0),
      forwardZ: p('forwardZ', -1),
      upX: p('upX', 0),
      upY: p('upY', 1),
      upZ: p('upZ', 0),
    });
  }
  setPosition(x: number, y: number, z: number): void {
    assertFinite(x, y, z);
    this.legacyPosition = [x, y, z];
  }
  setOrientation(...xs: number[]): void {
    assertFinite(...xs);
    this.legacyOrientation = xs;
  }
}

export class FakeAudioContext {
  state: 'suspended' | 'running' | 'interrupted' | 'closed' = 'suspended';
  currentTime = 0;
  readonly nodes: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  readonly paramCalls: ParamCall[] = [];
  readonly destination: FakeNode;
  readonly listener: FakeListener;
  resumeCalls = 0;
  private readonly stateListeners: (() => void)[] = [];

  constructor(
    readonly options: FakeAudioOptions,
    readonly ctorOptions: unknown,
  ) {
    this.destination = new FakeNode(this, 'destination');
    this.listener = new FakeListener(this);
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    switch (this.options.resume ?? 'run') {
      case 'run':
        this.state = 'running';
        return Promise.resolve();
      case 'reject':
        return Promise.reject(domError('NotAllowedError'));
      case 'stay-suspended':
        return Promise.resolve();
      case 'throw':
        throw domError('InvalidStateError');
    }
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.stateListeners.push(fn);
  }
  /** Test helper: the browser changed the context state (alt-tab, interruption). */
  setState(s: FakeAudioContext['state']): void {
    this.state = s;
    for (const fn of this.stateListeners) fn();
  }
  createGain(): FakeGain {
    return new FakeGain(this, `gain${String(this.nodes.length)}`);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createPanner(): FakePanner {
    return new FakePanner(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createWaveShaper(): FakeWaveShaper {
    return new FakeWaveShaper(this);
  }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    if (this.options.createBufferThrows === true) throw domError('NotSupportedError');
    const b = new FakeBuffer(channels, length, rate);
    this.buffers.push(b);
    return b;
  }

  /** Test helper: moves the clock and fires `ended` on every finished or stopped source. */
  advanceTo(t: number): void {
    this.currentTime = t;
    for (const src of this.sources()) if (src.started && src.endTime() <= t) src.end();
  }

  // ---- inspection helpers ----
  sources(): FakeBufferSource[] {
    return this.nodes.filter((n): n is FakeBufferSource => n instanceof FakeBufferSource);
  }
  /** Started sources whose nodes are still connected. */
  liveSources(): FakeBufferSource[] {
    return this.sources().filter((s) => s.started && s.outputs.length > 0);
  }
  /** Per-voice nodes still connected (fixed graph nodes excluded). */
  connectedVoiceNodes(): FakeNode[] {
    return this.nodes
      .filter((n) => ['source', 'panner'].includes(n.kind) || (n.kind === 'gain' && isVoiceGain(n)))
      .filter((n) => n.outputs.length > 0);
  }
}

function isVoiceGain(n: FakeNode): boolean {
  return n.inputs.some((i) => i.kind === 'source') || n.outputs.some((o) => o.kind === 'panner');
}

export interface FakeWebAudio {
  readonly Ctor: AudioContextCtor;
  readonly contexts: FakeAudioContext[];
  readonly constructions: number;
  /** The single context, or throws when there is none. */
  ctx(): FakeAudioContext;
}

export function createFakeWebAudio(options: FakeAudioOptions = {}): FakeWebAudio {
  const contexts: FakeAudioContext[] = [];
  let constructions = 0;
  function Ctor(this: unknown, ctorOptions?: unknown): FakeAudioContext {
    constructions++;
    if (options.constructorThrows === true) throw domError('NotSupportedError');
    const c = new FakeAudioContext(options, ctorOptions);
    contexts.push(c);
    return c;
  }
  return {
    Ctor: Ctor as unknown as AudioContextCtor,
    contexts,
    get constructions() {
      return constructions;
    },
    ctx() {
      const c = contexts[0];
      if (!c) throw new Error('no AudioContext was constructed');
      return c;
    },
  };
}
