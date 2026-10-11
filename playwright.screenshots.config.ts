import { defineConfig, devices } from '@playwright/test';

// `npm run screenshots`: the README's pictures in docs/images/, taken from the
// mock-mode build (the mock Decaid and the scripted coach) playing the demo's
// fixed story (docs/DEMO.md), at a fixed clock, time zone and locale, so a
// re-run after a UI change gives the same scenes. Never part of `npm run e2e`:
// the scenes live in e2e/screenshots/ and end in .shots.ts.
// SCREENSHOTS_PORT moves the preview server (default 4176: e2e has 4174, and
// 4175 for a second e2e run beside it).
const PORT = Number(process.env.SCREENSHOTS_PORT ?? 4176);

/** What every scene shares: the same language, time zone and colour scheme on any computer. */
const STABLE = { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark', hasTouch: true } as const;
/** Desktop Chrome on a phone's own screen, as e2e's phone projects (playwright.config.ts). */
const PHONE = { ...devices['Desktop Chrome'], screen: { width: 390, height: 844 } };

export default defineConfig({
  testDir: './e2e/screenshots',
  testMatch: /\.shots\.ts$/,
  // Its own output folder, so a screenshot run never clears an e2e run's results.
  outputDir: 'test-results-screenshots',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    // Whole-tile raster, sRGB and greyscale text, so the edges of what changed on screen are drawn
    // the same way every run (without these a few edge pixels differ by antialiasing noise).
    launchOptions: { args: ['--disable-partial-raster', '--force-color-profile=srgb', '--disable-lcd-text'] },
  },
  projects: [
    {
      // The README's tablet: a 1280x800 Decent tablet at DPR 1.
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...STABLE },
    },
    {
      // An iPhone-sized phone upright, as e2e's phone-390x844 project.
      name: 'phone',
      use: {
        ...PHONE,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        ...STABLE,
      },
    },
  ],
  webServer: {
    command: `npm run build:mock && npx vite preview --mode mock --outDir dist-mock --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    // Always today's code: a server left running from an older build would take stale pictures.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
