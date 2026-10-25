import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { MOCK_GRINDER_IDS } from '../mock/decaid/grinders.ts';
import { TID } from '../src/ui/testIds.ts';
import { fillField, openApp } from './helpers.ts';

/**
 * Settings > Grinder links the grinder to Decaid's grinder library (D62), and
 * adds one the library lacks (D125). The mock Decaid seeds three test
 * grinders with fixed ids (mock/decaid/grinders.ts), so a link made in
 * Settings is still there after a reload; `?mockGrinders=0` starts it with an
 * empty library. Everything applies as it changes (D234): a pick saves at
 * once, a typed value on Enter or when its field is left, and the line under
 * the card says "Saved." for 3 s.
 */
const NICHE_LABEL = 'Niche Zero (63 mm conical)';
const NICHE_STEPS = 'Decaid lists steps of 0.5 for this grinder (big steps 2).';
const LIBRARY_HINT = "Add your grinder to Decaid's grinder library and CafAI will use its step size.";

/** The line under Your grinder: "Saved." for 3 s after a change saved, or why it did not. */
const savedLine = (page: Page) => page.getByTestId(TID.settingsSaved('grinder'));

test('a grinder picked from Decaid saves at once, shows its step size and stays linked after a reload', async ({ page }) => {
  await openApp(page, '#/settings/grinder');
  const picker = page.getByLabel('Grinder from Decaid');
  await expect(picker).toBeEnabled();
  expect((await picker.boundingBox())?.height ?? 0, 'a full touch target').toBeGreaterThanOrEqual(47.5);

  await picker.selectOption({ label: NICHE_LABEL });
  // Picked: saved there and then, with nothing to press.
  await expect(savedLine(page)).toHaveText('Saved.');
  await expect(page.getByText(NICHE_STEPS)).toBeVisible();
  // A picked grinder is named by its model; only the setting is typed.
  await expect(page.getByTestId(TID.grinderName)).toHaveCount(0);
  // The typed setting saves on Enter: once the pick's "Saved." has gone, the next one is the setting's.
  await expect(savedLine(page)).toBeEmpty();
  await page.getByTestId(TID.grinderSetting).fill('14.5');
  await page.getByTestId(TID.grinderSetting).press('Enter');
  await expect(savedLine(page)).toHaveText('Saved.');

  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  const again = page.getByLabel('Grinder from Decaid');
  await expect(again).toBeEnabled();
  await expect(again).toHaveValue(MOCK_GRINDER_IDS.nicheZero);
  await expect(again.locator('option:checked')).toHaveText(NICHE_LABEL);
  await expect(page.getByText(NICHE_STEPS)).toBeVisible();
  await expect(page.getByTestId(TID.grinderSetting)).toHaveValue('14.5');
});

test('with an empty grinder library the free-text fields and the library hint show', async ({ page }) => {
  await page.goto('./?mockSpeed=25&mockGrinders=0#/settings/grinder');
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByText(LIBRARY_HINT)).toBeVisible();
  await expect(page.getByLabel('Grinder from Decaid')).toHaveCount(0);
  await expect(page.getByTestId(TID.grinderName)).toBeVisible();
  await expect(page.getByTestId(TID.grinderSetting)).toBeVisible();
});

test("Add a grinder puts it in Decaid's library for every skin, picks it and links it at once", async ({ page }) => {
  await page.goto('./?mockSpeed=25&mockGrinders=0#/settings/grinder');
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await fillField(page, TID.grinderName, 'Mazzer Philos');
  await fillField(page, TID.grinderSetting, '12');
  const add = page.getByTestId(TID.addGrinder);
  expect((await add.boundingBox())?.height ?? 0, 'a full touch target').toBeGreaterThanOrEqual(47.5);
  await add.click();
  // Each field saved what was typed in it as it was left, the setting as Add a grinder took the tap.
  await expect(savedLine(page)).toHaveText('Saved.');

  const dialog = page.getByRole('dialog', { name: 'Add a grinder to Decaid' });
  await expect(dialog.getByTestId(TID.addGrinderModel)).toHaveValue('Mazzer Philos');
  await dialog.getByTestId(TID.addGrinderBurrs).fill('64 mm flat');
  await dialog.getByTestId(TID.addGrinderSmallStep).fill('0.5');
  await dialog.getByTestId(TID.addGrinderBigStep).fill('2');
  // So the next "Saved." is the pick's.
  await expect(savedLine(page)).toBeEmpty();
  await dialog.getByTestId(TID.addGrinderSubmit).click();
  await expect(dialog).toHaveCount(0);

  // In Decaid's grinder library, where Decaid and every skin read it.
  const library = await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.listGrinders() ?? []);
  expect(library).toEqual([
    expect.objectContaining({ model: 'Mazzer Philos', burrs: '64 mm flat', settingType: 'numeric', settingSmallStep: 0.5, settingBigStep: 2 }),
  ]);
  const picker = page.getByLabel('Grinder from Decaid');
  await expect(picker).toHaveValue(library[0]!.id);
  await expect(picker.locator('option:checked')).toHaveText('Mazzer Philos (64 mm flat)');
  await expect(page.getByText('Decaid lists steps of 0.5 for this grinder (big steps 2).')).toBeVisible();
  // Picked, so linked and saved there and then: no Save to press.
  await expect(page.getByTestId(TID.addGrinderNote)).toHaveText("Added Mazzer Philos (64 mm flat) to Decaid's grinders, and picked it.");
  await expect(savedLine(page)).toHaveText('Saved.');
  await expect(page.getByTestId(TID.grinderSetting)).toHaveValue('12');

  // The note stays until the next change.
  await page.getByTestId(TID.grinderSetting).fill('12.5');
  await expect(page.getByTestId(TID.addGrinderNote)).toHaveCount(0);
  await expect(picker).toHaveValue(library[0]!.id);
});
