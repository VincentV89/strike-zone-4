/**
 * Accessibility scans (security-design-verification-suite SEC-VS-50, req-menu-accessibility).
 * axe with WCAG 2.0/2.1 A and AA tags; any critical or serious violation fails, moderate and
 * minor ones are written to the row's notes. Pause and end screens are reached through the hook.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, requireWebgl, test } from './support/fixtures';
import { specTitle } from './support/checks';
import { bootWithHook, fightUntilEnd, startLive } from './support/play';

async function scan(page: Page, testInfo: TestInfo): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = result.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  for (const v of result.violations.filter((x) => !blocking.includes(x))) {
    testInfo.annotations.push({
      type: 'note',
      description: `axe ${v.impact ?? 'unknown'}: ${v.id} (${String(v.nodes.length)} nodes)`,
    });
  }
  expect(blocking.map((v) => `${v.impact ?? ''} ${v.id}`)).toEqual([]);
}

async function enterMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('loading-enter-button')).toBeEnabled({ timeout: 90_000 });
  await page.getByTestId('loading-enter-button').click();
  await expect(page.getByTestId('screen-main-menu')).toBeVisible();
}

test(specTitle('a11y-main-menu'), async ({ page }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await enterMenu(page);
  await expect(page.getByTestId('setup-panel')).toBeVisible();
  await scan(page, testInfo);
});

test(specTitle('a11y-settings'), async ({ page }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await enterMenu(page);
  await page.getByTestId('main-menu-settings-button').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await scan(page, testInfo);
});

test(specTitle('a11y-pause'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await bootWithHook(page, hook);
  await startLive(hook, { mapId: 'desert-compound', botCount: 1, difficulty: 'easy' }, 31);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('pause-dialog')).toBeVisible();
  await scan(page, testInfo);
});

test(specTitle('a11y-end'), async ({ page, hook }, testInfo) => {
  requireWebgl(testInfo.project.name);
  test.setTimeout(480_000); // same hunt budget as the win checks
  await bootWithHook(page, hook);
  await startLive(hook, { mapId: 'desert-compound', botCount: 1, difficulty: 'easy' }, 32);
  await fightUntilEnd(hook, 420_000);
  await expect(page.getByTestId('screen-end')).toBeVisible({ timeout: 10_000 });
  await scan(page, testInfo);
});
