import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { isPhone, machineRow, openApp } from './helpers.ts';

/**
 * Steam, hot water and flush take the screen while they run (D146-D150): the
 * mock runs each for the time or volume set in its workflow (steam 50 s, hot
 * water 50 ml, flush 10 s), compressed 25 times, so a run is over in a
 * couple of seconds.
 */

/** Start a drink on the machine itself (its group head, or Decaid's own screen): no tap in CafAI. */
async function startOnMachine(page: Page, drink: 'steam' | 'hotWater' | 'flush'): Promise<void> {
  await page.evaluate((name) => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.command(name), drink);
}

/** The mock machine is running nothing. */
async function machineIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.activity ?? null)).toBeNull();
}

const view = (page: Page) => page.getByTestId(TID.drinkView);
const hash = (page: Page) => new URL(page.url()).hash;

test('Steam from the row takes the screen, Stop in its place; its settings wait for the end, then Go back', async ({ page }) => {
  await openApp(page);
  await machineRow(page).getByTestId(TID.steamButton).click();
  await expect(view(page)).toHaveAttribute('data-drink', 'steam');
  expect(hash(page)).toBe('#/steam');
  await expect(machineRow(page).getByTestId(TID.stopButton)).toBeVisible();

  const time = view(page).getByRole('spinbutton', { name: 'Steam time' });
  await expect(time).toBeDisabled();
  await expect(view(page).getByTestId(TID.drinkGoBack)).toHaveCount(0);

  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  await expect(view(page).getByTestId(TID.drinkDialOf)).toHaveText('of 50 s');
  await expect(time).toBeEnabled();
  await view(page).getByRole('button', { name: 'More steam time' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow().steamSettings.duration))
    .toBe(55);
  // The change is for the next steam: the finished one keeps the time it ran toward.
  await expect
    .poll(() => page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getShotSettings().targetSteamDuration))
    .toBe(55);
  await expect(view(page).getByTestId(TID.drinkDialOf)).toHaveText('of 50 s');

  await view(page).getByRole('button', { name: 'Go back to the coach' }).click();
  await expect(view(page)).toHaveCount(0);
  expect(hash(page)).toBe('#/');
});

test('hot water started on the machine takes the screen from Settings, counts its water, and Go back returns there', async ({ page }) => {
  await openApp(page, '#/settings');
  await startOnMachine(page, 'hotWater');
  await expect(view(page)).toHaveAttribute('data-drink', 'hotWater');
  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  const water = Number(await view(page).getByTestId(TID.drinkDialValue).textContent());
  expect(water).toBeGreaterThanOrEqual(45);
  expect(water).toBeLessThanOrEqual(55);
  await expect(view(page).getByTestId(TID.drinkDialOf)).toHaveText(/^in \d+\.\d s$/);
  await view(page).getByRole('button', { name: 'Go back to Settings' }).click();
  await expect(page.getByTestId(TID.drinkSettings)).toBeVisible();
});

test('a flush counts its time toward the flush time and holds the result', async ({ page }) => {
  await openApp(page);
  await machineRow(page).getByTestId(TID.flushButton).click();
  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  await expect(view(page).getByTestId(TID.drinkDialValue)).toHaveText(/^(9\.\d|10\.\d)$/);
  await expect(view(page).getByTestId(TID.drinkReadout('water'))).toContainText('ml');
  // No return of its own: the view stays with its result.
  await page.waitForTimeout(1000);
  expect(hash(page)).toBe('#/flush');
});

test('no switch while the barista types', async ({ page }) => {
  await openApp(page, '#/settings');
  await page.getByTestId(TID.apiKeyInput).click();
  await startOnMachine(page, 'flush');
  await machineIdle(page);
  expect(hash(page)).toBe('#/settings');
  await expect(view(page)).toHaveCount(0);
});

test('on a phone the tabs stay, none of them current, while a drink has the screen', async ({ page }) => {
  test.skip(!isPhone(page), 'the phone layout only');
  await openApp(page);
  await startOnMachine(page, 'steam');
  await expect(view(page)).toBeVisible();
  for (const id of [TID.tabCoach, TID.tabShot, TID.tabHistory, TID.tabSettings]) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId(id)).not.toHaveAttribute('aria-current', 'page');
  }
});
