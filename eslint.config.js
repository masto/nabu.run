import js from '@eslint/js';
import globals from 'globals';
import react from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['build/', 'snapshot/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Unused callback parameters (reject, event, ...) are fine.
      'no-unused-vars': ['error', { args: 'none' }],
    },
  },
  {
    files: ['src/**/*.jsx'],
    ...react.configs.recommended,
    settings: { 'react-x': { importSource: 'preact' } },
  },
  {
    files: ['src/**/*.jsx'],
    rules: {
      // React 19 APIs that Preact doesn't have.
      '@eslint-react/no-context-provider': 'off',
      '@eslint-react/no-use-context': 'off',
    },
  },
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['tests/**', 'tools/**', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['public/sw*.js'],
    languageOptions: { globals: globals.serviceworker },
  },
];
