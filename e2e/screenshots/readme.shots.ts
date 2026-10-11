import { statSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TID } from '../../src/ui/testIds.ts';
import { goTo, isPhone, pullShot } from '../helpers.ts';

/**
 * The README's screenshots (`npm run screenshots`, playwright.screenshots.config.ts).
 *
 * Each scene opens the demo (?demo=1, docs/DEMO.md): CafAI already in use on
 * the mock Decaid and the scripted coach, a dial-in of Kiambu AA at v4 with
 * one open "How did it taste?". The demo's story is fixed and its times count
 * back from the page's clock, which is pinned here; the mock has no
 * randomness; the config pins the locale, time zone and colour scheme. So a
 * run takes the same pictures until the UI itself changes.
 *
 * Tablet (1280x800) and phone (390x844 at DPR 2) scenes write
 * docs/images/<project>-<scene>.png, each kept under MAX_BYTES so the
 * repository stays small.
 */

const OUT_DIR = 'docs/images';
/** A fixed morning for the page's clock: the demo's dial-in started about a day before it. */
const NOW = new Date('2026-10-10T08:30:00Z');
const MAX_BYTES = 300 * 1024;
/** Plays the scripted shot (about a minute of Blooming Espresso) in about 6 s; its data keeps real time. */
const SHOT_SPEED = 10;

/** Open the demo on the coach, with the page's clock pinned before anything runs. */
async function openDemo(page: Page, mockSpeed = 25): Promise<void> {
  await page.clock.install({ time: NOW });
  await page.goto(`./?demo=1&mockSpeed=${mockSpeed}#/`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v4');
  await coachIdle(page);
}

/** The coach is idle: no reply streaming, nothing about to land in the chat. */
async function coachIdle(page: Page): Promise<void> {
  await expect(page.getByTestId(TID.chat)).not.toHaveAttribute('data-busy');
}

/** Write docs/images/<project>-<name>.png once fonts are in and motion is stopped, and check its size. */
async function snap(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // The pointer stays where the last tap was, and whatever moved under it since would show its
  // hover colour, or not, by timing: park it on the top bar's corner, over the name, which has none.
  await page.mouse.move(0, 0);
  // Let a scroll, a route change or the graph's canvas settle before the picture.
  await page.waitForTimeout(500);
  const path = `${OUT_DIR}/${test.info().project.name}-${name}.png`;
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  const bytes = statSync(path).size;
  expect(bytes, `${path} is ${Math.round(bytes / 1024)} KB; keep README images under ${MAX_BYTES / 1024} KB`).toBeLessThan(MAX_BYTES);
}

test('coach: a taste answered, and the one change the coach proposes', async ({ page }) => {
  await openDemo(page);
  const changes = page.getByTestId(TID.diffCard);
  const before = await changes.count();
  // The demo's open question; the scripted coach answers "Sour / sharp" with v5, 1 °C hotter (docs/DEMO.md).
  await page.getByRole('radiogroup', { name: 'How did it taste?' }).last().getByTestId(TID.optionChip('Sour / sharp')).click();
  await expect(changes).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(changes.last()).toContainText('Kiambu AA v5');
  await expect(changes.last().getByTestId(TID.diffConfirm)).toBeVisible();
  await coachIdle(page);
  // The chat follows the newest message by itself, but at the mock's 25x pace it sometimes stops
  // following before the card lands; end at the thread's end, as a reader would (followNewest.ts
  // resumes following there). The scroller is x-chat's, as ChatSurface.tsx finds it.
  await page
    .getByTestId(TID.chat)
    .locator('.MuiChatMessageList-scroller')
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await snap(page, 'coach');
});

test('shot: a shot just pulled, on the big graph', async ({ page }) => {
  await openDemo(page, SHOT_SPEED);
  const cards = page.getByTestId(TID.shotCard);
  const before = await cards.count();
  await pullShot(page);
  // The shot takes the screen by itself; once its card is in the chat the coach is back.
  await expect(cards).toHaveCount(before + 1, { timeout: 90_000 });
  await expect(page.getByTestId(TID.chat)).toBeVisible();
  await coachIdle(page);
  await cards.last().getByTestId(TID.openShotGraph).click();
  await expect(page).toHaveURL(/#\/shot$/);
  const view = page.getByTestId(TID.shotView);
  await expect(view).toContainText('Last shot');
  await expect(view.getByTestId(TID.liveGraph).locator('canvas').first()).toBeVisible();
  await snap(page, 'shot');
});

test('history: every version of the bag with its shots', async ({ page }) => {
  test.skip(isPhone(page), 'The README shows History on the tablet only.');
  await openDemo(page);
  await goTo(page, 'history');
  await page.locator('[data-testid^="history-bag-"]').filter({ hasText: 'Kiambu AA' }).click();
  await expect(page.getByTestId(TID.historyVersion(4))).toBeVisible();
  await snap(page, 'history');
});

test('settings: a look of your own, Light in Matcha', async ({ page }) => {
  test.skip(isPhone(page), 'The README shows Settings on the tablet only.');
  await openDemo(page);
  await goTo(page, 'settings');
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
  await page.getByTestId(TID.appearanceMode('light')).click();
  await page.getByTestId(TID.tintSwatch('matcha')).click();
  await expect(page.getByTestId(TID.tintSwatch('matcha'))).toHaveAttribute('aria-checked', 'true');
  await snap(page, 'settings');
});
