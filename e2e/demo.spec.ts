import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { openApp, saveApiKey, sendChat } from './helpers.ts';

/**
 * The demo (npm run demo, ?demo=1; docs/DEMO.md, D76): CafAI already in use
 * on the mock Decaid and the scripted coach, with one open "How did it
 * taste?" to answer. Each load starts it over; it never replaces data an
 * address already has (mock/demo/guard.ts).
 */

const GUARD_NOTE = 'The demo did not load: this address already has CafAI data of its own.';
const TASTES = ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery', 'Other'];

/** Open the demo on the coach. `mockSpeed` hurries the scripted coach; null leaves it at the demo's own pace. */
async function openDemo(page: Page, mockSpeed: number | null = 25, route = '#/'): Promise<void> {
  await page.goto(`./?demo=1${mockSpeed === null ? '' : `&mockSpeed=${mockSpeed}`}${route}`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v4');
}

/** The open taste question: the last one in the chat (the answered ones stay, disabled). */
function openQuestion(page: Page): Locator {
  return page.getByRole('radiogroup', { name: 'How did it taste?' }).last();
}

function diffCards(page: Page, status?: string): Locator {
  return page.locator(`[data-testid="${TID.diffCard}"]${status ? `[data-status="${status}"]` : ''}`);
}

/** Every message in the chat, the barista's, the coach's and CafAI's. */
function messages(page: Page): Locator {
  return page.getByTestId(TID.chat).getByRole('article');
}

test('opens on Kiambu AA v4 with every kind of card, both bags and the history', async ({ page }) => {
  await openDemo(page);

  // The bag picker lists both bags, the active one first.
  await expect(page.getByTestId(TID.bagPicker).locator('option')).toHaveText(['Kiambu AA', 'Santos']);
  await expect(page.getByTestId(TID.undoButton)).toBeVisible();

  await expect(page.getByTestId(TID.templateCard('blooming-espresso'))).toContainText('In use');
  const shots = page.getByTestId(TID.shotCard);
  await expect(shots.first()).toBeVisible();
  expect(await shots.count()).toBeGreaterThanOrEqual(4);

  // Change cards: the latest applied version with Undo, a declined one, an undone one.
  await expect(diffCards(page, 'applied').filter({ hasText: 'Saved as Kiambu AA v4' }).getByTestId(TID.diffUndo)).toBeVisible();
  await expect(page.getByTestId(TID.diffUndo)).toHaveCount(1);
  await expect(diffCards(page, 'declined')).toHaveCount(1);
  await expect(diffCards(page, 'undone')).toHaveCount(1);
  await expect(page.getByText('Back on Kiambu AA v2.')).toBeVisible();
  await expect(page.getByText('Set the grinder to 14.5 before the next shot (Decaid lists 0.5 steps for your Niche Zero).')).toBeVisible();

  // The open question waits for a tap.
  for (const taste of TASTES) await expect(openQuestion(page).getByTestId(TID.optionChip(taste))).toBeEnabled();

  // History has every shot of the dial-in.
  await page.getByTestId(TID.navHistory).click();
  const bags = page.locator('[data-testid^="history-bag-"]');
  await expect(bags).toHaveCount(2);
  const kiambu = bags.filter({ hasText: 'Kiambu AA' });
  await expect(kiambu).toContainText('4 shots');
  await kiambu.click();
  for (const version of [1, 2, 3, 4]) await expect(page.getByTestId(TID.historyVersion(version))).toBeVisible();
  await expect(page.locator('[data-testid^="history-iteration-"]')).toHaveCount(4);

  // Santos's "Balanced, sweet" ended with the keep card confirmed: History says it was kept.
  await page.getByRole('button', { name: 'All bags' }).click();
  await bags.filter({ hasText: 'Santos' }).click();
  const santos = page.locator('[data-testid^="history-iteration-"]');
  await expect(santos).toHaveCount(1);
  await expect(santos).toContainText('Balanced, sweet');
  await expect(santos).toContainText('Kept as is');
});

test('a taste typed instead of tapped is read like the answer', async ({ page }) => {
  await openDemo(page);
  await expect(diffCards(page)).toHaveCount(5);

  await sendChat(page, 'It tasted a bit sour, sharp at the end');

  await expect(diffCards(page)).toHaveCount(6, { timeout: 30_000 });
  const card = diffCards(page).last();
  await expect(card).toContainText('Kiambu AA v5');
  await expect(card).toContainText('Brew temperature');
});

test('"Weak / watery" after a shot that ran out of steps short of its stop moves the grinder, not the stop', async ({ page }) => {
  await openDemo(page);
  await openQuestion(page).getByTestId(TID.optionChip('Weak / watery')).click();

  await expect(diffCards(page)).toHaveCount(6, { timeout: 30_000 });
  await expect(diffCards(page).last()).toContainText('Set the grinder to 14.0 before the next shot');
});

test('"Sour / sharp" gets a coach reply and a Kiambu AA v5 card, and Confirm loads it', async ({ page }) => {
  await openDemo(page);
  await expect(diffCards(page)).toHaveCount(5);
  const before = await messages(page).count();

  await openQuestion(page).getByTestId(TID.optionChip('Sour / sharp')).click();

  await expect(diffCards(page)).toHaveCount(6, { timeout: 30_000 });
  const card = diffCards(page).last();
  await expect(card).toContainText('Kiambu AA v5');
  await expect(card).toContainText('Brew temperature');
  // The barista's answer, at least one line from the coach, and the card.
  expect(await messages(page).count()).toBeGreaterThanOrEqual(before + 3);

  await card.getByTestId(TID.diffConfirm).click();
  await expect(page.getByText('Loaded Kiambu AA v5 on the machine.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v5');
});

test('at the demo pace, the coach thinks visibly before it answers, and the card comes within 20 s', async ({ page }) => {
  await openDemo(page, null);
  await expect(diffCards(page)).toHaveCount(5);

  await openQuestion(page).getByTestId(TID.optionChip('Sour / sharp')).click();
  await expect(page.getByRole('status').filter({ hasText: 'Thinking…' })).toBeVisible({ timeout: 5_000 });
  await expect(diffCards(page)).toHaveCount(6, { timeout: 20_000 });
  await expect(diffCards(page).last()).toContainText('Kiambu AA v5');
});

test('a reload starts the demo over, on the coach whatever route was saved', async ({ page }) => {
  await openDemo(page);
  await openQuestion(page).getByTestId(TID.optionChip('Bitter / harsh')).click();
  await expect(diffCards(page)).toHaveCount(6, { timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v4');
  await expect(diffCards(page)).toHaveCount(5);
  await expect(openQuestion(page).getByTestId(TID.optionChip('Sour / sharp'))).toBeEnabled();

  // Decaid reloads a skin without its hash: the saved route would open History; the demo opens the coach.
  await page.getByTestId(TID.navHistory).click();
  await expect(page.locator('[data-testid^="history-bag-"]')).toHaveCount(2);
  await page.goto('./?demo=1&mockSpeed=25');
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v4');
  await expect(openQuestion(page).getByTestId(TID.optionChip('Sour / sharp'))).toBeEnabled();
});

test('never replaces data of its own: a bag made in the normal app stays, and a note says why', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');

  await page.goto('./?demo=1&mockSpeed=25#/');
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  const note = page.getByRole('status').filter({ hasText: GUARD_NOTE });
  await expect(note).toBeVisible();
  await expect(note).toContainText('npm run demo');

  // Across the top of the page, with the app moved down below it: it covers no control (the composer, a field).
  const app = page.getByTestId(TID.appReady);
  const noteBox = (await note.boundingBox())!;
  expect(noteBox.y).toBeLessThanOrEqual(1);
  await expect.poll(async () => (await app.boundingBox())!.y).toBeGreaterThanOrEqual(noteBox.y + noteBox.height - 1);

  // The normal app runs on this address's own data.
  await expect(page.getByTestId(TID.bagPicker).locator('option')).toHaveText(['New bag']);
  await expect(page.getByTestId(TID.activeVersion)).toContainText('No profile yet');

  await note.getByRole('button', { name: 'Dismiss' }).click();
  await expect(note).toHaveCount(0);
  // Dismissed, the app has the whole page again.
  await expect.poll(async () => (await app.boundingBox())!.y).toBeLessThanOrEqual(1);
});
