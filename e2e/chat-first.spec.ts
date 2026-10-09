import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import {
  composerField,
  goTo,
  isPhone,
  machineRow,
  openApp,
  openAppWithSwitches,
  pullShotOnMachine,
  saveApiKey,
  sendChat,
  showStats,
  statsCard,
  topBar,
} from './helpers.ts';

/**
 * Chat first, the machine on demand (D90-D92), in every layout. There is no
 * machine column: the live stats card sits under the key card or the New bag
 * card until the coach can start, then the chat opens with it after its
 * newest message; anything new in the chat takes it away, and the Stats
 * prompt above the composer brings it back at the end. The machine row in the
 * top bar starts the machine, and the start that runs turns into Stop in its
 * own box. Shot (the tablet's top bar, the phone's tab) opens the graph. The
 * tap guard after a switch the app made covers the main pane only, never the
 * top bar, so Stop takes a touch at once.
 *
 * mockSpeed 2 plays the scripted shot (about 30 s of data) in about 15 s:
 * time to look at the row mid-shot and to stop the shot long before its end.
 */
const SLOW = 2;
/** How long the screen the app switched to ignores taps (useShotFocus.ts, GUARD_MS). */
const GUARD_MS = 350;
/** When the touch on Stop lands after the switch: well inside the guard. */
const TOUCH_AFTER_MS = 80;

const STARTS = [
  { name: 'Espresso', id: TID.espressoButton },
  { name: 'Steam', id: TID.steamButton },
  { name: 'Flush', id: TID.flushButton },
  { name: 'Hot water', id: TID.hotWaterButton },
] as const;

type Box = { x: number; y: number; width: number; height: number };

/** What a touch after the app's switch met. */
interface TouchSeen {
  /** How long after the switch to the Shot route, in ms. */
  afterMs: number;
  /** Whether the tap guard was up over the main pane. */
  guarded: boolean;
  /** The test id of what the touch landed on. */
  on: string | null;
}

type TouchLog = Window & { __switchedAt?: number | null; __touches?: TouchSeen[] };

/** Every row of the chat (x-chat's articles): the barista's, the coach's, CafAI's, and the stats card's. */
function rows(page: Page): Locator {
  return page.getByTestId(TID.chat).getByRole('article');
}

/** A new bag's chat, opened the way a barista first opens one: the coach's first words, then the card. */
async function openNewBag(page: Page, mockSpeed?: number): Promise<void> {
  await openApp(page, '#/', mockSpeed);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
}

/** The number before `unit` in a readout or a clock: 36.4 for "Scale 36.4 g"; NaN for a dash. */
async function numberIn(target: Locator, unit: 'g' | 's'): Promise<number> {
  const match = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`).exec((await target.textContent()) ?? '');
  return match ? Number(match[1]) : Number.NaN;
}

function expectSameBox(actual: Box | null, expected: Box, what: string): void {
  expect(actual, what).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual![key] - expected[key]), `${what}: ${key}`).toBeLessThanOrEqual(0.5);
  }
}

/**
 * The newest row in the chat's view, as the chat keeps it: all of it, or its
 * start when it is taller than the view (a phone on its side).
 */
async function expectNewestInView(page: Page, target: Locator, what: string): Promise<void> {
  const view = page.locator('.MuiChatMessageList-scroller');
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        const frame = await view.boundingBox();
        if (!box || !frame) return 'not rendered';
        const startIn = box.y >= frame.y - 1 && box.y < frame.y + frame.height;
        const endIn = box.y + box.height <= frame.y + frame.height + 1;
        return startIn && (endIn || box.height > frame.height) ? 'in view' : `outside: ${Math.round(box.y)} vs ${Math.round(frame.y)}`;
      },
      { message: what, timeout: 5_000 },
    )
    .toBe('in view');
}

/** The newest shot record in the mock Decaid: its id and why it stopped. */
async function latestShot(page: Page): Promise<{ id: string; stopReason: string | null } | null> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const latest = state?.getLatestShot();
    return state && latest ? { id: latest.id, stopReason: state.getShot(latest.id).stopReason ?? null } : null;
  });
}

/** Whether the mock Decaid was asked to stop the machine (PUT state idle, what Stop sends). */
async function stopSent(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as CafaiMockWindow).__CAFAI_MOCK__?.state.requests.some(
        (request) => request.method === 'PUT' && request.path === '/api/v1/machine/state/idle',
      ) ?? false,
  );
}

test('the coach screen opens with the live stats card: under the setup cards, then as the chat’s newest row', async ({ page }) => {
  await openApp(page);
  const card = statsCard(page);

  // Before a key is saved: what to do next, and the card under it. No chat yet, so no Stats prompt.
  const keyCard = page.getByRole('heading', { name: 'Add your Anthropic API key to start coaching' });
  await expect(keyCard).toBeVisible();
  await expect(card).toBeVisible();
  expect((await card.boundingBox())!.y).toBeGreaterThan((await keyCard.boundingBox())!.y);
  await expect(page.getByTestId(TID.chat)).toHaveCount(0);
  await expect(page.getByTestId(TID.statsPrompt)).toHaveCount(0);
  // The same before the first bag.
  await saveApiKey(page);
  await goTo(page, 'coach');
  await expect(page.getByRole('heading', { name: 'Dial in your first bag' })).toBeVisible();
  await expect(card).toBeVisible();
  await expect(page.getByTestId(TID.statsPrompt)).toHaveCount(0);

  // A new bag's chat: the coach's first words, then CafAI's card, the newest row.
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).last().getByTestId(TID.statsCard)).toBeVisible();
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId(TID.machineState)).toHaveText('Ready');
  await expect(card.getByTestId(TID.connectionStatus)).toContainText('DE1');
  await expect(card.getByTestId(TID.connectionStatus)).toContainText('Scale');
  for (const [id, label] of [
    [TID.groupTemp, 'Group'],
    [TID.steamTemp, 'Steam'],
    [TID.waterLevel, 'Water'],
    [TID.scaleWeight, 'Scale'],
  ] as const) {
    await expect(card.getByTestId(id)).toContainText(label);
  }
  await expect(card.getByTestId(TID.groupTemp)).toContainText(/\d+\.\d\s*°C/);
  await expect(card.getByTestId(TID.groupTemp)).toContainText(/target \d+\.\d/);
  await expect(card.getByTestId(TID.scaleWeight)).toContainText('0.0 g');
  await expect(card.getByRole('group', { name: 'Profile', exact: true })).toBeVisible();
  await expect(card.getByTestId(TID.tareButton)).toBeEnabled();
  await expect(card.getByTestId(TID.sleepWakeButton)).toBeEnabled();
  // The prompt that brings it back, above the composer.
  await expect(page.getByRole('button', { name: 'Stats', exact: true })).toHaveAttribute('data-testid', TID.statsPrompt);

  // The machine row in the top bar: the four starts, ready, and no Stop while nothing runs.
  const row = machineRow(page);
  for (const { name, id } of STARTS) {
    const button = row.getByRole('button', { name, exact: true });
    await expect(button).toHaveAttribute('data-testid', id);
    await expect(button).toBeEnabled();
    await expect(button).toBeInViewport({ ratio: 1 });
  }
  await expect(row.getByTestId(TID.stopButton)).toHaveCount(0);

  // No machine column: the main pane reaches the window's right edge (and on a tablet spans the window).
  await expect(page.getByRole('complementary')).toHaveCount(0);
  const { width } = page.viewportSize()!;
  const main = (await page.getByRole('main').boundingBox())!;
  expect(Math.abs(main.x + main.width - width)).toBeLessThanOrEqual(1);
  if (!isPhone(page)) expect(Math.abs(main.width - width)).toBeLessThanOrEqual(1);
});

test('a message takes the card away, Stats brings it back at the end, and History and a reload keep it', async ({ page }) => {
  await openNewBag(page);
  const card = statsCard(page);
  await expect(card).toBeVisible();

  // The barista's message lands after it: the card goes at once, before the coach answers.
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId(TID.templatePick('blooming-espresso'))).toBeVisible();

  // Stats posts it after the newest message, in view: one row more, and no bubble of the barista's.
  const before = await rows(page).count();
  await showStats(page);
  await expect(rows(page)).toHaveCount(before + 1);
  await expect(rows(page).last().getByTestId(TID.statsCard)).toBeVisible();
  await expectNewestInView(page, card, 'the stats card after Stats');
  // Tapped again, the one card stays where it is.
  await page.getByTestId(TID.statsPrompt).click();
  await expect(card).toHaveCount(1);
  await expect(rows(page)).toHaveCount(before + 1);

  // History and back: still there, still the newest row.
  await goTo(page, 'history');
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
  await goTo(page, 'coach');
  await expect(rows(page).last().getByTestId(TID.statsCard)).toBeVisible();
  await expect(rows(page)).toHaveCount(before + 1);

  // A reload opens the chat afresh, with the card again: one, never a stored copy.
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(rows(page).last().getByTestId(TID.statsCard)).toBeVisible();
  await expect(card).toHaveCount(1);
  await expect(rows(page)).toHaveCount(before + 1);

  // Another bag takes it away: the new bag's chat has the coach's first words alone.
  await page.getByTestId(TID.newBag).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await expect(card).toHaveCount(0);
});

test("the card's numbers move with the machine, and the shot's card in the chat takes it away", async ({ page }) => {
  // About 3 s of pour: time to watch the cup weight climb.
  await openNewBag(page, 10);
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  const card = await showStats(page);
  const weight = card.getByTestId(TID.scaleWeight);
  await expect(weight).toContainText('0.0 g');

  // A shot started on the machine while the barista types: the coach stays on screen, and so does the card.
  const composer = await composerField(page);
  await composer.click();
  await pullShotOnMachine(page);
  await expect(card.getByTestId(TID.machineState)).toContainText('Pulling a shot');
  await expect.poll(() => numberIn(weight, 'g'), { message: 'the cup weight on the card as the shot pours' }).toBeGreaterThan(1);
  await expect(page).toHaveURL(/#\/$/);

  // The shot's own card is the next thing in the chat: the stats card goes.
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await expect(card).toHaveCount(0);
});

test('Espresso turns into Stop in its own box while the shot runs, and Stop ends it', async ({ page }) => {
  await openApp(page, '#/', SLOW);
  const row = machineRow(page);
  const espresso = row.getByTestId(TID.espressoButton);
  const stop = row.getByTestId(TID.stopButton);
  const box = (await espresso.boundingBox())!;
  const before = await latestShot(page);
  await espresso.click();

  // The shot takes the screen by itself; the row stays in the top bar over it.
  await expect(page).toHaveURL(/#\/shot$/);
  await expect(stop).toBeVisible();
  await expect(stop).toHaveAccessibleName('Stop');
  await expect(espresso).toHaveCount(0);
  expectSameBox(await stop.boundingBox(), box, "Stop in Espresso's box");
  for (const id of [TID.steamButton, TID.flushButton, TID.hotWaterButton]) await expect(row.getByTestId(id)).toBeDisabled();
  // The way back to the shot counts it: the phone's tab by its name, the tablet's Shot item on screen.
  if (isPhone(page)) await expect(page.getByTestId(TID.tabShot)).toHaveAccessibleName(/^Shot, running, \d+ seconds?$/);
  else await expect(page.getByTestId(TID.navShot)).toContainText(/Shot\s*\d+\.\d s/);

  // Into the pour (the Shot view's clock counts the pour only), then Stop.
  await expect.poll(() => numberIn(page.getByTestId(TID.shotTimer), 's'), { message: 'the pour has begun' }).toBeGreaterThan(0);
  await stop.click();

  // The machine stops there, long before the shot's own end: Decaid records the REST stop.
  await expect(espresso).toBeVisible({ timeout: 10_000 });
  await expect(stop).toHaveCount(0);
  expectSameBox(await espresso.boundingBox(), box, 'Espresso back in its box');
  await expect
    .poll(
      async () => {
        const latest = await latestShot(page);
        return latest !== null && latest.id !== before?.id ? latest.stopReason : null;
      },
      { message: "this shot's record says Stop ended it" },
    )
    .toBe('apiStop');
  // Held for a moment after the run, then ready again.
  await expect(espresso).toBeEnabled();
});

test('Stop in the top bar takes a touch 80 ms after the shot took the screen, inside the tap guard', async ({ page }) => {
  await openApp(page, '#/', SLOW);
  await page.evaluate((guardId) => {
    const log = window as TouchLog;
    log.__switchedAt = null;
    log.__touches = [];
    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#/shot' && log.__switchedAt === null) log.__switchedAt = performance.now();
    });
    // Every touch from the switch on: when it came, whether the guard was up, and what it landed on.
    window.addEventListener(
      'touchstart',
      (event) => {
        if (log.__switchedAt === null || log.__switchedAt === undefined) return;
        const on = event.target instanceof Element ? event.target.closest('[data-testid]') : null;
        log.__touches!.push({
          afterMs: performance.now() - log.__switchedAt,
          guarded: document.querySelector(`[data-testid="${guardId}"]`) !== null,
          on: on?.getAttribute('data-testid') ?? null,
        });
      },
      { capture: true },
    );
  }, TID.tapGuard);

  await machineRow(page).getByTestId(TID.espressoButton).tap();
  // The app's switch to the shot, and Stop in the row: where Stop is, and how long ago the switch was.
  const seen = await page.waitForFunction(
    ({ rowId, stopId }) => {
      const log = window as TouchLog;
      const stop = document.querySelector(`[data-testid="${rowId}"] [data-testid="${stopId}"]`);
      if (log.__switchedAt === null || log.__switchedAt === undefined || stop === null) return null;
      const r = stop.getBoundingClientRect();
      return { afterMs: performance.now() - log.__switchedAt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    { rowId: TID.machineRow, stopId: TID.stopButton },
    { polling: 'raf' },
  );
  const at = (await seen.jsonValue())!;
  await page.waitForTimeout(Math.max(0, TOUCH_AFTER_MS - at.afterMs));
  // A raw touch on the screen, no waiting for anything to settle.
  await page.touchscreen.tap(at.x, at.y);

  const touches = (await page.evaluate(() => (window as TouchLog).__touches ?? [])) as TouchSeen[];
  expect(touches, 'the touch on Stop').toHaveLength(1);
  expect(touches[0]).toMatchObject({ on: TID.stopButton, guarded: true });
  expect(touches[0]!.afterMs, 'the touch came while the guard was up').toBeLessThan(GUARD_MS);
  // Stop went out, and the machine stopped.
  await expect.poll(() => stopSent(page), { message: 'Stop sent the machine to idle' }).toBe(true);
  await expect(machineRow(page).getByTestId(TID.espressoButton)).toBeVisible({ timeout: 10_000 });
  await expect(machineRow(page).getByTestId(TID.stopButton)).toHaveCount(0);
});

test('Shot opens the graph across the main pane, a dash before any shot', async ({ page }) => {
  await openApp(page);
  await goTo(page, 'shot');
  await expect(page).toHaveURL(/#\/shot$/);
  await expect(page.getByTestId(isPhone(page) ? TID.tabShot : TID.navShot)).toHaveAttribute('aria-current', 'page');
  const view = page.getByTestId(TID.shotView);
  await expect(view).toBeVisible();
  await expect(view.getByTestId(TID.liveGraph)).toBeVisible();
  await expect(view.getByRole('list', { name: 'Shot readouts' })).toBeVisible();
  // No shot yet: a dash for the time, and a hint in the plot.
  await expect(view.getByTestId(TID.shotTimer)).toHaveText('—');
  await expect(view).toContainText('Pull a shot to see it here.');
  // Inside the main pane, centred in it; the machine row stays in the top bar above.
  const main = (await page.getByRole('main').boundingBox())!;
  const box = (await view.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(main.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width + 1);
  expect(Math.abs(box.x + box.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
  await expect(machineRow(page).getByTestId(TID.espressoButton)).toBeInViewport({ ratio: 1 });

  await goTo(page, 'coach');
  await expect(page).toHaveURL(/#\/$/);
  await expect(view).toHaveCount(0);
});

test('on a group-head machine the row is empty until a shot runs, then holds Stop alone', async ({ page }) => {
  await openAppWithSwitches(page, { mockGhc: '1' }, '#/', SLOW);
  const row = machineRow(page);
  // Once Decaid has said the machine has a group-head controller, its starts are the machine's own.
  await expect(row.getByRole('button')).toHaveCount(0);

  await pullShotOnMachine(page);
  await expect(row.getByRole('button')).toHaveCount(1);
  await expect(row.getByTestId(TID.stopButton)).toBeEnabled();
  await row.getByTestId(TID.stopButton).click();
  await expect.poll(() => stopSent(page), { message: 'Stop sent the machine to idle' }).toBe(true);
  await expect(row.getByRole('button')).toHaveCount(0, { timeout: 10_000 });
});

test('a sleeping machine shows Wake alone in the row, and Wake brings the starts back', async ({ page }) => {
  await openApp(page);
  const row = machineRow(page);
  await expect(row.getByTestId(TID.espressoButton)).toBeEnabled();
  // Asleep, as Decaid's own Sleep or the machine's timer leaves it.
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.player.command('sleeping'));
  await expect(row.getByRole('button')).toHaveCount(1);
  const wake = row.getByRole('button', { name: 'Wake', exact: true });
  await expect(wake).toBeEnabled();

  await wake.click();
  for (const { name, id } of STARTS) await expect(row.getByRole('button', { name, exact: true })).toHaveAttribute('data-testid', id);
  // Held for a moment after waking, so a second tap meant for Wake starts nothing; then ready.
  await expect(row.getByTestId(TID.espressoButton)).toBeEnabled();
});

test('a machine that drops off shows one slim alert under the top bar, and the row waits for it', async ({ page }) => {
  await openApp(page);
  const alert = page.getByTestId(TID.machineAlerts);
  const row = machineRow(page);
  await expect(row.getByTestId(TID.espressoButton)).toBeEnabled();
  await expect(alert).toHaveCount(0);

  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.setMachineConnected(false));
  // Decaid's own report first, which the barista can close.
  await expect(alert).toContainText('The machine disconnected.');
  await expect(alert).toHaveCount(1);
  // Right under the top bar and over the whole width, pushing the screen down rather than covering it.
  const bar = (await topBar(page).boundingBox())!;
  const box = (await alert.boundingBox())!;
  expect(Math.abs(box.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - bar.width)).toBeLessThanOrEqual(1);
  expect((await page.getByRole('main').boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  for (const { id } of STARTS) await expect(row.getByTestId(id)).toBeDisabled();
  // Closed, it gives way to what lasts as long as the problem does: what to do about it.
  await alert.getByRole('button', { name: 'Close' }).click();
  await expect(alert).toContainText('Not connected. Wake the DE1 and pair it in Decaid.');
  await expect(alert).toHaveCount(1);

  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.setMachineConnected(true));
  await expect(alert).toHaveCount(0);
  await expect(row.getByTestId(TID.espressoButton)).toBeEnabled();
});

test('between 800 and 960 px wide a tablet shows its places as icons, still named', async ({ page }) => {
  test.skip(isPhone(page), 'a tablet layout');
  await page.setViewportSize({ width: 900, height: 602 });
  await openApp(page);
  const bar = topBar(page);
  for (const [id, name] of [
    [TID.navCoach, 'Coach'],
    [TID.navShot, 'Shot'],
    [TID.navHistory, 'History'],
    [TID.navSettings, 'Settings'],
  ] as const) {
    const place = page.getByTestId(id);
    await expect(place).toHaveAccessibleName(name);
    expect((await place.boundingBox())!.width, `${name} is its icon alone`).toBeLessThanOrEqual(52);
  }
  // The row keeps its labels, and everything in the bar fits.
  await expect(machineRow(page).getByTestId(TID.hotWaterButton)).toHaveText('Hot water');
  for (const id of [TID.machineRow, TID.decaidSettings, TID.exitToSkins]) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
