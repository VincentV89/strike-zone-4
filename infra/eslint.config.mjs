// ESLint 9 flat config for the infra package (team-practices Code Style).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'cdk.out/**', 'coverage/**', 'test/fixtures/**'] },
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
      // Named exports only (team-practices Code Style).
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Tool config files: plain JS/ESM, and their tools require a default export.
    files: ['eslint.config.mjs', 'vitest.config.mts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['eslint.config.mjs', 'vitest.config.mts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
