import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { MOCK_GRINDER_IDS } from '../mock/decaid/grinders.ts';
import type { MockDisplayCommand, MockDisplayState } from '../mock/decaid/state.ts';
import type { PresenceSettings, ShotRecord, WakeSchedule } from '../src/api/types.ts';
import { TID } from '../src/ui/testIds.ts';
import {
  decaidRequests,
  fillField,
  goTo,
  isPhone,
  machineRow,
  mirroredText,
  openApp,
  openSettingsGroup,
  pullShot,
  saveApiKey,
  sendChat,
  settingsGroup,
} from './helpers.ts';

/**
 * The gaps Settings filled (D241, D245-D248), each where its group has it,
 * against the mock Decaid and the scripted coach: which way is finer on the
 * grinder, and the coach's grind step following it; the 12-hour clock on the
 * wake times and in their dialog, Decaid still keeping "HH:MM"; the switch for
 * the shot cards' TDS; the screensaver's wait and brightness on the tablet
 * inside Decaid, with the page's clock and the mock's display socket; and
 * About's What's new and Report a problem. Export in Data and privacy is
 * export-data.spec.ts's. The tablets, and the phones where a phone lays a
 * gap out differently (the wake time dialog, the shot card, About's address).
 */

const PACKAGE = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
const CHANGELOG = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Decaid's WebView on the Decent tablet: window.__DECENT_HOST__, as the app injects it. */
async function insideDecaid(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__DECENT_HOST__', {
      value: Object.freeze({ app: 'decent.app', platform: 'android', version: '0.9.0', build: '3000', commit: 'aab5f938' }),
      configurable: false,
      writable: false,
      enumerable: false,
    });
  });
}

async function coachDone(page: Page): Promise<void> {
  await expect(page.getByTestId(TID.chat), 'the coach is done').not.toHaveAttribute('data-busy');
}

/** A new bag on Blooming Espresso v1, its profile loaded on the machine. */
async function bagOnTheMachine(page: Page): Promise<void> {
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
}

/** One shot pulled on the bag: its card in the chat, and the coach done asking how it tasted. */
async function shotCard(page: Page): Promise<Locator> {
  await pullShot(page);
  const card = page.getByTestId(TID.shotCard).last();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(TID.optionChip('Other')).last()).toBeVisible({ timeout: 60_000 });
  await coachDone(page);
  return card;
}

/** The grinder fields of the workflow context in the mock Decaid. */
function workflowGrinder(page: Page): Promise<{ grinderId: string | null; grinderSetting: string | null }> {
  return page.evaluate(() => {
    const context = (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow().context;
    return { grinderId: context?.grinderId ?? null, grinderSetting: context?.grinderSetting ?? null };
  });
}

test("Higher numbers on a grinder whose higher numbers are finer: the coach's one step finer from 5 is 6", async ({ page }) => {
  test.skip(isPhone(page), "The coach's grind step is the same on a phone; the tablets carry it.");
  await openApp(page);
  await saveApiKey(page);

  // Settings > Grinder: the mock's Baratza Encore ESP, a list of settings 1 to 12, on 5.
  await openSettingsGroup(page, 'grinder');
  const saved = page.getByTestId(TID.settingsSaved('grinder'));
  const picker = page.getByLabel('Grinder from Decaid');
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: 'Baratza Encore ESP (40 mm conical (M2))' });
  await expect(saved).toHaveText('Saved.');
  await expect(saved).toBeEmpty();
  await page.getByLabel('Current grinder setting').selectOption('5');
  await expect(saved).toHaveText('Saved.');

  // Finer is: Lower numbers until chosen (D62), then Higher numbers, kept for this grinder.
  const lower = page.getByTestId(TID.grinderFinerLower);
  const higher = page.getByTestId(TID.grinderFinerHigher);
  await expect(lower).toHaveAttribute('aria-pressed', 'true');
  await higher.click();
  await expect(higher).toHaveAttribute('aria-pressed', 'true');
  await expect(lower).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('So the coach turns the dial the right way.')).toBeVisible();
  // Saved under Decaid's id for the grinder ("id:<id>", grinderDirectionKey), and the coach has read it again.
  await expect.poll(() => mirroredText(page), { message: 'Higher numbers is saved' }).toContain(`"grinderFinerHigher":["id:${MOCK_GRINDER_IDS.encore}"]`);

  // A bag, a shot, and a taste the scripted coach does not recognise: one step finer, the grinder's way.
  await bagOnTheMachine(page);
  await shotCard(page);
  await page.getByTestId(TID.optionChip('Other')).last().click();
  await fillField(page, TID.otherInput, 'Muddy');
  await page.getByTestId(TID.optionsSubmit).click();
  const change = page.getByTestId(TID.diffCard).last();
  await expect(change).toContainText('Grind 1 step finer, to 6');
  await expect(change).toContainText('Set the grinder to 6');
  await expect(change).not.toContainText('Set the grinder to 4');

  await change.getByTestId(TID.diffConfirm).click();
  await expect.poll(() => workflowGrinder(page)).toEqual({ grinderId: MOCK_GRINDER_IDS.encore, grinderSetting: '6' });
  await openSettingsGroup(page, 'grinder');
  await expect(page.getByLabel('Current grinder setting')).toHaveValue('6');
  await expect(higher).toHaveAttribute('aria-pressed', 'true');
});

/** A wake time put into Decaid as its own page or another skin would. */
function seedWake(page: Page, body: Omit<WakeSchedule, 'id'>): Promise<string> {
  return page.evaluate((sent) => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.addWakeSchedule(sent).id, body);
}

function presence(page: Page): Promise<PresenceSettings> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getPresenceSettings() as PresenceSettings);
}

async function presenceWrites(page: Page): Promise<Array<{ method: string; path: string; body: unknown }>> {
  return (await decaidRequests(page))
    .filter((request) => request.path.startsWith('/api/v1/presence/') && request.method !== 'GET')
    .map(({ method, path, body }) => ({ method, path, body }));
}

test('the 12-hour clock: wake times read "6:30 am", the dialog takes am and pm, and Decaid keeps HH:MM', async ({ page }) => {
  // Thursday 15 October 2026, 05:00 here: the next weekday wake at 06:30 is today's.
  await page.clock.setFixedTime(new Date(2026, 9, 15, 5, 0));
  await openApp(page);
  const id = await seedWake(page, { time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true });

  // Settings > Display > Units > Clock: 24-hour until chosen, each choice showing a time as it would read.
  await openSettingsGroup(page, 'display');
  const twelve = page.getByTestId(TID.clockFormat('12h'));
  await expect(page.getByTestId(TID.clockFormat('24h'))).toHaveAttribute('aria-pressed', 'true');
  await expect(twelve).toHaveText('12-hour2:30 pm');
  await twelve.click();
  await expect(twelve).toHaveAttribute('aria-pressed', 'true');

  // Settings > Machine: the wake time and the next wake on the 12-hour clock.
  await openSettingsGroup(page, 'machine');
  const section = page.getByTestId(TID.sleepWake);
  const row = section.getByTestId(TID.wakeRow(id));
  await expect(row).toContainText('6:30 am');
  await expect(row).not.toContainText('06:30');
  await expect(page.getByTestId(TID.nextWake)).toHaveText('Next wake: today at 6:30 am.');

  // Changed in the dialog to 6:30 pm: the hour 1-12 with am and pm, and Decaid gets 18:30.
  await section.getByTestId(TID.wakeEdit(id)).click();
  const dialog = page.getByRole('dialog', { name: 'Change the wake time' });
  await expect(dialog.getByTestId(TID.wakeDialogHour)).toHaveValue('6');
  await expect(dialog.getByTestId(TID.wakeDialogMinute)).toHaveValue('30');
  await expect(dialog.getByTestId(TID.wakeDialogHalf('am'))).toHaveAttribute('aria-pressed', 'true');
  // The hours run as a clock face does, 12 first.
  await expect(dialog.getByTestId(TID.wakeDialogHour).locator('option')).toHaveText(['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  // am and pm in the dialog, whole, 48 px targets.
  const viewport = page.viewportSize()!;
  for (const half of ['am', 'pm']) {
    const box = (await dialog.getByTestId(TID.wakeDialogHalf(half)).boundingBox())!;
    expect(box.height, `${half}'s height`).toBeGreaterThanOrEqual(47.5);
    expect(box.x + box.width, `${half} inside the screen`).toBeLessThanOrEqual(viewport.width);
  }
  await dialog.getByTestId(TID.wakeDialogHalf('pm')).click();
  await expect(dialog.getByTestId(TID.wakeDialogHalf('pm'))).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByTestId(TID.wakeDialogSave).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('6:30 pm');
  await expect(page.getByTestId(TID.nextWake)).toHaveText('Next wake: today at 6:30 pm.');

  // A new one at 12:15 am: midnight's hour, 00 to Decaid.
  await page.getByTestId(TID.wakeAdd).click();
  const add = page.getByRole('dialog', { name: 'Add a wake time' });
  await expect(add.getByTestId(TID.wakeDialogHour)).toHaveValue('6');
  await expect(add.getByTestId(TID.wakeDialogHalf('am'))).toHaveAttribute('aria-pressed', 'true');
  await add.getByTestId(TID.wakeDialogHour).selectOption('12');
  await add.getByTestId(TID.wakeDialogMinute).selectOption('15');
  await add.getByTestId(TID.wakeDialogSave).click();
  await expect(add).toHaveCount(0);

  const stored = (await presence(page)).schedules;
  expect(stored.map((schedule) => schedule.time).sort()).toEqual(['00:15', '18:30']);
  const added = stored.find((schedule) => schedule.time === '00:15')!;
  await expect(section.getByTestId(TID.wakeRow(added.id))).toContainText('12:15 am');
  expect(await presenceWrites(page)).toEqual([
    { method: 'PUT', path: `/api/v1/presence/schedules/${encodeURIComponent(id)}`, body: { time: '18:30' } },
    { method: 'POST', path: '/api/v1/presence/schedules', body: { time: '00:15', daysOfWeek: [], enabled: true, keepAwakeFor: 60 } },
  ]);
});

/** The newest shot record in the mock Decaid. */
function latestShot(page: Page): Promise<ShotRecord | null> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const latest = state?.getLatestShot();
    return state && latest ? state.getShot(latest.id) : null;
  });
}

/** History > the bag: its newest shot's line. */
async function historyShotLine(page: Page): Promise<Locator> {
  await goTo(page, 'history');
  await page.locator('[data-testid^="history-bag-"]').filter({ hasText: 'Kiambu AA' }).click();
  return page.locator('[data-testid^="history-iteration-"]').first();
}

test('Show TDS off takes the TDS cell off the shot card and History, the reading kept; on again, it is back', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  await bagOnTheMachine(page);
  const card = await shotCard(page);
  // A reading, as a barista with a refractometer gives it.
  await card.getByTestId(TID.tdsCell).click();
  await card.getByTestId(TID.tdsInput).fill('9.25');
  await card.getByTestId(TID.tdsInput).press('Enter');
  await expect(card.getByTestId(TID.tdsCell)).toHaveAccessibleName('TDS 9.25 %, change it');
  await expect(card.getByTestId(TID.tdsEy)).toBeVisible();
  await expect.poll(async () => (await latestShot(page))?.annotations?.drinkTds).toBe(9.25);

  // Settings > Display > Shot cards: on until chosen; off.
  await openSettingsGroup(page, 'display');
  const show = settingsGroup(page, 'display').getByTestId(TID.showTds);
  await expect(show).toBeChecked();
  await show.click();
  await expect(show).not.toBeChecked();

  await goTo(page, 'coach');
  const again = page.getByTestId(TID.shotCard).last();
  await expect(again).toBeVisible();
  await expect(again.getByText('Dose → yield', { exact: true })).toBeVisible();
  await expect(again.getByTestId(TID.tdsCell)).toHaveCount(0);
  await expect(again.getByTestId(TID.tdsEy)).toHaveCount(0);
  // The reading stays on the shot, where the coach reads it; History leaves it out too.
  expect((await latestShot(page))?.annotations?.drinkTds).toBe(9.25);
  const line = await historyShotLine(page);
  await expect(line).toBeVisible();
  await expect(line).not.toContainText('TDS');

  // On again: the cell is back with its reading, on the card and in History.
  await openSettingsGroup(page, 'display');
  await show.click();
  await expect(show).toBeChecked();
  await expect(await historyShotLine(page)).toContainText('TDS 9.25 %');
  await goTo(page, 'coach');
  await expect(page.getByTestId(TID.shotCard).last().getByTestId(TID.tdsCell)).toHaveAccessibleName('TDS 9.25 %, change it');
});

/** A fixed late evening: the machine asleep, nobody at it. */
const NIGHT = new Date('2026-10-22T21:30:00');

function display(page: Page): Promise<{ state: MockDisplayState; commands: MockDisplayCommand[] }> {
  return page.evaluate(() => {
    const mock = (window as CafaiMockWindow).__CAFAI_MOCK__!;
    return { state: mock.state.getDisplayState(), commands: [...mock.state.displayCommands] };
  });
}

/** Two frames of the page, time for a timer that fired to show what it did. */
function twoFrames(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('the screensaver waits the 2 minutes chosen and dims to the 50 % chosen', async ({ page }) => {
  test.skip(isPhone(page), "The screensaver is the Decent tablet's, inside Decaid.");
  await insideDecaid(page);
  await page.clock.install({ time: NIGHT });
  await openApp(page);

  // Settings > Display > Screensaver: Starts after 2 minutes, Dims the screen to 50 %.
  await openSettingsGroup(page, 'display');
  const startAfter = page.getByTestId(TID.saverStartAfter);
  const dimTo = page.getByTestId(TID.saverDimTo);
  await expect(startAfter).toHaveValue('1');
  await expect(dimTo).toHaveValue('30');
  await startAfter.selectOption('2');
  await dimTo.selectOption('50');
  await expect(startAfter).toHaveValue('2');
  await expect(dimTo).toHaveValue('50');
  await expect(page.getByTestId(TID.saverSection)).toContainText('untouched for 2 minutes.');
  await goTo(page, 'coach');

  // Asleep, as Decaid's own Sleep leaves the machine; the row says Wake once CafAI knows.
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.player.command('sleeping'));
  await expect(machineRow(page).getByRole('button', { name: 'Wake', exact: true })).toBeVisible();
  const saver = page.getByTestId(TID.saver);

  // A minute untouched, and a little: not yet.
  await page.clock.fastForward(61_000);
  await twoFrames(page);
  await expect(saver).toHaveCount(0);
  expect((await display(page)).commands, 'the screen not touched yet').toEqual([]);

  // Two minutes untouched: up, dimmed to 50 and held on.
  await page.clock.fastForward(60_000);
  await expect(saver).toBeVisible();
  await expect(saver).toHaveAttribute('data-phase', 'showing');
  await expect.poll(async () => (await display(page)).state).toMatchObject({ requestedBrightness: 50, wakeLockOverride: true });
  expect((await display(page)).commands).toEqual(expect.arrayContaining([{ command: 'requestWakeLock' }, { command: 'setBrightness', brightness: 50 }]));
});

/** This version's section of the changelog: its date and its first heading. */
function changelogSection(version: string): { date: string | null; firstHeading: string } {
  const lines = CHANGELOG.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
  expect(start, `CHANGELOG.md has a section for ${version}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const section = lines.slice(start + 1, end < 0 ? undefined : end);
  const firstHeading = section.find((line) => line.startsWith('### '))?.slice(4).trim() ?? '';
  return { date: /\((\d{4}-\d{2}-\d{2})\)/.exec(lines[start]!)?.[1] ?? null, firstHeading };
}

/** The new issue's body, from Report a problem's address. */
async function issueBody(report: Locator): Promise<string> {
  const href = (await report.getAttribute('href')) ?? '';
  return new URL(href).searchParams.get('body') ?? '';
}

test("About: What's new shows this version's notes, and Report a problem opens GitHub's new issue page naming CafAI's version", async ({ page }) => {
  const { version } = PACKAGE;
  const { date, firstHeading } = changelogSection(version);
  await openApp(page, '#/settings/about');
  const about = settingsGroup(page, 'about');
  await expect(about).toContainText(`CafAI ${version}`);

  const whatsNew = about.getByTestId(TID.whatsNew);
  await expect(whatsNew).toHaveText(`What's new in ${version}`);
  await whatsNew.click();
  const dialog = page.getByRole('dialog', { name: `What's new in ${version}` });
  await expect(dialog).toBeVisible();
  if (date !== null) {
    const [year, month, day] = date.split('-').map(Number);
    await expect(dialog).toContainText(`Released ${day} ${SHORT_MONTHS[month! - 1]} ${year}`);
  }
  await expect(dialog.getByRole('heading', { name: firstHeading })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // GitHub's new issue page, in a new tab: the title left to the barista, the body naming the versions.
  const report = about.getByTestId(TID.reportProblem);
  await expect(report).toHaveAttribute('target', '_blank');
  const href = new URL((await report.getAttribute('href'))!);
  expect(`${href.origin}${href.pathname}`).toBe('https://github.com/justinmwarner/CafAI/issues/new');
  expect(href.searchParams.get('title')).toBe('');
  await expect.poll(() => issueBody(report), { message: "the body names Decaid's version once Decaid has said it" }).toContain('Decaid: 0.8.6');
  const body = await issueBody(report);
  expect(body).toContain(`CafAI: ${version}`);
  expect(body).toContain('Where: in a browser');
  expect(body).toContain('Attach the log: Settings > Data and privacy > Log >');
  // Outside Decaid the link opens: no address to copy.
  await expect(about.getByTestId(TID.reportProblemAddress)).toHaveCount(0);
  await expect(about.getByTestId(TID.reportProblemCopy)).toHaveCount(0);
});

test('inside Decaid, Report a problem shows its address with Copy, which copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await insideDecaid(page);
  await openApp(page, '#/settings/about');
  const about = settingsGroup(page, 'about');
  const report = about.getByTestId(TID.reportProblem);
  // A plain link, which Decaid opens in the system browser.
  await expect(report).toHaveAttribute('href', /^https:\/\/github\.com\/justinmwarner\/CafAI\/issues\/new\?/);
  expect(await report.getAttribute('target')).toBeNull();
  const body = await issueBody(report);
  expect(body).toContain(`CafAI: ${PACKAGE.version}`);
  expect(body).toContain('Decaid: 0.9.0');
  expect(body).toContain('Where: inside Decaid on Android');

  const address = about.getByTestId(TID.reportProblemAddress);
  await expect(address).toBeVisible();
  await expect(address).toHaveValue((await report.getAttribute('href'))!);
  const copy = about.getByTestId(TID.reportProblemCopy);
  // Both whole on the screen once scrolled to (a phone on its side shows them below the fold), the address beside its Copy.
  await copy.scrollIntoViewIfNeeded();
  await expect(address).toBeInViewport({ ratio: 1 });
  await expect(copy).toBeInViewport({ ratio: 1 });
  await copy.click();
  await expect(about.getByTestId(TID.reportProblemSaid)).toHaveText('Copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await report.getAttribute('href'));
});
