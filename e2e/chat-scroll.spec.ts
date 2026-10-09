import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { openApp, pullShot, saveApiKey, sendChat } from './helpers.ts';

/**
 * "Visible" in Playwright only means rendered; this checks the element sits
 * inside the chat's scrolled viewport, where the barista can see and tap it.
 */
async function expectInView(page: Page, target: Locator, what: string): Promise<void> {
  const view = page.locator('.MuiChatMessageList-scroller');
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        const frame = await view.boundingBox();
        if (!box || !frame) return 'not rendered';
        const inside = box.y >= frame.y - 1 && box.y + box.height <= frame.y + frame.height + 1;
        return inside
          ? 'in view'
          : `outside: ${Math.round(box.y)}-${Math.round(box.y + box.height)} vs ${Math.round(frame.y)}-${Math.round(frame.y + frame.height)}`;
      },
      { message: what, timeout: 5_000 },
    )
    .toBe('in view');
}

test('every prompt the barista must act on is in view when it arrives', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');

  // The suggestions are listed best first: the best one is in view, not only the last.
  const best = page.getByTestId(TID.templatePick('blooming-espresso'));
  await expect(best).toBeVisible();
  await expectInView(page, best, 'the best template suggestion');
  await best.click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('v1');

  // A shot pulled from Espresso in the top bar (no tap in the chat) still brings the question into view.
  await pullShot(page);
  const sour = page.getByTestId(TID.optionChip('Sour / sharp'));
  await expect(sour).toBeVisible({ timeout: 60_000 });
  await expectInView(page, sour, 'the taste options after the shot');
  await sour.click();

  const confirm = page.getByTestId(TID.diffConfirm);
  await expect(confirm).toBeVisible();
  await expectInView(page, confirm, 'Confirm on the proposed change');
  await confirm.click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('v2');
  // The newest message: the stats card (D91) is a row of the chat too while it shows, but no message.
  const reply = page.locator('.MuiChatMessage-root').filter({ hasNot: page.getByTestId(TID.statsCard) }).last();
  await expectInView(page, reply, "the coach's reply after Confirm");
});
