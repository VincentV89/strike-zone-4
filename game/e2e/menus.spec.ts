/**
 * Menus through the real DOM (req-main-menu, req-controls-about, req-match-setup,
 * req-menu-accessibility, req-settings-persistence). Input label: real.
 */
import type { Page } from '@playwright/test';
import { expect, requireWebgl, test } from './support/fixtures';
import { specTitle } from './support/checks';

async function enterMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('loading-enter-button')).toBeEnabled({ timeout: 90_000 });
  await page.getByTestId('loading-enter-button').click();
  await expect(page.getByTestId('screen-main-menu')).toBeVisible();
}

test(specTitle('menus-main-options'), async ({ page }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await enterMenu(page);
  // Play Game, Select Map, Configure CPU Enemies and Select Difficulty live on the setup panel.
  for (const id of ['main-menu-play-button', 'main-menu-start-button']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  for (const map of ['desert-compound', 'industrial-warehouse']) {
    await expect(page.getByTestId(`setup-map-option-${map}`)).toBeVisible();
  }
  const botValues = await page
    .getByTestId('setup-bots')
    .locator('input[type="radio"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(botValues).toEqual(['1', '2', '3', '5', '8', '10', '15', '20']);
  for (const d of ['easy', 'normal', 'hard']) {
    await expect(page.getByTestId(`setup-difficulty-option-${d}`)).toBeVisible();
  }
  // Each dialog opens and closes.
  const dialogs: ReadonlyArray<[string, string, string]> = [
    ['main-menu-settings-button', 'settings-dialog', 'settings-done-button'],
    ['main-menu-controls-button', 'controls-dialog', 'controls-done-button'],
    ['main-menu-history-button', 'history-dialog', 'history-done-button'],
    ['main-menu-about-button', 'about-dialog', 'about-done-button'],
  ];
  for (const [open, body, done] of dialogs) {
    await page.getByTestId(open).click();
    await expect(page.getByTestId(body)).toBeVisible();
    await page.getByTestId(done).click();
    await expect(page.getByTestId(body)).toBeHidden();
  }
  await page.getByTestId('main-menu-controls-button').click();
  await expect(page.getByTestId('controls-table')).toBeVisible();
  await page.getByTestId('controls-done-button').click();
  await page.getByTestId('main-menu-about-button').click();
  await expect(page.getByTestId('about-version')).toContainText('Version');
  await page.getByTestId('about-done-button').click();
});

test(specTitle('menus-keyboard-start'), async ({ page }, testInfo) => {
  requireWebgl(testInfo.project.name);
  // Spy before any page script runs. The real lock is a manual check (manual-pointer-lock).
  await page.addInitScript(() => {
    const w = window as unknown as { __lockCalls: number };
    w.__lockCalls = 0;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'requestPointerLock');
    const original = desc?.value as ((this: Element, ...a: unknown[]) => unknown) | undefined;
    Object.defineProperty(Element.prototype, 'requestPointerLock', {
      configurable: true,
      writable: true,
      value(this: Element, ...args: unknown[]): unknown {
        w.__lockCalls += 1;
        return original?.apply(this, args);
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('loading-enter-button')).toBeEnabled({ timeout: 90_000 });
  const pressUntilFocused = async (testid: string): Promise<void> => {
    for (let i = 0; i < 40; i += 1) {
      const focused = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset['testid'] ?? '',
      );
      if (focused === testid) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`Tab never reached ${testid}`);
  };
  await pressUntilFocused('loading-enter-button');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('screen-main-menu')).toBeVisible();
  await pressUntilFocused('main-menu-start-button');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('screen-capture-prompt')).toBeVisible({ timeout: 60_000 });
  await pressUntilFocused('capture-start-button');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __lockCalls: number }).__lockCalls))
    .toBeGreaterThan(0);
});

test(specTitle('settings-persist-reload'), async ({ page }, testInfo) => {
  requireWebgl(testInfo.project.name);
  await enterMenu(page);
  await page.getByTestId('main-menu-settings-button').click();
  await page.getByTestId('settings-duration-option-300').check();
  await page.getByTestId('settings-done-button').click();
  await page.waitForTimeout(600); // the store debounces settings writes by 250 ms
  await enterMenu(page);
  await page.getByTestId('main-menu-settings-button').click();
  await expect(page.getByTestId('settings-duration-option-300')).toBeChecked();
});
