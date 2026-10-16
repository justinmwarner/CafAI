import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import type { ShotRecord } from '../src/api/types.ts';
import { TID } from '../src/ui/testIds.ts';
import { goTo, isPhone, openApp, pullShot, saveApiKey, sendChat } from './helpers.ts';

/**
 * TDS and EY on the shot card (D-TDS-1 to D-TDS-9), on the tablets and the
 * phones: a quiet TDS cell among the card's numbers opens a field with the
 * decimal keyboard; the reading shows as TDS and EY, the EY worked out from
 * the card's own dose and yield; both go to the shot's record in the mock
 * Decaid (drinkTds, drinkEy); and the scripted coach says what it heard with
 * the next turn, whether the reading came before the taste answer or after
 * the coach proposed a change (ENGINE_PROTOCOL rule 0b).
 */

/** The newest shot record in the mock Decaid. */
async function latestShot(page: Page): Promise<ShotRecord | null> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const latest = state?.getLatestShot();
    return state && latest ? state.getShot(latest.id) : null;
  });
}

/** A new bag on Blooming Espresso v1, one shot pulled, its card in the chat and the coach done asking how it tasted. */
async function toShotCard(page: Page): Promise<Locator> {
  await openApp(page);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await pullShot(page);
  const card = page.getByTestId(TID.shotCard).last();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(TID.optionChip('Sour / sharp')).last()).toBeVisible({ timeout: 60_000 });
  await coachDone(page);
  return card;
}

/** Saving is held while the coach works (as the rating is): wait until it is done. */
async function coachDone(page: Page): Promise<void> {
  await expect(page.getByTestId(TID.chat), 'the coach is done').not.toHaveAttribute('data-busy');
}

/** The card's dose and yield, as its Dose → yield shows them: what the EY is worked out from. */
async function doseAndYield(card: Locator): Promise<{ doseG: number; yieldG: number }> {
  const value = await card.getByText('Dose → yield', { exact: true }).locator('xpath=following-sibling::*[1]').innerText();
  const [doseG, yieldG] = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (doseG === undefined || yieldG === undefined) throw new Error(`No dose and yield in "${value}"`);
  return { doseG, yieldG };
}

/** EY as CafAI shows it: TDS x yield / dose, to 0.1. */
const eyOf = (tdsPct: number, { doseG, yieldG }: { doseG: number; yieldG: number }) => Number(((tdsPct * yieldG) / doseG).toFixed(1));

/** Type a reading into the card's TDS field (opening it from the cell) and save it with the keyboard's Done. */
async function typeTds(card: Locator, typed: string): Promise<void> {
  const field = card.getByTestId(TID.tdsInput);
  if (!(await field.isVisible())) await card.getByTestId(TID.tdsCell).click();
  await expect(field).toBeVisible();
  await field.fill(typed);
  await field.press('Enter');
}

test('a reading typed before the taste answer reaches the coach with it, and Decaid gets the TDS and its EY', async ({ page }) => {
  const card = await toShotCard(page);
  const cell = card.getByTestId(TID.tdsCell);
  await expect(cell).toHaveAccessibleName('Add TDS');
  await expect(cell).toContainText('TDS');
  // One 48 px target; on a tablet it fills the empty fifth column of the numbers, so the card does not grow.
  const box = (await cell.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(47.5);
  if (!isPhone(page)) {
    const firstDrop = (await card.getByText('First drop', { exact: true }).boundingBox())!;
    expect(Math.abs(box.y + 3 - firstDrop.y), 'the TDS cell sits on the row of the other numbers').toBeLessThanOrEqual(8);
  }

  await cell.click();
  const field = card.getByTestId(TID.tdsInput);
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('inputmode', 'decimal');
  await expect(field).toHaveAttribute('enterkeyhint', 'done');
  await expect(card).toContainText('What your refractometer reads.');
  // A comma, as the numeric keyboard of some locales offers it.
  await field.fill('9,25');
  await field.press('Enter');

  const numbers = await doseAndYield(card);
  const ey = eyOf(9.25, numbers);
  await expect(card.getByTestId(TID.tdsCell)).toHaveAccessibleName('TDS 9.25 %, change it');
  await expect(card.getByTestId(TID.tdsEy)).toContainText(`${ey.toFixed(1)} %`);
  await expect.poll(async () => (await latestShot(page))?.annotations).toMatchObject({ drinkTds: 9.25, drinkEy: ey });

  // The taste answer carries the reading: the coach says what it heard, then reads the curve.
  await page.getByTestId(TID.optionChip('Sour / sharp')).last().click();
  await expect(page.getByTestId(TID.chat)).toContainText(`Noted: TDS 9.25 %, EY ${ey.toFixed(1)} %. Thanks. Let me look at the pressure curve.`);
  await expect(page.getByTestId(TID.diffCard).last()).toBeVisible();
});

test('a reading typed after the coach proposed a change reaches it with Confirm, the change card kept open meanwhile', async ({ page }) => {
  const card = await toShotCard(page);
  await page.getByTestId(TID.optionChip('Sour / sharp')).last().click();
  const diff = page.getByTestId(TID.diffCard).last();
  await expect(diff).toBeVisible();
  await coachDone(page);

  await typeTds(card, '9.5');
  const ey = eyOf(9.5, await doseAndYield(card));
  await expect(card.getByTestId(TID.tdsCell)).toHaveAccessibleName('TDS 9.50 %, change it');
  await expect.poll(async () => (await latestShot(page))?.annotations).toMatchObject({ drinkTds: 9.5, drinkEy: ey });
  // Nothing was sent to the coach: the change waits for its Confirm as it was.
  await expect(diff).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId(TID.chat)).not.toContainText('Noted: TDS');

  await diff.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.chat)).toContainText(`Noted: TDS 9.50 %, EY ${ey.toFixed(1)} %. Done. v2 is on the machine.`, { timeout: 30_000 });
});

test('a reading changed and removed: the field says why a number is not a TDS, Decaid follows, and the coach hears the removal', async ({ page }) => {
  const card = await toShotCard(page);
  await typeTds(card, '30');
  await expect(card.getByRole('alert')).toContainText('That is more than a refractometer reads (25 %). Check the number.');
  await expect(card.getByTestId(TID.tdsInput)).toHaveAttribute('aria-invalid', 'true');
  expect((await latestShot(page))?.annotations?.drinkTds).toBeUndefined();

  await typeTds(card, '9.1');
  await expect.poll(async () => (await latestShot(page))?.annotations?.drinkTds).toBe(9.1);
  // The coach hears 9.1 with the taste answer.
  await page.getByTestId(TID.optionChip('Sour / sharp')).last().click();
  await expect(page.getByTestId(TID.chat)).toContainText('Noted: TDS 9.10 %');
  await expect(page.getByTestId(TID.diffCard).last()).toBeVisible();
  await coachDone(page);

  // Changed: the field opens on the reading.
  await card.getByTestId(TID.tdsCell).click();
  await expect(card.getByTestId(TID.tdsInput)).toHaveValue('9.10');
  await typeTds(card, '9.4');
  await expect.poll(async () => (await latestShot(page))?.annotations?.drinkTds).toBe(9.4);

  // Removed: off the card, and both numbers cleared in Decaid.
  await card.getByTestId(TID.tdsCell).click();
  await card.getByTestId(TID.tdsRemove).click();
  await expect(card.getByTestId(TID.tdsCell)).toHaveAccessibleName('Add TDS');
  await expect(card.getByTestId(TID.tdsEy)).toHaveCount(0);
  await expect.poll(async () => Object.keys((await latestShot(page))?.annotations ?? {})).not.toContain('drinkTds');
  expect(Object.keys((await latestShot(page))?.annotations ?? {})).not.toContain('drinkEy');

  // The coach heard 9.1, so it hears that the reading is gone with the next tap.
  await page.getByTestId(TID.diffCard).last().getByTestId(TID.diffCancel).click();
  await expect(page.getByTestId(TID.chat)).toContainText('Noted: no TDS reading for that shot. OK, we keep v1 as it is.');
});

test('a reading stays on the card after a reload, and History keeps it on the shot', async ({ page }) => {
  const card = await toShotCard(page);
  await typeTds(card, '9.25');
  const ey = eyOf(9.25, await doseAndYield(card));
  await expect(card.getByTestId(TID.tdsEy)).toContainText(`${ey.toFixed(1)} %`);

  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  const again = page.getByTestId(TID.shotCard).last();
  await expect(again.getByTestId(TID.tdsCell)).toHaveAccessibleName('TDS 9.25 %, change it');
  await expect(again.getByTestId(TID.tdsEy)).toContainText(`${ey.toFixed(1)} %`);

  await goTo(page, 'history');
  await page.locator('[data-testid^="history-bag-"]').filter({ hasText: 'Kiambu AA' }).click();
  await expect(page.locator('[data-testid^="history-iteration-"]').first()).toContainText(`TDS 9.25 % · EY ${ey.toFixed(1)} %`);
});
