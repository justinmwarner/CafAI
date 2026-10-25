import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { formatUsd } from '../src/spend/budget.ts';
import { SPEND_DB_NAME, SPEND_DEVICE_KEY } from '../src/spend/store.ts';
import { SPEND_NAMESPACE } from '../src/spend/sync.ts';
import { makeRecord } from '../src/spend/testing/fixtures.ts';
import type { SpendRecord } from '../src/spend/types.ts';
import { TID } from '../src/ui/testIds.ts';
import {
  fillField,
  goTo,
  isPhone,
  mirroredText,
  openApp,
  openAppWithSwitches,
  openSettingsGroup,
  recordRequests,
  saveApiKey,
  sendChat,
  type SeenRequest,
} from './helpers.ts';

/**
 * The coach's usage and cost (D237-D240) on the mock: Settings > Coach >
 * Usage and cost counts each reply the scripted coach streams on the API key
 * (its usage at the end of the stream, priced as Opus 5.5: the mock's replies
 * read some 10 k tokens, about $0.04 each); a monthly budget warns in the chat
 * at 80 %, and with its switch on pauses the coach at 100 %, the pause card
 * standing in for the reply until the budget is raised; How the coach
 * replies sets the next request's effort (D243); on the computer the card is
 * the plan's, read from CafAI Bridge's status without a probe; and on a phone
 * the Coach page fits the screen.
 *
 * A month near the budget is seeded the way another device would leave it,
 * as its records in Decaid's copy (namespace cafai-spend, a key per month,
 * D238), dated in the page's own calendar month; with ?mockPersist=1 the mock
 * keeps its store across the reload, and CafAI reads the copy as it starts.
 * The request bodies come from Playwright's request events, which see the
 * page's fetches even when the mock's service worker answers them.
 */

const OTHER_DEVICE = 'e2eother';
/** The scripted coach's answer to anything once the bag has its profile (rule 8). */
const FALLBACK = 'Got it. Pull a shot when you are ready, or tell me more about the coffee.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const usageCard = (page: Page) => page.getByTestId(TID.coachUsage);

async function coachDone(page: Page): Promise<void> {
  await expect(page.getByTestId(TID.chat), 'the coach is done').not.toHaveAttribute('data-busy');
}

/** The coach's requests so far: Anthropic's Messages API (or the bridge's), the bodies parsed. */
function coachCalls(seen: readonly SeenRequest[]): Array<Record<string, unknown>> {
  return seen
    .filter((request) => new URL(request.url).pathname === '/v1/messages' && request.body !== null)
    .map((request) => JSON.parse(request.body!) as Record<string, unknown>);
}

/** The page's calendar: today as 'YYYY-MM-DD' and its month, the day of the month, and today and the 1st of next month as the barista reads them. */
async function calendar(page: Page): Promise<{ day: string; month: string; date: number; today: string; firstOfNext: string }> {
  const parts = await page.evaluate(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), date: now.getDate() };
  });
  const pad = (value: number) => String(value).padStart(2, '0');
  const month = `${parts.year}-${pad(parts.month + 1)}`;
  return {
    day: `${month}-${pad(parts.date)}`,
    month,
    date: parts.date,
    today: `${parts.date} ${MONTHS[parts.month]}`,
    firstOfNext: `1 ${MONTHS[(parts.month + 1) % 12]}`,
  };
}

/**
 * Another device's spend this month, as Decaid's copy holds it (D238): the
 * month's value replaced by these records, each dated today. CafAI reads it
 * as it starts and as the Coach page opens.
 */
async function seedMonth(page: Page, records: ReadonlyArray<Partial<SpendRecord>>): Promise<void> {
  const { day, month } = await calendar(page);
  const value = { v: 1, records: records.map((record) => makeRecord({ day, device: OTHER_DEVICE, webSearches: 0, webSearchMicros: 0, ...record })) };
  await page.evaluate(
    ({ namespace, key, text }) => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.kvSet(namespace, key, text),
    { namespace: SPEND_NAMESPACE, key: month, text: JSON.stringify(value) },
  );
}

/** This device's own spend this month as it keeps it (src/spend/store.ts): requests and estimated cost. */
function ownSpend(page: Page): Promise<{ requests: number; costMicros: number }> {
  return page.evaluate(
    async ({ name, deviceKey }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opened = indexedDB.open(name);
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => reject(opened.error);
      });
      try {
        const records = await new Promise<Array<{ day: string; device: string; requests: number; costMicros: number }>>((resolve, reject) => {
          const all = db.transaction('days', 'readonly').objectStore('days').getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        });
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const own = records.filter((record) => record.device === localStorage.getItem(deviceKey) && record.day.startsWith(month));
        return {
          requests: own.reduce((sum, record) => sum + record.requests, 0),
          costMicros: own.reduce((sum, record) => sum + record.costMicros, 0),
        };
      } finally {
        db.close();
      }
    },
    { name: SPEND_DB_NAME, deviceKey: SPEND_DEVICE_KEY },
  );
}

/** This device's cost this month once it has counted `requests` requests. */
async function ownCostAfter(page: Page, requests: number): Promise<number> {
  await expect.poll(async () => (await ownSpend(page)).requests, { message: `this device counted ${requests} requests` }).toBe(requests);
  return (await ownSpend(page)).costMicros;
}

/** A new bag described: the coach's first reply, with the starting profiles. */
async function describeBag(page: Page): Promise<void> {
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await expect(page.getByTestId(TID.templatePick('blooming-espresso'))).toBeVisible();
  await coachDone(page);
}

/** Settings > Coach > Where the coach runs: Claude on this computer, through the mock's CafAI Bridge. */
async function useComputer(page: Page): Promise<void> {
  const section = page.getByRole('region', { name: 'Where the coach runs' });
  await section.getByTestId(TID.coachSourceComputer).check();
  await section.getByTestId(TID.computerFind).click();
  await expect(section.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1');
  await fillField(page, TID.computerCode, 'abcd-efgh');
  await section.getByTestId(TID.computerSave).click();
  await expect(section.getByText('Saved on this device.')).toBeVisible();
}

/** How wide the page and its scrolling boxes are against the window, any box that scrolls sideways, and anything in `rootId` past the window's right edge. */
async function sideways(page: Page, rootId: string) {
  return page.evaluate((root) => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''}.${[...el.classList].join('.')}`;
    const width = window.innerWidth;
    const scrolls = [...document.querySelectorAll('*')]
      .filter((el) => {
        const { overflowX } = getComputedStyle(el);
        return (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
      })
      .map((el) => `${describe(el)}: ${el.scrollWidth} > ${el.clientWidth}`);
    const past = [...(document.querySelector(`[data-testid="${root}"]`)?.querySelectorAll('*') ?? [])]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > width + 1;
      })
      .map((el) => `${describe(el)}: right edge ${Math.round(el.getBoundingClientRect().right)} > ${width}`);
    return { width, html: document.documentElement.scrollWidth, body: document.body.scrollWidth, scrolls, past };
  }, rootId);
}

async function expectNothingSideways(page: Page, where: string): Promise<void> {
  const seen = await sideways(page, TID.settingsPane('coach'));
  expect(seen.html, `${where}: the page is no wider than the screen`).toBeLessThanOrEqual(seen.width);
  expect(seen.body, `${where}: the body is no wider than the screen`).toBeLessThanOrEqual(seen.width);
  expect(seen.scrolls, `${where}: nothing scrolls sideways`).toEqual([]);
  expect(seen.past, `${where}: nothing reaches past the screen's right edge`).toEqual([]);
}

test("one reply on the API key shows on the card: its cost, its tokens, 1 reply and today's bar", async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  const card = usageCard(page);
  await expect(page.getByRole('region', { name: 'Usage and cost' })).toBeVisible();
  await expect(card.getByTestId(TID.coachUsageCost)).toHaveText('$0.00');
  await expect(card.getByTestId(TID.coachUsageSummary)).toHaveText('Nothing yet this month.');
  await expect(card.getByTestId(TID.coachUsageDays)).toHaveCount(0);

  await describeBag(page);
  await openSettingsGroup(page, 'coach');
  // About $0.04: the mock's reply reads some 10 k tokens, at Opus 5.5's prices.
  const cost = card.getByTestId(TID.coachUsageCost);
  await expect(cost).toHaveText(/^\$0\.0[1-9]$/);
  const dollars = await cost.innerText();
  await expect(card.getByTestId(TID.coachUsageSummary)).toHaveText(/^estimated this month · \d+(\.\d)?\sk tokens · 1 reply$/);
  await expect(card.getByTestId(TID.coachUsagePeriod('today'))).toHaveText(`Today${dollars}`);
  await expect(card.getByTestId(TID.coachUsagePeriod('all-time'))).toHaveText(`All time${dollars}`);
  await expect(card.getByTestId(TID.coachUsagePeriod('last-month'))).toHaveText('Last month$0.00');

  // A bar for each day of the month so far: today's the last, named with its cost, the scale of the rest.
  const { date, today } = await calendar(page);
  const bars = card.getByTestId(TID.coachUsageDays).getByRole('listitem');
  await expect(bars).toHaveCount(date);
  await expect(bars.last()).toHaveText(`${today}: ${dollars}`);
  const heights = await bars.locator('.usage-day-bar').evaluateAll((all) => all.map((bar) => bar.getBoundingClientRect().height));
  expect(heights.at(-1), "today's bar is the tallest, the card's scale").toBeGreaterThan(40);
  expect(heights.slice(0, -1).every((height) => height === 0), 'the days before it spent nothing').toBe(true);
  // All of it went on replies to the barista.
  await expect(card.getByTestId(TID.coachUsageKinds).getByRole('listitem').first()).toContainText(`Replies to you${dollars}`);
});

test('a $1 budget with the pause on: the 80 % notice after a reply, the pause card at 100 %, and Raise sends the reply that waited', async ({ page }) => {
  const seen = recordRequests(page);
  await openAppWithSwitches(page, { mockPersist: '1' });
  // $0.79 of $1 spent on another device this month, as Decaid's copy has it; CafAI reads it as it starts.
  const seeded = 790_000;
  await seedMonth(page, [{ requests: 19, replies: 19, inputTokens: 190_000, outputTokens: 4_000, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: seeded }]);
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await saveApiKey(page);
  const card = usageCard(page);
  await expect(card.getByTestId(TID.coachUsageCost)).toHaveText('$0.79');
  await expect(card.getByTestId(TID.coachUsageSummary)).toHaveText(/ · 19 replies$/);

  // A budget of $1 (Raise from none starts there), and the pause on.
  await card.getByTestId(TID.coachBudgetRaise).click();
  await expect(card.getByTestId(TID.coachBudgetAmount)).toHaveValue('1');
  await expect(card.getByTestId(TID.coachBudgetMeter)).toHaveText('79 % of $1.00');
  const pause = card.getByTestId(TID.coachBudgetPause);
  await pause.click();
  await expect(pause).toBeChecked();
  // Saved before the coach is asked anything: the backup in Decaid has it once storage does.
  await expect
    .poll(() => mirroredText(page), { message: 'the budget is saved' })
    .toMatch(/"coachBudget":\{("monthlyUsd":1,"pauseAtBudget":true|"pauseAtBudget":true,"monthlyUsd":1)\}/);

  // One reply takes the month past 80 %: a quiet notice after it, with the month's dollars.
  await describeBag(page);
  let total = seeded + (await ownCostAfter(page, coachCalls(seen).length));
  expect(total, 'one reply takes the month to 80 % and not past the budget').toBeGreaterThanOrEqual(800_000);
  expect(total).toBeLessThan(1_000_000);
  const chat = page.getByTestId(TID.chat);
  const near = chat.getByText(`The coach has used ${formatUsd(total)} of your $1 budget this month.`);
  await expect(near).toBeVisible();

  // Replies until the month reaches the budget: said once, at 100 %.
  const reached = chat.getByText("This month's coach spend reached your $1 budget.");
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(chat.getByText('Loaded Kiambu AA v1. Pull a shot when you are ready; I will read the curves.')).toBeVisible();
  await coachDone(page);
  total = seeded + (await ownCostAfter(page, coachCalls(seen).length));
  const fallbacks = chat.getByText(FALLBACK);
  for (let sent = 1; total < 1_000_000; sent += 1) {
    expect(sent, 'the month reaches $1 within eight more replies').toBeLessThanOrEqual(8);
    await expect(reached).toHaveCount(0);
    await sendChat(page, 'Thanks');
    await expect(fallbacks).toHaveCount(sent);
    await coachDone(page);
    total = seeded + (await ownCostAfter(page, coachCalls(seen).length));
  }
  await expect(reached).toBeVisible();
  await expect(near, 'the 80 % notice was said once this month').toHaveCount(1);

  // At the budget the coach sends nothing: the pause card stands in for its reply.
  const repliesBefore = await fallbacks.count();
  const callsBefore = coachCalls(seen).length;
  await sendChat(page, 'One more question');
  const paused = page.getByTestId(TID.budgetPaused);
  const { firstOfNext } = await calendar(page);
  await expect(paused).toHaveText(
    `The coach is paused: this month's spend reached your $1.00 budget. Raise it in Settings, or it starts again on ${firstOfNext}.Open Settings`,
  );
  await coachDone(page);
  expect(coachCalls(seen), 'nothing went to the coach').toHaveLength(callsBefore);
  await expect(fallbacks).toHaveCount(repliesBefore);

  // Open Settings: the Coach page, the usage card brought into view.
  await paused.getByTestId(TID.budgetPausedOpenSettings).click();
  await expect(page).toHaveURL(/#\/settings\/coach$/);
  const region = page.getByRole('region', { name: 'Usage and cost' });
  await expect(region.getByRole('heading', { name: 'Usage and cost' })).toBeInViewport();
  await expect(card.getByTestId(TID.coachBudgetMeter)).toHaveText(/^1\d\d\s% of \$1\.00$/);
  await expect(card).toContainText(`Paused now: the coach starts again on ${firstOfNext}, or as soon as you raise the budget or turn this off.`);

  // Raised to $2, the coach is back, and the reply that waited goes.
  await card.getByTestId(TID.coachBudgetRaise).click();
  await expect(card.getByTestId(TID.coachBudgetAmount)).toHaveValue('2');
  await expect.poll(() => coachCalls(seen).length, { message: 'the reply that waited is sent' }).toBe(callsBefore + 1);
  await goTo(page, 'coach');
  await expect(fallbacks).toHaveCount(repliesBefore + 1);
  await coachDone(page);
  // The pause card stays where it was, the reply after it.
  await expect(paused).toBeVisible();
  const [cardBox, replyBox] = await Promise.all([paused.boundingBox(), fallbacks.last().boundingBox()]);
  expect(replyBox!.y, 'the reply comes after the pause card').toBeGreaterThan(cardBox!.y);
});

test('No budget holds the pause switch: the coach can pause only at a budget', async ({ page }) => {
  await openApp(page, '#/settings/coach');
  const card = usageCard(page);
  const amount = card.getByTestId(TID.coachBudgetAmount);
  const pause = card.getByTestId(TID.coachBudgetPause);
  const none = card.getByTestId(TID.coachBudgetNone);
  // None until chosen: the field empty (its placeholder None), the switch held.
  await expect(amount).toHaveValue('');
  await expect(amount).toHaveAttribute('aria-valuetext', 'No budget');
  await expect(none).toBeDisabled();
  await expect(pause).toBeDisabled();
  await expect(card).toContainText('Set a budget to use this.');

  // A budget frees the switch.
  await card.getByTestId(TID.coachBudgetRaise).click();
  await expect(amount).toHaveValue('1');
  await expect(card.getByTestId(TID.coachBudgetMeter)).toHaveText('0 % of $1.00');
  await expect(pause).toBeEnabled();
  await pause.click();
  await expect(pause).toBeChecked();
  await expect(card).toContainText('At the budget the coach sends nothing more until you raise it or a new month begins. Shots still save.');

  // No budget: the field empty again, no meter, and the switch held.
  await none.click();
  await expect(amount).toHaveValue('');
  await expect(card.getByTestId(TID.coachBudgetMeter)).toHaveCount(0);
  await expect(card).toContainText('No budget. Set one to be told in the chat at 80 % and 100 % of it.');
  await expect(pause).toBeDisabled();
  await expect(card).toContainText('Set a budget to use this.');
  await expect(none).toBeDisabled();

  // Kept: Settings opened again after a reload says the same.
  await expect.poll(() => mirroredText(page), { message: 'no budget is saved' }).toContain('"monthlyUsd":null');
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(amount).toHaveAttribute('aria-valuetext', 'No budget');
  await expect(pause).toBeDisabled();
});

test("Thorough sends the coach's next request with effort high", async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page);
  await saveApiKey(page);
  const effort = (value: string) => page.getByTestId(TID.coachEffort(value));
  // Balanced until chosen (D30): the first reply goes at medium.
  await expect(effort('medium')).toHaveAttribute('aria-pressed', 'true');
  await describeBag(page);
  expect(coachCalls(seen).map((body) => body.output_config)).toEqual([{ effort: 'medium' }]);

  await openSettingsGroup(page, 'coach');
  await effort('high').click();
  await expect(effort('high')).toHaveAttribute('aria-pressed', 'true');
  await expect(effort('medium')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Thorough thinks longer: better on a hard dial-in, and it costs more.')).toBeVisible();
  // Saved, and the coach has read it again, before its next reply.
  await expect.poll(() => mirroredText(page), { message: 'Thorough is saved' }).toContain('"coachEffort":"high"');

  await goTo(page, 'coach');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1. Pull a shot when you are ready; I will read the curves.')).toBeVisible();
  await coachDone(page);
  expect(coachCalls(seen).map((body) => body.output_config)).toEqual([{ effort: 'medium' }, { effort: 'high' }]);
});

test("on the computer the card is Usage: the plan pays, and its use is read from the bridge's status without a probe", async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page, '#/settings/coach');
  await useComputer(page);
  const usage = page.getByRole('region', { name: 'Usage', exact: true });
  await expect(usage).toBeVisible();
  await expect(page.getByRole('region', { name: 'Usage and cost' })).toHaveCount(0);
  await expect(usage).toContainText('The coach runs on your Claude plan, so there is nothing to pay per reply.');
  // The plan's 5 hours and week, as the bridge last heard them from Claude Code; no dollars, no budget.
  await expect(usage.getByTestId(TID.coachUsagePlanWindow('five-hour'))).toContainText('Plan, this 5 hours');
  await expect(usage.getByTestId(TID.coachUsagePlanWindow('seven-day'))).toContainText('Plan, this week');
  await expect(usage.getByTestId(TID.coachUsageCost)).toHaveCount(0);
  await expect(usage.getByTestId(TID.coachBudgetAmount)).toHaveCount(0);
  await expect(usage).toContainText('Nothing yet this month.');

  // A reply through the bridge: its tokens this month, and what they would cost on the API.
  await describeBag(page);
  await openSettingsGroup(page, 'coach');
  await expect(usage.getByTestId(TID.coachUsagePeriod('month-tokens'))).toHaveText(/^This month\d+(\.\d)?\sktokens$/);
  await expect(usage.getByTestId(TID.coachUsagePeriod('on-api'))).toHaveText(/^On the API≈\s\$0\.0[1-9]this month$/);

  // Every read of the bridge's status was the plain one: never a probe, which spends a test reply.
  const status = seen.filter((request) => new URL(request.url).pathname === '/v1/status');
  expect(status.length, 'the card read the status').toBeGreaterThan(0);
  expect(status.map((request) => request.url)).toEqual(status.map(() => 'http://127.0.0.1:8877/v1/status'));
  expect(coachCalls(seen).length).toBeGreaterThan(0);
  expect(seen.filter((request) => request.url.startsWith('https://api.anthropic.com/'))).toEqual([]);
});

test('on a phone Settings > Coach fits the screen: nothing runs off its side, on the API key and on the computer', async ({ page }) => {
  test.skip(!isPhone(page), 'The phones: a tablet has room to spare.');
  await openApp(page);
  // A full card: every kind, a reply on the computer, a model typed by hand.
  await seedMonth(page, [
    { kind: 'reply', requests: 24, replies: 24, inputTokens: 240_000, outputTokens: 6_000, costMicros: 1_082_000, webSearches: 3, webSearchMicros: 30_000 },
    { kind: 'shot', requests: 9, replies: 9, inputTokens: 95_000, outputTokens: 2_500, costMicros: 430_000 },
    { kind: 'photo', requests: 2, replies: 2, inputTokens: 3_000, outputTokens: 400, costMicros: 20_000 },
    { source: 'computer', requests: 5, replies: 5, inputTokens: 52_000, outputTokens: 1_200, costMicros: 232_000 },
    { model: 'claude-opus-4-1-20250805', requests: 1, replies: 1, inputTokens: 9_000, outputTokens: 300, costMicros: 0, unpriced: 1 },
  ]);
  await openSettingsGroup(page, 'coach');
  const card = usageCard(page);
  // The API key's: the replies, the shots' and the photos', web searches included.
  await expect(card.getByTestId(TID.coachUsageCost)).toHaveText('$1.53');
  await expect(card.getByTestId(TID.coachUsageAlso)).toBeVisible();
  await expect(card.getByTestId(TID.coachUsageUnpriced)).toContainText('claude-opus-4-1-20250805');
  await card.getByTestId(TID.coachBudgetRaise).click();
  await expect(card.getByTestId(TID.coachBudgetMeter)).toHaveText('153 % of $1.00');
  await expectNothingSideways(page, 'Settings > Coach on the API key');

  await useComputer(page);
  await expect(page.getByRole('region', { name: 'Usage', exact: true }).getByTestId(TID.coachUsagePlan)).toBeVisible();
  await expectNothingSideways(page, 'Settings > Coach on the computer');
});
