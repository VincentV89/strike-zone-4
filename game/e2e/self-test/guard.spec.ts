/**
 * Guard self-tests (security-design-verification-suite SD-VS-6, SEC-VS-10, SEC-VS-11). Each test
 * is marked test.fail(): it passes only if the guard fixture fails it. A fixture page is served
 * on the base origin, so these need a browser but not the game or WebGL.
 */
import { specTitle } from '../support/checks';
import { test } from '../support/fixtures';

const FIXTURE = '/__sz-guard-fixture.html';

test.beforeEach(async ({ page }) => {
  await page.route(`**${FIXTURE}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>guard fixture</title><p>fixture</p>',
    }),
  );
});

test(specTitle('guard-console-error'), async ({ page }) => {
  test.fail();
  await page.goto(FIXTURE);
  await page.evaluate(() => {
    console.error('guard self-test error');
  });
});

test(specTitle('guard-page-error'), async ({ page }) => {
  test.fail();
  await page.goto(FIXTURE);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('guard self-test uncaught');
    }, 0);
  });
  await page.waitForTimeout(200);
});

test(specTitle('guard-cross-origin'), async ({ page }) => {
  test.fail();
  await page.goto(FIXTURE);
  await page.evaluate(async () => {
    try {
      // eslint-disable-next-line no-restricted-globals -- SD-VS-6: the one guard self-test fetch, run in the page.
      await fetch('https://example.invalid/');
    } catch {
      // aborted by the guard's route; the recorded request is what fails the test
    }
  });
});
