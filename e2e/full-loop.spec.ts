import { expect, test } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { openApp, saveApiKey, sendChat } from './helpers.ts';

/**
 * The whole dial-in loop against the mock: new bag -> template suggestions ->
 * pick -> v1 uploaded -> scripted fake shot -> taste feedback -> one bounded
 * change confirmed as v2 -> per-bean history. The model is the scripted fake
 * in mock/anthropic (docs/briefs/ENGINE_PROTOCOL.md), Decaid is the MSW mock.
 */
test('new bag to confirmed v2 and history', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);

  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');

  await sendChat(page, 'Kiambu AA, light roast, washed, blackcurrant and grapefruit');

  // 2-5 template suggestions with confidence; a light roast ranks Blooming first.
  const cards = page.locator('[data-testid^="template-card-"]');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count).toBeLessThanOrEqual(5);
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v1');

  // Pull the scripted fake shot from the machine panel.
  await page.getByTestId(TID.espressoButton).click();
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });

  // Tappable taste options, "Other" always last.
  const chips = page.locator('[data-testid^="option-"]');
  await expect(chips.last()).toHaveText(/Other/);
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();

  // One bounded change as a plain-language diff that needs a confirm tap.
  const diff = page.getByTestId(TID.diffCard);
  await expect(diff).toBeVisible();
  await expect(diff).toContainText('Brew temperature');
  await expect(page.getByTestId(TID.activeVersion)).toContainText('v1');
  await page.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v2');

  // Per-bean version history.
  await page.getByTestId(TID.navHistory).click();
  const bag = page.locator('[data-testid^="history-bag-"]').first();
  await bag.click();
  await expect(page.getByTestId(TID.historyVersion(1))).toBeVisible();
  await expect(page.getByTestId(TID.historyVersion(2))).toBeVisible();
  await expect(page.getByTestId(TID.historyVersion(2))).toContainText('Brew temperature');
});

test('undo returns the machine to the previous version', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Rwanda Huye, medium roast, natural');
  await page.getByTestId(TID.templatePick('d-flow')).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('v1');
  await page.getByTestId(TID.espressoButton).click();
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(TID.optionChip('Bitter / harsh')).click();
  await page.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('v2');

  await page.getByTestId(TID.undoButton).first().click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('v1');
});
