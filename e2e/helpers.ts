import { expect, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';

/**
 * Open the mock-mode build. `mockSpeed` compresses the scripted shot's wall
 * time (data timestamps stay realistic); the hash picks the route.
 */
export async function openApp(page: Page, route = '#/', mockSpeed = 25): Promise<void> {
  await page.goto(`./?mockSpeed=${mockSpeed}${route}`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
}

/** Fill an MUI text field whether the test id sits on the input or its wrapper. */
export async function fillField(page: Page, testId: string, value: string): Promise<void> {
  const target = page.getByTestId(testId);
  const tag = await target.evaluate((el) => el.tagName.toLowerCase());
  const input = tag === 'input' || tag === 'textarea' ? target : target.locator('input, textarea').first();
  await input.fill(value);
}

export async function saveApiKey(page: Page, key = 'sk-ant-e2e-test'): Promise<void> {
  await page.getByTestId(TID.navSettings).click();
  await fillField(page, TID.apiKeyInput, key);
  await page.getByTestId(TID.apiKeySave).click();
}

export async function sendChat(page: Page, text: string): Promise<void> {
  await fillField(page, TID.composerInput, text);
  await page.getByTestId(TID.composerSend).click();
}

/** The cafai namespace of the mock Decaid's key-value store, as one searchable string. */
export async function mirroredText(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify((window as CafaiMockWindow).__CAFAI_MOCK__?.state.kvAll('cafai') ?? {}));
}

/** Every request the mock Decaid received and everything it stores, as one searchable string. */
export async function everythingDecaidSaw(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    if (!state) throw new Error('The mock Decaid is not running.');
    const shots = state.getShotIds().map((id) => state.getShot(id));
    return JSON.stringify({ requests: state.requests, kv: state.kvAll('cafai'), shots, workflow: state.getWorkflow() });
  });
}

export interface SeenRequest {
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Record every request the page makes from now on, those the mock's service worker answers included. */
export function recordRequests(page: Page): SeenRequest[] {
  const seen: SeenRequest[] = [];
  page.on('request', (request) => {
    seen.push({ url: request.url(), headers: request.headers(), body: request.postData() });
  });
  return seen;
}

/** openApp with extra URL switches for the mock, e.g. `{ mockPersist: '1' }`. */
export async function openAppWithSwitches(page: Page, switches: Record<string, string>, route = '#/', mockSpeed = 25): Promise<void> {
  const query = new URLSearchParams({ mockSpeed: String(mockSpeed), ...switches }).toString();
  await page.goto(`./?${query}${route}`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
}

/**
 * The mirrored namespace once it holds `mustContain` and has stopped
 * changing. CafAI pushes 2 s after its last write, so call this once the
 * coach is idle: unchanged for `quietMs` then means the backup is complete.
 */
export async function settledMirror(page: Page, mustContain: string, quietMs = 4_000, timeout = 30_000): Promise<string> {
  // mirroredText is JSON, never '', so the first read always starts the quiet period.
  let last = '';
  let since = Date.now();
  await expect
    .poll(
      async () => {
        const text = await mirroredText(page);
        if (text !== last) {
          last = text;
          since = Date.now();
        }
        return text.includes(mustContain) && Date.now() - since >= quietMs;
      },
      { message: `the backup in the mock Decaid holds "${mustContain}" and stops changing`, timeout, intervals: [250] },
    )
    .toBe(true);
  return last;
}

export interface LostStorage {
  /** IndexedDB databases on the origin before and after, by name. */
  databasesBefore: string[];
  databasesAfter: string[];
  /** Each deleteDatabase outcome: 'deleted', 'blocked', 'no answer' or an error name. */
  deleted: Record<string, string>;
  /** localStorage keys removed, and the ones left. */
  removedKeys: string[];
  keptKeys: string[];
}

/**
 * Lose the app's browser storage, as a changed origin or a wiped WebView
 * would: delete the named IndexedDB databases and every localStorage key that
 * does not start with `keepPrefix` (the mock Decaid's own saved store).
 *
 * The page first leaves the app for a same-origin file that is not the app
 * (the MSW worker script every mock build serves): a running CafAI holds its
 * databases open, which blocks the delete, and with its data gone it would
 * push an empty backup over the real one. The page stays there; open the app
 * again to reload it.
 */
export async function loseBrowserStorage(page: Page, databases: readonly string[], keepPrefix: string): Promise<LostStorage> {
  await page.goto('./mockServiceWorker.js');
  return page.evaluate(
    async ({ names, keep }) => {
      const listDatabases = async () => (await indexedDB.databases()).map((info) => info.name ?? '').sort();
      const localKeys = () => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key !== null) keys.push(key);
        }
        return keys.sort();
      };
      const databasesBefore = await listDatabases();
      const deleted: Record<string, string> = {};
      for (const name of names) {
        deleted[name] = await new Promise<string>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          let blocked = false;
          // A connection that is never closed keeps the delete pending forever.
          const timer = setTimeout(() => resolve(blocked ? 'blocked' : 'no answer'), 10_000);
          request.onblocked = () => {
            blocked = true;
          };
          request.onsuccess = () => {
            clearTimeout(timer);
            resolve('deleted');
          };
          request.onerror = () => {
            clearTimeout(timer);
            resolve(request.error?.name ?? 'error');
          };
        });
      }
      const removedKeys = localKeys().filter((key) => !key.startsWith(keep));
      for (const key of removedKeys) localStorage.removeItem(key);
      return { databasesBefore, databasesAfter: await listDatabases(), deleted, removedKeys, keptKeys: localKeys() };
    },
    { names: [...databases], keep: keepPrefix },
  );
}
