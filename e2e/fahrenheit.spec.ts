import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { goTo, machineRow, openApp, pullShot, recordRequests, saveApiKey, sendChat, statsCard } from './helpers.ts';

/**
 * °F (D-TEMP-1 to D-TEMP-7), on the tablets and the phones: Settings >
 * Appearance > Temperatures turns every temperature a barista reads or sets
 * into °F, the coach's words too, while the mock Decaid, as Decaid does,
 * keeps whole °C and truncates anything else (mock/decaid/workflow.ts).
 *
 * mockSpeed 10 plays the scripted shot (about 30 s of data) in about 3 s.
 */
const SPEED = 10;

/** The drink temperatures in the mock Decaid's workflow, in °C. */
function decaidKeeps(page: Page, drink: 'steamSettings' | 'hotWaterData' | 'rinseData'): Promise<number | null | undefined> {
  return page.evaluate((name) => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow()[name].targetTemperature, drink);
}

/** Settings > Appearance > Temperatures, as a barista taps it. */
async function choose(page: Page, unit: 'celsius' | 'fahrenheit'): Promise<void> {
  const segment = page.getByTestId(TID.temperatureUnit(unit));
  await segment.click();
  await expect(segment).toHaveAttribute('aria-pressed', 'true');
}

const stepper = (page: Page, name: string) => page.getByRole('spinbutton', { name });

/** Type a value into a stepper and leave it, as the barista does. */
async function typeInto(page: Page, name: string, value: string): Promise<void> {
  const field = stepper(page, name);
  await field.fill(value);
  await field.press('Tab');
}

test('°F in Settings: the drink settings and the stats card read °F, a value set in °F is the whole °C Decaid keeps, read back as set', async ({ page }) => {
  await openApp(page, '#/settings');
  await expect(page.getByTestId(TID.temperatureUnit('celsius'))).toHaveAttribute('aria-pressed', 'true');
  await expect(stepper(page, 'Steam temperature')).toHaveValue('150');

  await choose(page, 'fahrenheit');
  await expect(stepper(page, 'Steam temperature')).toHaveValue('302');
  await expect(stepper(page, 'Steam temperature')).toHaveAttribute('aria-valuetext', '302 degrees Fahrenheit');
  await expect(stepper(page, 'Hot water temperature')).toHaveValue('167');
  await expect(stepper(page, 'Flush temperature')).toHaveValue('194');
  // Not a temperature: as it was.
  await expect(stepper(page, 'Steam time')).toHaveValue('50');

  // A tap: one whole °C, which Decaid keeps and gives back.
  await page.getByRole('button', { name: 'More steam temperature' }).click();
  await expect.poll(() => decaidKeeps(page, 'steamSettings')).toBe(151);
  await expect(stepper(page, 'Steam temperature')).toHaveValue('304');

  // Typed: the nearest whole °C; 276 °F is none, so 136 °C, which reads 277.
  await typeInto(page, 'Steam temperature', '300');
  await expect.poll(() => decaidKeeps(page, 'steamSettings')).toBe(149);
  await expect(stepper(page, 'Steam temperature')).toHaveValue('300');
  await typeInto(page, 'Steam temperature', '276');
  await expect.poll(() => decaidKeeps(page, 'steamSettings')).toBe(136);
  await expect(stepper(page, 'Steam temperature')).toHaveValue('277');

  // Each end, typed and read back as typed.
  for (const [name, drink, typed, celsius] of [
    ['Steam temperature', 'steamSettings', '275', 135],
    ['Steam temperature', 'steamSettings', '320', 160],
    ['Hot water temperature', 'hotWaterData', '212', 100],
    ['Flush temperature', 'rinseData', '34', 1],
  ] as const) {
    await typeInto(page, name, typed);
    await expect.poll(() => decaidKeeps(page, drink), { message: `${name} at ${typed} °F` }).toBe(celsius);
    await expect(stepper(page, name)).toHaveValue(typed);
  }

  // The stats card under the setup card, in °F.
  await goTo(page, 'coach');
  await expect(statsCard(page).getByTestId(TID.groupTemp)).toContainText('°F');
  await expect(statsCard(page).getByTestId(TID.steamTemp)).toContainText('°F');
  await expect(statsCard(page)).not.toContainText('°C');

  // Kept after a reload (the mock Decaid starts over: 150 °C again).
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(statsCard(page).getByTestId(TID.groupTemp)).toContainText('°F');
  await goTo(page, 'settings');
  await expect(page.getByTestId(TID.temperatureUnit('fahrenheit'))).toHaveAttribute('aria-pressed', 'true');
  await expect(stepper(page, 'Steam temperature')).toHaveValue('302');

  // And °C again.
  await choose(page, 'celsius');
  await expect(stepper(page, 'Steam temperature')).toHaveValue('150');
});

test('the coach in °F: its prompt asks for °F, its change and the change card read °F, a change without the 32, and History too', async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page, '#/settings', SPEED);
  await choose(page, 'fahrenheit');
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();

  // Blooming's pour is 92 °C: one °C hotter, shown as 1.8 °F, never 33.8.
  const card = page.getByTestId(TID.diffCard);
  await expect(card.getByRole('heading', { name: 'Raise brew temperature by 1.8 °F' })).toBeVisible();
  await expect(card).toContainText('197.6 °F');
  await expect(card).toContainText('199.4 °F (every step +1.8 °F)');
  await expect(card).not.toContainText('°C');
  // The coach's turns, not a preflight: each with its body.
  const asked = seen.filter((request) => new URL(request.url).pathname === '/v1/messages' && request.body !== null).map((request) => request.body ?? '');
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((body) => body.includes('# Temperatures in °F')), 'every request carries the °F section').toBe(true);

  await page.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v2');
  // The machine was sent °C: the version's pour at 93 °C.
  await expect
    .poll(() => page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow().profile.steps.map((step) => step.temperature)))
    .toContain(93);

  await goTo(page, 'history');
  await page.locator('[data-testid^="history-bag-"]').first().click();
  const v2 = page.getByTestId(TID.historyVersion(2));
  await expect(v2).toContainText('Raise brew temperature by 1.8 °F');
  await expect(v2).toContainText('197.6 °F');
  await expect(v2).not.toContainText('°C');

  // Back to °C: CafAI's lines as they were kept, and the coach's °F words read in °C.
  await goTo(page, 'settings');
  await choose(page, 'celsius');
  await goTo(page, 'history');
  await page.locator('[data-testid^="history-bag-"]').first().click();
  await expect(v2).toContainText('Raise brew temperature by 1.0 °C');
  await expect(v2).toContainText('92.0 °C');
  await expect(v2).not.toContainText('°F');
});

test("a drink's view reads its temperature in °F, and its settings too", async ({ page }) => {
  await openApp(page, '#/settings');
  await choose(page, 'fahrenheit');
  await machineRow(page).getByTestId(TID.steamButton).click();
  const view = page.getByTestId(TID.drinkView);
  await expect(view).toHaveAttribute('data-drink', 'steam');
  await expect(view.getByTestId(TID.drinkReadout('steam'))).toContainText('°F');
  await expect(view.getByRole('spinbutton', { name: 'Steam temperature' })).toHaveValue('302');
  await expect(view).not.toContainText('°C');
  await expect(view.getByTestId(TID.drinkPhase)).toContainText('Done');

  await machineRow(page).getByTestId(TID.flushButton).click();
  await expect(view).toHaveAttribute('data-drink', 'flush');
  await expect(view.getByTestId(TID.drinkReadout('group'))).toContainText('°F');
  await expect(view.getByRole('spinbutton', { name: 'Flush temperature' })).toHaveValue('194');
  await expect(view).not.toContainText('°C');
});

test("the cleaning guide's descale reads its 60 °C as 140 °F", async ({ page }) => {
  await openApp(page, '#/settings');
  await choose(page, 'fahrenheit');
  const open = page.getByTestId(TID.careOpen);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await page.getByTestId(TID.careSegment('asNeeded')).click();
  await expect(page.getByTestId(TID.careStep('descale'))).toContainText('down to 140 °F (up to an hour)');
  await expect(page.getByTestId(TID.careRoutine)).not.toContainText('°C');
});
