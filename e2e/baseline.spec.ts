import { expect, test } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { openApp, fillField } from './helpers.ts';

test('machine panel shows live status and the basic controls', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId(TID.connectionStatus)).toBeVisible();
  await expect(page.getByTestId(TID.machineState)).toBeVisible();
  await expect(page.getByTestId(TID.groupTemp)).toBeVisible();
  for (const id of [TID.espressoButton, TID.steamButton, TID.flushButton, TID.hotWaterButton, TID.tareButton, TID.sleepWakeButton]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId(TID.liveGraph)).toBeVisible();
});

test('steam starts and stop returns to idle', async ({ page }) => {
  await openApp(page);
  await page.getByTestId(TID.steamButton).click();
  await expect(page.getByTestId(TID.machineState)).toContainText(/steam/i);
  await page.getByTestId(TID.stopButton).click();
  await expect(page.getByTestId(TID.machineState)).not.toContainText(/steam/i);
});

test('sleep and wake', async ({ page }) => {
  await openApp(page);
  await page.getByTestId(TID.sleepWakeButton).click();
  await expect(page.getByTestId(TID.machineState)).toContainText(/sleep/i);
  await page.getByTestId(TID.sleepWakeButton).click();
  await expect(page.getByTestId(TID.machineState)).not.toContainText(/sleep/i);
});

test('a way back to the skin switcher and Decaid settings is always on screen', async ({ page }) => {
  for (const route of ['#/', '#/history', '#/settings']) {
    await openApp(page, route);
    await expect(page.getByTestId(TID.exitToSkins)).toBeVisible();
    await expect(page.getByTestId(TID.decaidSettings)).toBeVisible();
  }
});

test('settings keep the API key local and can forget it', async ({ page }) => {
  await openApp(page, '#/settings');
  await fillField(page, TID.apiKeyInput, 'sk-ant-e2e-secret');
  await page.getByTestId(TID.apiKeySave).click();
  await expect(page.locator('body')).not.toContainText('sk-ant-e2e-secret');
  const mirrored = await page.evaluate(async () => {
    const mock = (window as unknown as { __CAFAI_MOCK__?: { state?: unknown } }).__CAFAI_MOCK__;
    return JSON.stringify(mock?.state ?? {});
  });
  expect(mirrored).not.toContain('sk-ant-e2e-secret');
  await page.getByTestId(TID.forgetKey).click();
  await page.getByTestId(TID.forgetKeyConfirm).click();
  await expect(page.getByTestId(TID.forgetKey)).toBeHidden();
});
