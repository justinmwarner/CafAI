import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import type { ShotRecord } from '../src/api/types.ts';
import { TID } from '../src/ui/testIds.ts';
import { decaidRequests, machineRow, openApp, pullShot, pullShotOnMachine, saveApiKey, sendChat } from './helpers.ts';

/**
 * D65: while CafAI asks Decaid for a just-finished shot (six tries over about
 * 15 s), the chat says so with a progress bar, updated on each try, until the
 * shot card or the warning takes its place. Retry searches again, visibly,
 * and says what the first warning said of how the shot ended (D205).
 * A cleaning profile's run is no shot, and CafAI looks for none (D193); nor
 * is a run that never poured, which gets one quiet line (D204).
 */

const SEARCH = 'Looking for that shot in Decaid…';
const NEVER_POURED = 'That shot stopped before it poured: nothing to taste.';

/** The newest shot record in the mock Decaid. */
async function latestShot(page: Page): Promise<ShotRecord | null> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    const latest = state?.getLatestShot();
    return state && latest ? state.getShot(latest.id) : null;
  });
}

/**
 * Resolves once the mock machine has been stopped on the next shot's `frames`th frame of pour: a stop a moment
 * into the pour, as on Decaid's simulator, where a stop at about 0.65 s left two frames of pour.
 */
async function stopAfterPourFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const mock = (window as CafaiMockWindow).__CAFAI_MOCK__!;
        let seen = 0;
        const stop = mock.state.on('machine', (frame) => {
          if (mock.player.activity !== 'espresso' || (frame.state.substate !== 'preinfusion' && frame.state.substate !== 'pouring')) return;
          if ((seen += 1) < count) return;
          stop();
          // Inside the frame's delivery: the next frame is the stop, so the record keeps `count` frames of pour.
          mock.player.stop();
          resolve();
        });
      }),
    frames,
  );
}

async function loadFirstVersion(page: Page): Promise<void> {
  await openApp(page);
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
}

/** Resolves once the mock machine has dropped off in the middle of the pour. */
async function dropMachineWhilePouring(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
        const stop = state.on('shotState', (event) => {
          if (event.state !== 'pouring') return;
          stop();
          // After the frame that announced the pour, not inside its delivery.
          setTimeout(() => {
            state.setMachineConnected(false);
            resolve();
          }, 0);
        });
      }),
  );
}

test('shows the search while Decaid saves a shot, then the shot card in its place', async ({ page }) => {
  await loadFirstVersion(page);
  // Decaid answers 404 for the record three times, as while it is still saving it.
  await page.evaluate(() =>
    (window as CafaiMockWindow).__CAFAI_MOCK__?.state.failNext({
      method: 'GET',
      path: /^\/api\/v1\/shots\/[^/]+$/,
      status: 404,
      body: { error: 'Shot not found' },
      times: 3,
    }),
  );
  await pullShot(page);
  // The shot takes the main pane by itself (D85) and hands it back only with the
  // card, after the search. To watch the search, go back to the coach, as a
  // barista would; that also keeps the coach on screen for the rest of the shot.
  await expect(page.getByTestId(TID.shotView)).toBeVisible();
  await page.getByTestId(TID.navCoach).click();

  const search = page.getByRole('status').filter({ hasText: SEARCH });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await expect(search.getByRole('progressbar')).toBeVisible();
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(SEARCH)).toHaveCount(0);
});

test('shows the search again on Retry after the machine dropped mid-shot', async ({ page }) => {
  await loadFirstVersion(page);
  const dropped = dropMachineWhilePouring(page);
  await pullShot(page);
  await dropped;

  const search = page.getByText(SEARCH);
  await expect(search).toBeVisible({ timeout: 30_000 });
  // Six tries over about 15 s, then the warning, and the banner with Retry.
  const cutOff = page.getByText(/The machine disconnected during that shot/);
  await expect(cutOff).toBeVisible({ timeout: 40_000 });
  await expect(search).toHaveCount(0);
  await expect(page.getByTestId(TID.errorBanner)).toContainText('Decaid has not saved that shot yet.');

  // With the machine back, as the warning says, Retry looks again, and still says how the shot ended (D205).
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.setMachineConnected(true));
  await page.getByTestId(TID.retryButton).click();
  await expect(search).toBeVisible({ timeout: 10_000 });
  await expect(cutOff).toHaveCount(2, { timeout: 40_000 });
  await expect(search).toHaveCount(0);
  await expect(page.getByText(/The shot finished, but Decaid has not saved it/)).toHaveCount(0);
});

test('Espresso then Stop at once is no shot: no card, no taste question, and the next shot is compared with the one before', async ({
  page,
}) => {
  await loadFirstVersion(page);
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toHaveCount(1, { timeout: 60_000 });
  const tasteQuestions = page.getByText('How did it taste?', { exact: true });
  await expect(tasteQuestions).toHaveCount(1);
  const first = (await latestShot(page))!.id;
  const shotIds = () => page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getShotIds());
  const kept = (await shotIds()).length;

  // Espresso, then Stop while the machine is still in its preheat (slowed, so the tap lands there however busy the
  // page is): Decaid aborts the run and keeps no record of it, and CafAI looks for none.
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.setSpeed(0.25));
  await pullShot(page);
  // The run takes the screen by itself (D85)...
  await expect(page).toHaveURL(/#\/shot$/);
  await machineRow(page).getByTestId(TID.stopButton).click();
  await expect(page.getByText(NEVER_POURED)).toHaveCount(1, { timeout: 30_000 });
  // ...and the line, the run's outcome, hands it back at once: well before D85's 8 s without one.
  await expect(page).toHaveURL(/#\/$/, { timeout: 3_000 });
  expect(await shotIds(), 'Decaid keeps no record of a run stopped in preheat').toHaveLength(kept);
  await page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__!.setSpeed(25));

  // Stopped a moment into the pour, three frames in, as on Decaid's simulator: Decaid keeps a record with well under
  // 2 s of pour, which is no shot either (D204).
  const stopped = stopAfterPourFrames(page, 3);
  await pullShot(page);
  await stopped;
  await expect(page.getByText(NEVER_POURED)).toHaveCount(2, { timeout: 30_000 });
  await expect(page).toHaveURL(/#\/$/, { timeout: 3_000 });
  expect(await shotIds(), 'Decaid kept this one').toHaveLength(kept + 1);
  const pour = (await latestShot(page))!.measurements.filter((m) => m.machine.state.substate !== 'preparingForShot');
  expect(pour, 'three frames of pour in its record').toHaveLength(3);

  // Neither run got a card, a taste question or a search; the first shot's question is still open.
  await expect(page.getByTestId(TID.shotCard)).toHaveCount(1);
  await expect(tasteQuestions).toHaveCount(1);
  await expect(page.getByTestId(TID.optionChip('Sour / sharp'))).toBeEnabled();
  await expect(page.getByText(SEARCH)).toHaveCount(0);
  await expect(page.getByText(/Decaid has not saved it|Decaid has no record of it/)).toHaveCount(0);

  // The next shot is compared with the shot before the stopped runs, on its card and in Decaid.
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toHaveCount(2, { timeout: 60_000 });
  const card = page.getByTestId(TID.shotCard).last();
  await expect(card.getByRole('radiogroup', { name: 'Compared with your previous shot?' })).toBeVisible();
  const same = card.getByRole('radio', { name: 'About the same', exact: true });
  await expect(same).toBeEnabled();
  await same.click();
  await expect.poll(async () => (await latestShot(page))?.annotations?.extras?.cafai).toMatchObject({
    comparedWith: { kind: 'previous', shotId: first },
  });
});

test('a cleaning profile run is no shot: no search, no warning, no banner, no card', async ({ page }) => {
  await loadFirstVersion(page);
  // The weekly clean (Settings > Machine care): Decent's Forward Flush x5, loaded and run in streamline, behind
  // CafAI's back. Decaid gives the run a shot id and keeps no record of it, and so does the mock (D191).
  await page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    const { profile } = state.getWorkflow();
    state.updateWorkflow({ profile: { ...profile, title: 'Cleaning/Forward Flush x5', beverage_type: 'cleaning' } });
  });
  const ended = page.evaluate(
    () =>
      new Promise<{ shotId: string | null; at: number }>((resolve) => {
        const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
        let shotId: string | null = null;
        const stop = state.on('shotState', (event) => {
          shotId ??= event.shotId;
          if (event.state !== 'finished') return;
          stop();
          resolve({ shotId, at: state.clock.now() });
        });
      }),
  );
  await pullShotOnMachine(page);
  const run = await ended;
  expect(run.shotId, 'Decaid gives the run a shot id').toBeTruthy();
  expect(await page.evaluate((id) => (window as CafaiMockWindow).__CAFAI_MOCK__!.state.getShotIds().includes(id), run.shotId!)).toBe(false);

  // CafAI asks Decaid which profile ran as the run ends...
  await expect
    .poll(async () => (await decaidRequests(page)).some((request) => request.method === 'GET' && request.path === '/api/v1/workflow' && request.at >= run.at))
    .toBe(true);
  // ...and the Shot view the run took gives the screen back by itself, with no shot to wait for, while the
  // old search (about 15 s) would still be under way.
  await expect(page).toHaveURL(/#\/$/, { timeout: 20_000 });
  await expect(page.getByTestId(TID.chat)).toBeVisible();
  const looked = (await decaidRequests(page)).filter((request) => request.method === 'GET' && request.path === `/api/v1/shots/${run.shotId}`);
  expect(looked, 'CafAI never looked for the run in Decaid').toEqual([]);
  await expect(page.getByText(SEARCH)).toHaveCount(0);
  await expect(page.getByText(/Decaid has not saved it|Decaid has no record of it|Pick a starting profile first/)).toHaveCount(0);
  await expect(page.getByTestId(TID.shotCard)).toHaveCount(0);
  await expect(page.getByText('Decaid has not saved that shot yet.')).toHaveCount(0);
});
