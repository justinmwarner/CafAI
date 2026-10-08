import { expect, test, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { openApp } from './helpers.ts';

/**
 * The old-engine warning and the start-up fallback (D58). Playwright's
 * Chromium is modern, so only the version path can run here: a user agent that
 * names Chromium 85. The probe path (Decaid's WebView, whose user agent is
 * just "Decent") is covered by src/ui/platform/engineScript.test.ts.
 */
const CHROMIUM_85 =
  'Mozilla/5.0 (Linux; Android 10; P80X Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/85.0.4183.127 Safari/537.36';
const WARNING = /older than CafAI is built for/;
const SETTINGS_URL = 'http://127.0.0.1:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI';

/** The engine check reads client hints first, and they would name the real engine; Chromium 85 has none. */
async function withoutClientHints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => undefined });
  });
}

/** The app's entry chunk never arrives (a file Decaid is replacing mid-update, a failed fetch). */
async function blockTheBundle(page: Page): Promise<void> {
  await page.route(/\/assets\/index-[^/]+\.js(\?.*)?$/, (route) => route.abort());
}

/**
 * The fallback shown because the bundle failed to load. Its error reaches the
 * inline script's capture listener at once; the 15 s watchdog would mark it
 * "timeout" instead, so this also proves the page did not wait.
 */
const failedLoad = (page: Page) => page.locator('[data-cafai-start-failed="load"]');
/** Generous for a slow runner; the page normally shows within a second or two. */
const GENEROUS_MS = 30_000;

test.describe('on an engine older than Chromium 91', () => {
  test.use({ userAgent: CHROMIUM_85 });

  test('the app warns without covering anything, and remembers a dismissal', async ({ page }) => {
    await withoutClientHints(page);
    await openApp(page);
    expect(await page.evaluate(() => window.__CAFAI_ENGINE__)).toEqual({ chromium: 85, supported: false, reason: 'version' });

    const warning = page.getByRole('alert').filter({ hasText: WARNING });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(
      "This device's browser engine (Chromium 85) is older than CafAI is built for (Chromium 91 or newer), so some parts may not work.",
    );

    // In the flow between the top bar and the columns: it pushes them down
    // and covers nothing, and the app still fits the screen.
    // The shell's own top bar (the coach screen has a header of its own).
    const bar = (await page.locator(`[data-testid="${TID.appReady}"] > header`).boundingBox())!;
    const box = (await warning.boundingBox())!;
    const machine = (await page.getByRole('complementary', { name: 'Machine' }).boundingBox())!;
    const main = (await page.getByRole('main').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(machine.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect(main.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const id of [TID.exitToSkins, TID.decaidSettings, TID.navCoach, TID.espressoButton, TID.stopButton]) {
      await expect(page.getByTestId(id)).toBeInViewport();
    }

    const dismiss = warning.getByRole('button', { name: 'Dismiss the browser engine warning' });
    expect((await dismiss.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(47.5);
    await dismiss.click();
    await expect(page.getByText(WARNING)).toHaveCount(0);

    // Remembered for this engine version.
    await page.reload();
    await expect(page.getByTestId(TID.appReady)).toBeVisible();
    await expect(page.getByText(WARNING)).toHaveCount(0);
  });

  test('when the app never starts, the page names the engine and offers the ways back', async ({ page }) => {
    await withoutClientHints(page);
    await blockTheBundle(page);
    await page.goto('./?mockSpeed=25#/');
    await expect(failedLoad(page)).toBeVisible({ timeout: GENEROUS_MS });
    await expect(page.getByText("CafAI could not start on this device's browser engine (Chromium 85).")).toBeVisible();
    await expect(page.getByText('It needs Chromium 91 or newer.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit to Decaid' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Decaid settings' })).toHaveAttribute('href', SETTINGS_URL);
  });
});

test('a current engine shows no warning', async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate(() => window.__CAFAI_ENGINE__)).toMatchObject({ supported: true, reason: 'probe' });
  await expect(page.getByText(WARNING)).toHaveCount(0);
  await expect(page.getByText('could not start')).toHaveCount(0);
});

test('an app bundle that never loads still leaves Exit and Decaid settings', async ({ page }) => {
  await blockTheBundle(page);
  await page.goto('./?mockSpeed=25#/');

  const exit = page.getByRole('button', { name: 'Exit to Decaid' });
  const settings = page.getByRole('link', { name: 'Decaid settings' });
  await expect(failedLoad(page)).toBeVisible({ timeout: GENEROUS_MS });
  await expect(exit).toBeVisible();
  await expect(settings).toBeVisible();
  // A current engine is not blamed.
  await expect(page.getByText('CafAI could not start.')).toBeVisible();
  await expect(page.getByText('browser engine')).toHaveCount(0);
  await expect(settings).toHaveAttribute('href', SETTINGS_URL);
  for (const control of [exit, settings]) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(47.5);
  }

  // Outside Decaid, Exit opens Decaid's settings (its Web Interface section switches skins).
  await page.route(/^http:\/\/127\.0\.0\.1:8080\/api\/v1\/plugins\/settings\.reaplugin\/ui/, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Decaid settings</title>' }),
  );
  await exit.click();
  await expect(page).toHaveURL(SETTINGS_URL);
});
