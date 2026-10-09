import { expect, test } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { openApp, profileLine, pullShot, saveApiKey, sendChat, showStats } from './helpers.ts';

/**
 * The stats card's Profile line names the profile in Decaid's workflow
 * (D66), and marks it as the bag's own only when CafAI's tag and the title
 * match. The card sits under the key card before a key is saved, and in the
 * chat after that (D91), where anything new takes it away and Stats brings it
 * back.
 */
test("the Profile line follows the versions the coach loads", async ({ page }) => {
  await openApp(page);
  const profile = profileLine(page);

  // Before any bag: whatever Decaid had, with no claim that it is a bag's.
  const startTitle = await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getWorkflow().profile.title);
  await expect(profile).toContainText(startTitle);
  await expect(profile).not.toContainText('This bag');

  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed, blackcurrant and grapefruit');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v1');
  await showStats(page);
  await expect(profile).toContainText('Kiambu AA v1');
  await expect(profile).toContainText('This bag');

  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();
  await page.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v2');
  await showStats(page);
  await expect(profile).toContainText('Kiambu AA v2');
  await expect(profile).toContainText('This bag');

  // Two fixed lines: a title never wraps, and the whole title is on hover.
  const title = profile.locator('[title="Kiambu AA v2"]');
  await expect(title).toBeVisible();
  expect((await title.boundingBox())?.height ?? 0).toBeLessThan(30);
  expect((await profile.boundingBox())?.height ?? 0).toBeLessThan(48);

  // Offline, the line says Decaid loads it on connect, never "on the machine" (D42).
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.setMachineConnected(false));
  await expect(profile).toContainText('Decaid loads it when the machine connects');
  await expect(profile).toContainText('Kiambu AA v2');
  await expect(profile).not.toContainText(/on the machine/i);
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.setMachineConnected(true));
  await expect(profile).not.toContainText('Decaid loads it');
});

test('a profile changed outside CafAI shows up without a "This bag" mark', async ({ page }) => {
  await openApp(page);
  const profile = profileLine(page);
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Rwanda Huye, medium roast, natural');
  await page.getByTestId(TID.templatePick('d-flow')).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Rwanda Huye v1');
  await showStats(page);
  await expect(profile).toContainText('Rwanda Huye v1');
  await expect(profile).toContainText('This bag');

  // Another skin loads its own profile. Decaid merges the workflow, so
  // CafAI's tag stays behind, but the title no longer matches.
  await page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    state.updateWorkflow({ profile: { ...state.getWorkflow().profile, title: 'Picked in another skin' } });
  });
  // Coming back into view reads the workflow at once (otherwise the 30 s poll would).
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(profile).toContainText('Picked in another skin');
  await expect(profile).not.toContainText('This bag');
});
