// ESLint 9 flat config for the game package (team-practices Code Style, BR-K-54, SD-K-2).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { SHARED_SYNTAX, SRC_BASE, ZONES, zoneConfig } from './eslint.zones.mjs';

const CONFIG_FILES = [
  'eslint.config.mjs',
  'eslint.zones.mjs',
  'eslint.zones.d.mts',
  'vitest.config.mts',
  'scripts/**',
];

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  {
    // SEC-K-06: a stale eslint-disable comment fails lint.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-syntax': ['error', ...SHARED_SYNTAX],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // SEC-K-04: no dynamic code anywhere; the hosting CSP has no 'unsafe-eval'.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
    },
  },
  SRC_BASE,
  ...ZONES.map(zoneConfig),
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Tool config and Node scripts: plain ESM outside the TS project.
    files: CONFIG_FILES,
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: CONFIG_FILES,
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    // Tools require a default export from their config files.
    files: ['eslint.config.mjs', 'vitest.config.mts', 'vite.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
