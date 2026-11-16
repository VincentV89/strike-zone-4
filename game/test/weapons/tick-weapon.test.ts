import { describe, expect, it } from 'vitest';
import { PLAYER_ID, ZERO, angleBetween, createRng, vec3, type WeaponId } from '@sz/kernel';
import {
  BOT_LOADOUT,
  PLAYER_LOADOUT,
  WEAPON_TABLE,
  createInventory,
  requestReload,
  switchWeapon,
  tickWeapon,
  weaponView,
  type TriggerIntent,
  type WeaponTickContext,
} from '@sz/weapons';
import { createCountingRng } from '../support/counting-rng';
import {
  BOT_1,
  FIRE,
  FORWARD,
  IDLE_INTENT,
  ctxAt,
  eventsOf,
  runTicks,
  shotTicks,
} from '../support/weapon-driver';

const { rifle, sniper } = WEAPON_TABLE;
const held = (): TriggerIntent => FIRE;
const idle = (): TriggerIntent => IDLE_INTENT;
const pressAt =
  (ticks: ReadonlyArray<number>) =>
  (t: number): TriggerIntent => ({ ...IDLE_INTENT, fire: ticks.includes(t) });

describe('story-weapon-loadout: fire modes (req-weapon-loadout AC1, AC2)', () => {
  it('AC1: the rifle fires every 6 ticks while held (10 shots per second)', () => {
    const log = runTicks(createInventory(), createRng(1), 0, 60, held);
    expect(shotTicks(log)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54]);
  });

  it('AC2: holding the pistol trigger gives one shot', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'pistol');
    expect(shotTicks(runTicks(inv, createRng(1), 0, 120, held))).toEqual([0]);
  });

  it('AC2: five separate pistol presses at least 9 ticks apart give five shots', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'pistol');
    const presses = [0, 10, 20, 30, 40];
    expect(shotTicks(runTicks(inv, createRng(1), 0, 60, pressAt(presses)))).toEqual(presses);
  });

  it('FD-WC-A7: a pistol press during cooldown is dropped, not buffered', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'pistol');
    expect(shotTicks(runTicks(inv, createRng(1), 0, 30, pressAt([0, 3, 9])))).toEqual([0, 9]);
  });

  it('the sniper bolt cycle is 78 ticks', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'sniper');
    const log = runTicks(inv, createRng(1), 0, 100, pressAt([0, 40, 76, 78, 90]));
    expect(shotTicks(log)).toEqual([0, 78]);
  });

  it('a shot request carries the shooter, weapon, origin, range and a unit direction in the cone', () => {
    const r = tickWeapon(createInventory(), FIRE, ctxAt(0), createRng(2));
    const shot = r.shots[0]!;
    expect(shot).toMatchObject({ shooter: PLAYER_ID, weapon: 'rifle', rangeM: 200 });
    expect(shot.origin).toEqual(ctxAt(0).origin);
    expect(shot.spread).toBe(rifle.spreadBase);
    expect(angleBetween(FORWARD, shot.dir)).toBeLessThanOrEqual(rifle.spreadBase + 1e-9);
  });
});

describe('story-weapon-loadout: scope (req-weapon-loadout AC3, BR-W-50..52)', () => {
  it('scope follows right mouse after the draw, and scoped spread is tighter', () => {
    const inv = createInventory();
    const scope: TriggerIntent = { ...IDLE_INTENT, scope: true };
    const first = tickWeapon(inv, { ...scope, switchTo: 'sniper' }, ctxAt(0), createRng(1));
    expect(first.events.map((e) => e.type)).toEqual(['WeaponSwitched']);
    const rng = createRng(1);
    for (let t = 1; t < 54; t++) {
      tickWeapon(inv, scope, ctxAt(t), rng);
      expect(inv.scoped, `tick ${t}`).toBe(false);
    }
    tickWeapon(inv, scope, ctxAt(54), rng); // drawSec 0.9 s
    const view = weaponView(inv, ctxAt(54).now, false);
    expect(view.scoped).toBe(true);
    expect(view.spread).toBe(sniper.spreadScoped);
    tickWeapon(inv, IDLE_INTENT, ctxAt(55), rng);
    expect(weaponView(inv, ctxAt(55).now, false).spread).toBe(sniper.spreadBase);
  });

  it('a sniper shot keeps the scope, and its bloom is gone within 0.5 s', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'sniper');
    const rng = createRng(4);
    const scoped: TriggerIntent = { ...IDLE_INTENT, scope: true };
    tickWeapon(inv, scoped, ctxAt(0), rng);
    const shot = tickWeapon(inv, { ...scoped, fire: true }, ctxAt(1), rng);
    expect(shot.shots[0]!.spread).toBe(sniper.spreadScoped);
    expect(inv.scoped).toBe(true);
    expect(inv.bloom).toBeCloseTo(sniper.bloomPerShot, 12);
    for (let t = 2; t <= 1 + 30; t++) tickWeapon(inv, scoped, ctxAt(t), rng);
    expect(inv.bloom).toBe(0);
  });

  it('a weapon without a scope ignores right mouse', () => {
    const inv = createInventory();
    tickWeapon(inv, { ...IDLE_INTENT, scope: true }, ctxAt(0), createRng(1));
    expect(inv.scoped).toBe(false);
  });
});

describe('story-switch-weapons (req-weapon-switch AC1, AC2)', () => {
  it('AC1: key 2 equips the pistol and the view shows its ammo', () => {
    const inv = createInventory();
    const r = tickWeapon(inv, { ...IDLE_INTENT, switchTo: 'pistol' }, ctxAt(0), createRng(1));
    expect(r.events).toEqual([
      { type: 'WeaponSwitched', actor: PLAYER_ID, from: 'rifle', to: 'pistol' },
    ]);
    const view = weaponView(inv, ctxAt(1).now, false);
    expect([view.equipped, view.magazine, view.reserve, view.status]).toEqual([
      'pistol',
      15,
      45,
      'drawing',
    ]);
  });

  it('AC2: no shot during the draw; held fire on the rifle fires on the tick the draw ends', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'pistol');
    tickWeapon(inv, { ...IDLE_INTENT, switchTo: 'rifle' }, ctxAt(0), createRng(1));
    const log = runTicks(inv, createRng(1), 1, 50, held);
    expect(shotTicks(log)[0]).toBe(36); // rifle drawSec 0.6 s
    expect(eventsOf(log).filter((e) => e.type === 'DryFire')).toEqual([]);
  });

  it('AC2: the pistol fires on a fresh press at the end of its draw', () => {
    const inv = createInventory();
    tickWeapon(inv, { ...IDLE_INTENT, switchTo: 'pistol' }, ctxAt(0), createRng(1));
    const log = runTicks(inv, createRng(1), 1, 30, pressAt([5, 12, 21]));
    expect(shotTicks(log)).toEqual([21]); // pistol drawSec 0.35 s = 21 ticks
  });

  it('BR-W-24: a switch and a fire in the same tick give no shot', () => {
    const inv = createInventory();
    const r = tickWeapon(inv, { ...FIRE, switchTo: 'pistol' }, ctxAt(0), createRng(1));
    expect(r.shots).toEqual([]);
  });

  it('BR-W-12: switching away and back keeps the sniper bolt cooldown and its ammo', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'sniper');
    const rng = createRng(1);
    tickWeapon(inv, FIRE, ctxAt(0), rng);
    tickWeapon(inv, { ...IDLE_INTENT, switchTo: 'pistol' }, ctxAt(1), rng);
    tickWeapon(inv, { ...IDLE_INTENT, switchTo: 'sniper' }, ctxAt(2), rng);
    const log = runTicks(inv, rng, 3, 100, (t) => ({ ...IDLE_INTENT, fire: t % 2 === 0 }));
    expect(shotTicks(log)[0]).toBe(78);
    expect(inv.slots[2]!.magazine).toBe(3);
  });
});

describe('story-ammo-reload (req-ammo-reload AC1..AC4)', () => {
  it('AC1: ten shots leave 20 in the rifle magazine', () => {
    const inv = createInventory();
    runTicks(inv, createRng(1), 0, 60, held);
    expect(weaponView(inv, 1, false).magazine).toBe(20);
  });

  it('AC2: reload from 20 / 90 gives 30 / 80, moving ammo only at completion', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 20;
    const rng = createRng(1);
    const start = tickWeapon(inv, { ...IDLE_INTENT, reload: true }, ctxAt(0), rng);
    expect(start.events).toEqual([
      { type: 'ReloadStarted', actor: PLAYER_ID, weapon: 'rifle', durationSec: 2.5 },
    ]);
    const log = runTicks(inv, rng, 1, 150, idle);
    expect(eventsOf(log)).toEqual([]);
    expect([inv.slots[0]!.magazine, inv.slots[0]!.reserve]).toEqual([20, 90]);
    const done = tickWeapon(inv, IDLE_INTENT, ctxAt(150), rng);
    expect(done.events).toEqual([
      { type: 'ReloadDone', actor: PLAYER_ID, weapon: 'rifle', magazine: 30, reserve: 80 },
    ]);
  });

  it('a full magazine held empty: one DryFire, auto reload, and firing resumes on the done tick', () => {
    const inv = createInventory();
    const log = runTicks(inv, createRng(1), 0, 340, held);
    const ticks = shotTicks(log);
    expect(ticks.slice(0, 30)).toEqual(Array.from({ length: 30 }, (_, i) => i * 6));
    expect(eventsOf(log)).toEqual([
      { tick: 180, type: 'DryFire' },
      { tick: 180, type: 'ReloadStarted' },
      { tick: 330, type: 'ReloadDone' },
    ]);
    expect(ticks[30]).toBe(330);
    expect(weaponView(inv, ctxAt(340).now, false).reserve).toBe(60);
  });

  it('AC3: with no reserve, fire clicks once per press and R does nothing', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 0;
    inv.slots[0]!.reserve = 0;
    const rng = createRng(1);
    const log = runTicks(inv, rng, 0, 40, (t) => ({ ...IDLE_INTENT, fire: t < 20 || t >= 30 }));
    expect(eventsOf(log)).toEqual([
      { tick: 0, type: 'DryFire' },
      { tick: 30, type: 'DryFire' },
    ]);
    expect(requestReload(inv, ctxAt(41).now)).toBe(false);
    expect(tickWeapon(inv, { ...IDLE_INTENT, reload: true }, ctxAt(42), rng).events).toEqual([]);
  });

  it('AC4: switching mid-reload moves no ammo; fire during the draw is ignored', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 20;
    const rng = createRng(1);
    tickWeapon(inv, { ...IDLE_INTENT, reload: true }, ctxAt(60), rng);
    const sw = tickWeapon(inv, { ...IDLE_INTENT, switchTo: 'pistol' }, ctxAt(120), rng);
    expect(sw.events.map((e) => e.type)).toEqual(['WeaponSwitched']);
    expect([inv.slots[0]!.magazine, inv.slots[0]!.reserve]).toEqual([20, 90]);
    const log = runTicks(inv, rng, 121, 160, pressAt([132, 141]));
    expect(eventsOf(log)).toEqual([]);
    expect(shotTicks(log)).toEqual([141]);
    expect([inv.slots[0]!.magazine, inv.slots[0]!.reserve]).toEqual([20, 90]);
  });

  it('BR-W-33: fire during a reload neither fires nor clicks', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 5;
    const rng = createRng(1);
    tickWeapon(inv, { ...IDLE_INTENT, reload: true }, ctxAt(0), rng);
    const log = runTicks(inv, rng, 1, 100, held);
    expect(shotTicks(log)).toEqual([]);
    expect(eventsOf(log)).toEqual([]);
  });

  it('S8: each bot reloads on its own; others keep firing', () => {
    const a = createInventory(BOT_LOADOUT);
    const b = createInventory(BOT_LOADOUT);
    a.slots[0]!.magazine = 0;
    const rng = createRng(1);
    const logA = runTicks(a, rng, 0, 60, held, () => ({ shooter: BOT_1 }));
    const logB = runTicks(b, rng, 0, 60, held);
    expect(shotTicks(logA)).toEqual([]);
    expect(eventsOf(logA).map((e) => e.type)).toEqual(['DryFire', 'ReloadStarted']);
    expect(logA[0]!.result.events[0]).toMatchObject({ actor: BOT_1 });
    expect(shotTicks(logB)).toHaveLength(10);
  });
});

describe('story-recoil-spread (req-recoil-spread AC1..AC3)', () => {
  it('AC1: fire input on every tick never exceeds one shot per interval', () => {
    for (const id of ['rifle', 'pistol', 'sniper'] as WeaponId[]) {
      const inv = createInventory(PLAYER_LOADOUT, id);
      const log = runTicks(inv, createRng(1), 0, 600, (t) => ({
        ...IDLE_INTENT,
        fire: t % 2 === 0,
      }));
      const ticks = shotTicks(log);
      const minGap = Math.min(...ticks.slice(1).map((t, i) => t - ticks[i]!));
      expect(minGap / 60 + 1e-9).toBeGreaterThanOrEqual(WEAPON_TABLE[id].fireIntervalSec);
      expect(log.every((l) => l.result.shots.length <= 1)).toBe(true);
    }
  });

  it('AC2: shot 10 of a held rifle burst has a wider spread than shot 1', () => {
    const log = runTicks(createInventory(), createRng(1), 0, 60, held);
    const spreads = log.flatMap((l) => l.result.shots.map((s) => s.spread));
    expect(spreads[0]).toBe(rifle.spreadBase);
    expect(spreads[9]).toBeCloseTo(rifle.spreadBase + 9 * rifle.bloomPerShot, 12);
    expect(spreads[9]!).toBeGreaterThan(spreads[0]!);
  });

  it('bloom is capped at bloomMax and recovers to 0 after the trigger is released', () => {
    const inv = createInventory();
    const rng = createRng(1);
    runTicks(inv, rng, 0, 175, held);
    expect(inv.bloom).toBeCloseTo(rifle.bloomMax, 12);
    runTicks(inv, rng, 175, 183, idle); // still within 0.15 s of the last shot (tick 174)
    expect(inv.bloom).toBeCloseTo(rifle.bloomMax, 12);
    runTicks(inv, rng, 183, 243, idle);
    expect(inv.bloom).toBe(0);
  });

  it('AC3: a moving shooter uses a wider cone than a still one', () => {
    const still = tickWeapon(createInventory(), FIRE, ctxAt(0), createRng(1));
    const moving = tickWeapon(createInventory(), FIRE, ctxAt(0, { moving: true }), createRng(1));
    expect(moving.shots[0]!.spread).toBeGreaterThan(still.shots[0]!.spread);
  });

  it('determinism: the same seed and script give the same directions', () => {
    const dirs = (seed: number) =>
      runTicks(createInventory(), createRng(seed), 0, 120, held).flatMap((l) =>
        l.result.shots.map((s) => s.dir),
      );
    expect(dirs(7)).toEqual(dirs(7));
    expect(dirs(7)).not.toEqual(dirs(8));
  });

  it('BR-W-70: each shot kicks up by kickPitch and sideways within kickYawMax', () => {
    const log = runTicks(createInventory(), createRng(3), 0, 120, held);
    for (const l of log) {
      if (l.result.shots.length === 0) {
        expect(l.result.viewKick).toEqual({ pitch: 0, yaw: 0 });
        continue;
      }
      expect(l.result.viewKick.pitch).toBe(rifle.kickPitch);
      expect(Math.abs(l.result.viewKick.yaw)).toBeLessThanOrEqual(rifle.kickYawMax);
    }
  });

  it('BR-W-83: exactly 3 Rng draws per shot and 0 on every other tick', () => {
    const rng = createCountingRng(9);
    const inv = createInventory();
    let shots = 0;
    for (let t = 0; t < 400; t++) {
      const before = rng.draws;
      const r = tickWeapon(inv, { ...IDLE_INTENT, fire: t % 50 < 40 }, ctxAt(t), rng);
      shots += r.shots.length;
      expect(rng.draws - before, `tick ${t}`).toBe(3 * r.shots.length);
    }
    expect(shots).toBeGreaterThan(30);
  });
});

describe('locked ticks (BR-W-15, BR-W-67, S9)', () => {
  it('never shoot, click, reload, switch or scope', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'sniper');
    inv.scoped = true;
    inv.slots[2]!.magazine = 0;
    const intent: TriggerIntent = { fire: true, reload: true, scope: true, switchTo: 'rifle' };
    const log = runTicks(
      inv,
      createRng(1),
      0,
      30,
      () => intent,
      () => ({ locked: true }),
    );
    expect(shotTicks(log)).toEqual([]);
    expect(eventsOf(log)).toEqual([]);
    expect(inv.scoped).toBe(false);
    expect(weaponView(inv, 1, false).equipped).toBe('sniper');
  });

  it('a reload in progress still completes', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 1;
    const rng = createRng(1);
    tickWeapon(inv, { ...IDLE_INTENT, reload: true }, ctxAt(0), rng);
    const log = runTicks(inv, rng, 1, 200, idle, () => ({ locked: true }));
    expect(eventsOf(log)).toEqual([{ tick: 150, type: 'ReloadDone' }]);
  });

  it('S9: fire held through the countdown: the rifle fires on the first live tick', () => {
    const inv = createInventory();
    const log = runTicks(inv, createRng(1), 0, 20, held, (t) => ({ locked: t < 10 }));
    expect(shotTicks(log)[0]).toBe(10);
  });

  it('S9: a semi weapon needs a fresh press after the countdown', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'pistol');
    const log = runTicks(
      inv,
      createRng(1),
      0,
      30,
      (t) => ({ ...IDLE_INTENT, fire: t < 15 || t >= 20 }),
      (t) => ({ locked: t < 10 }),
    );
    expect(shotTicks(log)).toEqual([20]);
  });
});

describe('outbox and idle ticks (BR-W-16, PERF-WC-05)', () => {
  it('events from direct command calls come out of the next tick, stamped with the holder', () => {
    const inv = createInventory(BOT_LOADOUT);
    inv.slots[0]!.magazine = 3;
    expect(requestReload(inv, 0)).toBe(true);
    const r = tickWeapon(inv, IDLE_INTENT, ctxAt(1, { shooter: BOT_1 }), createRng(1));
    expect(r.events).toEqual([
      { type: 'ReloadStarted', actor: BOT_1, weapon: 'rifle', durationSec: 2.5 },
    ]);
    expect(inv.outbox).toEqual([]);
    expect(switchWeapon(inv, 'next', 2)).toBe(false);
  });

  it('an idle tick returns one shared frozen result', () => {
    const inv = createInventory();
    const a = tickWeapon(inv, IDLE_INTENT, ctxAt(0), createRng(1));
    const b = tickWeapon(inv, IDLE_INTENT, ctxAt(1), createRng(1));
    expect(a).toBe(b);
    expect(Object.isFrozen(a) && Object.isFrozen(a.shots) && Object.isFrozen(a.events)).toBe(true);
  });
});

describe('hostile input (SEC-WC-01, SEC-WC-02, BR-W-65)', () => {
  function fresh() {
    const inv = createInventory();
    const before = JSON.stringify(inv);
    return { inv, before };
  }

  it.each([NaN, Infinity, -Infinity, '1' as unknown as number])(
    'now = %s is a no-op that changes nothing',
    (now) => {
      const { inv, before } = fresh();
      const r = tickWeapon(inv, FIRE, ctxAt(0, { now }), createRng(1));
      expect(r.shots).toEqual([]);
      expect(JSON.stringify(inv)).toBe(before);
    },
  );

  it('a null context or intent never fires', () => {
    const { inv } = fresh();
    const rng = createRng(1);
    expect(tickWeapon(inv, FIRE, null as unknown as WeaponTickContext, rng).shots).toEqual([]);
    expect(tickWeapon(inv, null as unknown as TriggerIntent, ctxAt(0), rng).shots).toEqual([]);
  });

  it.each([1, 'true', {}, null])('fire = %j does not count as pressed', (fire) => {
    const { inv } = fresh();
    const intent = { ...IDLE_INTENT, fire } as unknown as TriggerIntent;
    expect(tickWeapon(inv, intent, ctxAt(0), createRng(1)).shots).toEqual([]);
  });

  it.each([undefined, 0, 'no', null])('locked = %j is treated as locked', (locked) => {
    const { inv } = fresh();
    const ctx = { ...ctxAt(0), locked } as unknown as WeaponTickContext;
    expect(tickWeapon(inv, FIRE, ctx, createRng(1)).shots).toEqual([]);
  });

  it.each(['__proto__', 'knife', 7])('switchTo = %j is ignored', (switchTo) => {
    const { inv } = fresh();
    const intent = { ...IDLE_INTENT, switchTo } as unknown as TriggerIntent;
    expect(tickWeapon(inv, intent, ctxAt(0), createRng(1)).events).toEqual([]);
  });

  it.each([
    ['origin NaN', { origin: vec3(NaN, 0, 0) }],
    ['origin null', { origin: null }],
    ['aimDir Infinity', { aimDir: vec3(0, Infinity, 0) }],
    ['aimDir zero', { aimDir: ZERO }],
    ['aimDir tiny', { aimDir: vec3(1e-12, 0, 0) }],
  ])('%s: no shot and no ammo used', (_name, over) => {
    const { inv } = fresh();
    const rng = createCountingRng(1);
    const ctx = { ...ctxAt(0), ...over } as unknown as WeaponTickContext;
    expect(tickWeapon(inv, FIRE, ctx, rng).shots).toEqual([]);
    expect(inv.slots[0]!.magazine).toBe(30);
    expect(rng.draws).toBe(0);
  });

  it('a non-unit aimDir is normalised before sampling', () => {
    const r = tickWeapon(
      createInventory(),
      FIRE,
      ctxAt(0, { aimDir: vec3(0, 0, -5) }),
      createRng(1),
    );
    expect(angleBetween(FORWARD, r.shots[0]!.dir)).toBeLessThanOrEqual(rifle.spreadBase + 1e-9);
  });

  it.each([NaN, -1, Infinity])('dt = %s gives no recovery', (dt) => {
    const inv = createInventory();
    inv.bloom = 0.01;
    tickWeapon(inv, IDLE_INTENT, ctxAt(100, { dt }), createRng(1));
    expect(inv.bloom).toBe(0.01);
  });

  it('a corrupted inventory still returns outbox events and never throws', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 1;
    requestReload(inv, 0);
    inv.equipped = 42;
    const r = tickWeapon(inv, FIRE, ctxAt(1), createRng(1));
    expect(r.shots).toEqual([]);
    expect(r.events.map((e) => e.type)).toEqual(['ReloadStarted']);
    expect(tickWeapon(inv, FIRE, ctxAt(2), createRng(1)).events).toEqual([]);
  });
});

describe('ammo conservation over 1 000 seeded scripts (REL-WC-02, BR-W-41)', () => {
  it('magazine + reserve + rounds fired always equals the starting total, within bounds', () => {
    const script = createRng(2026);
    for (let run = 0; run < 1000; run++) {
      const inv = createInventory(PLAYER_LOADOUT);
      const rng = createRng(run);
      const fired = new Map<WeaponId, number>();
      for (let t = 0; t < 120; t++) {
        const roll = script.next();
        const intent: TriggerIntent = {
          fire: roll < 0.6,
          reload: roll > 0.95,
          scope: script.next() < 0.3,
          ...(roll > 0.9 && roll <= 0.95
            ? { switchTo: script.pick(['next', 'prev', 'pistol'])! }
            : {}),
        };
        const locked = script.next() < 0.05;
        const r = tickWeapon(inv, intent, ctxAt(t, { locked, moving: roll < 0.3 }), rng);
        for (const s of r.shots) fired.set(s.weapon, (fired.get(s.weapon) ?? 0) + 1);
      }
      for (const slot of inv.slots) {
        const stats = WEAPON_TABLE[slot.weapon];
        const total = slot.magazine + slot.reserve + (fired.get(slot.weapon) ?? 0);
        expect(total).toBe(stats.magazineSize + stats.reserveStart);
        expect(slot.magazine).toBeGreaterThanOrEqual(0);
        expect(slot.magazine).toBeLessThanOrEqual(stats.magazineSize);
        expect(slot.reserve).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(slot.magazine) && Number.isInteger(slot.reserve)).toBe(true);
      }
    }
  });
});
