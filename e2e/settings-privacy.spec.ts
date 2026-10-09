import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { CAFAI_DB_NAME } from '../src/storage/db.ts';
import { TID } from '../src/ui/testIds.ts';
import { everythingDecaidSaw, fillField, openApp, pullShot, recordRequests, saveApiKey, sendChat, settledMirror } from './helpers.ts';

/**
 * An API key pasted into Settings' grinder fields or model never becomes a
 * setting (D37). Before the fix it travelled on in PUT /workflow, stayed in
 * Decaid's workflow and every later shot record (which Decaid shares with
 * Visualizer), went to Anthropic in the coach's context and shot events, and
 * sat in IndexedDB. The key only ever travels as the x-api-key header.
 */

/**
 * What a 20-character field keeps of the key after "sk-ant-api03-", so any
 * trace of it, a cut one included, carries MARK.
 */
const MARK = 'Qx7pRv9';
/** A made-up key, built at run time. */
const KEY = ['sk', 'ant', 'api03', `${MARK}privacyE2e${Date.now().toString(36)}`, 'Zz9Yy8Xx7Ww6Vv5Uu4AA'].join('-');
const KEY_TAKEN_OUT = 'That looked like an API key, so CafAI took it out. Keys go in the API key field above.';
const DEFAULT_MODEL = 'claude-opus-5-5';

/** The grinder fields of Decaid's workflow context (Decaid leaves nulls out). */
async function workflowGrinder(page: Page) {
  return page.evaluate(() => {
    const context = (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow().context;
    return { grinderModel: context?.grinderModel ?? null, grinderSetting: context?.grinderSetting ?? null };
  });
}

/** The grinder fields of the newest shot record's workflow context, or null without a shot. */
async function shotGrinder(page: Page) {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const latest = state?.getLatestShot();
    const context = state && latest ? state.getShot(latest.id).workflow.context : undefined;
    return latest ? { grinderModel: context?.grinderModel ?? null, grinderSetting: context?.grinderSetting ?? null } : null;
  });
}

/** CafAI's settings as IndexedDB holds them, read raw rather than through CafAI. */
async function storedSettings(page: Page): Promise<string> {
  return page.evaluate(
    (name) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('settings', 'readonly').objectStore('settings').getAll();
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(read.result));
          };
        };
      }),
    CAFAI_DB_NAME,
  );
}

test('a key pasted into the grinder fields and the model never reaches Decaid or the coach', async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page);
  await saveApiKey(page, KEY);
  await expect(page.getByText('Key saved on this device.')).toBeVisible();

  // The same key, pasted after a grinder name and over the setting (which keeps 20 characters)...
  await fillField(page, TID.grinderName, `Niche Zero ${KEY}`);
  await fillField(page, TID.grinderSetting, KEY);
  // ...and as the model. The model is a list, so only a crafted value can carry a key: plant one.
  const model = page.getByTestId(TID.modelSelect);
  await model.evaluate((select, key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = 'Planted';
    option.setAttribute('data-planted', '');
    select.appendChild(option);
  }, KEY);
  await model.selectOption(KEY);
  await expect(model).toHaveValue(KEY);
  await model.evaluate((select) => select.querySelector('option[data-planted]')?.remove());
  await page.getByTestId(TID.settingsSave).click();

  // Settings says it took the key out, in view, and shows what was really saved.
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect(page.getByText(KEY_TAKEN_OUT)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
  await expect(page.getByTestId(TID.grinderSetting)).toHaveValue('');
  await expect(model).toHaveValue(DEFAULT_MODEL);
  // The rest of the grinder still reaches Decaid's workflow (D54).
  await expect.poll(() => workflowGrinder(page)).toEqual({ grinderModel: 'Niche Zero', grinderSetting: null });

  // A bag, a template, a shot, the taste answer.
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();
  await expect(page.getByTestId(TID.diffCard)).toBeVisible();

  // The shot record carries the grinder as saved; the backup holds it too, once settled.
  await expect.poll(() => shotGrinder(page)).toEqual({ grinderModel: 'Niche Zero', grinderSetting: null });
  const mirrored = await settledMirror(page, 'Kiambu AA');
  expect(mirrored).toContain('Niche Zero');

  // Nothing key-shaped anywhere in Decaid: requests, the backup, shot records, the workflow.
  const decaid = await everythingDecaidSaw(page);
  expect(decaid).not.toContain(MARK);
  expect(decaid).not.toMatch(/sk-ant-/);

  // To Anthropic the key goes in its header only; the coach ran on the default model.
  const isAnthropic = (url: string) => new URL(url).hostname === 'api.anthropic.com';
  const toAnthropic = seen.filter((request) => isAnthropic(request.url));
  expect(toAnthropic.length).toBeGreaterThan(0);
  for (const request of toAnthropic) {
    expect(request.headers['x-api-key']).toBe(KEY);
    const body = request.body ?? '';
    expect(body).not.toContain(MARK);
    if (body) expect((JSON.parse(body) as { model?: unknown }).model).toBe(DEFAULT_MODEL);
  }
  // Every other request the page made, whoever answered it.
  expect(JSON.stringify(seen.filter((request) => !isAnthropic(request.url)))).not.toContain(MARK);

  // Nor does the key sit in CafAI's own settings record.
  const stored = await storedSettings(page);
  expect(stored).toContain('Niche Zero');
  expect(stored).not.toContain(MARK);
});
