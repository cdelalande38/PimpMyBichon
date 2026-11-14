import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // Le prototype est une référence figée : on ne le passe pas au linter.
  globalIgnores([
    'dist',
    'dev-dist',
    'proto',
    'test-results',
    'playwright-report',
    'captures',
    'coverage',
    '.private-assets',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
  },
  {
    files: ['src/pwa/sw.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['*.config.{ts,js}', 'tools/**/*.mjs', 'tests/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.node },
  },
]);
