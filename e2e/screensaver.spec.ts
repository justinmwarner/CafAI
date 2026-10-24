import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import type { MockDisplayCommand, MockDisplayState } from '../mock/decaid/state.ts';
import { TID } from '../src/ui/testIds.ts';
import { goTo, machineRow, openApp } from './helpers.ts';

/**
 * The screensaver (D223-D226) on the mock Decaid: inside Decaid's
 * WebView, as e2e/care.spec.ts pretends, with the page's clock for the minute
 * and the 30 minutes, and the mock's display socket (ws/v1/display) for the
 * dim and the wake lock.
 */

/** A fixed late evening: the machine asleep, nobody at it. */
const NIGHT = new Date('2026-10-22T21:30:00');
/** The minute untouched, and a little. */
const A_MINUTE = 61_000;

/** Decaid's WebView on the Decent tablet: window.__DECENT_HOST__, as the app injects it. */
async function insideDecaid(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__DECENT_HOST__', {
      value: Object.freeze({ app: 'decent.app', platform: 'android', version: '0.8.8', build: '2900', commit: 'aab5f938' }),
      configurable: false,
      writable: false,
      enumerable: false,
    });
  });
}

async function open(page: Page, options: { inside?: boolean } = {}): Promise<void> {
  if (options.inside ?? true) await insideDecaid(page);
  await page.clock.install({ time: NIGHT });
  await openApp(page);
}

/** Asleep, as Decaid's own Sleep or its idle timer leaves the machine; the row says Wake once CafAI knows. */
async function sleepMachine(page: Page): Promise<void> {
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.player.command('sleeping'));
  await expect(machineRow(page).getByRole('button', { name: 'Wake', exact: true })).toBeVisible();
}

function display(page: Page): Promise<{ state: MockDisplayState; commands: MockDisplayCommand[]; sockets: number }> {
  return page.evaluate(() => {
    const mock = (window as CafaiMockWindow).__CAFAI_MOCK__!;
    return { state: mock.state.getDisplayState(), commands: [...mock.state.displayCommands], sockets: mock.state.socketCount('display') };
  });
}

function machineCommands(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as CafaiMockWindow).__CAFAI_MOCK__!.state.machineCommands]);
}

async function choose(page: Page, pick: string): Promise<void> {
  await goTo(page, 'settings');
  await page.getByTestId(TID.saverPick).selectOption(pick);
  await goTo(page, 'coach');
}

test('asleep and a minute untouched, it covers CafAI, dimmed to 30 and held on; a tap is swallowed, wakes the machine and puts the screen back', async ({ page }) => {
  await open(page);
  await sleepMachine(page);
  await page.clock.fastForward(A_MINUTE);
  const saver = page.getByTestId(TID.saver);
  await expect(saver).toBeVisible();
  await expect(saver).toHaveAttribute('data-phase', 'showing');
  await expect.poll(async () => (await display(page)).state).toMatchObject({ requestedBrightness: 30, wakeLockOverride: true });
  expect((await display(page)).commands).toEqual(expect.arrayContaining([{ command: 'requestWakeLock' }, { command: 'setBrightness', brightness: 30 }]));
  expect(await machineCommands(page)).not.toContain('idle');

  // Over everything, the top bar included: tapped where Settings is, the tap goes to the screensaver alone.
  const box = (await page.getByTestId(TID.navSettings).boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(saver).toBeHidden();
  await expect.poll(() => machineCommands(page)).toContain('idle');
  expect((await machineCommands(page)).filter((command) => command === 'idle')).toHaveLength(1);
  await expect(machineRow(page).getByRole('button', { name: 'Wake', exact: true })).toBeHidden();
  expect(page.url()).not.toContain('#/settings');
  await expect.poll(async () => (await display(page)).state).toMatchObject({ requestedBrightness: 100, wakeLockOverride: false });
  await expect.poll(async () => (await display(page)).sockets).toBe(0);
});

test('after 30 minutes it turns black and lets the wake lock go, the dim kept; a click on the black still wakes the machine', async ({ page }) => {
  await open(page);
  await sleepMachine(page);
  await page.clock.fastForward(A_MINUTE);
  const saver = page.getByTestId(TID.saver);
  await expect(saver).toHaveAttribute('data-phase', 'showing');
  await expect.poll(async () => (await display(page)).state.wakeLockOverride).toBe(true);
  await page.clock.fastForward('30:00');
  await expect(saver).toHaveAttribute('data-phase', 'black');
  await expect(page.getByTestId(TID.nightstand)).toHaveCount(0);
  await expect.poll(async () => (await display(page)).state).toMatchObject({ wakeLockOverride: false, requestedBrightness: 30 });
  await expect.poll(async () => (await display(page)).sockets).toBe(0);

  // A mouse, as on Decaid for Windows: the press, and the click after it, land nowhere else.
  await saver.click();
  await expect(saver).toBeHidden();
  await expect.poll(() => machineCommands(page)).toContain('idle');
  await expect.poll(async () => (await display(page)).state).toMatchObject({ requestedBrightness: 100, wakeLockOverride: false });
});

test('awake, it never shows; asleep but outside Decaid, on a phone or a computer, it never shows either', async ({ page }) => {
  await open(page, { inside: false });
  await page.clock.fastForward('10:00');
  await expect(page.getByTestId(TID.saver)).toHaveCount(0);
  await sleepMachine(page);
  await page.clock.fastForward('10:00');
  await expect(machineRow(page).getByRole('button', { name: 'Wake', exact: true })).toBeVisible();
  await expect(page.getByTestId(TID.saver)).toHaveCount(0);
  expect((await display(page)).sockets).toBe(0);
  expect((await display(page)).commands).toEqual([]);
});

test('inside Decaid with the machine awake it never shows', async ({ page }) => {
  await open(page);
  await page.clock.fastForward('10:00');
  await expect(page.getByTestId(TID.saver)).toHaveCount(0);
  expect((await display(page)).commands).toEqual([]);
});

test('turned off in Settings, it never shows', async ({ page }) => {
  await open(page);
  await goTo(page, 'settings');
  const on = page.getByTestId(TID.saverOn);
  await expect(on).toBeChecked();
  await on.click();
  await expect(on).not.toBeChecked();
  await goTo(page, 'coach');
  await sleepMachine(page);
  await page.clock.fastForward('10:00');
  await expect(page.getByTestId(TID.saver)).toHaveCount(0);
  expect((await display(page)).commands).toEqual([]);
});

test('under reduced motion a canvas screensaver shows its still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await choose(page, 'portafilter');
  await sleepMachine(page);
  await page.clock.fastForward(A_MINUTE);
  await expect(page.getByTestId(TID.saver)).toHaveAttribute('data-saver', 'portafilter');
  await expect(page.getByTestId(TID.saverCanvas)).toHaveAttribute('data-motion', 'still');
  await expect(page.getByTestId(TID.saverReady)).toBeAttached();
});

/** Every canvas screensaver, in Settings' order. */
const CANVAS_IDS = ['portafilter', 'pipes', 'beanfield', 'steam', 'lava', 'rain'] as const;

// At each tablet project's size: a throw that only some sizes meet (a gradient stop past 1 on a
// 1280x800 screen, once) shows Nightstand in its place, which only data-fallback tells apart (D-SAVE-3).
for (const id of CANVAS_IDS) {
  test(`${id} starts at this size, held and running, and never gives way to Nightstand`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('screensaver stopped')) problems.push(message.text());
    });
    const saver = page.getByTestId(TID.saver);
    for (const held of ['&saverAt=3000', '']) {
      await page.goto(`./?mockSpeed=25&saverPreview=${id}${held}#/`);
      await expect(page.getByTestId(TID.saverReady)).toBeAttached({ timeout: 30_000 });
      await expect(saver).toHaveAttribute('data-saver', id);
      // Running: a second of frames after the first.
      if (!held) await page.waitForTimeout(1000);
      await expect(saver).not.toHaveAttribute('data-fallback', '1');
    }
    expect(problems).toEqual([]);
  });
}

test('Preview shows the chosen one anywhere and a tap closes it, waking nothing and dimming nothing', async ({ page }) => {
  await open(page, { inside: false });
  await sleepMachine(page);
  await goTo(page, 'settings');
  await page.getByTestId(TID.saverPick).selectOption('nightstand');
  await page.getByTestId(TID.saverPreview).click();
  const saver = page.getByTestId(TID.saver);
  await expect(saver).toHaveAttribute('data-phase', 'preview');
  await expect(page.getByTestId(TID.nightstandTime)).toHaveText(/^21:3\d$/);
  await saver.tap();
  await expect(saver).toBeHidden();
  // Still on Settings, the machine still asleep, the screen never touched.
  await expect(page.getByTestId(TID.saverSection)).toBeVisible();
  await expect(machineRow(page).getByRole('button', { name: 'Wake', exact: true })).toBeVisible();
  expect(await machineCommands(page)).not.toContain('idle');
  expect((await display(page)).commands).toEqual([]);
});
