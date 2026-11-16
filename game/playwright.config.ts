/**
 * Playwright config (security-design-verification-suite SD-VS-14, tech-stack-decisions ADR-VS-1).
 * Chromium only, one worker, one retry (a pass on retry is reported `flaky`). The only launch
 * arguments are the SwiftShader pair for headless WebGL2. bypassCSP and ignoreHTTPSErrors are
 * never set (lint-banned), so CSP violations reach the console guard.
 */
import { defineConfig } from '@playwright/test';
import { LOCAL_BASE_URL } from './e2e/support/policy';

const project = process.env['SZ_E2E_PROJECT'] === 'deployed' ? 'deployed' : 'local';
const deployedBase = process.env['SZ_E2E_BASE_URL'] ?? 'https://deployed-url-not-set.invalid/';

const browser = {
  browserName: 'chromium' as const,
  launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  serviceWorkers: 'block' as const,
  viewport: { width: 1920, height: 1080 },
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  globalSetup: './e2e/support/global-setup.ts',
  reporter: [['list'], ['./e2e/support/reporter.ts']],
  workers: 1,
  retries: 1,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'local',
      testIgnore: ['deployed/**'],
      use: { ...browser, baseURL: LOCAL_BASE_URL },
    },
    {
      name: 'deployed',
      testMatch: ['deployed/**/*.spec.ts', 'hook.spec.ts', 'load.spec.ts'],
      use: { ...browser, baseURL: deployedBase },
    },
  ],
  // Loopback only, always the fresh dist/ (no reuse of a server already on the port).
  ...(project === 'local'
    ? {
        webServer: {
          command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
          url: LOCAL_BASE_URL,
          reuseExistingServer: false,
          timeout: 60_000,
        },
      }
    : {}),
});
