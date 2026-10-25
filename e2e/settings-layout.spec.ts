import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { goTo, isPhone, openApp, openSettingsGroup, settingsGroup } from './helpers.ts';

/**
 * Settings regrouped (D232, D233), on the tablets and the phones: on a
 * tablet Settings' own list of seven groups beside the group chosen, a bare
 * #/settings taking the group opened last (Coach at first) into the address;
 * on a phone the list, then a group's page with a back arrow. Each group has
 * its own address, which a reload keeps and the links into Settings land on:
 * the coach screen's Open Settings, the Care screen's back arrow and its
 * "Set it in Settings", and a drink view's Go back. Its search (D236) finds
 * a setting by its words or the words people use, and opens it in view.
 */

const hash = (page: Page) => new URL(page.url()).hash;
const list = (page: Page) => page.getByTestId(TID.settingsList);
const row = (page: Page, group: string) => page.getByTestId(TID.settingsGroupRow(group));

/** Start a drink on the machine itself (its group head, or Decaid's own screen): no tap in CafAI. */
async function startOnMachine(page: Page, drink: 'steam' | 'hotWater' | 'flush'): Promise<void> {
  await page.evaluate((name) => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.command(name), drink);
}

test('Settings opens on its list: beside Coach on a tablet, taking its address, alone on a phone', async ({ page }) => {
  await openApp(page);
  await goTo(page, 'settings');
  await expect(list(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const groups = ['Coach', 'Grinder', 'Drinks', 'Machine', 'Display', 'Data and privacy', 'About'];
  await expect(list(page).getByRole('link')).toHaveText(groups.map((name) => new RegExp(`^${name}`)));
  if (isPhone(page)) {
    expect(hash(page)).toBe('#/settings');
    await expect(page.getByTestId(TID.settingsPane('coach'))).toHaveCount(0);
  } else {
    await expect(page).toHaveURL(/#\/settings\/coach$/);
    await expect(settingsGroup(page, 'coach')).toBeVisible();
    await expect(row(page, 'coach')).toHaveAttribute('aria-current', 'page');
    // The list and the group share the screen: both whole, side by side.
    const [listBox, paneBox] = await Promise.all([list(page).boundingBox(), settingsGroup(page, 'coach').boundingBox()]);
    expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(paneBox!.x + 1);
    expect(listBox!.width).toBe((page.viewportSize()!.width >= 1200 ? 300 : 280) - 1);
  }
});

test('a row opens its group, at its own address, as a pane beside the list or a page with a back arrow', async ({ page }) => {
  await openApp(page);
  await openSettingsGroup(page, 'machine');
  const machine = settingsGroup(page, 'machine');
  await expect(machine.getByRole('region', { name: 'Sleep and wake' })).toBeVisible();
  if (isPhone(page)) {
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Machine' })).toBeVisible();
    // Settings stays the current place, with the tabs where they were.
    await expect(page.getByTestId(TID.tabSettings)).toHaveAttribute('aria-current', 'page');
    await page.getByTestId(TID.settingsBack).click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(list(page)).toBeVisible();
  } else {
    await expect(list(page)).toBeVisible();
    await expect(row(page, 'machine')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2, name: 'Machine' })).toBeVisible();
    await expect(page.getByTestId(TID.navSettings)).toHaveAttribute('aria-current', 'page');
  }
});

test('a tablet replaces a bare #/settings, so Back leaves Settings, and opens on the group opened last', async ({ page }) => {
  test.skip(isPhone(page), "A phone's #/settings is its list.");
  await openApp(page);
  await goTo(page, 'settings');
  await expect(page).toHaveURL(/#\/settings\/coach$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);

  await openSettingsGroup(page, 'display');
  await goTo(page, 'history');
  await goTo(page, 'settings');
  await expect(page).toHaveURL(/#\/settings\/display$/);
  await expect(settingsGroup(page, 'display')).toBeVisible();
});

test('a reload on a group opens that group', async ({ page }) => {
  await openApp(page, '#/settings/display');
  await expect(settingsGroup(page, 'display').getByRole('region', { name: 'Appearance' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(settingsGroup(page, 'display').getByRole('region', { name: 'Units' })).toBeVisible();
  expect(hash(page)).toBe('#/settings/display');
});

test('the list moves with the arrow keys, Home and End, and Enter opens a group', async ({ page }) => {
  test.skip(isPhone(page), 'A keyboard on a tablet.');
  await openApp(page, '#/settings/grinder');
  await row(page, 'grinder').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'drinks')).toBeFocused();
  await page.keyboard.press('End');
  await expect(row(page, 'about')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'coach')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/settings\/coach$/);
});

test("the coach screen's Open Settings opens Coach", async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Open Settings' }).click();
  await expect(page).toHaveURL(/#\/settings\/coach$/);
  await expect(settingsGroup(page, 'coach').getByTestId(TID.apiKeyInput)).toBeVisible();
});

test("Care's Set it in Settings opens Machine with Machine care in view, and its back arrow comes back there", async ({ page }) => {
  await openApp(page, '#/care/as-needed');
  await page.getByTestId(TID.careSetIn('descale')).click();
  await expect(page).toHaveURL(/#\/settings\/machine$/);
  await expect(page.getByTestId(TID.careSection)).toBeInViewport();

  await page.getByTestId(TID.careOpen).click();
  await expect(page).toHaveURL(/#\/care$/);
  await page.getByTestId(TID.careBack).click();
  await expect(page).toHaveURL(/#\/settings\/machine$/);
  await expect(settingsGroup(page, 'machine')).toBeVisible();
});

test("a drink started from Settings > Drinks goes back to Drinks", async ({ page }) => {
  await openApp(page, '#/settings/drinks');
  await expect(page.getByTestId(TID.drinkSettings)).toBeVisible();
  await startOnMachine(page, 'flush');
  const view = page.getByTestId(TID.drinkView);
  await expect(view).toHaveAttribute('data-drink', 'flush');
  await expect(view.getByTestId(TID.drinkPhase)).toContainText('Done');
  await view.getByRole('button', { name: 'Go back to Settings' }).click();
  await expect(page).toHaveURL(/#\/settings\/drinks$/);
  await expect(settingsGroup(page, 'drinks').getByRole('region', { name: 'Flush' })).toBeVisible();
});

test('crossing the line keeps the group: a tablet pane becomes a phone page, and back', async ({ page }) => {
  test.skip(isPhone(page), 'The tablets resize to a phone and back.');
  const size = page.viewportSize()!;
  await openApp(page, '#/settings/data');
  await expect(list(page)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(list(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Data and privacy' })).toBeVisible();
  await page.setViewportSize(size);
  await expect(list(page)).toBeVisible();
  await expect(row(page, 'data')).toHaveAttribute('aria-current', 'page');
  expect(hash(page)).toBe('#/settings/data');
});

// Search (D236): a field over the list's rows, what it finds in their place, a result opening its
// group (a phone's page) with the setting in view in the group's own column and focused.

const searchField = (page: Page) => page.getByTestId(TID.settingsSearch);

test('search: "tint" opens Display with the tint swatches in view', async ({ page }) => {
  await openApp(page);
  await goTo(page, 'settings');
  await searchField(page).fill('tint');
  const result = page.getByTestId(TID.settingsSearchResult('tint'));
  await expect(result).toBeVisible();
  await expect(result).toContainText('Tint');
  await expect(result).toContainText('Display');
  await searchField(page).press('Enter');
  await expect(page).toHaveURL(/#\/settings\/display$/);
  const display = settingsGroup(page, 'display');
  await expect(display.getByRole('radiogroup', { name: 'Tint' })).toBeInViewport({ ratio: 1 });
  // The tint chosen takes the focus: Crema, until another is chosen.
  await expect(display.getByTestId(TID.tintSwatch('crema'))).toBeFocused();
  if (isPhone(page)) await expect(list(page)).toHaveCount(0);
});

test('search: "budget" opens Coach with the budget field in view and focused, on a phone as its page', async ({ page }) => {
  await openApp(page);
  await goTo(page, 'settings');
  await searchField(page).fill('budget');
  await page.getByTestId(TID.settingsSearchResult('coach-budget')).click();
  await expect(page).toHaveURL(/#\/settings\/coach$/);
  if (isPhone(page)) {
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Coach' })).toBeVisible();
  }
  const budget = settingsGroup(page, 'coach').getByTestId(TID.coachBudgetAmount);
  await expect(budget).toBeFocused();
  await expect(budget).toBeInViewport({ ratio: 1 });
});

test('search: words that match nothing say so, and clearing the field puts the rows back', async ({ page }) => {
  await openApp(page);
  await goTo(page, 'settings');
  await searchField(page).fill('zzz');
  await expect(page.getByTestId(TID.settingsSearchNone)).toHaveText('No setting matches “zzz”.');
  await expect(row(page, 'coach')).toBeHidden();
  await page.getByTestId(TID.settingsSearchClear).click();
  await expect(searchField(page)).toHaveValue('');
  await expect(page.getByTestId(TID.settingsSearchNone)).toHaveCount(0);
  await expect(list(page).getByRole('link')).toHaveCount(7);
  await expect(row(page, 'coach')).toBeVisible();
});

test("the Coach card's Save is gone: the model, fun facts and the grinder apply as they change (D234)", async ({ page }) => {
  await openApp(page);
  for (const group of ['coach', 'grinder', 'drinks', 'machine', 'display', 'data', 'about'] as const) {
    await openSettingsGroup(page, group);
    await expect(settingsGroup(page, group).getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  }
  await openSettingsGroup(page, 'coach');
  const model = page.getByTestId(TID.modelSelect);
  await model.selectOption('claude-fable-5-1');
  await expect(page.getByTestId(TID.settingsSaved('model'))).toHaveText('Saved.');
  await page.reload();
  await expect(page.getByTestId(TID.modelSelect)).toHaveValue('claude-fable-5-1');
});
