import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { pullShot, recordRequests, saveApiKey, sendChat } from './helpers.ts';

/**
 * D55: a version is "on the machine" only once Decaid's barrier
 * (POST /api/v1/machine/profile) says the machine holds it. The mock DE1
 * keeps its own profile and takes ?mockUploadMs to upload a new one after the
 * workflow PUT; ?mockNoMachineProfile=1 answers the route like an older
 * Decaid (404), where CafAI keeps its old wording and asks only once.
 */

async function openWith(page: Page, switches: string): Promise<void> {
  await page.goto(`./?mockSpeed=25&${switches}#/`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
}

/** The title of the profile the mock DE1 holds (MockDecaid.getMachineProfile). */
async function machineProfileTitle(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state as unknown as
      | { getMachineProfile?: () => { title: string } }
      | undefined;
    return state?.getMachineProfile?.().title ?? null;
  });
}

async function pickFirstTemplate(page: Page): Promise<void> {
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
}

test('says a version is loaded only once the machine holds it', async ({ page }) => {
  await openWith(page, 'mockUploadMs=3000');
  await pickFirstTemplate(page);

  const loading = page.getByRole('status').filter({ hasText: 'Loading Kiambu AA v1 on the machine…' });
  await expect(loading).toBeVisible();
  await expect(loading.getByRole('progressbar')).toBeVisible();
  // Three seconds of upload: the machine still holds its previous profile.
  expect(await machineProfileTitle(page)).not.toBe('Kiambu AA v1');

  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await expect(page.getByText('Loading Kiambu AA v1 on the machine…')).toHaveCount(0);
  expect(await machineProfileTitle(page)).toBe('Kiambu AA v1');
});

test('keeps the loop going on an older Decaid without the machine-profile route', async ({ page }) => {
  const seen = recordRequests(page);
  await openWith(page, 'mockNoMachineProfile=1');
  await pickFirstTemplate(page);
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();

  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();
  const diff = page.getByTestId(TID.diffCard).last();
  await expect(diff).toBeVisible();
  await diff.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v2');
  await expect(page.getByText('Loaded Kiambu AA v2 on the machine.')).toBeVisible();

  // Asked once; the answer is remembered for the session.
  const posts = seen.filter((request) => new URL(request.url).pathname === '/api/v1/machine/profile' && request.body !== null);
  expect(posts).toHaveLength(1);
});
