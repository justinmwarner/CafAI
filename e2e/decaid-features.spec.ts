import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Workflow } from '../src/api/types.ts';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { decaidRequests, openApp, pullShot, statsCard } from './helpers.ts';

/**
 * Decaid's features in CafAI (spec section 6), in every layout: Connect for
 * a machine and a scale that dropped off (6.2, D111), the minutes until a
 * waking machine is ready (6.3, D112), Next step during a shot (6.7, D113),
 * and Settings' steam, hot water and flush (6.6, D114). Each is checked
 * against what the mock Decaid received and holds.
 *
 * mockSpeed 2 runs time-to-ready's countdown after a wake (about 32
 * mock-seconds) in about 16 s; mockSpeed 0.5 plays the scripted shot at half
 * speed, so its first step (2 s) is on screen for 4 s.
 */
const SLOW = 2;
const HALF = 0.5;

/** Whether the mock Decaid has the machine and the scale connected. */
async function connected(page: Page): Promise<{ machine: boolean; scale: boolean }> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    return { machine: state.isMachineConnected(), scale: state.isScaleConnected() };
  });
}

/** The mock Decaid's workflow. */
async function workflow(page: Page): Promise<Workflow> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getWorkflow());
}

/** The number before `s` in the Shot view's clock: 1.4 for "1.4 s"; NaN for a dash. */
async function seconds(clock: Locator): Promise<number> {
  const match = /(\d+(?:\.\d+)?)\s*s\b/.exec((await clock.textContent()) ?? '');
  return match ? Number(match[1]) : Number.NaN;
}

test('Connect brings a machine and a scale that dropped off back, one device at a time', async ({ page }) => {
  await openApp(page);
  const alert = page.getByTestId(TID.machineAlerts);
  await expect(statsCard(page).getByTestId(TID.machineState)).toHaveText('Ready');
  const ids = await page.evaluate(() => {
    const devices = (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getDevices();
    return { machine: devices.find((d) => d.type === 'machine')!.id, scale: devices.find((d) => d.type === 'scale')!.id };
  });

  // Both drop off, as when the DE1 is switched off with the scale beside it.
  await page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    state.setScaleConnected(false);
    state.setMachineConnected(false);
  });
  // Decaid's own report first; closed, what to do about it, with Connect for each.
  await expect(alert).toContainText('The machine disconnected.');
  await alert.getByRole('button', { name: 'Close' }).click();
  await expect(alert).toContainText("Not connected. Wake the DE1 and tap Connect DE1, or pair it in Decaid's settings.");
  await expect(alert.getByTestId(TID.connectMachine)).toHaveText('Connect DE1');
  await expect(alert.getByTestId(TID.connectScale)).toHaveText('Connect scale');

  // Connect DE1 connects the machine, and only the machine...
  await alert.getByTestId(TID.connectMachine).click();
  await expect.poll(() => connected(page)).toEqual({ machine: true, scale: false });
  // ...so the scale, still missing while the machine is awake, gets its own alert.
  await expect(alert).toContainText("The scale is not connected. Switch it on and tap Connect scale, or pair it in Decaid's settings.");
  await expect(alert.getByTestId(TID.connectMachine)).toHaveCount(0);
  await alert.getByTestId(TID.connectScale).click();
  await expect.poll(() => connected(page)).toEqual({ machine: true, scale: true });
  await expect(alert).toHaveCount(0);
  await expect(statsCard(page).getByTestId(TID.connectionStatus)).toContainText('DE1');
  await expect(statsCard(page).getByTestId(TID.connectionStatus)).toContainText('Scale');

  // Each Connect looked without connecting anything (Decaid's scan would connect all it finds), then connected its one device.
  const sent = await decaidRequests(page);
  const scans = sent.filter((request) => request.method === 'GET' && request.path === '/api/v1/devices/scan');
  expect(scans.map((request) => new URLSearchParams(request.query).get('connect'))).toEqual(['false', 'false']);
  const connects = sent.filter((request) => request.method === 'PUT' && request.path === '/api/v1/devices/connect');
  expect(connects.map((request) => request.body)).toEqual([{ deviceId: ids.machine }, { deviceId: ids.scale }]);
});

test('after Sleep then Wake the stats card counts down the minutes until the machine is ready', async ({ page }) => {
  await openApp(page, '#/', SLOW);
  const card = statsCard(page);
  const state = card.getByTestId(TID.machineState);
  const sleepWake = card.getByTestId(TID.sleepWakeButton);
  const readyIn = card.getByTestId(TID.timeToReady);
  await expect(state).toHaveText('Ready');
  await expect(readyIn).toHaveCount(0);

  await sleepWake.click();
  await expect(state).toHaveText('Sleeping');
  await expect(sleepWake).toHaveAccessibleName('Wake');
  await sleepWake.click();

  // Warming up, the machine says Heating, and time-to-ready's estimate adds the minutes at the end of the line.
  await expect(state).toHaveText('Heating');
  await expect(readyIn).toBeVisible();
  await expect(readyIn).toHaveText(/^Ready in about [1-5] min$/);
  // It follows the plugin's estimate down...
  await expect(readyIn).toHaveText('Ready in under a minute', { timeout: 30_000 });
  // ...and goes once the machine is ready.
  await expect(state).toHaveText('Ready', { timeout: 30_000 });
  await expect(readyIn).toHaveCount(0);
});

test('Next step moves the shot on to its next step, at once and once per tap', async ({ page }) => {
  await openApp(page, '#/', HALF);
  await pullShot(page);
  await expect(page).toHaveURL(/#\/shot$/);
  const view = page.getByTestId(TID.shotView);
  const step = view.getByText(/ · step \d+ of \d+$/);
  const next = view.getByTestId(TID.nextStep);

  // The first of the profile's six steps: two seconds of it, and five steps after it.
  await expect(step).toHaveText('Preinfusion temp boost · step 1 of 6');
  await expect(next).toBeEnabled();
  await next.click();

  // The next step's name, long before the first step's own two seconds are up.
  await expect(step).toHaveText('Preinfusion · step 2 of 6');
  expect(await seconds(view.getByTestId(TID.shotTimer)), 'the pour clock when the step changed').toBeLessThan(2);
  // One tap sent Decaid one skip.
  const skips = await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.machineCommands.filter((name) => name === 'skipStep'));
  expect(skips).toHaveLength(1);
});

test("a steam change in Settings reaches Decaid's workflow alone, held to what the DE1 can take", async ({ page }) => {
  await openApp(page, '#/settings');
  const drinks = page.getByTestId(TID.drinkSettings);
  // Each setting's value is a spin button named for its drink (D124).
  const steamTime = drinks.getByRole('spinbutton', { name: 'Steam time' });
  // Decaid's own values: the mock's workflow steams for 50 s.
  await expect(steamTime).toHaveValue('50');
  await expect(steamTime).toBeEnabled();
  const before = await workflow(page);
  expect(before.steamSettings.duration).toBe(50);

  // A tap on the stepper: 5 s more, written at once.
  await drinks.getByRole('button', { name: 'More steam time' }).click();
  await expect(steamTime).toHaveValue('55');
  await expect.poll(async () => (await workflow(page)).steamSettings.duration).toBe(55);

  // A typed time past CafAI's ceiling is held at 120 s: Decaid passes it to the DE1 as one byte, unchecked.
  await steamTime.fill('500');
  await steamTime.blur();
  await expect(steamTime).toHaveValue('120');
  await expect.poll(async () => (await workflow(page)).steamSettings.duration).toBe(120);

  // From the keyboard, Down is one step less, written at once too.
  await steamTime.focus();
  await page.keyboard.press('ArrowDown');
  await expect(steamTime).toHaveValue('115');
  await expect.poll(async () => (await workflow(page)).steamSettings.duration).toBe(115);

  // Each write carried steamSettings alone, with the changed field alone: never the profile, the other drinks or the context.
  const puts = (await decaidRequests(page)).filter((request) => request.method === 'PUT' && request.path === '/api/v1/workflow');
  expect(puts.map((request) => request.body)).toEqual([
    { steamSettings: { duration: 55 } },
    { steamSettings: { duration: 120 } },
    { steamSettings: { duration: 115 } },
  ]);
  const after = await workflow(page);
  expect(after).toEqual({ ...before, steamSettings: { ...before.steamSettings, duration: 115 } });
});
