// App glue over Node fakes (SD-AS-2, SD-AS-11, business-logic-model machine rows, PD-AS-15).
import { PLAYER_ID, type ActorId } from '@sz/kernel';
import { industrialWarehouse } from '@sz/maps';
import { NEUTRAL_INTENT } from '@sz/player';
import { describe, expect, it, vi } from 'vitest';
import * as sim from '@sz/sim';
import { createAppHarness, type AppHarness } from '../support/app-harness';

vi.mock('@sz/sim', async (importOriginal) => {
  const real = await importOriginal<typeof import('@sz/sim')>();
  return { ...real, createSim: vi.fn(real.createSim) };
});

const phase = (h: AppHarness) => h.app.round()?.state().phase;

describe('boot hand-off and the main menu', () => {
  it('stored settings reach the renderer, audio and round once at attach', () => {
    const h = createAppHarness();
    expect(h.renderer.settings).toEqual([{ preset: 'medium', fovDeg: 90, reducedMotion: false }]);
    expect(h.audio.volumes).toEqual([[0.8, 0.7]]);
    expect(h.ui.outlines).toBe(1);
    h.app.attach(h.booted);
    expect(h.renderer.settings).toHaveLength(1);
  });

  it('boot progress renders the loading screen; enter plays the click and unlocks audio', () => {
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    expect(h.ui.last()).toMatchObject({ id: 'loading' });
    h.send({ kind: 'enter' });
    expect(h.screen()).toBe('main-menu');
    expect(h.audio.played).toEqual(['ui-click']);
    expect(h.audio.counts.unlock).toBe(1); // BR-AS-13
  });

  it('ignored intents are counted, not logged (SD-AS-8)', () => {
    const h = createAppHarness();
    h.send({ kind: 'resume' });
    h.send({ kind: 'play-again' });
    expect(h.app.ignoredIntents()).toBe(2);
    expect(h.reported).toEqual([]);
  });

  it('setup and settings changes persist and fan out', () => {
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'change-setup', field: 'botCount', raw: '5' });
    expect(h.store.lastSetup().botCount).toBe(5);
    h.send({ kind: 'open', screen: 'settings' });
    h.send({ kind: 'change-setting', key: 'graphics', raw: 'high' });
    h.send({ kind: 'change-setting', key: 'masterVolume', raw: '50' });
    h.send({ kind: 'change-setting', key: 'masterVolume', raw: 'nope' });
    expect(h.store.settings()).toMatchObject({ graphics: 'high', masterVolume: 50 });
    expect(h.renderer.settings.at(-1)).toMatchObject({ preset: 'high' });
    expect(h.audio.volumes.at(-1)).toEqual([0.5, 0.7]);
    h.send({ kind: 'reset-settings' });
    h.send({ kind: 'confirm' });
    expect(h.store.settings().graphics).toBe('medium');
  });

  it('clear history keeps the record (FD-UI-8)', () => {
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'open', screen: 'history' });
    h.send({ kind: 'clear-history' });
    h.send({ kind: 'confirm' });
    expect(h.store.history()).toEqual([]);
  });
});

describe('match flow', () => {
  it('SD-AS-2: sim gets host.current() and the boot-built nav graph', () => {
    const h = createAppHarness();
    const spy = vi.mocked(sim.createSim);
    spy.mockClear();
    h.goLive();
    expect(spy).toHaveBeenCalledTimes(1);
    const deps = spy.mock.calls[0]?.[0];
    expect(deps?.physics).toBe(h.host.current());
    expect(deps?.nav).toBe(h.booted.navs.get('desert-compound'));
    expect(phase(h)).toBe('live');
    expect(h.screen()).toBe('hud');
    expect(h.renderer.counts.beginRound).toBe(1);
  });

  it('starting is deferred one frame so map loading paints', () => {
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'start-match' });
    expect(h.screen()).toBe('map-loading');
    expect(phase(h)).toBe('loading');
    h.frames(1);
    expect(h.screen()).toBe('capture');
    expect(phase(h)).toBe('ready');
  });

  it('a different map is loaded once into physics, renderer and radar; replays skip it', () => {
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'change-setup', field: 'mapId', raw: industrialWarehouse.id });
    const loads = h.host.loads.length;
    h.send({ kind: 'start-match' });
    h.frames(1);
    expect(h.host.loads.slice(loads)).toEqual([industrialWarehouse.id]);
    expect(h.renderer.loaded).toEqual([industrialWarehouse.id]);
    expect(h.ui.outlines).toBe(2);
    h.send({ kind: 'capture-and-start' });
    h.app.signal({ kind: 'lock-lost', reason: 'external' }); // still capture: ignored
    h.app.signal({ kind: 'lock-gained' });
    h.app.signal({ kind: 'lock-lost', reason: 'external' });
    h.send({ kind: 'restart' }); // countdown: pre-start, no confirmation
    h.frames(1);
    expect(h.host.loads.slice(loads)).toEqual([industrialWarehouse.id]);
    expect(h.screen()).toBe('capture');
  });

  it('capture and resume enable input before requesting the lock (e2e defect BT-1)', () => {
    // The real adapter drops requestLock while disabled (SEC-P-06). Found by the first real
    // browser run: menus-keyboard-start saw zero requestPointerLock calls.
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'start-match' });
    h.frames(1);
    h.send({ kind: 'capture-and-start' });
    expect(h.input.counts.requestLock).toBe(1);
    expect(h.input.honouredLocks).toBe(1);
    h.app.signal({ kind: 'lock-gained' });
    h.app.signal({ kind: 'lock-lost', reason: 'external' });
    expect(h.screen()).toBe('pause');
    expect(h.input.enabled.at(-1)).toBe(false);
    h.send({ kind: 'resume' });
    expect(h.input.honouredLocks).toBe(2);
  });

  it('the canvas click captures only on the capture prompt', () => {
    const h = createAppHarness();
    h.app.canvasClick();
    expect(h.input.counts.requestLock).toBe(0);
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'start-match' });
    h.frames(1);
    h.app.canvasClick();
    expect(h.input.counts.requestLock).toBe(1);
  });

  it('per frame: one poll, one drain-driven HUD update, one render, ≤ 5 ticks (PD-AS budget)', () => {
    const h = createAppHarness();
    h.goLive();
    const before = { poll: h.input.counts.poll, hud: h.ui.counts.updateHud };
    const tick = vi.spyOn(h.app.round()!, 'tick');
    h.frames(1, 250);
    expect(h.input.counts.poll - before.poll).toBe(1);
    expect(h.ui.counts.updateHud - before.hud).toBe(1);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(5);
    expect(h.audio.counts.setListener).toBeGreaterThan(0);
    expect(h.renderer.frames.at(-1)).toMatchObject({ paused: false, dtSec: 0.25 });
  });
});

describe('pause (story-pause-game)', () => {
  it('Esc pauses: sim, AI and timer freeze, SFX duck, input off; resume restores', () => {
    const h = createAppHarness();
    h.goLive();
    h.app.signal({ kind: 'lock-lost', reason: 'external' });
    expect(h.screen()).toBe('pause');
    expect(h.app.round()?.state().paused).toBe(true);
    expect(h.audio.ducks.at(-1)).toBe(true);
    expect(h.input.enabled.at(-1)).toBe(false);
    const t0 = h.app.round()?.state().timeLeftSec;
    const polls = h.input.counts.poll;
    h.frames(30);
    expect(h.app.round()?.state().timeLeftSec).toBe(t0);
    expect(h.input.counts.poll).toBe(polls);
    expect(h.renderer.frames.at(-1)?.paused).toBe(true);
    h.send({ kind: 'resume' });
    expect(h.input.counts.requestLock).toBeGreaterThanOrEqual(2);
    h.app.signal({ kind: 'lock-gained' });
    expect(h.screen()).toBe('hud');
    expect(h.app.round()?.state().paused).toBe(false);
    expect(h.audio.ducks.at(-1)).toBe(false);
  });

  it('pausing during the countdown restarts it from 3 on resume (BR-AS-22)', () => {
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'start-match' });
    h.frames(1);
    h.send({ kind: 'capture-and-start' });
    h.app.signal({ kind: 'lock-gained' });
    h.frames(10, 50);
    h.app.signal({ kind: 'lock-lost', reason: 'external' });
    expect(phase(h)).toBe('ready');
    h.send({ kind: 'resume' });
    h.app.signal({ kind: 'lock-gained' });
    expect(phase(h)).toBe('countdown');
    expect(h.app.round()?.state().countdown).toBe(3);
  });

  it('a combat abandon asks, then records a loss once (story-abandon-round)', () => {
    const h = createAppHarness();
    h.goLive();
    h.app.signal({ kind: 'lock-lost', reason: 'external' });
    h.send({ kind: 'quit-to-menu' });
    expect(h.store.history()).toHaveLength(0);
    h.send({ kind: 'confirm' });
    expect(h.screen()).toBe('main-menu');
    expect(h.store.history()).toHaveLength(1);
    expect(h.store.history()[0]?.outcome).toBe('abandoned');
    expect(h.store.record().roundsLost).toBe(1);
    expect(h.app.round()?.snapshot()).toBeUndefined();
  });

  it('a combat restart records the abandon and reaches the capture prompt', () => {
    const h = createAppHarness();
    h.goLive();
    h.app.signal({ kind: 'lock-lost', reason: 'external' });
    h.send({ kind: 'restart' });
    h.send({ kind: 'confirm' });
    expect(h.screen()).toBe('capture');
    expect(phase(h)).toBe('ready');
    expect(h.store.history()).toHaveLength(1);
    expect(h.renderer.counts.beginRound).toBe(2);
  });
});

describe('round end (story-play-again-reset)', () => {
  it('time expiry holds 0 s, releases the lock, records once, and Play again restarts', () => {
    const h = createAppHarness();
    h.app.signal({ kind: 'boot-ready' });
    h.send({ kind: 'enter' });
    h.send({ kind: 'change-setup', field: 'botCount', raw: '1' });
    h.send({ kind: 'open', screen: 'settings' });
    h.send({ kind: 'change-setting', key: 'roundDurationSec', raw: '120' });
    h.send({ kind: 'close' });
    h.send({ kind: 'start-match' });
    h.frames(1);
    h.host.currentFake()?.untouchable.add(PLAYER_ID);
    h.host.currentFake()?.untouchable.add('bot-1' as ActorId);
    h.send({ kind: 'capture-and-start' });
    h.app.signal({ kind: 'lock-gained' });
    const releases = h.input.counts.releaseLock;
    for (let i = 0; i < 3000 && h.screen() === 'hud'; i++) h.frames(1, 50);
    expect(h.screen()).toBe('end');
    expect(h.ui.last()).toMatchObject({ id: 'end', outcome: 'time-expired' });
    expect(h.input.counts.releaseLock).toBe(releases + 1);
    expect(h.store.history()).toHaveLength(1);
    expect(h.store.record().roundsLost).toBe(1);
    h.send({ kind: 'play-again' });
    expect(h.screen()).toBe('capture');
    expect(h.store.history()).toHaveLength(1);
  }, 60_000);
});

describe('context loss and fatal (FD-AS-2, FD-AS-3)', () => {
  it('context loss freezes the round without console output and restores to Pause', () => {
    const h = createAppHarness();
    h.goLive();
    h.app.signal({ kind: 'context-lost' });
    expect(h.screen()).toBe('context-lost');
    expect(h.app.round()?.state().paused).toBe(true);
    h.frames(3);
    expect(h.renderer.frames.at(-1)?.paused).toBe(true);
    h.app.signal({ kind: 'context-restored' });
    expect(h.screen()).toBe('pause');
    expect(h.reported).toEqual([]);
  });

  it('fatal: one report, loop stopped, lock released, store flushed, terminal screen, no record', () => {
    const h = createAppHarness();
    h.goLive();
    const flush = vi.spyOn(h.store, 'flush');
    h.app.fatal(new Error('boom'));
    h.app.fatal(new Error('again'));
    expect(h.reported).toEqual(['[strikezone] fatal: Error: boom']);
    expect(h.bootCalls.stopLoop).toBe(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(h.screen()).toBe('fatal');
    expect(h.ui.last()).toMatchObject({ id: 'boot-error', retryable: false });
    h.frames(5);
    h.send({ kind: 'resume' });
    expect(h.screen()).toBe('fatal');
    expect(h.store.history()).toHaveLength(0);
    expect(h.app.e2eStart(h.store.lastSetup(), 1).ok).toBe(false);
  });
});

describe('HUD containment', () => {
  it('the first HUD throw reports once, parks the HUD, and the next round retries it', () => {
    const h = createAppHarness();
    h.goLive();
    h.ui.hudThrows = true;
    h.frames(5);
    expect(h.reported).toEqual(['[strikezone] hud: Error: hud boom']);
    expect(h.ui.counts.showHudFault).toBe(1);
    const updates = h.ui.counts.updateHud;
    h.frames(5);
    expect(h.ui.counts.updateHud).toBe(updates);
    expect(h.screen()).toBe('hud');
    h.ui.hudThrows = false;
    h.app.signal({ kind: 'lock-lost', reason: 'external' });
    h.send({ kind: 'restart' });
    h.send({ kind: 'confirm' });
    h.frames(1);
    expect(h.ui.counts.resetHud).toBe(1);
    expect(h.ui.counts.updateHud).toBeGreaterThan(updates);
  });
});

describe('e2e hook path', () => {
  it('starts a seeded round without pointer lock and injects input for N ticks', () => {
    const h = createAppHarness();
    const res = h.app.e2eStart({ mapId: 'desert-compound', botCount: 1, difficulty: 'easy' }, 99);
    expect(res.ok).toBe(true);
    expect(h.screen()).toBe('hud');
    expect(phase(h)).toBe('countdown');
    expect(h.input.counts.requestLock).toBe(0);
    h.app.inject({ ...NEUTRAL_INTENT, move: { forward: 1, right: 0 } }, 3);
    h.frames(70, 50);
    expect(phase(h)).toBe('live');
    expect(h.app.frameStats()?.samples).toBeGreaterThan(0);
  });

  it('refuses before boot finished', () => {
    const h = createAppHarness({ attach: false });
    expect(h.app.e2eStart(h.store.lastSetup(), 1)).toEqual({ ok: false, error: 'not-ready' });
    h.app.frame(1);
    expect(h.app.round()).toBeUndefined();
    expect(h.app.frameStats()).toBeUndefined();
  });
});

describe('leaks (PD-AS-15, fakes)', () => {
  it('10 restarts and 10 pause/resume cycles keep the live character count', () => {
    const h = createAppHarness();
    h.goLive();
    const fake = h.host.currentFake()!;
    const ids = ['player', ...Array.from({ length: 20 }, (_, i) => `bot-${String(i + 1)}`)];
    const live = () => ids.filter((id) => fake.positionOf(id as never) !== undefined).length;
    const after1 = live();
    for (let i = 0; i < 10; i++) {
      h.app.signal({ kind: 'lock-lost', reason: 'external' });
      h.send({ kind: 'resume' });
      h.app.signal({ kind: 'lock-gained' });
      h.frames(2, 50);
    }
    for (let i = 0; i < 10; i++) {
      h.app.signal({ kind: 'lock-lost', reason: 'external' });
      h.send({ kind: 'restart' });
      h.send({ kind: 'confirm' });
      h.send({ kind: 'capture-and-start' });
      h.app.signal({ kind: 'lock-gained' });
      h.frames(62, 50);
    }
    expect(after1).toBe(6);
    expect(live()).toBe(after1);
    expect(h.host.loads).toHaveLength(1);
    expect(h.store.history()).toHaveLength(10);
  }, 60_000);
});
