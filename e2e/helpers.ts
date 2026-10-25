import { expect, type Locator, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import type { MockRequestLog } from '../mock/decaid/state.ts';
import type { SettingsGroupId } from '../src/ui/settings/groupIds.ts';
import { TID } from '../src/ui/testIds.ts';

export type { SettingsGroupId } from '../src/ui/settings/groupIds.ts';

/**
 * Open the mock-mode build. `mockSpeed` compresses the scripted shot's wall
 * time (data timestamps stay realistic); the hash picks the route.
 */
export async function openApp(page: Page, route = '#/', mockSpeed = 25): Promise<void> {
  await page.goto(`./?mockSpeed=${mockSpeed}${route}`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
}

/** An MUI text field's own input or textarea, whether the test id sits on it or on its wrapper. */
async function fieldOf(page: Page, testId: string): Promise<Locator> {
  const target = page.getByTestId(testId);
  const tag = await target.evaluate((el) => el.tagName.toLowerCase());
  return tag === 'input' || tag === 'textarea' ? target : target.locator('input, textarea').first();
}

/** Fill an MUI text field whether the test id sits on the input or its wrapper. */
export async function fillField(page: Page, testId: string, value: string): Promise<void> {
  await (await fieldOf(page, testId)).fill(value);
}

/** The composer's text field, whether the test id sits on it or on its wrapper. */
export function composerField(page: Page): Promise<Locator> {
  return fieldOf(page, TID.composerInput);
}

/** A screen the navigation reaches: the top bar's buttons on a tablet, the tabs on a phone. */
export type Screen = 'coach' | 'shot' | 'history' | 'settings';

/** The phone layout's viewports: src/ui/shell/layout.ts's rule, a tablet being at least 800 x 500. */
export function isPhoneViewport(size: { width: number; height: number }): boolean {
  return !(size.width >= 800 && size.height >= 500);
}

/** Whether the page has the phone layout (bottom tabs, or the rail on its side). */
export function isPhone(page: Page): boolean {
  const size = page.viewportSize();
  if (size === null) throw new Error('The page has no viewport size.');
  return isPhoneViewport(size);
}

const TOP_BAR: Record<Screen, string> = { coach: TID.navCoach, shot: TID.navShot, history: TID.navHistory, settings: TID.navSettings };
// The phone's tabs are the same four places, its Shot tab the shot route too.
const TABS: Record<Screen, string> = { coach: TID.tabCoach, shot: TID.tabShot, history: TID.tabHistory, settings: TID.tabSettings };

/**
 * Go to a screen as the barista would: the top bar on a tablet, the tabs on a
 * phone. The tabs give way to the on-screen keyboard while a text field has
 * focus, so on a phone the field is left first, as a tap outside it would.
 *
 * Settings (D232) opens on its list: on a tablet beside the group opened
 * last (Coach at first), whose address it takes; on a phone alone. Give a
 * group to open it too (openSettingsGroup).
 */
export async function goTo(page: Page, screen: Screen, group?: SettingsGroupId): Promise<void> {
  if (isPhone(page)) {
    await page.evaluate(() => {
      const field = document.activeElement;
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.blur();
    });
    await page.getByTestId(TABS[screen]).click();
  } else {
    await page.getByTestId(TOP_BAR[screen]).click();
  }
  if (screen === 'settings' && group !== undefined) await openSettingsGroup(page, group);
}

/** A Settings group's pane (tablet) or page (phone). */
export function settingsGroup(page: Page, group: SettingsGroupId): Locator {
  return page.getByTestId(TID.settingsPane(group));
}

/**
 * Open one of Settings' groups as the barista would, from wherever the page
 * is: Settings in the top bar or the tabs, then the group's row in Settings'
 * list (beside the pane on a tablet, the page itself on a phone). Resolves
 * once the group's pane or page shows.
 */
export async function openSettingsGroup(page: Page, group: SettingsGroupId): Promise<void> {
  await goTo(page, 'settings');
  await page.getByTestId(TID.settingsGroupRow(group)).click();
  await expect(settingsGroup(page, group)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/settings/${group}$`));
}

/** Settings > Coach > Anthropic API key: paste a key and save it. */
export async function saveApiKey(page: Page, key = 'sk-ant-e2e-test'): Promise<void> {
  await openSettingsGroup(page, 'coach');
  await fillField(page, TID.apiKeyInput, key);
  await page.getByTestId(TID.apiKeySave).click();
}

/** The shell's own top bar (a screen may have a header of its own, as the coach's bag header). */
export function topBar(page: Page): Locator {
  return page.locator(`[data-testid="${TID.appReady}"] > header`);
}

/**
 * The machine row in the top bar, on every screen of both layouts (D90):
 * Espresso, Steam, Flush and Hot water; the one that runs turns into Stop.
 */
export function machineRow(page: Page): Locator {
  return topBar(page).getByTestId(TID.machineRow);
}

/** Pull a shot as the barista does: Espresso in the top bar's machine row. */
export async function pullShot(page: Page): Promise<void> {
  await machineRow(page).getByTestId(TID.espressoButton).click();
}

/** Pull the scripted shot on the machine itself, as the group-head button does: no tap in CafAI. */
export async function pullShotOnMachine(page: Page): Promise<void> {
  const started = await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.start() ?? false);
  expect(started, 'the mock machine starts a shot').toBe(true);
}

/**
 * The live stats card (D91): the machine's links, state and readings, its
 * profile, Tare and Sleep. At the end of the chat once there is one; under
 * the key card or the New bag card before that.
 */
export function statsCard(page: Page): Locator {
  return page.getByTestId(TID.statsCard);
}

/** The stats card's Profile line: the profile in Decaid's workflow, and whether it is the bag's own (D66). */
export function profileLine(page: Page): Locator {
  return statsCard(page).getByRole('group', { name: 'Profile', exact: true });
}

/**
 * Bring the stats card back at the end of the chat with the Stats prompt.
 * Anything that lands in the chat after it takes it away again, so this first
 * waits for the coach to be done.
 */
export async function showStats(page: Page): Promise<Locator> {
  await expect(page.getByTestId(TID.chat), 'the coach is done').not.toHaveAttribute('data-busy');
  await page.getByTestId(TID.statsPrompt).click();
  await expect(statsCard(page)).toBeVisible();
  return statsCard(page);
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

/** The requests the mock Decaid received (its last 500), oldest first: method, path, query and parsed body. */
export async function decaidRequests(page: Page): Promise<MockRequestLog[]> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    if (!state) throw new Error('The mock Decaid is not running.');
    return state.requests;
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
