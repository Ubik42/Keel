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
      'tools/phone-photo-sync/catalog.cjs',
      'tools/phone-photo-sync/catalog-*.js',
      'tools/phone-photo-sync/pdf-*.js',
      // Emscripten-generated glue (acquired by scripts/build-ufbx-wasm.mjs).
      'resources/ufbx/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
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
);
