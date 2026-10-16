import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import type { PresenceSettings, WakeSchedule } from '../src/api/types.ts';
import { TID } from '../src/ui/testIds.ts';
import { decaidRequests, goTo, openApp } from './helpers.ts';

/**
 * Settings > Sleep and wake (D157-D160), against the mock Decaid's presence
 * routes (mock/decaid/presence.ts), on the tablets and the phones: every
 * change reaches Decaid at once with only what changed, the keep-awake
 * window's line follows Decaid after each one (D-SIMC-2), and the dialog's
 * seven days fit a phone.
 */

function presence(page: Page): Promise<PresenceSettings> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getPresenceSettings() as PresenceSettings);
}

/** A wake time put into Decaid as its own page or another skin would, before Settings reads them. */
function seedWake(page: Page, body: Omit<WakeSchedule, 'id'>): Promise<string> {
  return page.evaluate((sent) => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.addWakeSchedule(sent).id, body);
}

async function presenceWrites(page: Page): Promise<Array<{ method: string; path: string; body: unknown }>> {
  return (await decaidRequests(page))
    .filter((request) => request.path.startsWith('/api/v1/presence/') && request.method !== 'GET')
    .map(({ method, path, body }) => ({ method, path, body }));
}

async function openSection(page: Page) {
  const section = page.getByTestId(TID.sleepWake);
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText(/^Decaid keeps these and acts on them/)).toBeVisible();
  return section;
}

test("Sleep when idle: the minutes and the switch go to Decaid at once, and off leaves Decaid's own switch on", async ({ page }) => {
  await openApp(page, '#/settings');
  const section = await openSection(page);
  const minutes = section.getByRole('spinbutton', { name: 'Sleep after' });
  const toggle = page.getByTestId(TID.sleepWhenIdle);
  // Decaid's own defaults: its switch on, 30 minutes.
  await expect(toggle).toBeChecked();
  await expect(minutes).toHaveValue('30');

  await section.getByRole('button', { name: 'More sleep after' }).click();
  await expect(minutes).toHaveValue('35');
  await expect.poll(async () => (await presence(page)).sleepTimeoutMinutes).toBe(35);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(minutes).toHaveCount(0);
  await expect(section.getByText('The machine stays on until you put it to sleep.')).toBeVisible();
  expect(await presence(page)).toMatchObject({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 });

  // Back on with the minutes it had.
  await toggle.click();
  await expect(minutes).toHaveValue('35');
  expect(await presenceWrites(page)).toEqual([
    { method: 'POST', path: '/api/v1/presence/settings', body: { sleepTimeoutMinutes: 35 } },
    { method: 'POST', path: '/api/v1/presence/settings', body: { sleepTimeoutMinutes: 0 } },
    { method: 'POST', path: '/api/v1/presence/settings', body: { userPresenceEnabled: true, sleepTimeoutMinutes: 35 } },
  ]);
});

test('a weekday wake time added in the dialog reaches Decaid, with the next wake over the list', async ({ page }) => {
  // Thursday 15 October 2026, 05:00 here: the next weekday wake at 06:30 is today's.
  await page.clock.setFixedTime(new Date(2026, 9, 15, 5, 0));
  await openApp(page, '#/settings');
  const section = await openSection(page);
  await expect(page.getByTestId(TID.nextWake)).toHaveText('No wake times yet.');

  await page.getByTestId(TID.wakeAdd).click();
  const dialog = page.getByRole('dialog', { name: 'Add a wake time' });
  await expect(dialog.getByTestId(TID.wakeDialogHour)).toHaveValue('06');
  await dialog.getByTestId(TID.wakeDialogMinute).selectOption('30');
  await dialog.getByTestId(TID.wakeDialogDay('Sat')).click();
  await dialog.getByTestId(TID.wakeDialogDay('Sun')).click();
  await expect(dialog.getByText('Weekdays', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId(TID.wakeDialogKeepAwake)).toHaveValue('60');
  await dialog.getByTestId(TID.wakeDialogSave).click();
  await expect(dialog).toHaveCount(0);

  const [stored] = (await presence(page)).schedules;
  expect(stored).toEqual({ id: expect.any(String), time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true, keepAwakeFor: 60 });
  const row = section.getByTestId(TID.wakeRow(stored!.id));
  await expect(row).toContainText('06:30');
  await expect(row).toContainText('Weekdays · stays awake for 1 h');
  await expect(page.getByTestId(TID.nextWake)).toHaveText('Next wake: today at 06:30.');
  expect(await presenceWrites(page)).toEqual([
    { method: 'POST', path: '/api/v1/presence/schedules', body: { time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true, keepAwakeFor: 60 } },
  ]);
});

test('a wake time set elsewhere changes, turns off and goes, each at once', async ({ page }) => {
  await openApp(page, '#/');
  const id = await seedWake(page, { time: '07:15', daysOfWeek: [6, 7], enabled: true });
  await goTo(page, 'settings');
  const section = await openSection(page);
  const row = section.getByTestId(TID.wakeRow(id));
  await expect(row).toContainText('07:15');
  await expect(row).toContainText('Weekends');

  await section.getByTestId(TID.wakeEdit(id)).click();
  const dialog = page.getByRole('dialog', { name: 'Change the wake time' });
  await expect(dialog.getByTestId(TID.wakeDialogHour)).toHaveValue('07');
  await expect(dialog.getByTestId(TID.wakeDialogMinute)).toHaveValue('15');
  await expect(dialog.getByTestId(TID.wakeDialogDay('Sat'))).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByTestId(TID.wakeDialogDay('Mon'))).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByTestId(TID.wakeDialogMinute).selectOption('45');
  await dialog.getByTestId(TID.wakeDialogSave).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('07:45');

  const toggle = page.getByTestId(TID.wakeSwitch(id));
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId(TID.nextWake)).toHaveText('Every wake time is off.');

  await section.getByTestId(TID.wakeEdit(id)).click();
  await page.getByRole('dialog', { name: 'Change the wake time' }).getByTestId(TID.wakeDialogDelete).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId(TID.nextWake)).toHaveText('No wake times yet.');
  expect((await presence(page)).schedules).toEqual([]);
  const path = `/api/v1/presence/schedules/${encodeURIComponent(id)}`;
  expect(await presenceWrites(page)).toEqual([
    { method: 'PUT', path, body: { time: '07:45' } },
    { method: 'PUT', path, body: { enabled: false } },
    { method: 'DELETE', path, body: null },
  ]);
});

test("the keep-awake window's line follows Decaid after every change: the wake time changed and deleted, Sleep when idle off and on again (D-SIMC-2)", async ({ page }) => {
  // The simulator's run (hardware test plan 15.3-15.7): Thursday 15 October 2026, 08:50, a wake time at
  // 08:46 every day keeping the machine awake for 30 minutes, so Decaid holds it awake until 09:16.
  await page.clock.setFixedTime(new Date(2026, 9, 15, 8, 50));
  await openApp(page, '#/');
  const id = await seedWake(page, { time: '08:46', daysOfWeek: [], enabled: true, keepAwakeFor: 30 });
  await goTo(page, 'settings');
  const section = await openSection(page);
  const windowLine = section.getByText(/^A wake time keeps the machine awake until/);
  await expect(windowLine).toHaveText('A wake time keeps the machine awake until 09:16.');
  const reads = async () =>
    (await decaidRequests(page)).filter((request) => request.method === 'GET' && request.path === '/api/v1/presence/settings').length;
  expect(await reads()).toBe(1);

  // A change of the wake time: an hour awake moves the window's end with it.
  await section.getByTestId(TID.wakeEdit(id)).click();
  const dialog = page.getByRole('dialog', { name: 'Change the wake time' });
  await dialog.getByTestId(TID.wakeDialogKeepAwake).selectOption('60');
  await dialog.getByTestId(TID.wakeDialogSave).click();
  await expect(dialog).toHaveCount(0);
  await expect(windowLine).toHaveText('A wake time keeps the machine awake until 09:46.');

  // Sleep when idle off: the window holds nothing off then, so the line goes (D158).
  const toggle = page.getByTestId(TID.sleepWhenIdle);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(windowLine).toHaveCount(0);

  // The wake time deleted, and Sleep when idle back on with its 30 minutes: Decaid holds no window, nor does the line.
  await section.getByTestId(TID.wakeEdit(id)).click();
  await dialog.getByTestId(TID.wakeDialogDelete).click();
  await expect(section.getByTestId(TID.wakeRow(id))).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(section.getByRole('spinbutton', { name: 'Sleep after' })).toHaveValue('30');
  await expect(section.getByText('Using the machine, or CafAI, starts the time again.')).toBeVisible();
  expect((await presence(page)).keepAwakeUntil).toBeNull();
  await expect(windowLine).toHaveCount(0);

  // Read again after each of the four changes, none of whose answers carries the window.
  await expect.poll(reads).toBe(5);
  const path = `/api/v1/presence/schedules/${encodeURIComponent(id)}`;
  expect(await presenceWrites(page)).toEqual([
    { method: 'PUT', path, body: { keepAwakeFor: 60 } },
    { method: 'POST', path: '/api/v1/presence/settings', body: { sleepTimeoutMinutes: 0 } },
    { method: 'DELETE', path, body: null },
    { method: 'POST', path: '/api/v1/presence/settings', body: { userPresenceEnabled: true, sleepTimeoutMinutes: 30 } },
  ]);
});

test('the section and the dialog fit the screen: the stepper in its row, seven days a thumb wide', async ({ page }) => {
  await openApp(page, '#/settings');
  const section = await openSection(page);
  const sectionBox = (await section.boundingBox())!;
  const stepperBox = (await section.getByRole('spinbutton', { name: 'Sleep after' }).locator('..').boundingBox())!;
  expect(stepperBox.x + stepperBox.width, 'the stepper inside the section').toBeLessThanOrEqual(sectionBox.x + sectionBox.width);

  await page.getByTestId(TID.wakeAdd).click();
  const dialog = page.getByRole('dialog', { name: 'Add a wake time' });
  const viewport = page.viewportSize()!;
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.x, 'the dialog inside the screen').toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const box = (await dialog.getByTestId(TID.wakeDialogDay(day)).boundingBox())!;
    expect(box.width, `${day}'s width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${day}'s height`).toBeGreaterThanOrEqual(48);
  }
  // A native select opens only from itself: each is the whole target.
  for (const select of [TID.wakeDialogHour, TID.wakeDialogMinute]) {
    expect((await dialog.getByTestId(select).boundingBox())!.height, select).toBeGreaterThanOrEqual(48);
  }
  // Every button in reach: on a phone on its side the dialog scrolls inside itself.
  const save = dialog.getByTestId(TID.wakeDialogSave);
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
});
