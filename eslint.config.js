import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

// APIs that exist in current browsers but not in the Chromium 91 WebView that
// Decaid's oldest tablets are frozen on, and that core-js cannot polyfill.
const chromium91Properties = [
  { object: 'crypto', property: 'randomUUID', message: 'Chromium 92+. Use newId() from src/util/id.ts.' },
  { object: 'AbortSignal', property: 'timeout', message: 'Chromium 103+. Use AbortController + setTimeout.' },
  { object: 'AbortSignal', property: 'any', message: 'Chromium 116+. Combine signals manually.' },
  { property: 'throwIfAborted', message: 'Chromium 100+. Check signal.aborted instead.' },
  { object: 'navigator', property: 'mediaDevices', message: 'Decaid skins cannot use camera or microphone.' },
  { property: 'getUserMedia', message: 'Decaid skins cannot use camera or microphone.' },
  { object: 'Response', property: 'json', message: 'Static Response.json() is Chromium 105+.' },
];

const chromium91Syntax = [
  {
    selector: "ForOfStatement[await=true][right.property.name='body']",
    message: 'ReadableStream is not async-iterable in Chromium 91. Use body.getReader().',
  },
];

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'dist-mock/**',
      '.verify/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'release/**',
      'crema/**',
      '.ref/**',
      'tools/chrome91/node_modules/**',
      'tools/chrome91/out/**',
      'mock/public/**',
      // openapi-typescript output from Decaid's pinned specs (scripts/decaid-contract.mjs).
      'contract/decaid/generated/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-restricted-properties': ['error', ...chromium91Properties],
      'no-restricted-syntax': ['error', ...chromium91Syntax],
      'no-restricted-globals': [
        'error',
        { name: 'structuredClone', message: 'Chromium 98+. Use clone() from src/util/clone.ts.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'The SDK pulls Node modules into the browser bundle. Use src/llm/anthropic.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests, mocks and tooling run in Node or only in dev/mock builds.
    files: ['**/*.test.{ts,tsx}', 'mock/**', 'e2e/**', 'scripts/**', 'tools/**', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
    },
  },
);
