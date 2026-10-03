import { expect, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';

/**
 * Open the mock-mode build. `mockSpeed` compresses the scripted shot's wall
 * time (data timestamps stay realistic); the hash picks the route.
 */
export async function openApp(page: Page, route = '#/', mockSpeed = 25): Promise<void> {
  await page.goto(`./?mockSpeed=${mockSpeed}${route}`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
}

/** Fill an MUI text field whether the test id sits on the input or its wrapper. */
export async function fillField(page: Page, testId: string, value: string): Promise<void> {
  const target = page.getByTestId(testId);
  const tag = await target.evaluate((el) => el.tagName.toLowerCase());
  const input = tag === 'input' || tag === 'textarea' ? target : target.locator('input, textarea').first();
  await input.fill(value);
}

export async function saveApiKey(page: Page, key = 'sk-ant-e2e-test'): Promise<void> {
  await page.getByTestId(TID.navSettings).click();
  await fillField(page, TID.apiKeyInput, key);
  await page.getByTestId(TID.apiKeySave).click();
}

export async function sendChat(page: Page, text: string): Promise<void> {
  await fillField(page, TID.composerInput, text);
  await page.getByTestId(TID.composerSend).click();
}
