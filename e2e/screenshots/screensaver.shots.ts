import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TID } from '../../src/ui/testIds.ts';
import { goTo } from '../helpers.ts';

/**
 * The screensavers' pictures (D227), for looking at them: Settings >
 * Display > Screensaver, and one frame of each screensaver through the mock
 * builds' held Preview (`?saverPreview=<id>&saverAt=<ms>`,
 * src/ui/saver/preview.ts), on the Decent tablet's own screen, 962x602 CSS px
 * at DPR 1.33, at a pinned clock, so a fixed seed (the day's number) and a
 * fixed moment.
 *
 *   SCREENSHOTS_PORT=4192 npx playwright test --config playwright.screenshots.config.ts e2e/screenshots/screensaver.shots.ts
 *
 * Tablet only. The pictures go to test-results-screenshots/screensavers/
 * (git-ignored, made again by every run): they are for the eye, not the
 * README.
 */

const OUT_DIR = 'test-results-screenshots/screensavers';
/** A fixed evening for the page's clock (the demo's story counts back from it). */
const NOW = new Date('2026-10-22T21:30:00Z');

/** Each screensaver, and the moment its frame is taken at: the spec's stills' moments where it names one. */
const FRAMES: ReadonlyArray<{ id: string; at: number }> = [
  { id: 'nightstand', at: 0 },
  { id: 'portafilter', at: 3000 },
  // 8 s in: a held frame draws every frame before it, which Playwright's software WebGL pays for one frame at a time.
  { id: 'pipes', at: 8000 },
  { id: 'beanfield', at: 6000 },
  { id: 'steam', at: 12_000 },
  { id: 'lava', at: 20_000 },
  { id: 'rain', at: 8000 },
  { id: 'latte', at: 30_000 },
];

test.use({ viewport: { width: 962, height: 602 }, deviceScaleFactor: 1.33 });

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'tablet', 'The screensavers are the tablet’s.');
  mkdirSync(OUT_DIR, { recursive: true });
});

async function snap(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, animations: 'disabled', caret: 'hide' });
}

test('Settings > Display > Screensaver', async ({ page }) => {
  await page.clock.install({ time: NOW });
  // The demo opens on the coach, whatever the route.
  await page.goto('./?demo=1&mockSpeed=25#/');
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await goTo(page, 'settings', 'display');
  const section = page.getByTestId(TID.saverSection);
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await snap(page, 'settings-screensaver');
});

for (const { id, at } of FRAMES) {
  test(`${id} at ${at} ms`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.clock.install({ time: NOW });
    // The demo: a bag on the machine and its last shot, for Nightstand's lines and Brew Rain's numbers.
    await page.goto(`./?demo=1&mockSpeed=25&saverPreview=${id}&saverAt=${at}#/`);
    // A minute: Espresso Pipes held at 8 s takes 11 to 13 s in Playwright's software WebGL.
    await expect(page.getByTestId(TID.saverReady)).toBeAttached({ timeout: 60_000 });
    await expect(page.getByTestId(TID.saver)).toHaveAttribute('data-saver', id);
    // Not Nightstand standing in for one that threw.
    await expect(page.getByTestId(TID.saver)).not.toHaveAttribute('data-fallback', '1');
    await snap(page, id);
    expect(problems).toEqual([]);
  });
}
