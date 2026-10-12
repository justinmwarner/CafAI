import { expect, test } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { fillField, goTo, openApp, recordRequests, sendChat } from './helpers.ts';

/**
 * "Claude on my computer" (docs/superpowers/specs/2026-10-11-local-claude-design.md):
 * Settings finds CafAI Bridge on this device, saves its address and code, and
 * Test says what the bridge reports; the coach's turns then go to the bridge,
 * with its code, and never to Anthropic. Mock mode answers
 * http://127.0.0.1:8877 with the same scripted coach (mock/anthropic/bridge.ts),
 * so no bridge runs here.
 */
test('the coach answers through CafAI Bridge on this computer, without an API key', async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page, '#/settings');

  const section = page.getByRole('region', { name: 'Where the coach runs' });
  const keySection = page.getByRole('region', { name: 'Anthropic API key' });
  await expect(section.getByTestId(TID.coachSourceAnthropic)).toBeChecked();
  await expect(keySection).toBeVisible();
  await expect(section.getByTestId(TID.computerAddress)).toHaveCount(0);
  // The key's field and the bridge's address and code take turns with the choice (D140).
  await section.getByTestId(TID.coachSourceComputer).check();
  await expect(keySection).toHaveCount(0);
  await expect(section.getByTestId(TID.computerAddress)).toBeVisible();

  await section.getByTestId(TID.computerFind).click();
  await expect(section.getByText('Found CafAI Bridge on this device.')).toBeVisible();
  await expect(section.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1');
  await fillField(page, TID.computerCode, 'abcd-efgh');
  await section.getByTestId(TID.computerSave).click();
  await expect(section.getByText('Saved on this device.')).toBeVisible();
  await expect(section.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1:8877');
  await expect(section.getByTestId(TID.computerCode)).toHaveValue('ABCD-EFGH');

  await section.getByTestId(TID.computerTest).click();
  await expect(section.getByTestId(TID.computerStatus)).toHaveText(
    'Connected. Claude Code 2.1.251, signed in with Claude Max. 8% of the 5-hour limit used.',
  );

  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await expect(page.getByTestId(TID.templateCard('blooming-espresso'))).toBeVisible();

  const coachCalls = seen.filter((request) => new URL(request.url).pathname === '/v1/messages');
  expect(coachCalls.length).toBeGreaterThan(0);
  for (const call of coachCalls) {
    expect(call.url).toBe('http://127.0.0.1:8877/v1/messages');
    expect(call.headers['x-api-key']).toBe('ABCDEFGH');
  }
  expect(seen.filter((request) => request.url.startsWith('https://api.anthropic.com/'))).toEqual([]);
  // The probe ran on the coach's model.
  expect(seen.some((request) => request.url.startsWith('http://127.0.0.1:8877/v1/status?probe=1&model=claude-'))).toBe(true);
});
