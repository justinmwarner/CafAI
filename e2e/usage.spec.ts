import { expect, test, type Page } from '@playwright/test';
import type { ClarityMockWindow } from '../mock/clarity.ts';
import { TID } from '../src/ui/testIds.ts';
import { goTo, openAppWithSwitches, recordRequests, saveApiKey, sendChat, type SeenRequest } from './helpers.ts';

/**
 * Usage sharing (D-USAGE-1 to D-USAGE-6) through mock mode's ?mockUsage=1: a
 * stand-in Clarity project whose tag the mock's service worker answers with
 * a stand-in that records every call (mock/clarity.ts), so nothing leaves
 * the browser. The time zone and the language decide whether CafAI asks
 * first (D-USAGE-2).
 */
const CLARITY = /^https:\/\/([a-z0-9-]+\.)*clarity\.ms\//;

/** A Clarity host the mock does not answer must never be asked: fail the test if it is. */
async function refuseRealClarity(page: Page): Promise<void> {
  await page.route(CLARITY, (route) => route.abort());
}

const clarityCalls = (page: Page) => page.evaluate(() => (window as ClarityMockWindow).__clarityCalls ?? []);
const toClarity = (seen: readonly SeenRequest[]) => seen.filter((request) => CLARITY.test(request.url));
const screenInAddress = (page: Page) => new URL(page.url()).searchParams.get('screen');

test.describe('in Europe', () => {
  test.use({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });

  test('asks first, loads nothing from Clarity before Yes, share, then counts the screens and the coach steps', async ({ page }) => {
    await refuseRealClarity(page);
    const seen = recordRequests(page);
    await openAppWithSwitches(page, { mockUsage: '1' });
    await expect(page.getByTestId(TID.usagePrompt)).toContainText('Help improve CafAI?');
    expect(toClarity(seen)).toEqual([]);
    expect(screenInAddress(page)).toBeNull();

    await page.getByTestId(TID.usageYes).click();
    await expect(page.getByTestId(TID.usagePrompt)).toHaveCount(0);
    await expect.poll(() => toClarity(seen).length).toBeGreaterThan(0);
    await expect.poll(() => clarityCalls(page)).toContainEqual(['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);
    await expect.poll(() => screenInAddress(page)).toBe('coach');

    await saveApiKey(page);
    await expect.poll(() => screenInAddress(page)).toBe('settings');
    await expect.poll(() => clarityCalls(page)).toContainEqual(['event', 'coach_setup']);
    await expect(page.getByTestId(TID.usageSwitch)).toBeChecked();

    await goTo(page, 'coach');
    await page.getByTestId(TID.newBag).click();
    await expect(page.getByTestId(TID.chat)).toContainText('origin');
    await sendChat(page, 'Kiambu AA, washed, light');
    await expect.poll(() => clarityCalls(page)).toContainEqual(['event', 'coach_message']);
    await expect.poll(() => clarityCalls(page)).toContainEqual(['event', 'bag_started']);
    expect(await clarityCalls(page)).toContainEqual(['set', 'rule', 'ask']);
  });
});

test.describe('elsewhere', () => {
  test.use({ timezoneId: 'America/Chicago', locale: 'en-US' });

  test('shares with the notice, claiming no consent, and Turn off stops it', async ({ page }) => {
    await refuseRealClarity(page);
    const seen = recordRequests(page);
    await openAppWithSwitches(page, { mockUsage: '1' });
    await expect(page.getByTestId(TID.usagePrompt)).toContainText('Microsoft Clarity');
    await expect.poll(() => toClarity(seen).length).toBeGreaterThan(0);
    await expect.poll(() => clarityCalls(page)).toContainEqual(['consentv2', { ad_Storage: 'denied' }]);
    expect(await clarityCalls(page)).not.toContainEqual(['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);

    const before = (await clarityCalls(page)).length;
    await page.getByTestId(TID.usageNo).click();
    await expect(page.getByTestId(TID.usagePrompt)).toHaveCount(0);
    await expect.poll(() => clarityCalls(page)).toContainEqual(['stop']);
    // Stopped, and nothing after: no consent(false), which would start Clarity again without cookies.
    expect((await clarityCalls(page)).slice(before)).toEqual([['stop']]);
    expect(screenInAddress(page)).toBeNull();

    await goTo(page, 'settings');
    await expect(page.getByTestId(TID.usageSwitch)).not.toBeChecked();
    expect(screenInAddress(page)).toBeNull();
    expect((await clarityCalls(page)).slice(before)).toEqual([['stop']]);
  });

  test('never in the demo, nor in mock mode without the switch', async ({ page }) => {
    await refuseRealClarity(page);
    const seen = recordRequests(page);
    // A fresh mock app: the key panel, where the card or the notice would sit beside it.
    await openAppWithSwitches(page, {});
    await expect(page.getByText('Add your Anthropic API key to start coaching')).toBeVisible();
    await expect(page.getByTestId(TID.usagePrompt)).toHaveCount(0);
    // The demo: a dial-in under way, the chat and its prompt row on screen.
    await openAppWithSwitches(page, { mockUsage: '1', demo: '1' });
    await expect(page.getByTestId(TID.chat)).toBeVisible();
    await expect(page.getByTestId(TID.usagePrompt)).toHaveCount(0);
    expect(toClarity(seen)).toEqual([]);
  });
});
