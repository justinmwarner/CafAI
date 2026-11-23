import { expect, test, type Page } from '@playwright/test';
import { TID } from '../../src/ui/testIds.ts';

/**
 * Overhead's states (docs/overhead/screens/, `npm run screenshots`): the
 * mock build with the Overhead plugin running in the page on its recorded
 * data (?mockOverhead=<scenario>, mock/overhead.ts), opened as a Preview
 * (?overheadPreview=1). The tablet only: Overhead is a kitchen tablet's
 * screensaver.
 *
 * The map's tiles come from OpenFreeMap over the network, so they need it; a
 * computer behind a proxy passes it in HTTPS_PROXY. Chromium draws WebGL 2
 * in software (SwiftShader) when it has no GPU.
 */

const OUT_DIR = 'docs/overhead/screens';
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;

test.use({
  launchOptions: {
    args: ['--disable-partial-raster', '--force-color-profile=srgb', '--disable-lcd-text', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}),
  },
});

test.skip(({ isMobile }) => isMobile, 'Overhead is the tablet’s screensaver.');

/** Opens a scenario and waits for the screen to show `state`; the map's tiles get a moment to arrive. */
async function open(page: Page, scenario: string, state: string, settleMs = 6000): Promise<void> {
  await page.goto(`./?mockOverhead=${scenario}&overheadPreview=1#/`);
  await expect(page.getByTestId(TID.overhead)).toBeVisible();
  await expect(page.getByTestId(TID.overheadState)).toHaveAttribute('data-state', state);
  await page.waitForTimeout(settleMs);
  await expect(page.getByTestId(TID.overheadState)).toHaveAttribute('data-state', state);
}

test('setup needed: no home yet', async ({ page }) => {
  await open(page, 'setup', 'setup', 500);
  await page.screenshot({ path: `${OUT_DIR}/setup.png` });
});

test('loading: the first moments', async ({ page }) => {
  await page.goto('./?mockOverhead=loading&overheadPreview=1#/');
  await expect(page.getByTestId(TID.overheadState)).toHaveAttribute('data-state', 'loading');
  await page.screenshot({ path: `${OUT_DIR}/loading.png` });
});

test('live: one overhead now, more within minutes', async ({ page }) => {
  await open(page, 'live', 'live');
  const rows = page.getByTestId(TID.overheadRow);
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  await expect(rows.first()).toHaveAttribute('data-bucket', 'now');
  await expect(page.getByTestId(TID.overheadNotable)).toHaveCount(0);
  await page.screenshot({ path: `${OUT_DIR}/live.png` });
});

test('notable: a plane-alert-db aircraft in the area', async ({ page }) => {
  await open(page, 'notable', 'live');
  await expect(page.getByTestId(TID.overheadNotable)).toContainText('US Helicopters (ABC7 Chicago)');
  await page.screenshot({ path: `${OUT_DIR}/notable.png` });
});

test('stale: live data paused', async ({ page }) => {
  await open(page, 'stale', 'stale');
  await expect(page.getByTestId(TID.overheadStatus)).toContainText('Live data paused');
  await page.screenshot({ path: `${OUT_DIR}/stale.png` });
});

test('empty: quiet skies', async ({ page }) => {
  await open(page, 'empty', 'empty');
  await expect(page.getByTestId(TID.overheadBoard)).toContainText('Quiet skies');
  await page.screenshot({ path: `${OUT_DIR}/empty.png` });
});
