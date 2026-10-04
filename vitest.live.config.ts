/**
 * `npm run test:live`: the opt-in smoke test against the real Anthropic API
 * (src/llm/live/anthropic.live.ts). Standalone on purpose: the unit config in
 * vite.config.ts never includes *.live.ts, and only this config provides the
 * flag the suite checks, so `npm test` cannot make a paid call even when
 * ANTHROPIC_API_KEY happens to be set.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.live.ts'],
    environment: 'node',
    provide: { cafaiLiveSuite: true },
    // A real turn can think for a while; the client's own timeouts end a stalled stream sooner.
    testTimeout: 180_000,
    hookTimeout: 30_000,
    // A failed live check is a finding, not flakiness, and a retry would pay twice.
    retry: 0,
    // Check 2 replays what check 1 stored: one file, its tests in order.
    fileParallelism: false,
    // Every check by name, so the owner sees which checks and model ids ran.
    reporters: ['verbose'],
  },
});
