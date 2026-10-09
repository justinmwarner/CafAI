import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { MOCK_GRINDER_IDS } from '../mock/decaid/grinders.ts';
import { TID } from '../src/ui/testIds.ts';
import { fillField, openApp, pullShot, saveApiKey, sendChat } from './helpers.ts';

/**
 * A grind move on the grinder linked from Decaid's grinder library (D62).
 * The mock seeds a Niche Zero that Decaid lists with 0.5 steps, so the
 * scripted coach's "one step finer" from 15 is 14.5 (ENGINE_PROTOCOL,
 * scripted rule 2). CafAI checks it on the grinder's grid, says where the
 * step came from, and on Confirm saves the setting and writes it to Decaid's
 * workflow context with the grinder's id.
 */
const NICHE_LABEL = 'Niche Zero (63 mm conical)';

/** The grinder fields of the workflow context in the mock Decaid. */
async function workflowGrinder(page: Page) {
  return page.evaluate(() => {
    const context = (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow().context;
    return {
      grinderId: context?.grinderId ?? null,
      grinderModel: context?.grinderModel ?? null,
      grinderSetting: context?.grinderSetting ?? null,
    };
  });
}

test("a grind move uses the linked grinder's steps and reaches Settings and Decaid", async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);

  // Settings: link the Niche Zero from Decaid's library; its dial is on 15.
  const picker = page.getByLabel('Grinder from Decaid');
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: NICHE_LABEL });
  await fillField(page, TID.grinderSetting, '15');
  await page.getByTestId(TID.settingsSave).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect
    .poll(() => workflowGrinder(page))
    .toEqual({ grinderId: MOCK_GRINDER_IDS.nicheZero, grinderModel: 'Niche Zero', grinderSetting: '15' });

  // A bag, a template, a shot.
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });

  // A taste the scripted coach does not recognise: one step finer, on the grinder's own grid.
  const other = page.getByTestId(TID.optionChip('Other'));
  await expect(other).toBeVisible();
  await other.click();
  await fillField(page, TID.otherInput, 'Muddy');
  await page.getByTestId(TID.optionsSubmit).click();
  const card = page.getByTestId(TID.diffCard).filter({ hasText: 'Set the grinder to 14.5' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Set the grinder to 14.5 before the next shot (Decaid lists 0.5 steps for your Niche Zero).');
  expect(await workflowGrinder(page)).toEqual({ grinderId: MOCK_GRINDER_IDS.nicheZero, grinderModel: 'Niche Zero', grinderSetting: '15' });

  await card.getByTestId(TID.diffConfirm).click();
  await expect
    .poll(() => workflowGrinder(page))
    .toEqual({ grinderId: MOCK_GRINDER_IDS.nicheZero, grinderModel: 'Niche Zero', grinderSetting: '14.5' });

  // Settings shows the new setting too.
  await page.getByTestId(TID.navSettings).click();
  await expect(page.getByTestId(TID.grinderSetting)).toHaveValue('14.5');
});
