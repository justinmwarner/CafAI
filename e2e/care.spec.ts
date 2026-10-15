import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { isPhone, machineRow, openApp, recordRequests, type SeenRequest } from './helpers.ts';

/**
 * Settings > Machine care and its cleaning guide (D152-D156), on the tablets
 * and the phones. Nothing here reaches Google: YouTube's hosts, its images'
 * and Google's answer with a stub page, and every request for a host other
 * than this machine is counted, so a thumbnail or a preload slipping in
 * before a tap fails the checks.
 */
const STUB = '<!doctype html><title>stub player</title><p>stub</p>';
const GOOGLE = /^https:\/\/([a-z0-9-]+\.)*(youtube|youtube-nocookie|ytimg|googlevideo|ggpht|google|gstatic|doubleclick)\.com\//;

async function stubGoogle(page: Page): Promise<void> {
  await page.route(GOOGLE, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: STUB }));
}

/** The requests for a host other than this machine's (the app and the mock Decaid are local). */
function leaving(seen: readonly SeenRequest[]): string[] {
  return seen
    .map((request) => new URL(request.url))
    .filter((url) => (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    .map((url) => url.href);
}

function settingsPlace(page: Page) {
  return page.getByTestId(isPhone(page) ? TID.tabSettings : TID.navSettings);
}

const hash = (page: Page) => new URL(page.url()).hash;

/** Start a drink on the machine itself (its group head, or Decaid's own screen): no tap in CafAI. */
async function startOnMachine(page: Page, drink: 'steam' | 'hotWater' | 'flush'): Promise<void> {
  await page.evaluate((name) => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.command(name), drink);
}

/** What the mock machine is running, or null. */
function activity(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.activity ?? null);
}

test('Settings > Machine care opens the guide on Daily, under Settings, and nothing leaves the machine', async ({ page }) => {
  await stubGoogle(page);
  const seen = recordRequests(page);
  await openApp(page, '#/settings');
  const open = page.getByTestId(TID.careOpen);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page).toHaveURL(/#\/care$/);
  await expect(page.getByTestId(TID.careScreen)).toBeVisible();
  await expect(settingsPlace(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId(TID.careSegment('daily'))).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Flush the group head');
  for (const routine of ['weekly', 'monthly', 'asNeeded']) await page.getByTestId(TID.careSegment(routine)).click();
  await expect(page.getByTestId(TID.carePlayer)).toHaveCount(0);
  expect(leaving(seen)).toEqual([]);
});

test('the routines switch in place, the address follows, and a reload keeps it', async ({ page }) => {
  await stubGoogle(page);
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

test('Back from the guide leaves it, whichever routines were looked at', async ({ page }) => {
  await openApp(page, '#/settings');
  const open = page.getByTestId(TID.careOpen);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page).toHaveURL(/#\/care$/);
  await page.getByTestId(TID.careSegment('weekly')).click();
  await expect(page).toHaveURL(/#\/care\/weekly$/);
  await page.getByTestId(TID.careSegment('monthly')).click();
  await expect(page).toHaveURL(/#\/care\/monthly$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/settings$/);
});

test('a moment plays the video in place at its time, and only YouTube is asked', async ({ page }) => {
  await stubGoogle(page);
  const seen = recordRequests(page);
  await openApp(page, '#/care');
  const moment = page.getByTestId(TID.careMoment('flush-group'));
  await moment.click();
  const player = page.getByTestId(TID.carePlayer);
  await expect(player).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/0cm1JxB_6bI\?start=108&autoplay=1/);
  await expect(moment).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => leaving(seen).length).toBeGreaterThan(0);
  expect(leaving(seen).every((url) => url.startsWith('https://www.youtube-nocookie.com/embed/'))).toBe(true);
});

test('a moment far down a routine opens the player whole in view', async ({ page }) => {
  await stubGoogle(page);
  await openApp(page, '#/care/as-needed');
  // The second step, under the long Descale: on a phone the player opens above, out of view, until it is brought there.
  await page.getByTestId(TID.careMoment('steam-tip')).click();
  const player = page.getByTestId(TID.carePlayer);
  await expect(player).toHaveAttribute('src', /start=310&/);
  await expect(player).toBeInViewport({ ratio: 0.95 });
});

test("a step's moment keeps a column of its own on a tablet; on a phone the words below the title take the whole width", async ({ page }) => {
  await openApp(page, '#/care');
  const how = await page.getByTestId(TID.careStep('flush-group')).getByText('Blind basket in, then Flush at least twice. Water only.').boundingBox();
  const moment = await page.getByTestId(TID.careMoment('flush-group')).boundingBox();
  if (how === null || moment === null) throw new Error('The step is not laid out.');
  if (isPhone(page)) expect(how.x + how.width).toBeGreaterThanOrEqual(moment.x + moment.width - 1);
  else expect(how.x + how.width).toBeLessThanOrEqual(moment.x);
});

test("on a phone the video takes the column's width, before a tap and playing", async ({ page }) => {
  test.skip(!isPhone(page), 'On a tablet the video has a column of its own.');
  await stubGoogle(page);
  await openApp(page, '#/care');
  const widthOf = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.width ?? 0;
  expect(Math.abs((await widthOf(TID.careVideo)) - (await widthOf(TID.careRoutine)))).toBeLessThanOrEqual(1);
  await page.getByTestId(TID.careMoment('flush-group')).click();
  await expect(page.getByTestId(TID.carePlayer)).toBeVisible();
  expect(Math.abs((await widthOf(TID.careVideo)) - (await widthOf(TID.careRoutine)))).toBeLessThanOrEqual(1);
});

test("a drink leaves Care on screen while Decent's video is open; with it closed, the drink's view takes over and goes back to Care", async ({ page }) => {
  await stubGoogle(page);
  // A slower mock, so the flush lasts about 2 s and can be seen running.
  await openApp(page, '#/care/weekly', 5);
  await page.getByTestId(TID.careMoment('rinza')).click();
  await expect(page.getByTestId(TID.carePlayer)).toBeVisible();
  await startOnMachine(page, 'flush');
  await expect.poll(() => activity(page)).toBe('flush');
  expect(hash(page)).toBe('#/care/weekly');
  await expect(page.getByTestId(TID.drinkView)).toHaveCount(0);
  await expect(page.getByTestId(TID.carePlayer)).toBeVisible();
  await expect.poll(() => activity(page)).toBeNull();
  await expect(page.getByTestId(TID.carePlayer)).toBeVisible();

  // A fresh Care, its video not opened: the flush takes the screen as it would anywhere.
  await page.reload();
  await expect(page.getByTestId(TID.careScreen)).toBeVisible();
  await startOnMachine(page, 'flush');
  const view = page.getByTestId(TID.drinkView);
  await expect(view).toHaveAttribute('data-drink', 'flush');
  await expect(view.getByTestId(TID.drinkPhase)).toContainText('Done');
  await view.getByRole('button', { name: 'Go back to Machine care' }).click();
  await expect(page).toHaveURL(/#\/care\/weekly$/);
  await expect(machineRow(page)).toBeVisible();
});

test('inside Decaid on Windows the moments are links to YouTube, and nothing is framed', async ({ page }) => {
  await stubGoogle(page);
  const seen = recordRequests(page);
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
  expect(leaving(seen)).toEqual([]);
});

test('the back arrow returns to Settings', async ({ page }) => {
  await openApp(page, '#/care/weekly');
  await page.getByTestId(TID.careBack).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByTestId(TID.careSection)).toBeAttached();
});
