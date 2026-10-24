import { expect, test, type Page } from '@playwright/test';
import { MOCK_STORE_KEY, MOCK_STORE_PREFIX, type MockStoreSnapshot } from '../mock/persist.ts';
import { CARE_DB_NAME } from '../src/storage/careDb.ts';
import { COACH_SOURCE_DB_NAME } from '../src/storage/coachSource.ts';
import { COACH_SOURCE_KEY, COACH_SOURCE_NAMESPACE } from '../src/storage/coachSourceBackup.ts';
import { CAFAI_DB_NAME } from '../src/storage/db.ts';
import { SECRETS_DB_NAME } from '../src/storage/secrets.ts';
import { TID } from '../src/ui/testIds.ts';
import { fillField, goTo, loseBrowserStorage, openApp, openAppWithSwitches, recordRequests, sendChat } from './helpers.ts';

/**
 * "Claude on my computer" (docs/superpowers/specs/2026-10-11-local-claude-design.md):
 * Settings finds CafAI Bridge on this device, saves its address and code, and
 * Test says what the bridge reports; the coach's turns then go to the bridge,
 * with its code, and never to Anthropic. Mock mode answers
 * http://127.0.0.1:8877 with the same scripted coach (mock/anthropic/bridge.ts),
 * so no bridge runs here.
 */
test('the coach answers through CafAI Bridge on this computer, without an API key', async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page, '#/settings');

  const section = page.getByRole('region', { name: 'Where the coach runs' });
  const keySection = page.getByRole('region', { name: 'Anthropic API key' });
  await expect(section.getByTestId(TID.coachSourceAnthropic)).toBeChecked();
  await expect(keySection).toBeVisible();
  await expect(section.getByTestId(TID.computerAddress)).toHaveCount(0);
  // The key's field and the bridge's address and code take turns with the choice (D140).
  await section.getByTestId(TID.coachSourceComputer).check();
  await expect(keySection).toHaveCount(0);
  await expect(section.getByTestId(TID.computerAddress)).toBeVisible();

  await section.getByTestId(TID.computerFind).click();
  await expect(section.getByText('Found CafAI Bridge on this device.')).toBeVisible();
  await expect(section.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1');
  await fillField(page, TID.computerCode, 'abcd-efgh');
  await section.getByTestId(TID.computerSave).click();
  await expect(section.getByText('Saved on this device.')).toBeVisible();
  await expect(section.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1:8877');
  await expect(section.getByTestId(TID.computerCode)).toHaveValue('ABCD-EFGH');

  await section.getByTestId(TID.computerTest).click();
  await expect(section.getByTestId(TID.computerStatus)).toHaveText(
    'Connected. Claude Code 2.1.251, signed in with Claude Max. 8% of the 5-hour limit used.',
  );

  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await expect(page.getByTestId(TID.templateCard('blooming-espresso'))).toBeVisible();

  const coachCalls = seen.filter((request) => new URL(request.url).pathname === '/v1/messages');
  expect(coachCalls.length).toBeGreaterThan(0);
  for (const call of coachCalls) {
    expect(call.url).toBe('http://127.0.0.1:8877/v1/messages');
    expect(call.headers['x-api-key']).toBe('ABCDEFGH');
  }
  expect(seen.filter((request) => request.url.startsWith('https://api.anthropic.com/'))).toEqual([]);
  // The probe ran on the coach's model.
  expect(seen.some((request) => request.url.startsWith('http://127.0.0.1:8877/v1/status?probe=1&model=claude-'))).toBe(true);
});

/** Where the coach runs as the mock Decaid saved it in this origin's localStorage, or null. */
function savedSourceCopy(page: Page): Promise<unknown> {
  return page.evaluate(
    ({ key, namespace, name }) => {
      const saved = localStorage.getItem(key);
      if (!saved) return null;
      const snapshot = JSON.parse(saved) as Partial<MockStoreSnapshot>;
      return snapshot.kv?.[namespace]?.[name] ?? null;
    },
    { key: MOCK_STORE_KEY, namespace: COACH_SOURCE_NAMESPACE, name: COACH_SOURCE_KEY },
  );
}

/**
 * A Decaid update can move CafAI to a new origin, with empty browser storage
 * (on an iPad every Decaid update does: docs/upstream/decaid-skin-origin-ios.md).
 * The bags come back from the mirror; where the coach runs comes back from its
 * own copy in Decaid (D229), unless that copy was turned off. `?mockPersist=1`
 * keeps the mock Decaid's store across the reload, as a real one keeps it on disk.
 */
test('a Decaid update that empties browser storage keeps the coach on the computer, unless its copy was turned off (D229)', async ({ page }) => {
  const PERSIST = { mockPersist: '1' };
  const lost = [CAFAI_DB_NAME, CARE_DB_NAME, SECRETS_DB_NAME, COACH_SOURCE_DB_NAME];
  const saved = { kind: 'computer', address: '127.0.0.1:8877', code: 'ABCDEFGH' };

  await openAppWithSwitches(page, PERSIST, '#/settings');
  const section = page.getByRole('region', { name: 'Where the coach runs' });
  await section.getByTestId(TID.coachSourceComputer).check();
  await expect(section.getByTestId(TID.sourceInDecaid)).toBeChecked();
  await section.getByTestId(TID.computerFind).click();
  await expect(section.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1');
  await fillField(page, TID.computerCode, 'abcd-efgh');
  await section.getByTestId(TID.computerSave).click();
  await expect(section.getByText('Saved on this device.')).toBeVisible();
  await expect.poll(() => savedSourceCopy(page), { message: 'the mock Decaid saved the copy' }).toEqual(saved);

  // The update: CafAI's own storage is gone, Decaid's store is not.
  expect((await loseBrowserStorage(page, lost, MOCK_STORE_PREFIX)).databasesAfter).not.toContain(COACH_SOURCE_DB_NAME);
  await openAppWithSwitches(page, PERSIST);
  await expect(page.getByRole('heading', { name: 'Add your Anthropic API key to start coaching' })).toHaveCount(0);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await goTo(page, 'settings');
  await expect(section.getByTestId(TID.coachSourceComputer)).toBeChecked();
  await expect(section.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1:8877');
  await expect(section.getByTestId(TID.computerCode)).toHaveValue('ABCD-EFGH');

  // Turned off, the copy leaves Decaid, and the next lost storage starts on Anthropic again.
  // The switch moves once Decaid has dropped the copy, not at the tap.
  await section.getByTestId(TID.sourceInDecaid).click();
  await expect(section.getByTestId(TID.sourceInDecaid)).not.toBeChecked();
  await expect.poll(() => savedSourceCopy(page), { message: 'the mock Decaid dropped the copy' }).toBeNull();
  await loseBrowserStorage(page, lost, MOCK_STORE_PREFIX);
  await openAppWithSwitches(page, PERSIST, '#/settings');
  await expect(section.getByTestId(TID.coachSourceAnthropic)).toBeChecked();
});
