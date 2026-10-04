import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { openApp, saveApiKey, sendChat } from './helpers.ts';

/**
 * D65: while CafAI asks Decaid for a just-finished shot (six tries over about
 * 15 s), the chat says so with a progress bar, updated on each try, until the
 * shot card or the warning takes its place. Retry searches again, visibly.
 */

const SEARCH = 'Looking for that shot in Decaid…';

async function loadFirstVersion(page: Page): Promise<void> {
  await openApp(page);
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
}

/** Resolves once the mock machine has dropped off in the middle of the pour. */
async function dropMachineWhilePouring(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
        const stop = state.on('shotState', (event) => {
          if (event.state !== 'pouring') return;
          stop();
          // After the frame that announced the pour, not inside its delivery.
          setTimeout(() => {
            state.setMachineConnected(false);
            resolve();
          }, 0);
        });
      }),
  );
}

test('shows the search while Decaid saves a shot, then the shot card in its place', async ({ page }) => {
  await loadFirstVersion(page);
  // Decaid answers 404 for the record three times, as while it is still saving it.
  await page.evaluate(() =>
    (window as CafaiMockWindow).__CAFAI_MOCK__?.state.failNext({
      method: 'GET',
      path: /^\/api\/v1\/shots\/[^/]+$/,
      status: 404,
      body: { error: 'Shot not found' },
      times: 3,
    }),
  );
  await page.getByTestId(TID.espressoButton).click();

  const search = page.getByRole('status').filter({ hasText: SEARCH });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await expect(search.getByRole('progressbar')).toBeVisible();
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(SEARCH)).toHaveCount(0);
});

test('shows the search again on Retry after the machine dropped mid-shot', async ({ page }) => {
  await loadFirstVersion(page);
  const dropped = dropMachineWhilePouring(page);
  await page.getByTestId(TID.espressoButton).click();
  await dropped;

  const search = page.getByText(SEARCH);
  await expect(search).toBeVisible({ timeout: 30_000 });
  // Six tries over about 15 s, then the warning, and the banner with Retry.
  await expect(page.getByText(/The machine disconnected during that shot/)).toBeVisible({ timeout: 40_000 });
  await expect(search).toHaveCount(0);
  await expect(page.getByTestId(TID.errorBanner)).toContainText('Decaid has not saved that shot yet.');

  await page.getByTestId(TID.retryButton).click();
  await expect(search).toBeVisible({ timeout: 10_000 });
});
