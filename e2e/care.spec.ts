import { expect, test, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { isPhone, openApp } from './helpers.ts';

/**
 * Settings > Machine care and its cleaning guide (D152-D155), on the tablets
 * and the phones. YouTube is never reached from a test: anything bound for it
 * gets a stub page, and the requests are counted.
 */
async function stubYouTube(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/^https:\/\/(www\.)?youtube(-nocookie)?\.com\//, async (route) => {
    asked.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub player</title><p>stub</p>' });
  });
  return asked;
}

function settingsPlace(page: Page) {
  return page.getByTestId(isPhone(page) ? TID.tabSettings : TID.navSettings);
}

test('Settings > Machine care opens the guide on Daily, under Settings, with nothing from YouTube', async ({ page }) => {
  const asked = await stubYouTube(page);
  await openApp(page, '#/settings');
  const open = page.getByTestId(TID.careOpen);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page).toHaveURL(/#\/care$/);
  await expect(page.getByTestId(TID.careScreen)).toBeVisible();
  await expect(settingsPlace(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId(TID.careSegment('daily'))).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Flush the group head');
  await expect(page.getByTestId(TID.carePlayer)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('the routines switch in place, the address follows, and a reload keeps it', async ({ page }) => {
  await stubYouTube(page);
  await openApp(page, '#/care');
  await page.getByTestId(TID.careSegment('weekly')).click();
  await expect(page).toHaveURL(/#\/care\/weekly$/);
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Steam Rinza through the wand');
  await page.reload();
  await expect(page.getByTestId(TID.careSegment('weekly'))).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId(TID.careSegment('asNeeded')).click();
  await expect(page).toHaveURL(/#\/care\/as-needed$/);
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Descale');
});

test('a moment plays the video in place at its time, in view', async ({ page }) => {
  const asked = await stubYouTube(page);
  await openApp(page, '#/care');
  const moment = page.getByTestId(TID.careMoment('flush-group'));
  await moment.click();
  const player = page.getByTestId(TID.carePlayer);
  await expect(player).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/0cm1JxB_6bI\?start=108&autoplay=1/);
  await expect(moment).toHaveAttribute('aria-pressed', 'true');
  await expect(player).toBeInViewport();
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith('https://www.youtube-nocookie.com/'))).toBe(true);
});

test('inside Decaid on Windows the moments are links to YouTube, and nothing is framed', async ({ page }) => {
  const asked = await stubYouTube(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, '__DECENT_HOST__', {
      value: Object.freeze({ app: 'decent.app', platform: 'windows', version: '0.8.8', build: '2900', commit: 'aab5f938' }),
      configurable: false,
      writable: false,
      enumerable: false,
    });
  });
  await openApp(page, '#/care/monthly');
  const moment = page.getByTestId(TID.careMoment('group-parts'));
  await expect(moment).toHaveAttribute('href', 'https://www.youtube.com/watch?v=0cm1JxB_6bI&t=1016s');
  await expect(moment).not.toHaveAttribute('target');
  await expect(page.getByTestId(TID.carePoster)).toHaveCount(0);
  await expect(page.getByTestId(TID.careWatch)).toHaveAttribute('href', 'https://www.youtube.com/watch?v=0cm1JxB_6bI');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('the back arrow returns to Settings', async ({ page }) => {
  await openApp(page, '#/care/weekly');
  await page.getByTestId(TID.careBack).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByTestId(TID.careSection)).toBeAttached();
});
