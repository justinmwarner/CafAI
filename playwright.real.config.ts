import { defineConfig, devices } from '@playwright/test';

// `npm run e2e:real`: one smoke test against a running Decaid that serves this
// repository's production build as its skin (scripts/decaid-ci.sh, or
// docs/SIMULATOR.md part 6), opened from Decaid's skin entry on port 3000. No
// web server and no mocks: not part of `npm run e2e`.
export default defineConfig({
  testDir: './e2e-real',
  timeout: 90_000,
  // Decaid's sockets and the first readings can take a moment after the page loads.
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  // A failure against the real thing is a finding, not flakiness.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-1280x800',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        hasTouch: true,
      },
    },
  ],
});
