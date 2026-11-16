import { describe, expect, it } from 'vitest';
import { PLAYER_ID, vec3, type DomainEvent } from '@sz/kernel';
import { DEFAULT_SETTINGS } from '@sz/persistence';
import { createEffects, reduceEffects } from '@sz/ui/core/effects';
import {
  HUD_LEAF_COUNT,
  LEAVES,
  MAX_HUD_PATCHES,
  NO_PATCHES,
  diffHud,
  hudElementIds,
} from '@sz/ui/core/hud-diff';
import {
  HIDDEN_HUD,
  createHudModeller,
  toHudViewModel,
  type HudInput,
} from '@sz/ui/core/hud-model';
import { radarOutlinePath, toRadarModel } from '@sz/ui/core/radar';
import { RADAR, bot, ctxOf, makeSnapshot, makeView } from '../../support/hud-driver';

function input(over: Partial<HudInput> = {}): HudInput {
  return {
    snap: makeSnapshot(),
    view: makeView(),
    effects: createEffects(),
    radar: RADAR,
    settings: DEFAULT_SETTINGS,
    tabHeld: false,
    ...over,
  };
}

describe('toHudViewModel (§6.1)', () => {
  it('is hidden before spawn and while paused or ended (BR-UI-20)', () => {
    expect(toHudViewModel(input({ snap: undefined }))).toBe(HIDDEN_HUD);
    expect(toHudViewModel(input()).visible).toBe(true);
    expect(toHudViewModel(input({ view: makeView({ paused: true }) })).visible).toBe(false);
    expect(toHudViewModel(input({ view: makeView({ phase: 'ended' }) })).visible).toBe(false);
    expect(
      toHudViewModel(input({ view: makeView({ phase: 'countdown', countdown: 2 }) })).visible,
    ).toBe(true);
  });

  it('maps vitals, ammo and cues from the same snapshot (BR-UI-22)', () => {
    const vm = toHudViewModel(input({ snap: makeSnapshot({ health: 24, armor: 7, magazine: 0 }) }));
    expect(vm.health).toBe(24);
    expect(vm.armor).toBe(7);
    expect(vm.healthLow).toBe(true);
    expect(vm.ammoText).toBe('0/90');
    expect(vm.ammoCue).toBe('R RELOAD');
    expect(toHudViewModel(input({ snap: makeSnapshot({ magazine: 0, reserve: 0 }) })).ammoCue).toBe(
      'NO AMMO',
    );
    const reloading = toHudViewModel(
      input({ snap: makeSnapshot({ magazine: 0, status: 'reloading', progress: 0.5 }) }),
    );
    expect(reloading.ammoCue).toBe('');
    expect(reloading.reloadProgress).toBe(0.5);
    expect(
      toHudViewModel(input({ snap: makeSnapshot({ health: 10, alive: false }) })).healthLow,
    ).toBe(false);
  });

  it('timer ceils, warns under 30 s live and shows GO for 0.4 s', () => {
    const vm = (v: Parameters<typeof makeView>[0]) => toHudViewModel(input({ view: makeView(v) }));
    expect(vm({ timeLeftSec: 180, durationSec: 180 }).timerText).toBe('3:00');
    expect(vm({ timeLeftSec: 180, durationSec: 180 }).countdown).toBe('GO');
    expect(vm({ timeLeftSec: 179.5, durationSec: 180 }).countdown).toBe('');
    expect(vm({ timeLeftSec: 29.9 }).timerWarn).toBe(true);
    expect(vm({ timeLeftSec: 29.9, phase: 'countdown', countdown: 1 }).timerWarn).toBe(false);
    expect(vm({ phase: 'countdown', countdown: 3 }).countdown).toBe('3');
  });

  it('crosshair gap follows spread and slots follow ownership', () => {
    expect(toHudViewModel(input({ snap: makeSnapshot({ spread: 0 }) })).crosshairGapPx).toBe(6);
    expect(toHudViewModel(input({ snap: makeSnapshot({ spread: 0.02 }) })).crosshairGapPx).toBe(18);
    expect(toHudViewModel(input({ snap: makeSnapshot({ spread: 1 }) })).crosshairGapPx).toBe(40);
    expect(toHudViewModel(input({ snap: makeSnapshot({ equipped: 'pistol' }) })).slots).toEqual([
      'owned',
      'equipped',
      'owned',
    ]);
  });

  it('scoped only for the sniper', () => {
    expect(
      toHudViewModel(input({ snap: makeSnapshot({ equipped: 'sniper', scoped: true }) })).scoped,
    ).toBe(true);
    expect(toHudViewModel(input({ snap: makeSnapshot({ scoped: true }) })).scoped).toBe(false);
  });

  it('scoreboard opens with Tab during countdown or live and lists bots without positions', () => {
    const snap = makeSnapshot({
      bots: [
        { id: bot(1), alive: true },
        { id: bot(2), alive: false },
      ],
    });
    const sb = toHudViewModel(input({ snap, tabHeld: true })).scoreboard;
    expect(sb.open).toBe(true);
    expect(sb.roster.slice(0, 3)).toEqual([
      { label: 'Bot-1', alive: true },
      { label: 'Bot-2', alive: false },
      null,
    ]);
    expect(sb.enemiesRemaining).toBe(1);
    expect(
      toHudViewModel(input({ snap, tabHeld: true, view: makeView({ phase: 'ready' }) })).scoreboard
        .open,
    ).toBe(false);
  });

  it('the result is deep-frozen', () => {
    const vm = toHudViewModel(input());
    expect(Object.isFrozen(vm)).toBe(true);
    expect(Object.isFrozen(vm.damageArcs)).toBe(true);
    expect(Object.isFrozen(vm.scoreboard.roster)).toBe(true);
  });
});

describe('radar model (§8, SD-UI-12, req-radar)', () => {
  const fx = createEffects();

  it('draws only alive and revealed bots, inside the radius', () => {
    const snap = makeSnapshot({
      bots: [
        { id: bot(1), pos: vec3(0, 0, -10), revealed: true },
        { id: bot(2), pos: vec3(0, 0, -10), revealed: false },
        { id: bot(3), pos: vec3(0, 0, -10), revealed: true, alive: false },
        { id: bot(4), pos: vec3(0, 0, -100), revealed: true },
      ],
    });
    const r = toRadarModel(snap, fx, RADAR);
    expect(r.diamonds[0]).toBe('translate(130 90)');
    expect(r.diamonds.slice(1, 4)).toEqual([null, null, null]);
    expect(r.diamonds).toHaveLength(20);
  });

  it('all bots unrevealed means zero diamonds', () => {
    const bots = Array.from({ length: 20 }, (_, i) => ({ id: bot(i + 1), pos: vec3(i, 0, -5) }));
    const r = toRadarModel(makeSnapshot({ bots }), fx, RADAR);
    expect(r.diamonds.every((d) => d === null)).toBe(true);
  });

  it('pings come only from the effects store and fade over 3 s', () => {
    const e = createEffects();
    const shot: DomainEvent = {
      type: 'ShotFired',
      shooter: bot(5),
      weapon: 'rifle',
      origin: vec3(10, 1, 0),
      dir: vec3(-1, 0, 0),
    };
    reduceEffects(e, [shot], ctxOf(makeSnapshot({ now: 1 })));
    const r = toRadarModel(makeSnapshot({ now: 2.5 }), e, RADAR);
    expect(r.pings[4]).toEqual({ transform: 'translate(170 130)', opacity: 0.5 });
  });

  it('the group transform and north marker follow the player pose', () => {
    const r = toRadarModel(makeSnapshot({ pos: vec3(3, 0, -4), yaw: Math.PI / 2 }), fx, RADAR);
    expect(r.groupTransform).toBe('translate(130 130) scale(4) rotate(90) translate(-3 4)');
    expect(r.northTransform).toBe('translate(252 130)');
  });
});

describe('createHudModeller (PD-UI-2)', () => {
  it('returns the same object while the key is unchanged (paused frames)', () => {
    const model = createHudModeller();
    const i = input();
    const a = model(i);
    const b = model({ ...i });
    expect(b).toBe(a);
    expect(model.hits()).toBe(1);
    const c = model({ ...i, tabHeld: true });
    expect(c).not.toBe(a);
    model.reset();
    expect(model({ ...i, tabHeld: true })).not.toBe(c);
  });
});

describe('diffHud (PD-UI-3 to PD-UI-6)', () => {
  it('has a fixed leaf table within the 128-patch ceiling', () => {
    expect(HUD_LEAF_COUNT).toBe(LEAVES.length);
    expect(HUD_LEAF_COUNT).toBeLessThanOrEqual(MAX_HUD_PATCHES);
    expect(hudElementIds()).toContain('diamond-19');
    expect(hudElementIds()).toContain('roster-19');
  });

  it('same model → the shared empty list; first write → every leaf', () => {
    const vm = toHudViewModel(input());
    expect(diffHud(vm, vm)).toBe(NO_PATCHES);
    expect(diffHud(undefined, vm)).toHaveLength(HUD_LEAF_COUNT);
  });

  it('an idle live frame writes nothing; a new sim second writes only the timer', () => {
    const fx = createEffects();
    const a = toHudViewModel(
      input({
        effects: fx,
        snap: makeSnapshot({ tick: 1 }),
        view: makeView({ timeLeftSec: 100.5 }),
      }),
    );
    const b = toHudViewModel(
      input({
        effects: fx,
        snap: makeSnapshot({ tick: 2 }),
        view: makeView({ timeLeftSec: 100.48 }),
      }),
    );
    expect(diffHud(a, b)).toEqual([]);
    const c = toHudViewModel(
      input({
        effects: fx,
        snap: makeSnapshot({ tick: 3 }),
        view: makeView({ timeLeftSec: 99.9 }),
      }),
    );
    expect(diffHud(b, c)).toEqual([{ el: 'timer', kind: 'text', value: '1:40' }]);
  });

  it('turning only writes the radar group and north marker plus visible items', () => {
    const bots = [{ id: bot(1), pos: vec3(0, 0, -10), revealed: true }];
    const a = toHudViewModel(input({ snap: makeSnapshot({ yaw: 0, bots }) }));
    const b = toHudViewModel(input({ snap: makeSnapshot({ yaw: 0.3, bots }) }));
    const els = diffHud(a, b).map((p) => p.el);
    expect(els.sort()).toEqual(['diamond-0', 'radar-group', 'radar-north']);
  });

  it('a worst-case frame stays within the ceiling', () => {
    const fx = createEffects();
    const events: DomainEvent[] = [];
    for (let i = 1; i <= 20; i++) {
      events.push(
        {
          type: 'ShotFired',
          shooter: bot(i),
          weapon: 'rifle',
          origin: vec3(i, 1, -i),
          dir: vec3(0, 0, 1),
        },
        { type: 'ActorKilled', killer: PLAYER_ID, victim: bot(i), weapon: 'rifle', headshot: true },
        {
          type: 'DamageTaken',
          victim: PLAYER_ID,
          from: bot(i),
          dir: vec3(Math.cos(i), 0, Math.sin(i)),
          amount: 1,
          healthAfter: 20,
          armorAfter: 0,
        },
      );
    }
    const bots = Array.from({ length: 20 }, (_, i) => ({
      id: bot(i + 1),
      pos: vec3(i, 0, -i - 2),
      revealed: true,
    }));
    reduceEffects(fx, events, ctxOf(makeSnapshot({ now: 1 })));
    const vm = toHudViewModel(
      input({ effects: fx, tabHeld: true, snap: makeSnapshot({ now: 1, health: 20, bots }) }),
    );
    const patches = diffHud(HIDDEN_HUD, vm);
    expect(patches.length).toBeLessThanOrEqual(MAX_HUD_PATCHES);
    expect(patches.length).toBeGreaterThan(60);
  });
});

describe('radarOutlinePath (PD-UI-10)', () => {
  it('builds one path from finite segments; null means no outline', () => {
    expect(
      radarOutlinePath([
        { x1: 0, z1: 0, x2: 1.23, z2: -4 },
        { x1: Number.NaN, z1: 0, x2: 1, z2: 1 },
        { x1: -2, z1: 3, x2: -2, z2: 5 },
      ]),
    ).toBe('M0 0L1.2 -4M-2 3L-2 5');
    expect(radarOutlinePath(null)).toBe('');
  });
});
