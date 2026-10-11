/**
 * `npm run test:bridge-live`: the opt-in live test of CafAI Bridge with this
 * computer's own Claude Code and Claude plan (src/llm/live/bridge.live.ts).
 * Only this config provides the flag that suite checks, so neither `npm test`
 * nor `npm run test:live` can spend the owner's plan.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/llm/live/bridge.live.ts'],
    environment: 'node',
    provide: { cafaiBridgeLive: true },
    // Claude Code starts, thinks and calls tools; the client's own timeouts end a stalled stream sooner.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    // A failed live check is a finding, and a retry would spend the plan twice.
    retry: 0,
    fileParallelism: false,
    reporters: ['verbose'],
  },
});
