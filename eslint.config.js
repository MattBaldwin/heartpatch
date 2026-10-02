// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Game logic must be deterministic: no hidden randomness or clock reads. */
const determinismRules = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Use the seeded RNG from @heartpatch/shared (tech spec §8).',
    },
  ],
};

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
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
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Plain JS config files aren't part of any tsconfig.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // packages/shared: pure, deterministic, no I/O (CLAUDE.md rules 2-3).
  {
    files: ['packages/shared/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      ...determinismRules,
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Shared logic takes time as an input; never read the clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Shared logic takes time as an input; never read the clock.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'net', 'http', 'https', 'child_process', 'os', 'path'],
              message: 'packages/shared does no I/O.',
            },
            {
              group: ['@heartpatch/server', '@heartpatch/client'],
              message: 'shared must not depend on apps.',
            },
          ],
        },
      ],
    },
  },

  // apps/server: Node; game logic uses the seeded RNG, seeds come from crypto.
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      ...determinismRules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@heartpatch/client'], message: 'server must not import the client.' },
          ],
        },
      ],
    },
  },

  // apps/client: browser; never import server-only secret data (CLAUDE.md rule 6).
  {
    files: ['apps/client/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@heartpatch/shared/server',
                '@heartpatch/shared/server/*',
                '**/data/server',
                '**/data/server/*',
              ],
              message: 'Server-only data must never reach the client bundle (tech spec §2).',
            },
            { group: ['@heartpatch/server'], message: 'client must not import the server.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/client/*.config.ts', 'apps/client/tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
