/**
 * Shared round drivers for gameplay specs (ADR-VS-3). Everything here goes through HookClient,
 * so every row that calls it is labelled `injected`.
 */
import type { Page } from '@playwright/test';
import { CHEST_HEIGHT_M, lookAt, lookDelta, nearest, wrapAngle } from './aim';
import type { E2eSetup, HookClient } from './hook';

/** Opens the app with the hook and waits for boot to attach the world. */
export async function bootWithHook(page: Page, hook: HookClient, path = '/?e2e=1'): Promise<void> {
  await page.goto(path);
  await hook.waitForBoot();
}

/** Starts a seeded match and waits for GO (live phase). */
export async function startLive(hook: HookClient, setup: E2eSetup, seed: number): Promise<void> {
  const r = await hook.startMatch(setup, seed);
  if (!r.ok) throw new Error(`startMatch failed: ${r.error ?? 'unknown'}`);
  await hook.waitForPhase('live', 15_000);
}

/** Measures radians per injected pixel for yaw and pitch (sign included). */
export async function calibrateLook(
  hook: HookClient,
): Promise<{ readonly yaw: number; readonly pitch: number }> {
  const PX = 20;
  const before = await hook.snapshot();
  await hook.inject({ look: { dx: PX, dy: 0 } }, 1);
  const mid = await hook.snapshot();
  await hook.inject({ look: { dx: 0, dy: PX } }, 1);
  const after = await hook.snapshot();
  if (before === undefined || mid === undefined || after === undefined) {
    throw new Error('no snapshot while calibrating');
  }
  return {
    yaw: wrapAngle(mid.player.yaw - before.player.yaw) / PX,
    pitch: (after.player.pitch - mid.player.pitch) / PX,
  };
}

/**
 * Aims at the nearest live bot and fires in bursts until the round ends or `budgetMs` passes.
 * Firing also makes noise, so bots investigate and come into view (req-bot-investigate).
 */
export async function fightUntilEnd(
  hook: HookClient,
  budgetMs: number,
): Promise<string | undefined> {
  const gain = await calibrateLook(hook);
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    const view = await hook.round();
    if (view?.phase === 'ended') return view.outcome;
    const snap = await hook.snapshot();
    if (snap === undefined) return undefined;
    const target = nearest(snap.player.pos, snap.bots);
    if (target !== undefined) {
      const eye = { ...snap.player.pos, y: snap.player.pos.y + snap.player.eyeHeight };
      const aim = lookAt(eye, { ...target.pos, y: target.pos.y + CHEST_HEIGHT_M });
      const look = lookDelta(
        wrapAngle(aim.yaw - snap.player.yaw),
        aim.pitch - snap.player.pitch,
        gain.yaw,
        gain.pitch,
      );
      await hook.inject({ look }, 1);
    }
    const reload = snap.player.weapon.magazine === 0;
    await hook.inject({ fire: !reload, firePressed: !reload, reload }, 12);
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
