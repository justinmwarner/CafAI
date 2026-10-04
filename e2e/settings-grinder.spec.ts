import { expect, test } from '@playwright/test';
import { MOCK_GRINDER_IDS } from '../mock/decaid/grinders.ts';
import { TID } from '../src/ui/testIds.ts';
import { openApp } from './helpers.ts';

/**
 * Settings links the grinder to Decaid's grinder library (D62). The mock
 * Decaid seeds three test grinders with fixed ids (mock/decaid/grinders.ts),
 * so a link made in Settings is still there after a reload;
 * `?mockGrinders=0` starts it with an empty library.
 */
const NICHE_LABEL = 'Niche Zero (63 mm conical)';
const NICHE_STEPS = 'Decaid lists steps of 0.5 for this grinder (big steps 2).';
const LIBRARY_HINT = "Add your grinder to Decaid's grinder library (for example with the DYE2 plugin) and CafAI will use its step size.";

test('a grinder picked from Decaid shows its step size and stays linked after a reload', async ({ page }) => {
  await openApp(page, '#/settings');
  const picker = page.getByLabel('Grinder from Decaid');
  await expect(picker).toBeEnabled();
  expect((await picker.boundingBox())?.height ?? 0, 'a full touch target').toBeGreaterThanOrEqual(47.5);

  await picker.selectOption({ label: NICHE_LABEL });
  await expect(page.getByText(NICHE_STEPS)).toBeVisible();
  // A picked grinder is named by its model; only the setting is typed.
  await expect(page.getByTestId(TID.grinderName)).toHaveCount(0);
  await page.getByTestId(TID.grinderSetting).fill('14.5');
  await page.getByTestId(TID.settingsSave).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

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
  await page.goto('./?mockSpeed=25&mockGrinders=0#/settings');
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByText(LIBRARY_HINT)).toBeVisible();
  await expect(page.getByLabel('Grinder from Decaid')).toHaveCount(0);
  await expect(page.getByTestId(TID.grinderName)).toBeVisible();
  await expect(page.getByTestId(TID.grinderSetting)).toBeVisible();
});
