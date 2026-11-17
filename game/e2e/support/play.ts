/**
 * Shared round drivers for gameplay specs (ADR-VS-3). Everything here goes through HookClient,
 * so every row that calls it is labelled `injected`.
 */
import type { Page } from '@playwright/test';
import { CHEST_HEIGHT_M, lookAt, lookDelta, nearest, wrapAngle } from './aim';
import type { E2eSetup, HookClient, PartialIntent } from './hook';
import type { SimSnapshot } from '@sz/sim';

/** Opens the app with the hook and waits for boot to attach the world. */
export async function bootWithHook(page: Page, hook: HookClient, path = '/?e2e=1'): Promise<void> {
  await page.goto(path);
  await hook.waitForBoot();
}

/** Starts a seeded match and waits for GO (live phase). */
export async function startLive(hook: HookClient, setup: E2eSetup, seed: number): Promise<void> {
  const r = await hook.startMatch(setup, seed);
  if (!r.ok) throw new Error(`startMatch failed: ${r.error ?? 'unknown'}`);
  // 180 countdown ticks; allow for a sim running well below real time under software WebGL.
  await hook.waitForPhase('live', 60_000);
}

/**
 * Injects `intent` for `ticks` sim ticks and waits until the sim has advanced that far (or the
 * round left the live phase). Waiting on sim ticks instead of wall time keeps the drivers correct
 * when software WebGL runs the sim well below 60 ticks per second, and stops a later inject from
 * overwriting one that has not been applied yet.
 */
export async function step(
  hook: HookClient,
  intent: PartialIntent,
  ticks: number,
  timeoutMs = 30_000,
): Promise<SimSnapshot | undefined> {
  const t0 = (await hook.snapshot())?.tick ?? 0;
  await hook.inject(intent, ticks);
  const until = Date.now() + timeoutMs;
  let snap = await hook.snapshot();
  while (snap !== undefined && snap.tick < t0 + ticks && Date.now() < until) {
    if ((await hook.round())?.phase !== 'live') break;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    snap = await hook.snapshot();
  }
  return snap;
}

/** Measures radians per injected pixel for yaw and pitch (sign included). */
export async function calibrateLook(
  hook: HookClient,
): Promise<{ readonly yaw: number; readonly pitch: number }> {
  const PX = 20;
  const before = await hook.snapshot();
  const mid = await step(hook, { look: { dx: PX, dy: 0 } }, 1);
  const after = await step(hook, { look: { dx: 0, dy: PX } }, 1);
  if (before === undefined || mid === undefined || after === undefined) {
    throw new Error('no snapshot while calibrating');
  }
  return {
    yaw: wrapAngle(mid.player.yaw - before.player.yaw) / PX,
    pitch: (after.player.pitch - mid.player.pitch) / PX,
  };
}

/** Engage range: inside it, a target the player can see gets rifle bursts. */
const ENGAGE_RANGE_M = 45;
/** Sim ticks between lure shots (sniper noise radius 60 m) while no target is visible. */
const LURE_EVERY_TICKS = 150;

/**
 * Hunts the nearest live bot until the round ends or `budgetMs` passes. While the bot is not
 * visible the player walks toward it (strafing around whatever blocks the way) and fires one
 * sniper shot every LURE_EVERY_TICKS, whose noise draws bots in (req-bot-investigate) without
 * spending the rifle magazine on walls. Once the snapshot marks the target as revealed and it is
 * inside ENGAGE_RANGE_M, the player stops, switches to the rifle and fires bursts, reloading
 * when empty.
 */
export async function fightUntilEnd(
  hook: HookClient,
  budgetMs: number,
): Promise<string | undefined> {
  const gain = await calibrateLook(hook);
  const until = Date.now() + budgetMs;
  let lastLure = -Infinity;
  let lastPos: { x: number; z: number } | undefined;
  let strafe = 0;
  let strafeDir: -1 | 1 = 1;
  while (Date.now() < until) {
    const view = await hook.round();
    if (view?.phase === 'ended') return view.outcome;
    const snap = await hook.snapshot();
    if (snap === undefined) return undefined;
    const me = snap.player;
    const target = nearest(me.pos, snap.bots);
    if (target !== undefined) {
      const eye = { ...me.pos, y: me.pos.y + me.eyeHeight };
      const aim = lookAt(eye, { ...target.pos, y: target.pos.y + CHEST_HEIGHT_M });
      const look = lookDelta(
        wrapAngle(aim.yaw - me.yaw),
        aim.pitch - me.pitch,
        gain.yaw,
        gain.pitch,
      );
      await step(hook, { look }, 1);
    }
    const w = me.weapon;
    const dist =
      target === undefined
        ? Infinity
        : Math.hypot(target.pos.x - me.pos.x, target.pos.z - me.pos.z);
    const engage = target !== undefined && target.revealed && dist < ENGAGE_RANGE_M;
    const wanted = engage ? 'rifle' : 'sniper';
    if (w.equipped !== wanted && w.owned.some((o) => o.weapon === wanted)) {
      await step(hook, { switchTo: wanted }, 1);
      await step(hook, {}, 40); // draw time
      continue;
    }
    if (w.magazine === 0) {
      await step(hook, { reload: true }, 1);
      await step(hook, {}, 60);
      continue;
    }
    if (engage) {
      await step(hook, { fire: true, firePressed: true }, 12);
    } else if (snap.tick - lastLure >= LURE_EVERY_TICKS) {
      lastLure = snap.tick;
      await step(hook, { fire: true, firePressed: true }, 1);
    } else {
      // Walk toward the target; if the last walk made under 0.3 m of progress, strafe for a while.
      const moved =
        lastPos === undefined ? Infinity : Math.hypot(me.pos.x - lastPos.x, me.pos.z - lastPos.z);
      if (strafe === 0 && moved < 0.3) {
        strafe = 3;
        strafeDir = strafeDir === 1 ? -1 : 1;
      }
      lastPos = { x: me.pos.x, z: me.pos.z };
      const right: -1 | 0 | 1 = strafe > 0 ? strafeDir : 0;
      if (strafe > 0) strafe -= 1;
      await step(hook, { move: { forward: strafe > 0 ? 0 : 1, right }, sprint: true }, 20);
    }
  }
  return (await hook.round())?.outcome;
}

/** Stands still and fires into the air until the round ends (bots hear it and engage). */
export async function standUntilEnd(
  hook: HookClient,
  budgetMs: number,
): Promise<string | undefined> {
  const until = Date.now() + budgetMs;
  await hook.inject({ look: { dx: 0, dy: -300 } }, 1);
  while (Date.now() < until) {
    const view = await hook.round();
    if (view?.phase === 'ended') return view.outcome;
    const snap = await hook.snapshot();
    const reload = snap?.player.weapon.magazine === 0;
    await hook.inject({ fire: !reload, firePressed: !reload, reload }, 30);
  }
  return (await hook.round())?.outcome;
}
