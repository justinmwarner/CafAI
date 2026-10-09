import { expect, test } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { everythingDecaidSaw, fillField, machineRow, openApp, statsCard } from './helpers.ts';

/**
 * The machine at a glance and its basic controls (D90, D91): the machine row
 * in the top bar starts things, and the live stats card holds the status, the
 * readings, Tare and Sleep. Before a key is saved the card sits under the key
 * card, so all of it is there from the first start.
 */

/** Steam at the mock's own pace (four seconds), so Stop has something to stop. */
const OWN_PACE = 1;

test('the top bar has the machine row, and the stats card the live status, Tare and Sleep', async ({ page }) => {
  await openApp(page);
  const card = statsCard(page);
  for (const id of [TID.connectionStatus, TID.machineState, TID.groupTemp, TID.steamTemp, TID.waterLevel, TID.scaleWeight, TID.tareButton, TID.sleepWakeButton]) {
    await expect(card.getByTestId(id)).toBeVisible();
  }
  for (const id of [TID.espressoButton, TID.steamButton, TID.flushButton, TID.hotWaterButton]) {
    await expect(machineRow(page).getByTestId(id)).toBeVisible();
  }
  // The graph is on Shot, a tap away, not beside the coach.
  await expect(page.getByTestId(TID.liveGraph)).toHaveCount(0);
  await page.getByTestId(TID.navShot).click();
  await expect(page.getByTestId(TID.liveGraph)).toBeVisible();
});

test('steam starts from the row, Stop takes its box, and Stop returns to idle', async ({ page }) => {
  await openApp(page, '#/', OWN_PACE);
  const state = statsCard(page).getByTestId(TID.machineState);
  const steamBox = (await machineRow(page).getByTestId(TID.steamButton).boundingBox())!;
  await machineRow(page).getByTestId(TID.steamButton).click();
  await expect(state).toContainText(/steam/i);
  const stop = machineRow(page).getByTestId(TID.stopButton);
  await expect(stop).toBeVisible();
  const stopBox = (await stop.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(stopBox[key] - steamBox[key]), `Stop in Steam's box: ${key}`).toBeLessThanOrEqual(0.5);
  }
  await stop.click();
  await expect(state).not.toContainText(/steam/i);
  await expect(machineRow(page).getByTestId(TID.steamButton)).toBeVisible();
});

test('sleep and wake from the stats card; asleep, the row offers Wake alone', async ({ page }) => {
  await openApp(page);
  const card = statsCard(page);
  await card.getByTestId(TID.sleepWakeButton).click();
  await expect(card.getByTestId(TID.machineState)).toContainText(/sleep/i);
  await expect(machineRow(page).getByRole('button')).toHaveText(['Wake']);
  await card.getByTestId(TID.sleepWakeButton).click();
  await expect(card.getByTestId(TID.machineState)).not.toContainText(/sleep/i);
  await expect(machineRow(page).getByTestId(TID.espressoButton)).toBeVisible();
});

test('a way back to the skin switcher and Decaid settings is always on screen', async ({ page }) => {
  for (const route of ['#/', '#/history', '#/settings']) {
    await openApp(page, route);
    await expect(page.getByTestId(TID.exitToSkins)).toBeVisible();
    await expect(page.getByTestId(TID.decaidSettings)).toBeVisible();
  }
});

test('the model select is a full 48 px touch target', async ({ page }) => {
  await openApp(page, '#/settings');
  const box = await page.getByTestId(TID.modelSelect).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(47.5);
});

test('settings keep the API key local and can forget it', async ({ page }) => {
  await openApp(page, '#/settings');
  await fillField(page, TID.apiKeyInput, 'sk-ant-e2e-secret');
  await page.getByTestId(TID.apiKeySave).click();
  await expect(page.locator('body')).not.toContainText('sk-ant-e2e-secret');
  expect(await everythingDecaidSaw(page)).not.toContain('sk-ant-e2e-secret');
  await page.getByTestId(TID.forgetKey).click();
  await page.getByTestId(TID.forgetKeyConfirm).click();
  await expect(page.getByTestId(TID.forgetKey)).toBeHidden();
});
