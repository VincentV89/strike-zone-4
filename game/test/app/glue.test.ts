// Boot runner, rAF loop, reporter, storage handle, seeds and the e2e hook (SD-AS-4, -5, -10, -11).
import { describe, expect, it, vi } from 'vitest';
import type { BootStepId } from '@sz/app/core/boot-plan';
import {
  bootOrder,
  createBootRunner,
  isRetryable,
  isWebglFailure,
  type BootFailure,
  type StepRunner,
} from '@sz/app/dom/boot';
import { createLoop } from '@sz/app/dom/loop';
import { MAX_REPORTED_ERRORS, createReporter } from '@sz/app/dom/report';
import { createSeedSource } from '@sz/app/dom/seed';
import { safeLocalStorage } from '@sz/app/dom/storage';
import { HOOK_PROPERTY, installTestHook, type HookDeps } from '@sz/diagnostics';
import { desertCompound, industrialWarehouse } from '@sz/maps';
import { PresentationBootFailure } from '@sz/assets';
import { BootError } from '@sz/physics';
import { createFakeStorage } from '../support/fake-storage';

function runnerWith(run: StepRunner) {
  const warns: string[] = [];
  const failures: BootFailure[] = [];
  let ready = 0;
  const pcts: number[] = [];
  const r = createBootRunner({
    run,
    onPlan: (p) => pcts.push(p.maxPct),
    onReady: () => {
      ready++;
    },
    onFailed: (f) => failures.push(f),
    warn: (_m, label) => warns.push(label),
  });
  return { r, warns, failures, pcts, ready: () => ready };
}

describe('boot runner (BR-AS-01 to BR-AS-05)', () => {
  it('runs every step in order and reports ready once', async () => {
    const order: BootStepId[] = [];
    const t = runnerWith((id, onSub) => {
      order.push(id);
      if (id === 'graphics') {
        onSub();
        onSub();
        onSub();
      }
      return Promise.resolve();
    });
    await t.r.start();
    expect(order).toEqual(['physics', 'graphics', 'sound', 'maps']);
    expect(t.ready()).toBe(1);
    expect(t.pcts.at(-1)).toBe(100);
    expect([...t.pcts].sort((a, b) => a - b)).toEqual(t.pcts);
  });

  it('a rejection becomes a value, warns once, and Retry reruns only the failed step', async () => {
    const calls: BootStepId[] = [];
    let failSound = true;
    const t = runnerWith((id) => {
      calls.push(id);
      if (id === 'sound' && failSound) return Promise.reject(new Error('no bank'));
      return Promise.resolve();
    });
    await t.r.start();
    expect(t.failures).toHaveLength(1);
    expect(t.failures[0]).toMatchObject({ label: 'Sound', retryable: true });
    expect(t.failures[0]?.cause).toBeInstanceOf(Error);
    expect(t.warns).toEqual(['Sound']);
    expect(t.ready()).toBe(0);
    failSound = false;
    await t.r.retry();
    expect(calls).toEqual(['physics', 'graphics', 'sound', 'sound', 'maps']);
    expect(t.ready()).toBe(1);
  });

  it('non-retryable shapes and WebGL failures are recognised', () => {
    expect(isRetryable(new BootError('maps', null, false))).toBe(false);
    expect(isRetryable(new BootError('physics', null, true))).toBe(true);
    expect(isRetryable('weird')).toBe(true);
    expect(isRetryable({ retryable: 'no' })).toBe(true);
    expect(isWebglFailure(new PresentationBootFailure('webgl', null, false))).toBe(true);
    expect(isWebglFailure(new PresentationBootFailure('textures', null, true))).toBe(false);
    expect(isWebglFailure(null)).toBe(false);
  });

  it('start while running and retry with nothing failed are harmless', async () => {
    let release!: () => void;
    const t = runnerWith((id) =>
      id === 'physics'
        ? new Promise<void>((r) => {
            release = r;
          })
        : Promise.resolve(),
    );
    const first = t.r.start();
    await t.r.start();
    await t.r.retry();
    release();
    await first;
    expect(t.ready()).toBe(1);
  });

  it('loads the last-used map last (FD-AS-6)', () => {
    const maps = [desertCompound, industrialWarehouse];
    expect(bootOrder(maps, 'desert-compound').map((m) => m.id)).toEqual([
      industrialWarehouse.id,
      desertCompound.id,
    ]);
    expect(bootOrder(maps, industrialWarehouse.id).at(-1)).toBe(industrialWarehouse);
  });
});

describe('rAF loop (PD-AS-2)', () => {
  function fakeRaf() {
    const queue = new Map<number, (t: number) => void>();
    let next = 1;
    return {
      raf: (cb: (t: number) => void) => {
        queue.set(next, cb);
        return next++;
      },
      caf: (h: number) => {
        queue.delete(h);
      },
      tick(t: number) {
        const due = [...queue.values()];
        queue.clear();
        for (const cb of due) cb(t);
      },
      size: () => queue.size,
    };
  }

  it('keeps exactly one handle and ignores a second start', () => {
    const r = fakeRaf();
    const frame = vi.fn();
    const loop = createLoop({ ...r, frame, onFatal: vi.fn() });
    loop.start();
    loop.start();
    expect(r.size()).toBe(1);
    r.tick(16);
    r.tick(32);
    expect(frame).toHaveBeenCalledTimes(2);
    expect(loop.running).toBe(true);
    loop.stop();
    expect(r.size()).toBe(0);
    loop.start();
    expect(r.size()).toBe(0);
  });

  it('a throwing frame goes to onFatal once and never schedules another frame', () => {
    const r = fakeRaf();
    const onFatal = vi.fn();
    const loop = createLoop({
      ...r,
      frame: () => {
        throw new Error('x');
      },
      onFatal,
    });
    loop.start();
    r.tick(16);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(r.size()).toBe(0);
    expect(loop.running).toBe(false);
  });

  it('a frame that stops the loop is not rescheduled', () => {
    const r = fakeRaf();
    const loop = createLoop({
      ...r,
      frame: () => {
        loop.stop();
      },
      onFatal: vi.fn(),
    });
    loop.start();
    r.tick(16);
    expect(r.size()).toBe(0);
  });
});

describe('reporter (SEC-AS-30)', () => {
  it('formats, forwards once per call and keeps at most 100 messages', () => {
    const sink = vi.fn();
    const report = createReporter(sink);
    report('bot', 'bot-1: x');
    expect(sink).toHaveBeenCalledWith('[strikezone] bot: bot-1: x', 'bot-1: x');
    for (let i = 0; i < MAX_REPORTED_ERRORS + 5; i++) report('hud', i);
    const errors = report.errors();
    expect(errors).toHaveLength(MAX_REPORTED_ERRORS);
    expect(errors[0]).toBe('[strikezone] hud: 5');
    expect(Object.isFrozen(errors)).toBe(true);
  });

  it('the default sink is console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createReporter()('fatal', 'x');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('safeLocalStorage (SD-AS-4)', () => {
  it('returns the handle, or null when missing or throwing', () => {
    const s = createFakeStorage();
    expect(safeLocalStorage({ localStorage: s })).toBe(s);
    expect(safeLocalStorage({ localStorage: null })).toBeNull();
    expect(safeLocalStorage({})).toBeNull();
    const throwing = {
      get localStorage(): never {
        throw new Error('SecurityError');
      },
    };
    expect(safeLocalStorage(throwing)).toBeNull();
  });
});

describe('seed source (FD-AS-7)', () => {
  it('reads one uint32 per call', () => {
    let n = 0;
    const next = createSeedSource({
      getRandomValues: (a) => {
        a[0] = 0xffff_ffff - n++;
        return a;
      },
    });
    expect(next()).toBe(0xffff_ffff);
    expect(next()).toBe(0xffff_fffe);
    expect(Number.isInteger(createSeedSource()())).toBe(true);
  });
});

describe('e2e hook (SD-AS-10)', () => {
  const deps = (): HookDeps & { started: unknown[]; injected: unknown[] } => {
    const started: unknown[] = [];
    const injected: unknown[] = [];
    return {
      started,
      injected,
      snapshot: () => undefined,
      roundView: () => undefined,
      startMatch: (setup, seed) => {
        started.push([setup, seed]);
        return { ok: true, value: undefined };
      },
      inject: (i, t) => injected.push([i, t]),
      errors: () => ['e'],
      frameStats: () => ({ samples: 0, medianFps: 0, worstMs: 0, p95Ms: 0 }),
      ignoredIntents: () => 3,
    };
  };

  it('installs a frozen, non-writable, non-configurable, non-enumerable property once', () => {
    const target = {};
    const hook = installTestHook(target, deps());
    const desc = Object.getOwnPropertyDescriptor(target, HOOK_PROPERTY);
    expect(desc).toMatchObject({ writable: false, configurable: false, enumerable: false });
    expect(desc?.value).toBe(hook);
    expect(Object.isFrozen(hook)).toBe(true);
    expect(Object.keys(target)).toEqual([]);
    expect(() => installTestHook(target, deps())).toThrow(TypeError);
  });

  it('validates setup and seed before starting', () => {
    const d = deps();
    const hook = installTestHook({}, d);
    expect(hook.startMatch({ mapId: 'nope' }, 1).ok).toBe(false);
    expect(
      hook.startMatch({ mapId: 'desert-compound', botCount: 5, difficulty: 'easy' }, -1),
    ).toEqual({
      ok: false,
      error: 'invalid-seed',
    });
    expect(
      hook.startMatch({ mapId: 'desert-compound', botCount: 5, difficulty: 'easy' }, 7).ok,
    ).toBe(true);
    expect(d.started).toHaveLength(1);
  });

  it('inject rejects bad ticks and intents and passes a sanitised copy', () => {
    const d = deps();
    const hook = installTestHook({}, d);
    for (const t of [0, 3601, 1.5]) expect(hook.inject({}, t).ok).toBe(false);
    expect(hook.inject(null, 5).ok).toBe(false);
    expect(hook.inject({ fire: true, health: 1 }, 5).ok).toBe(true);
    expect(d.injected).toHaveLength(1);
    expect(d.injected[0]).toEqual([expect.not.objectContaining({ health: 1 }), 5]);
    expect(hook.errors()).toEqual(['e']);
    expect(hook.ignoredIntents()).toBe(3);
    expect(hook.snapshot()).toBeUndefined();
    expect(hook.round()).toBeUndefined();
    expect(hook.frameStats().samples).toBe(0);
  });
});
