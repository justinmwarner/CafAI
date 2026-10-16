import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { MOCK_STORE_KEY, MOCK_STORE_PREFIX } from '../mock/persist.ts';
import { CAFAI_DB_NAME } from '../src/storage/db.ts';
import { SECRETS_DB_NAME } from '../src/storage/secrets.ts';
import { TID } from '../src/ui/testIds.ts';
import { goTo, loseBrowserStorage, openApp, openAppWithSwitches, settledMirror, statsCard } from './helpers.ts';

/**
 * Machine care's reminders (D183-D190), on the tablets and the
 * phones: a step's last time and Mark done on the Care screen, the stats
 * card's line for the most overdue step, the water and the filter in
 * Settings > Machine care, and the last times coming back from Decaid's
 * backup. The page's clock is moved on, as days are what bring a step due;
 * the shots and steams since come from the mock Decaid's totals.
 */

const DAY = 24 * 60 * 60 * 1000;
/** A morning in the browser's own time zone, and how the screens write its date. */
const T0 = new Date(2026, 9, 1, 8, 0).getTime();
const T0_DATE = '1 Oct';

/** Shots in the mock Decaid, one every six hours from T0, copied from its example shot. */
async function addShots(page: Page, count: number): Promise<void> {
  await page.evaluate(
    ({ count: n, from }) => {
      const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
      const shot = state.getShot(state.getShotIds()[0]!);
      const pad = (value: number) => String(value).padStart(2, '0');
      const local = (ms: number) => {
        const d = new Date(ms);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000000`;
      };
      for (let i = 1; i <= n; i += 1) state.addShot({ ...shot, id: `e2e-shot-${i}`, timestamp: local(from + i * 6 * 3_600_000) });
    },
    { count, from: T0 },
  );
}

/** Whether the mock Decaid's saved store (?mockPersist=1) holds this text in CafAI's backup namespace. */
function savedBackupHolds(page: Page, text: string): Promise<boolean> {
  return page.evaluate(
    ({ key, wanted }) => {
      const saved = localStorage.getItem(key);
      if (!saved) return false;
      const snapshot = JSON.parse(saved) as { kv?: Record<string, unknown> };
      return JSON.stringify(snapshot.kv?.['cafai'] ?? null).includes(wanted);
    },
    { key: MOCK_STORE_KEY, wanted: text },
  );
}

/** Back to the Care screen's routine the way a barista goes: Settings > Machine care > Cleaning guide, then its segment. */
async function openCare(page: Page, routine: 'weekly' | 'monthly' | 'asNeeded'): Promise<void> {
  await goTo(page, 'settings');
  const open = page.getByTestId(TID.careOpen);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await page.getByTestId(TID.careSegment(routine)).click();
  await expect(page.getByTestId(TID.careRoutine)).toBeVisible();
}

test('a step marked done keeps its last time across a reload, with Undo until then', async ({ page }) => {
  await openApp(page, '#/care/weekly');
  const line = page.getByTestId(TID.careStepLine('tank-tray'));
  await expect(line).toHaveText(/^Not marked done since \d{1,2} [A-Z][a-z]{2}$/);
  await page.getByTestId(TID.careMarkDone('tank-tray')).click();
  await expect(line).toHaveText('Done today');
  await page.getByTestId(TID.careUndo('tank-tray')).click();
  await expect(line).toHaveText(/^Not marked done since/);
  await expect(page.getByTestId(TID.careUndo('tank-tray'))).toHaveCount(0);
  await page.getByTestId(TID.careMarkDone('tank-tray')).click();
  await expect(line).toHaveText('Done today');

  await page.reload();
  await expect(page.getByTestId(TID.careStepLine('tank-tray'))).toHaveText('Done today');
  await expect(page.getByTestId(TID.careUndo('tank-tray'))).toHaveCount(0);
  // Daily's steps are habits: no last time, no Mark done.
  await page.getByTestId(TID.careSegment('daily')).click();
  await expect(page.getByTestId(TID.careRoutine).getByText('Mark done')).toHaveCount(0);
});

test("a week on with shots since, the weekly clean is due: on the Care screen, and as the stats card's line, which opens it", async ({ page }) => {
  await page.clock.install({ time: T0 });
  await openApp(page, '#/care/weekly');
  // No shot yet: nothing for detergent to clean, so not due however long, and the line says why.
  await expect(page.getByTestId(TID.careStepLine('detergent-clean'))).toHaveText(`Not marked done yet · no shots since ${T0_DATE}`);
  await addShots(page, 23);
  await page.clock.setSystemTime(T0 + 9 * DAY);

  await openCare(page, 'weekly');
  const clean = page.getByTestId(TID.careStepLine('detergent-clean'));
  await expect(clean).toHaveText(`Due · Not marked done yet · 23 shots since ${T0_DATE}`);
  await expect(clean).toHaveAttribute('data-due', 'true');

  // The coach without a key: the stats card under the setup card, with the line.
  await goTo(page, 'coach');
  const due = statsCard(page).getByTestId(TID.careDueLine);
  await expect(due).toHaveText(`Weekly clean due: 23 shots since ${T0_DATE}`);
  await due.click();
  await expect(page).toHaveURL(/#\/care\/weekly$/);
  await expect(page.getByTestId(TID.careStep('detergent-clean'))).toBeInViewport();
  await page.getByTestId(TID.careMarkDone('detergent-clean')).click();
  await expect(page.getByTestId(TID.careStepLine('detergent-clean'))).toHaveText('Done today');

  // Marked done: nothing else is due, so no line.
  await goTo(page, 'coach');
  await expect(statsCard(page)).toBeVisible();
  await expect(statsCard(page).getByTestId(TID.careDueLine)).toHaveCount(0);
});

test('the line opens a step further down with it in view, and the switch in Settings takes the line away', async ({ page }) => {
  await page.clock.install({ time: T0 });
  await openApp(page, '#/care/weekly');
  await expect(page.getByTestId(TID.careStepLine('intake-filter'))).toBeAttached();
  // Five weeks without a shot or a steam: only the intake filter is due, by the days alone.
  await page.clock.setSystemTime(T0 + 40 * DAY);
  await goTo(page, 'coach');
  const due = statsCard(page).getByTestId(TID.careDueLine);
  await expect(due).toHaveText(`Intake filter due: 5 weeks since ${T0_DATE}`);
  await due.click();
  await expect(page).toHaveURL(/#\/care\/weekly$/);
  await expect(page.getByTestId(TID.careStep('intake-filter'))).toBeInViewport();
  await expect(page.getByTestId(TID.careStepLine('intake-filter'))).toHaveText(`Due · Not marked done since ${T0_DATE}`);

  await goTo(page, 'settings');
  const reminders = page.getByTestId(TID.careReminders);
  await reminders.scrollIntoViewIfNeeded();
  await reminders.click();
  await expect(reminders).not.toBeChecked();
  await goTo(page, 'coach');
  await expect(statsCard(page)).toBeVisible();
  await expect(statsCard(page).getByTestId(TID.careDueLine)).toHaveCount(0);
});

test('the water and the intake filter, set in Settings > Machine care, change what the descale and the filter say', async ({ page }) => {
  await openApp(page, '#/care/as-needed');
  const descale = page.getByTestId(TID.careStepCare('descale'));
  await expect(descale).toContainText('CafAI does not know your water');
  await page.getByTestId(TID.careSetIn('descale')).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByTestId(TID.careSection)).toBeInViewport();
  await page.getByTestId(TID.careWater).selectOption('over120');
  await page.getByTestId(TID.careFilter).selectOption('v2');

  await openCare(page, 'asNeeded');
  await expect(page.getByTestId(TID.careStepCare('descale'))).toContainText('Your water is over 120 ppm: CafAI reminds you after six months, or 800 shots.');
  await expect(page.getByTestId(TID.careSetIn('descale'))).toHaveText('Change it in Settings');
  await page.getByTestId(TID.careSegment('weekly')).click();
  await expect(page.getByTestId(TID.careStepCare('intake-filter'))).toContainText('Your filter is V2: CafAI reminds you every month.');

  // Under 30 ppm needs no descaling: no reminder, and the step says so.
  await goTo(page, 'settings');
  await page.getByTestId(TID.careWater).selectOption('under30');
  await openCare(page, 'asNeeded');
  await expect(page.getByTestId(TID.careStepCare('descale'))).toContainText('it needs no descaling, so CafAI does not remind you');
});

test("a step's last time comes back from Decaid's backup after the browser storage is lost", async ({ page }) => {
  // A reload and a wait for the backup to settle.
  test.setTimeout(120_000);
  await openAppWithSwitches(page, { mockPersist: '1' }, '#/care/monthly');
  await page.getByTestId(TID.careMarkDone('gasket')).click();
  await expect(page.getByTestId(TID.careStepLine('gasket'))).toHaveText('Done today');
  await settledMirror(page, '"id":"gasket","doneAt":"');
  // The mock Decaid has kept its store, as a real one keeps it on disk.
  await expect.poll(() => savedBackupHolds(page, '"id":"gasket","doneAt":"'), { message: 'the mock Decaid saved its store' }).toBe(true);

  const lost = await loseBrowserStorage(page, [CAFAI_DB_NAME, SECRETS_DB_NAME], MOCK_STORE_PREFIX);
  expect(lost.deleted).toEqual({ [CAFAI_DB_NAME]: 'deleted', [SECRETS_DB_NAME]: 'deleted' });

  await openAppWithSwitches(page, { mockPersist: '1' }, '#/care/monthly');
  await expect(page.getByTestId(TID.careStepLine('gasket'))).toHaveText('Done today');
  await expect(page.getByTestId(TID.careStepLine('group-parts'))).toHaveText(/^Not marked done yet/);
});
