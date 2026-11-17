/**
 * Load check (req-no-console-errors, req-loading-screen). Runs locally and on the deployed URL.
 * The guard fixture fails the test on any console error, page error or foreign request.
 */
import { expect, requireWebgl, test } from './support/fixtures';
import { specTitle } from './support/checks';

test(specTitle('load-zero-console-errors'), async ({ page }, testInfo) => {
  requireWebgl(testInfo.project.name);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('screen-loading')).toBeVisible();
  await expect(page.getByTestId('loading-enter-button')).toBeEnabled({ timeout: 90_000 });
  await page.getByTestId('loading-enter-button').click();
  await expect(page.getByTestId('screen-main-menu')).toBeVisible();
});
