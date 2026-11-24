import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.vite/**',
      '.claude/**',
      '.worktrees/**',
      '.media-build/**',
      '.tmp-*/**',
      'artifacts/**',
      'dist/**',
      'out/**',
      'coverage/**',
      // Electron/Playwright-generated traces, reports, and runtime fixtures.
      'test-results/**',
      'node_modules/**',
      // Local scratch output (git-ignored): converters, backups, baselines.
      'work/**',
      // Generated bundles and the Python runtime of the phone sync tool
      // (git-ignored in tools/phone-photo-sync/.gitignore).
      'tools/phone-photo-sync/runtime/**',
      'tools/phone-photo-sync/catalog-*.js',
      'tools/phone-photo-sync/pdf-*.js',
      // Emscripten-generated glue (acquired by scripts/build-ufbx-wasm.mjs).
      'resources/ufbx/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // The app/ hooks keep "latest value" refs that are written during render
  // (about 55 places, see docs/进度.md 2026-11-22). Moving those writes into
  // effects changes when other effects see the new value; a change of that
  // kind caused the P3 restore regression. The React Compiler does not build
  // this code, so these advisory rules stay off here.
  {
    files: ['src/renderer/App.tsx', 'src/renderer/app/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
    },
  },
  // Directory layering (docs/进度.md 3.1).
  {
    files: ['src/renderer/workbench/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/features/**', '**/stores/**', '**/app/**'], message: 'workbench/ does not depend on features/, stores/ or app/.' },
          { group: ['**/shared/asset-types'], message: 'workbench/ does not know asset business types.' },
        ],
      }],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'keel', message: 'workbench/ does not call the backend.' },
        { object: 'window', property: 'serpent', message: 'workbench/ does not call the backend.' },
      ],
    },
  },
  {
    files: ['src/renderer/stores/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/features/**'], message: 'stores/ does not depend on features/.' },
          { group: ['**/*.tsx'], message: 'stores/ does not import React components.' },
        ],
      }],
    },
  },
  {
    files: ['src/worker/library/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/media/**', '**/integrations/**'], message: 'worker/library/ does not depend on worker/media/ or worker/integrations/.' },
        ],
      }],
    },
  },
);
