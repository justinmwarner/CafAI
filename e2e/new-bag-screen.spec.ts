import { expect, test, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { goTo, machineRow, openApp, pullShot, saveApiKey } from './helpers.ts';

/**
 * The new bag screen keeps its place (D276, D277): while a bag is being set
 * up (no starting profile yet), a shot, steam, a flush or hot water started
 * from the machine row stays off the screen, a line at its top says what
 * runs and offers its view, and the coach says nothing of the shot.
 *
 * The mock runs the scripted shot compressed 25 times, steam for 50 s
 * compressed the same, so each run is over in a few seconds.
 */

const hash = (page: Page) => new URL(page.url()).hash;
const heldRun = (page: Page) => page.getByTestId(TID.heldRun);

/** A new bag's chat, with a key saved: "Which coffee is it?" on screen. */
async function openNewBag(page: Page): Promise<void> {
  await openApp(page);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.beanCard).getByRole('heading', { name: 'Which coffee is it?' })).toBeVisible();
}

test('Espresso tapped by mistake and stopped at once: the screen stays, and the coach says nothing of it', async ({ page }) => {
  await openNewBag(page);
  const chat = page.getByTestId(TID.chat);
  await pullShot(page);
  await expect(heldRun(page)).toContainText('A shot is running.');
  await expect(heldRun(page)).toContainText('You are setting up a bag, so CafAI stayed on this screen.');
  expect(hash(page)).toBe('#/');
  await machineRow(page).getByTestId(TID.stopButton).click();

  await expect(heldRun(page)).toHaveCount(0);
  await expect(machineRow(page).getByTestId(TID.espressoButton)).toBeVisible();
  // Long enough for the engine to have said something, had it anything to say.
  await page.waitForTimeout(1500);
  await expect(chat).not.toContainText('stopped before it poured');
  await expect(chat).not.toContainText('not part of this dial-in');
  expect(hash(page)).toBe('#/');
  await expect(page.getByTestId(TID.beanCard).getByTestId(TID.beanTypeDetails)).toBeEnabled();
});

test('a whole shot pulled on the new bag screen: offered, never forced, and never in the chat', async ({ page }) => {
  await openNewBag(page);
  await pullShot(page);
  await expect(heldRun(page)).toBeVisible();
  // It runs to its end on its own (the mock's scripted shot): the line goes with it.
  await expect(heldRun(page)).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(hash(page)).toBe('#/');
  await expect(page.getByTestId(TID.chat)).not.toContainText('not part of this dial-in');
  await expect(page.getByTestId(TID.shotCard)).toHaveCount(0);
});

test("the line opens the shot on a tap, and dismissed it stays dismissed for that shot", async ({ page }) => {
  await openNewBag(page);
  await pullShot(page);
  await heldRun(page).getByTestId(TID.heldRunDismiss).click();
  await expect(heldRun(page)).toHaveCount(0);
  expect(hash(page)).toBe('#/');
  await machineRow(page).getByTestId(TID.stopButton).click();

  await expect(machineRow(page).getByTestId(TID.espressoButton)).toBeVisible();
  await pullShot(page);
  await heldRun(page).getByTestId(TID.heldRunOpen).click();
  await expect(page.getByTestId(TID.shotView)).toBeVisible();
  expect(hash(page)).toBe('#/shot');
  await machineRow(page).getByTestId(TID.stopButton).click();
});

test('Steam on the new bag screen stays off it too; Open Steam shows it, and Go back returns to the bag', async ({ page }) => {
  await openNewBag(page);
  await machineRow(page).getByTestId(TID.steamButton).click();
  await expect(heldRun(page)).toContainText('Steam is running.');
  expect(hash(page)).toBe('#/');
  await heldRun(page).getByRole('button', { name: 'Open Steam' }).click();
  const view = page.getByTestId(TID.drinkView);
  await expect(view).toHaveAttribute('data-drink', 'steam');
  expect(hash(page)).toBe('#/steam');
  await expect(view.getByTestId(TID.drinkPhase)).toContainText('Done');
  await view.getByRole('button', { name: 'Go back to the coach' }).click();
  expect(hash(page)).toBe('#/');
  await expect(page.getByTestId(TID.beanCard)).toBeVisible();
});

test('once the bag has its starting profile, a shot takes the screen as before', async ({ page }) => {
  await openNewBag(page);
  await page.getByTestId(TID.beanCard).getByTestId(TID.beanOption).first().click();
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText(/^Loaded .+ v1 on the machine\.$/)).toBeVisible();
  await pullShot(page);
  await expect(page.getByTestId(TID.shotView)).toBeVisible();
  expect(hash(page)).toBe('#/shot');
  await expect(heldRun(page)).toHaveCount(0);
});
