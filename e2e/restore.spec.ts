import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { MOCK_STORE_KEY, MOCK_STORE_PREFIX, type MockStoreSnapshot } from '../mock/persist.ts';
import { CARE_DB_NAME } from '../src/storage/careDb.ts';
import { CAFAI_DB_NAME } from '../src/storage/db.ts';
import { SECRETS_DB_NAME } from '../src/storage/secrets.ts';
import { TID } from '../src/ui/testIds.ts';
import {
  everythingDecaidSaw,
  loseBrowserStorage,
  openAppWithSwitches,
  openSettingsGroup,
  pullShot,
  saveApiKey,
  sendChat,
  settledMirror,
} from './helpers.ts';

/**
 * Restoring from the Decaid backup, end to end (D36, D60, D67): CafAI mirrors
 * its non-secret records to Decaid's key-value store, the browser storage is
 * lost, and the reloaded app rebuilds itself from the backup: everything but
 * the API key, which is never backed up. `?mockPersist=1` makes the mock
 * Decaid keep its store across the reload, as a real one keeps it on disk.
 *
 * The bag picker and the chat only show once a key is saved, so the checks
 * that need no key (the key card, Settings, History, what Decaid holds) run
 * first, and the bag and conversation checks after the key is saved again.
 */

const API_KEY = 'sk-ant-e2e-restore';
const INTAKE = 'Kiambu AA, light roast, washed';
const PERSIST = { mockPersist: '1' };

/** The mock Decaid's saved store, as kept in this origin's localStorage ('' when there is none). */
function savedStore(page: Page): Promise<string> {
  return page.evaluate((key) => localStorage.getItem(key) ?? '', MOCK_STORE_KEY);
}

/** Whether the saved store holds the live mock's cafai namespace, exactly. */
function savedBackupIsCurrent(page: Page): Promise<boolean> {
  return page.evaluate((key) => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const saved = localStorage.getItem(key);
    if (!state || !saved) return false;
    const snapshot = JSON.parse(saved) as Partial<MockStoreSnapshot>;
    return JSON.stringify(snapshot.kv?.['cafai'] ?? null) === JSON.stringify(state.kvAll('cafai'));
  }, MOCK_STORE_KEY);
}

test('a reload after lost browser storage restores bags, history and the chat from Decaid, but not the API key', async ({ page }) => {
  // Two shots, a reload and two waits for the backup to settle.
  test.setTimeout(180_000);

  // 1. Dial a bag in to v2 and let the backup reach Decaid.
  await openAppWithSwitches(page, PERSIST);
  await saveApiKey(page, API_KEY);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, INTAKE);
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v1');
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();
  await expect(page.getByTestId(TID.diffCard)).toBeVisible();
  await page.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v2');
  // New bag stays disabled while the coach works; once it is idle, wait for the last push.
  await expect(page.getByTestId(TID.newBag)).toBeEnabled();
  const backup = await settledMirror(page, 'Kiambu AA v2');
  expect(backup).toContain(INTAKE);
  await expect.poll(() => savedBackupIsCurrent(page), { message: 'the mock Decaid saved its store' }).toBe(true);

  // 2. Lose the browser storage: CafAI's databases (its data, machine care's
  // steps and the key) and its own localStorage keys, but not the mock
  // Decaid's saved store.
  const lost = await loseBrowserStorage(page, [CAFAI_DB_NAME, CARE_DB_NAME, SECRETS_DB_NAME], MOCK_STORE_PREFIX);
  expect(lost.databasesBefore).toEqual(expect.arrayContaining([CAFAI_DB_NAME, CARE_DB_NAME, SECRETS_DB_NAME]));
  expect(lost.deleted).toEqual({ [CAFAI_DB_NAME]: 'deleted', [CARE_DB_NAME]: 'deleted', [SECRETS_DB_NAME]: 'deleted' });
  expect(lost.databasesAfter).not.toContain(CAFAI_DB_NAME);
  expect(lost.databasesAfter).not.toContain(CARE_DB_NAME);
  expect(lost.databasesAfter).not.toContain(SECRETS_DB_NAME);
  expect(lost.removedKeys.length).toBeGreaterThan(0);
  expect(lost.keptKeys).toEqual([MOCK_STORE_KEY]);
  expect(await savedStore(page)).toContain('Kiambu AA v2');

  // 3. Reload the app.
  await openAppWithSwitches(page, PERSIST);

  // 4. The API key was not restored: the coach asks for one, Settings >
  // Coach has none, and nothing the mock Decaid saw or stores holds it.
  await expect(page.getByRole('heading', { name: 'Add your Anthropic API key to start coaching' })).toBeVisible();
  // The bags came back, and the card says so (machine care's last times alone would not: D189).
  await expect(page.getByText("Your bags came from Decaid's backup. Paste your API key to go on.")).toBeVisible();
  await openSettingsGroup(page, 'coach');
  await expect(page.getByRole('status').filter({ hasText: 'No key saved yet' })).toBeVisible();
  await expect(page.getByTestId(TID.forgetKey)).toHaveCount(0);
  expect(await everythingDecaidSaw(page)).not.toContain(API_KEY);
  expect(await savedStore(page)).not.toContain(API_KEY);

  // History is back: v1 with the shot's taste and the applied change, v2 with the change.
  await page.getByTestId(TID.navHistory).click();
  const bagRows = page.locator('[data-testid^="history-bag-"]');
  await expect(bagRows).toHaveCount(1);
  await expect(bagRows).toContainText('Kiambu AA');
  const bagId = ((await bagRows.getAttribute('data-testid')) ?? '').slice('history-bag-'.length);
  expect(bagId).not.toBe('');
  await bagRows.click();
  const v1 = page.getByTestId(TID.historyVersion(1));
  const v2 = page.getByTestId(TID.historyVersion(2));
  await expect(v1).toContainText('Kiambu AA v1');
  await expect(v1).toContainText('Sour / sharp');
  await expect(v1).toContainText('Change applied');
  await expect(v2).toContainText('Kiambu AA v2');
  await expect(v2).toContainText('Brew temperature');

  // With the key saved again, the bag is back in the picker with v2 active,
  // and so is the conversation.
  await saveApiKey(page, API_KEY);
  await expect(page.getByRole('status').filter({ hasText: 'A key is saved' })).toBeVisible();
  await page.getByTestId(TID.navCoach).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v2');
  const picker = page.getByTestId(TID.bagPicker);
  await expect(picker).toHaveValue(bagId);
  await expect(picker.locator('option')).toHaveText(['Kiambu AA']);
  const chat = page.getByTestId(TID.chat);
  await expect(chat).toContainText(INTAKE);
  await expect(chat).toContainText('Brew temperature');
  const shotCards = page.getByTestId(TID.shotCard);
  await expect(shotCards).toHaveCount(1);
  const chips = page.locator('[data-testid^="option-"]');
  const chipsBefore = await chips.count();
  expect(chipsBefore).toBeGreaterThan(0);

  // 5. The restored transcript is still a valid conversation: another shot
  // brings its card and fresh taste options (the old ones stay, answered).
  await pullShot(page);
  await expect(shotCards).toHaveCount(2, { timeout: 60_000 });
  await expect.poll(() => chips.count(), { message: 'fresh taste options after the new shot', timeout: 30_000 }).toBeGreaterThan(chipsBefore);
  const newest = chips.last();
  await expect(newest).toHaveText(/Other/);
  await expect(newest).toBeEnabled();
  await expect(chips.filter({ hasText: 'Sour / sharp' }).last()).toBeEnabled();
  expect(await everythingDecaidSaw(page)).not.toContain(API_KEY);
  expect(await savedStore(page)).not.toContain(API_KEY);
});
