import { expect, test, type Page } from '@playwright/test';
import type { ShotRecord } from '../src/api/types.ts';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { VERIFIED_DECAID } from '../src/api/decaidVersion.ts';
import { TID } from '../src/ui/testIds.ts';
import {
  decaidRequests,
  goTo,
  openApp,
  openAppWithSwitches,
  pullShot,
  saveApiKey,
  sendChat,
  settledMirror,
  statsCard,
} from './helpers.ts';

/**
 * CafAI fails safe with whatever Decaid it meets (spec sections 4 and 5), in
 * every layout: gateway mode Full gets an alert with a one-tap fix, and
 * CafAI never changes it by itself (5.1, D98); the API key's copy in Decaid
 * is the barista's choice (5.6, D99); the rating scale is asked, not assumed
 * (5.14, D101); and About says which Decaid runs and what it sent that CafAI
 * did not expect (4.6, D96). Each is checked against what the mock Decaid
 * received and holds.
 */

/** The mock answers GET /api/v1/info as a 0.8.6 field build. */
const MOCK_DECAID = '0.8.6+2801';
const SECOND_KEY = 'sk-ant-e2e-second';

/** Decaid's gateway mode, as the mock holds it. */
async function gatewayMode(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getSettings().gatewayMode);
}

/** The bodies of every POST /api/v1/settings the mock received. */
async function settingsPosts(page: Page): Promise<unknown[]> {
  return (await decaidRequests(page)).filter((request) => request.method === 'POST' && request.path === '/api/v1/settings').map((request) => request.body);
}

/** The key's copy in Decaid's cafai-key namespace, or null. */
async function keyCopy(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.kvGet('cafai-key', 'anthropic'));
}

/** The newest shot record in the mock Decaid. */
async function latestShot(page: Page): Promise<ShotRecord | null> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const latest = state?.getLatestShot();
    return state && latest ? state.getShot(latest.id) : null;
  });
}

/** New bag, v1 on the machine, one shot pulled from Espresso in the top bar. */
async function pullFirstShot(page: Page): Promise<void> {
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
}

test('gateway mode Full gets an alert, and Let Decaid stop shots hands stopping back to Decaid', async ({ page }) => {
  await openAppWithSwitches(page, { mockGateway: 'full' });
  const alert = page.getByTestId(TID.machineAlerts);
  await expect(alert.getByTestId(TID.gatewayAlert)).toHaveText(
    'Decaid is set to leave stopping shots to the skin, and CafAI does not stop them, so shots will not stop at the target weight.',
  );
  // CafAI read the setting and left it alone: changing it is the barista's call.
  expect(await gatewayMode(page)).toBe('full');
  expect(await settingsPosts(page)).toEqual([]);

  await alert.getByTestId(TID.gatewayFix).click();
  await expect(page.getByTestId(TID.gatewayAlert)).toHaveCount(0);
  await expect(alert).toHaveCount(0);
  // One POST asking for Tracking, and Decaid holds it.
  expect(await settingsPosts(page)).toEqual([{ gatewayMode: 'tracking' }]);
  expect(await gatewayMode(page)).toBe('tracking');
});

test('Keep my API key in Decaid copies the key to its own namespace while on, and deletes it when off', async ({ page }) => {
  await openApp(page, '#/settings');
  const keep = page.getByTestId(TID.keyInDecaid);
  // Nothing to keep before a key is saved.
  await expect(keep).toBeDisabled();
  await expect(page.getByText('Add a key above before turning this on.')).toBeVisible();
  await saveApiKey(page);
  await expect(page.getByText('Key saved on this device.')).toBeVisible();
  // Off by default, saying what a copy costs, and Decaid holds nothing.
  await expect(keep).not.toBeChecked();
  await expect(keep).toBeEnabled();
  await expect(
    page.getByText("So you do not have to paste it again after a Decaid update. Any device on your network can read Decaid's store, and Decaid's backups include it."),
  ).toBeVisible();
  expect(await keyCopy(page)).toBeNull();

  // On: the key goes to the cafai-key namespace, and a key saved while it is on replaces the copy.
  await keep.click();
  await expect(keep).toBeChecked();
  await expect.poll(() => keyCopy(page)).toBe('sk-ant-e2e-test');
  await saveApiKey(page, SECOND_KEY);
  await expect.poll(() => keyCopy(page)).toBe(SECOND_KEY);
  // The backup of CafAI's records in the cafai namespace keeps the choice, never the key.
  const mirrored = await settledMirror(page, '"keepKeyInDecaid":true');
  expect(mirrored).not.toContain('sk-ant-e2e');

  // Off: the copy is deleted.
  await keep.click();
  await expect(keep).not.toBeChecked();
  await expect.poll(() => keyCopy(page)).toBeNull();
});

test('a Decaid on the 0-100 rating scale gets the stars x 20, after one probe with a made-up shot', async ({ page }) => {
  await openAppWithSwitches(page, { mockEnjoyment: '100' });
  await saveApiKey(page);
  await pullFirstShot(page);
  const shotId = (await latestShot(page))!.id;
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();

  // The stars wait until the coach is done (busy blocks them), then 4 stars = enjoyment 80 of 100.
  await expect(page.getByTestId(TID.diffCard).last()).toBeVisible();
  const four = page.getByTestId(TID.shotCard).last().getByRole('radio', { name: 'Rate 4 out of 5' });
  await expect(four).toBeEnabled();
  await four.click();
  await expect(four).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await latestShot(page))?.annotations?.enjoyment).toBe(80);
  expect((await latestShot(page))?.annotations?.extras?.cafai).toMatchObject({ stars: 4 });

  // The scale came from one probe: enjoyment 11 for a shot that does not exist, which 0.8.6 answers 404 instead of 400.
  const probes = (await decaidRequests(page)).filter(
    (request) => request.method === 'PUT' && request.path.startsWith('/api/v1/shots/') && request.path !== `/api/v1/shots/${shotId}`,
  );
  expect(probes.map((request) => request.body)).toEqual([{ annotations: { enjoyment: 11 } }]);
});

test('About names the Decaid that runs and the one CafAI was verified with, and when CafAI last backed up to it', async ({ page }) => {
  await openApp(page, '#/settings');
  const about = page.getByTestId(TID.aboutDecaid);
  await expect(page.getByText(/^CafAI \d+\.\d+\.\d+/)).toBeVisible();
  // The mock's 0.8.6 is older than the Decaid CafAI was verified with, and About says so.
  await expect(about).toContainText(`Decaid ${MOCK_DECAID} (CafAI was verified with ${VERIFIED_DECAID.release})`);
  await expect(about).toContainText('Older than the Decaid CafAI was checked against; update Decaid if something does not work.');
  // This Decaid sends nothing CafAI does not expect: no list, no report.
  await expect(about.getByTestId(TID.driftReport)).toHaveCount(0);
  await expect(about.getByTestId(TID.copyDriftReport)).toHaveCount(0);

  // A saved setting goes to the backup in Decaid's store, and About says when the next time it opens.
  await page.getByTestId(TID.settingsSave).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await settledMirror(page, '"meta"');
  await goTo(page, 'coach');
  await goTo(page, 'settings');
  await expect(about.getByTestId(TID.backupHealth)).toHaveText('Backed up to Decaid 0 min ago');
});

test('a reading Decaid renamed is a dash on the stats card and an entry in About, with a report to copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // ?mockDrift=1: the mock's machine frames carry groupTemperature as groupTemp.
  await openAppWithSwitches(page, { mockDrift: '1' });
  const card = statsCard(page);
  const group = card.getByTestId(TID.groupTemp);
  // The machine's frames are in (the target and the steam reading show), but the group's reading is a dash, never a 0 that reads as a measurement.
  await expect(group).toContainText(/target \d+\.\d/);
  await expect(card.getByTestId(TID.steamTemp)).toContainText(/\d+\s*°C/);
  await expect(group).toContainText('—');
  await expect(group).not.toContainText(/\d+\.\d\s*°C/);

  await goTo(page, 'settings');
  const about = page.getByTestId(TID.aboutDecaid);
  const entries = about.getByTestId(TID.driftReport).getByRole('listitem');
  await expect(entries.filter({ hasText: 'ws/v1/machine/snapshot: groupTemperature: missing' })).toHaveCount(1);
  // Every entry is the renamed reading (the start-up read of GET /machine/state may have met it too), and the count says how many.
  const listed = await entries.allTextContents();
  for (const entry of listed) expect(entry).toMatch(/: groupTemperature: missing$/);
  await expect(about).toContainText(`Decaid sent ${listed.length} ${listed.length === 1 ? 'thing' : 'things'} CafAI did not expect`);

  // Copy report: CafAI's version, the running and the verified Decaid, and each entry with its count.
  await about.getByTestId(TID.copyDriftReport).click();
  await expect(about.getByRole('status')).toHaveText('Copied.');
  const [head, ...lines] = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  expect(head).toMatch(/^CafAI \S+ with Decaid /);
  expect(head).toContain(` with Decaid ${MOCK_DECAID} (verified with ${VERIFIED_DECAID.release})`);
  expect(lines).toHaveLength(listed.length);
  expect(lines).toContainEqual(expect.stringMatching(/^ws\/v1\/machine\/snapshot: groupTemperature: missing \(\d+ times?, first /));
});
