import js from '@eslint/js';
import globals from 'globals';

/** Module boundary rules (docs/implementation/PLAN.md section 3.1). */
const crossModule = [
  {
    group: ['../*/models/*', '../../*/models/*'],
    message: "Use the other module's index.js, never its models.",
  },
  {
    group: ['../*/services/*', '../../*/services/*'],
    message: "Use the other module's index.js service interface.",
  },
];

export default [
  { ignores: ['**/dist/**', '**/coverage/**', 'docs/**', '**/node_modules/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'warn',
    },
  },
  {
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/modules/**'], message: 'core/ must not depend on modules/.' }] },
      ],
    },
  },
  {
    files: ['src/modules/*/**/*.js'],
    rules: { 'no-restricted-imports': ['error', { patterns: crossModule }] },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'load/**/*.mjs', 'packages/*/scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.{js,jsx}', '**/test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
];
