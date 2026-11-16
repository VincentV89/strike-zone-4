/**
 * Gameplay through the hook (tech-stack-decisions-verification-suite ADR-VS-3). Every row is
 * `injected`: the hook replaces the local player's input and seeds the round. Real input feel is
 * a manual check (manual-pointer-lock).
 */
import { BOT_MATRIX, MAPS, checkById, specTitle } from './support/checks';
import { expect, requireWebgl, test } from './support/fixtures';
import type { E2eSetup } from './support/hook';
import { bootWithHook, fightUntilEnd, standUntilEnd, startLive } from './support/play';

const seedOf = (id: string): number => checkById(id)?.seed ?? 1;

test(specTitle('hook-snapshot-aliasing'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await bootWithHook(page, hook);
  await startLive(hook, { mapId: 'desert-compound', botCount: 1, difficulty: 'easy' }, 77);
  const r = await page.evaluate(() => {
    const h = window.__strikezone;
    if (h === undefined) return { ok: false, frozen: false, same: false };
    // Pause first so the next snapshot is the same tick.
    window.dispatchEvent(new Event('blur'));
    const a = h.snapshot();
    try {
      (a as unknown as { player: { pos: { x: number } } }).player.pos.x = 9999;
    } catch {
      // frozen: strict-mode assignment throws, which is the point
    }
    const b = h.snapshot();
    return { ok: true, frozen: Object.isFrozen(a?.player.pos), same: b?.player.pos.x !== 9999 };
  });
  expect(r).toEqual({ ok: true, frozen: true, same: true });
});

test(specTitle('pause-freezes-round'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await bootWithHook(page, hook);
  await startLive(hook, { mapId: 'desert-compound', botCount: 5, difficulty: 'normal' }, 41);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('pause-dialog')).toBeVisible();
  const a = await hook.round();
  const s1 = await hook.snapshot();
  await page.waitForTimeout(2000);
  const b = await hook.round();
  const s2 = await hook.snapshot();
  expect(a?.paused).toBe(true);
  expect(b?.timeLeftSec).toBe(a?.timeLeftSec);
  expect(s2?.tick).toBe(s1?.tick);
  expect(s2?.bots.map((x) => x.pos)).toEqual(s1?.bots.map((x) => x.pos));
});

test(specTitle('movement-wasd'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await bootWithHook(page, hook);
  await startLive(hook, { mapId: 'desert-compound', botCount: 1, difficulty: 'easy' }, 42);
  const start = await hook.snapshot();
  await hook.inject({ move: { forward: 1, right: 0 } }, 60);
  await page.waitForTimeout(1500);
  const moved = await hook.snapshot();
  const d = (p?: { x: number; z: number }, q?: { x: number; z: number }): number =>
    p && q ? Math.hypot(p.x - q.x, p.z - q.z) : 0;
  expect(d(start?.player.pos, moved?.player.pos)).toBeGreaterThan(1);
  // Sprint into whatever is ahead for 5 s: the player stays inside the map bounds (collision).
  await hook.inject({ move: { forward: 1, right: 0 }, sprint: true }, 300);
  await page.waitForTimeout(6000);
  const after = await hook.snapshot();
  expect(Math.abs(after?.player.pos.x ?? 1e9)).toBeLessThan(48);
  expect(Math.abs(after?.player.pos.z ?? 1e9)).toBeLessThan(48);
  expect(after?.player.pos.y ?? -1e9).toBeGreaterThan(-1);
});

test(specTitle('firing-ammo'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await bootWithHook(page, hook);
  await startLive(hook, { mapId: 'desert-compound', botCount: 1, difficulty: 'easy' }, 43);
  const before = await hook.snapshot();
  await hook.inject({ fire: true, firePressed: true }, 30);
  await page.waitForTimeout(1000);
  const fired = await hook.snapshot();
  const m0 = before?.player.weapon.magazine ?? 0;
  const m1 = fired?.player.weapon.magazine ?? m0;
  expect(m1).toBeLessThan(m0);
  await expect(page.getByTestId('hud-ammo-value')).toContainText(String(m1));
  await hook.inject({ reload: true }, 1);
  await hook.inject({}, 240);
  await page.waitForTimeout(4500);
  expect((await hook.snapshot())?.player.weapon.magazine).toBe(m0);
});

for (const map of MAPS) {
  for (const n of BOT_MATRIX) {
    const id = `bot-count-${map}-${String(n)}`;
    test(specTitle(id), async ({ page, hook }, testInfo) => {
      requireWebgl(testInfo.project.name);
      await bootWithHook(page, hook);
      const setup: E2eSetup = { mapId: map, botCount: n, difficulty: 'normal' };
      await startLive(hook, setup, seedOf(id));
      const snap = await hook.snapshot();
      expect(snap?.botCount).toBe(n);
      expect(snap?.bots).toHaveLength(n);
      expect(snap?.aliveBots).toBe(n);
      await expect(page.getByTestId('hud-enemies')).toHaveText(String(n));
    });
  }
}

for (const map of MAPS) {
  test(specTitle(`win-${map}`), async ({ page, hook }, testInfo) => {
    requireWebgl(testInfo.project.name);
    await bootWithHook(page, hook);
    await startLive(hook, { mapId: map, botCount: 1, difficulty: 'easy' }, seedOf(`win-${map}`));
    const outcome = await fightUntilEnd(hook, 150_000);
    expect(outcome).toBe('victory');
    await expect(page.getByTestId('screen-end')).toBeVisible({ timeout: 10_000 });
  });

  test(specTitle(`lose-${map}`), async ({ page, hook }, testInfo) => {
    requireWebgl(testInfo.project.name);
    await bootWithHook(page, hook);
    // Shortest round (2 min) so a time-out defeat also fits inside the 180 s test budget.
    await page.getByTestId('loading-enter-button').click();
    await page.getByTestId('main-menu-settings-button').click();
    await page.getByTestId('settings-duration-option-120').check();
    await page.getByTestId('settings-done-button').click();
    await startLive(hook, { mapId: map, botCount: 5, difficulty: 'hard' }, seedOf(`lose-${map}`));
    const outcome = await standUntilEnd(hook, 135_000);
    expect(['defeat', 'time-expired']).toContain(outcome);
    await expect(page.getByTestId('screen-end')).toBeVisible({ timeout: 10_000 });
  });
}

test(specTitle('restart-10'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await bootWithHook(page, hook);
  const setup: E2eSetup = { mapId: 'industrial-warehouse', botCount: 5, difficulty: 'normal' };
  await startLive(hook, setup, 70);
  for (let i = 1; i <= 10; i += 1) {
    await hook.inject({ fire: true, firePressed: true }, 30);
    await startLive(hook, setup, 70 + i);
    const snap = await hook.snapshot();
    expect(snap?.bots, `restart ${String(i)}`).toHaveLength(5);
    expect(snap?.aliveBots).toBe(5);
    expect(snap?.player.vitals.health).toBe(100);
    expect(await hook.errors()).toEqual([]);
  }
});
