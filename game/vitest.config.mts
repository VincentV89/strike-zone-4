import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@sz': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The zone canary suite builds an ESLint instance from the real config.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // BR-K-57: the 80% floor applies to framework-free logic only. Every entry needs a reason.
      exclude: [
        'src/app/**', // bootstrap glue (rAF loop, DOM wiring)
        'src/render/**', // Three.js / WebGL
        'src/assets/**', // Three.js procedural asset factory
        'src/audio/web/**', // Web Audio adapter; audio core stays covered (BR-A-50)
        'src/input/dom/**', // DOM events and pointer lock; the pure input core stays covered
        'src/ui/dom/**', // DOM builders; ui view-model mappers stay covered
        'src/diagnostics/**', // browser probes and the e2e hook
        'src/physics/**', // Rapier WASM adapter; checked by integration tests, not counted
        'src/**/index.ts', // barrels (re-exports only)
        'src/**/*.d.ts', // declarations
      ],
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        'src/kernel/**': { lines: 95, branches: 90 },
        // world-maps (cicd-pipeline-world-maps): maps and nav are pure and fully counted.
        'src/maps/**': { lines: 90, branches: 85 },
        'src/nav/**': { lines: 90, branches: 85 },
        'src/player/**': { lines: 95, branches: 90 },
        'src/input/core/**': { lines: 90, branches: 85 },
        'src/audio/core/**': { lines: 90, branches: 85 },
        // ADR-WC-2: weapons-combat logic, same bar as the kernel.
        'src/weapons/**': { lines: 95, branches: 90 },
        'src/combat/**': { lines: 95, branches: 90 },
      },
    },
  },
});
