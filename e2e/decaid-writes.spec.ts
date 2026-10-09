import { expect, test, type Page } from '@playwright/test';
import type { ShotRecord } from '../src/api/types.ts';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { fillField, openApp, pullShot, saveApiKey, sendChat } from './helpers.ts';

/**
 * CafAI's writes to Decaid: the taste answer and the star rating land in the
 * shot record (D61), and a grinder setting Decaid could not take is sent
 * again once Decaid is back (D64).
 */

/** The newest shot record in the mock Decaid. */
async function latestShot(page: Page): Promise<ShotRecord | null> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const latest = state?.getLatestShot();
    return state && latest ? state.getShot(latest.id) : null;
  });
}

async function workflowGrinderSetting(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow().context?.grinderSetting ?? null);
}

/** New bag, v1 on the machine, one shot pulled from Espresso in the top bar. */
async function pullFirstShot(page: Page): Promise<void> {
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
}

test('writes the taste and the star rating to the shot record', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  await pullFirstShot(page);

  await page.getByTestId(TID.optionChip('Sour / sharp')).click();
  await expect.poll(async () => (await latestShot(page))?.annotations?.espressoNotes ?? '').toContain(
    'Taste: Sour / sharp. Kiambu AA v1 (CafAI)',
  );
  expect((await latestShot(page))?.annotations?.extras?.cafai).toMatchObject({
    version: 1,
    selected: ['Sour / sharp'],
    notes: 'Taste: Sour / sharp. Kiambu AA v1 (CafAI)',
  });

  // The stars wait until the coach is done (busy blocks them), then 4 stars = enjoyment 8 of 10.
  await expect(page.getByTestId(TID.diffCard).last()).toBeVisible();
  const four = page.getByTestId(TID.shotCard).last().getByRole('radio', { name: 'Rate 4 out of 5' });
  await expect(four).toBeEnabled();
  expect((await four.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(47.5);
  await four.click();
  await expect(four).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await latestShot(page))?.annotations?.enjoyment).toBe(8);
  expect((await latestShot(page))?.annotations?.extras?.cafai).toMatchObject({ stars: 4 });

  // The rating lives on the shot card in the transcript, so it comes back after a reload.
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByTestId(TID.shotCard).last().getByRole('radio', { name: 'Rate 4 out of 5' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('sends a grind setting Decaid could not take once Decaid is back', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  // A plain number, so the scripted coach names the new setting (ENGINE_PROTOCOL rule 2).
  await fillField(page, TID.grinderSetting, '14');
  await page.getByTestId(TID.settingsSave).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await pullFirstShot(page);

  // A taste the scripted coach does not recognise: it proposes one step finer, to 13.
  await page.getByTestId(TID.optionChip('Other')).click();
  await fillField(page, TID.otherInput, 'Muddy');
  await page.getByTestId(TID.optionsSubmit).click();
  const diff = page.getByTestId(TID.diffCard).last();
  await expect(diff).toContainText(/grind/i);
  expect(await workflowGrinderSetting(page)).toBe('14');

  await page.evaluate(() =>
    (window as CafaiMockWindow).__CAFAI_MOCK__?.state.failNext({
      method: 'PUT',
      path: '/api/v1/workflow',
      status: 503,
      body: { error: 'Machine write queue is full' },
      times: 1,
    }),
  );
  await diff.getByTestId(TID.diffConfirm).click();
  await expect(page.getByText("Decaid can't be reached right now. CafAI will send grinder setting 13 as soon as it can.")).toBeVisible();
  expect(await workflowGrinderSetting(page)).toBe('14');

  // Decaid is back (its devices socket reconnects): the setting goes out, without another notice.
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.dropSockets('devices'));
  await expect.poll(() => workflowGrinderSetting(page), { timeout: 20_000 }).toBe('13');
  await expect(page.getByText(/Decaid can't be reached right now/)).toHaveCount(1);
});
