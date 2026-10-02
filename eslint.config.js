// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

/** Every Node built-in, bare and `node:`-prefixed, plus subpaths (`fs/promises`). */
const nodeBuiltins = [...builtinModules.flatMap((m) => [m, `${m}/*`]), 'node:*'];

const sharedForbiddenGlobals = [
  'process',
  'performance',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'fetch',
  'crypto',
  'Buffer',
  'require',
  'window',
  'document',
  'localStorage',
];

const clockMessage = 'Shared logic takes time as an input; never read the clock.';

const serverNoClient = {
  group: ['@heartpatch/client'],
  message: 'server must not import the client.',
};
const serverDbOnlyInRepos = {
  group: ['drizzle-orm', 'drizzle-orm/*', 'postgres'],
  message: 'Only repos (modules/*/repo.ts) and src/db/** touch the database (tech spec §7).',
};

/**
 * Math functions whose results can differ between JS engines (V8 on the server,
 * JavaScriptCore in Safari), so they never belong in outcome maths (tech spec §8).
 */
const transcendentalMath = [
  'pow',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'cbrt',
  'hypot',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
].map((property) => ({
  object: 'Math',
  property,
  message: 'Not bit-identical across engines (tech spec §8). Use a table or integer loop.',
}));

const crossEngineMessage = 'Not deterministic across JS engines (tech spec §8).';

/** Shared logic takes time as an input. */
const clockSelectors = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: clockMessage,
  },
  {
    selector: "MemberExpression[object.property.name='Date'][property.name='now']",
    message: clockMessage,
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: clockMessage,
  },
  { selector: "CallExpression[callee.name='Date']", message: clockMessage },
];

/** Outcome maths must give the same bits on every engine (tech spec §8). */
const crossEngineSelectors = [
  { selector: "BinaryExpression[operator='**']", message: crossEngineMessage },
  { selector: "AssignmentExpression[operator='**=']", message: crossEngineMessage },
  {
    selector: 'CallExpression[callee.property.name=/^(sort|toSorted)$/][arguments.length=0]',
    message: 'Pass a comparator: default sort order is string-based and easy to misuse.',
  },
  {
    selector: "CallExpression[callee.property.name='localeCompare']",
    message: 'localeCompare depends on engine locale data; compare code points instead.',
  },
];

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
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Repo tooling scripts run in Node.
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // packages/shared: pure, deterministic, no I/O (CLAUDE.md rules 2-3).
  // tsconfig.src.json also has no Node/DOM types; these rules give clearer errors.
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        ...determinismRules['no-restricted-properties'],
        ...transcendentalMath,
      ],
      'no-restricted-globals': [
        'error',
        ...sharedForbiddenGlobals.map((name) => ({
          name,
          message: 'packages/shared is pure: no I/O, timers or platform globals.',
        })),
      ],
      'no-restricted-syntax': ['error', ...clockSelectors, ...crossEngineSelectors],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: nodeBuiltins, message: 'packages/shared does no I/O.' },
            {
              group: ['@heartpatch/server', '@heartpatch/client'],
              message: 'shared must not depend on apps.',
            },
          ],
        },
      ],
    },
  },

  {
    // Tests may sort values to compare them; game code may not.
    files: ['packages/shared/src/**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...clockSelectors] },
  },

  // apps/server: Node; game logic uses the seeded RNG, seeds come from crypto.
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      ...determinismRules,
      'no-console': 'error', // use the pino logger (request.log / app.log)
      'no-restricted-imports': ['error', { patterns: [serverNoClient, serverDbOnlyInRepos] }],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/schema', '**/db/schema.js', '**/db/client', '**/db/client.js'],
              allowTypeImports: true,
              message:
                'Only repos (modules/*/repo.ts) and src/db/** use the DB schema or client (tech spec §7). Type imports are fine.',
            },
          ],
        },
      ],
    },
  },
  {
    // Wiring and tests may build a DB client or seed rows directly.
    files: [
      'apps/server/src/index.ts',
      'apps/server/src/ops/**/*.ts',
      'apps/server/src/**/*.test.ts',
      'apps/server/tests/**/*.ts',
    ],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  {
    // Repos are the only place that touches Drizzle (tech spec §7).
    files: ['apps/server/src/**/repo.ts', 'apps/server/src/db/**/*.ts', 'apps/server/*.config.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [serverNoClient] }],
      '@typescript-eslint/no-restricted-imports': 'off',
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
    // Procedural squishies/Keepers must look identical for every player.
    files: ['apps/client/src/procedural/**/*.ts'],
    rules: { ...determinismRules },
  },
  {
    files: ['apps/client/*.config.ts', 'apps/client/tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
