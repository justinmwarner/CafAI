import { expect, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
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

/** The cafai namespace of the mock Decaid's key-value store, as one searchable string. */
export async function mirroredText(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify((window as CafaiMockWindow).__CAFAI_MOCK__?.state.kvAll('cafai') ?? {}));
}

/** Every request the mock Decaid received and everything it stores, as one searchable string. */
export async function everythingDecaidSaw(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__?.state;
    if (!state) throw new Error('The mock Decaid is not running.');
    const shots = state.getShotIds().map((id) => state.getShot(id));
    return JSON.stringify({ requests: state.requests, kv: state.kvAll('cafai'), shots, workflow: state.getWorkflow() });
  });
}

export interface SeenRequest {
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Record every request the page makes from now on, those the mock's service worker answers included. */
export function recordRequests(page: Page): SeenRequest[] {
  const seen: SeenRequest[] = [];
  page.on('request', (request) => {
    seen.push({ url: request.url(), headers: request.headers(), body: request.postData() });
  });
  return seen;
}
