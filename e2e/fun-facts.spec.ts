import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { goTo, openApp, pullShot, saveApiKey, sendChat } from './helpers.ts';

/**
 * Fun facts (D197-D203) against the mock. Once the barista keeps a recipe
 * ("Balanced, sweet", then Confirm on the keep card), a shot that runs like
 * the one before it (the mock pulls the same shot again) gets one fun fact,
 * in a block of its own between the coach's line on the shot and the taste
 * question: the scripted coach's own when one of CafAI's facts fits the bag's
 * origin, else one from CafAI's list (D201). With Settings > Coach > Fun facts
 * on Off, the next such shot gets none, and the fact told stays in the bag's
 * chat (D198, D202).
 *
 * mockSpeed 10 plays the scripted shot (about 30 s of data) in about 3 s.
 */
const SPEED = 10;
const BALANCED = 'Balanced, sweet';

async function coachIdle(page: Page): Promise<void> {
  await expect(page.getByTestId(TID.chat)).not.toHaveAttribute('data-busy', { timeout: 60_000 });
}

/** Pull the bag's `nth` shot, and wait until the coach has read it and asks how it tasted. */
async function pullAndRead(page: Page, nth: number): Promise<void> {
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toHaveCount(nth, { timeout: 60_000 });
  // Every taste question offers it once, and an answered one stays: the nth is this shot's.
  await expect(page.getByTestId(TID.optionChip(BALANCED))).toHaveCount(nth, { timeout: 60_000 });
  await coachIdle(page);
}

/** "Balanced, sweet" on the `nth` shot's question, then Confirm on the keep card the coach answers it with. */
async function keepRecipe(page: Page, nth: number): Promise<void> {
  await page.getByTestId(TID.optionChip(BALANCED)).nth(nth - 1).click();
  const changes = page.getByTestId(TID.diffCard);
  await expect(changes).toHaveCount(nth, { timeout: 60_000 });
  const keep = changes.nth(nth - 1);
  await expect(keep).toContainText('Keep everything as it is');
  await keep.getByTestId(TID.diffConfirm).click();
  await expect(keep).toContainText('Kept. Pull the next shot the same way.');
  await coachIdle(page);
}

/** Whether `first` comes before `second` in the page. */
async function inOrder(first: Locator, second: Locator): Promise<boolean> {
  const later = await second.elementHandle();
  return first.evaluate((a, b) => b !== null && Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), later);
}

test('a kept recipe pulled again the same way gets a fun fact before the taste question, and none once Fun facts is Off', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page, '#/', SPEED);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, Kenya, light roast, washed, blackcurrant and grapefruit');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  const facts = page.getByTestId(TID.factCard);

  // The first shot: nothing kept yet, so nothing to tell.
  await pullAndRead(page, 1);
  await expect(facts).toHaveCount(0);
  await keepRecipe(page, 1);

  // The second, on the recipe kept and like the first: one fact, after the coach's line on it and before its taste question.
  await pullAndRead(page, 2);
  await expect(facts).toHaveCount(1);
  const fact = facts.first();
  const lines = (await fact.innerText()).split('\n').filter((line) => line.trim() !== '');
  expect(lines[0], 'the label first').toBe('Fun fact');
  expect(lines.length, 'then the fact').toBeGreaterThanOrEqual(2);
  // Quiet text to read: nothing to tap, and its source is never a link.
  await expect(fact.getByRole('button')).toHaveCount(0);
  await expect(fact.getByRole('link')).toHaveCount(0);
  expect(await inOrder(page.getByTestId(TID.shotCard).nth(1), fact), 'after the second shot').toBe(true);
  expect(await inOrder(fact, page.getByTestId(TID.optionChip(BALANCED)).nth(1)), 'before its taste question').toBe(true);
  await keepRecipe(page, 2);

  // Settings > Coach > Fun facts: Off, saved with the rest of the section.
  await goTo(page, 'settings');
  const source = page.getByTestId(TID.funFacts);
  await expect(source).toHaveValue('coach');
  expect((await source.boundingBox())?.height ?? 0, 'the native select is a full touch target').toBeGreaterThanOrEqual(47.5);
  await source.selectOption('off');
  await expect(page.getByText('No fun facts.')).toBeVisible();
  await page.getByTestId(TID.settingsSave).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  // The third shot runs like the second on the same kept recipe: no fact now, and the one told is still there.
  await goTo(page, 'coach');
  await pullAndRead(page, 3);
  await expect(facts).toHaveCount(1);
});
