import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // CDK synthesis of the stack takes a few seconds on a cold start.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'scripts/**/*.ts'],
      reportsDirectory: 'coverage',
    },
  },
});
