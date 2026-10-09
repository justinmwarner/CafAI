import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a mock-mode production build (MSW handlers for
// Decaid's REST/WS API and a scripted Anthropic stream), never real hardware.
const PORT = 4174;

/** The specs that run in the phone projects; the rest are about the tablet layout. */
const PHONE_SPECS = /(phone-baseline|shot-focus|appearance|chat-first)\.spec\.ts/;
/** Phone-only: the tablets have their own baseline (baseline.spec.ts). */
const PHONE_ONLY = /phone-baseline\.spec\.ts/;
/**
 * Desktop Chrome on a phone's own screen, in its natural (portrait)
 * orientation whichever way the phone is held: Desktop Chrome's screen is
 * 1920x1080, which no phone-sized page fills.
 */
const PHONE = { ...devices['Desktop Chrome'], screen: { width: 390, height: 844 } };

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    hasTouch: true,
  },
  // CSS viewports of real Decent tablets (Decaid's simulated devices,
  // docs/verified/01-platform.md section 10): a 1280x800 panel at DPR 1.33 is
  // 962x602 CSS px, the smallest layout CafAI must fit. 1280x800 is the
  // research brief's stated minimum at DPR 1; 1920x1200 is the large tablet.
  // The phones (D84) are an iPhone-sized 390x844 upright and on its side
  // (the side rail): touch and mobile emulation on a phone's own screen
  // (portrait, its natural orientation, in both: Desktop Chrome's is
  // 1920x1080), so the page fills the screen and the safe-area module infers
  // the home indicator's 34 px (21 px on its side).
  projects: [
    {
      name: 'tablet-962x602',
      testIgnore: PHONE_ONLY,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 962, height: 602 },
        deviceScaleFactor: 1.33,
        hasTouch: true,
      },
    },
    {
      name: 'tablet-1280x800',
      testIgnore: PHONE_ONLY,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        hasTouch: true,
      },
    },
    {
      name: 'tablet-1920x1200',
      testIgnore: PHONE_ONLY,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1200 },
        hasTouch: true,
      },
    },
    {
      name: 'phone-390x844',
      testMatch: PHONE_SPECS,
      use: {
        ...PHONE,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'phone-landscape-844x390',
      testMatch: PHONE_SPECS,
      use: {
        ...PHONE,
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: `npm run build:mock && npx vite preview --mode mock --outDir dist-mock --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
