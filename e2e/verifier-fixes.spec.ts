import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { openApp, openAppWithSwitches, recordRequests, saveApiKey, sendChat, type SeenRequest } from './helpers.ts';

/**
 * The fresh-eyes verifier's defects 2, 3, 7 and 8 (main 5098ef5), in the
 * built app: a profile loaded behind CafAI's back reaches the banner together
 * with the Profile line, once per profile (D66, D52); a version the connected
 * machine has not confirmed is never "loaded when the machine connects"
 * (D55); the Profile line marks the bag's version only once the machine holds
 * it; and a shot that ran another bag's same-named version names the title
 * once (D41).
 */

const profileLine = (page: Page) => page.getByRole('group', { name: 'Profile', exact: true });
const banner = (page: Page) => page.getByTestId(TID.errorBanner);
const chat = (page: Page) => page.getByTestId(TID.chat);

/** New bag from the coach screen, then wait for its template cards. */
async function startBag(page: Page, description: string, templateId: string): Promise<void> {
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await expect(chat(page)).toContainText('origin');
  const cards = page.getByTestId(TID.templatePick(templateId));
  const before = await cards.count();
  await sendChat(page, description);
  await expect(cards).toHaveCount(before + 1);
}

async function pickNewest(page: Page, templateId: string): Promise<void> {
  await page.getByTestId(TID.templatePick(templateId)).last().click();
}

/** Another skin puts a profile from Decaid's library in the workflow; CafAI's tag stays behind (Decaid merges extras). */
async function loadBehindCafai(page: Page, title: string): Promise<void> {
  await page.evaluate((wanted) => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    const record = state.listProfiles({ includeHidden: true }).find((candidate) => candidate.profile.title === wanted);
    if (!record) throw new Error(`The mock Decaid has no profile "${wanted}".`);
    state.updateWorkflow({ profile: record.profile });
  }, title);
}

/** The page comes back into view: CafAI looks at the machine at once instead of at its next 30 s beat. */
async function backIntoView(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/** Decaid's barrier (POST /api/v1/machine/profile) answers 504 once, with the machine connected. */
async function failNextBarrier(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as CafaiMockWindow).__CAFAI_MOCK__!.state.failNext({
      method: 'POST',
      path: '/api/v1/machine/profile',
      status: 504,
      body: { error: 'Gateway timeout' },
      times: 1,
    }),
  );
}

/** The tool results in the last request CafAI sent to the model, as sent. */
function toolResultsSent(seen: SeenRequest[]): string[] {
  const last = [...seen].reverse().find((request) => request.url.includes('api.anthropic.com') && request.body !== null);
  if (!last?.body) return [];
  const messages = (JSON.parse(last.body) as { messages: Array<{ content: unknown }> }).messages;
  return messages
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []))
    .filter((block) => block.type === 'tool_result' && typeof block.content === 'string')
    .map((block) => block.content as string);
}

test('a profile loaded behind CafAI reaches the banner with the Profile line, once per profile (defect 2)', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await saveApiKey(page);
  await startBag(page, 'Kiambu AA, light roast, washed', 'blooming-espresso');
  await pickNewest(page, 'blooming-espresso');
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await expect(profileLine(page)).toContainText('This bag');

  // CafAI looks every 30 s; the line reads on the same beat, so both change together.
  await loadBehindCafai(page, 'Default');
  await expect(profileLine(page)).toContainText('Default', { timeout: 35_000 });
  await expect(banner(page)).toContainText('The machine is running "Default", not Kiambu AA v1.', { timeout: 3_000 });
  await expect(profileLine(page)).not.toContainText('This bag');

  // Dismissed (D52): looking again at the same profile does not bring it back.
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page)).toHaveCount(0);
  await backIntoView(page);
  await page.waitForTimeout(1_500);
  await expect(banner(page)).toHaveCount(0);

  // A different profile is news.
  await loadBehindCafai(page, 'Gentle and sweet');
  await backIntoView(page);
  await expect(banner(page)).toContainText('The machine is running "Gentle and sweet", not Kiambu AA v1.');
  await expect(profileLine(page)).toContainText('Gentle and sweet');

  // Retry loads the bag's version again.
  await banner(page).getByTestId(TID.retryButton).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(profileLine(page)).toContainText('Kiambu AA v1');
  await expect(profileLine(page)).toContainText('This bag');
});

test('a version the connected machine has not confirmed asks for Retry, never for the machine to connect (defects 3, 7)', async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page);
  await saveApiKey(page);
  await startBag(page, 'Kiambu AA, light roast, washed', 'blooming-espresso');
  await failNextBarrier(page);
  await pickNewest(page, 'blooming-espresso');

  await expect(chat(page)).toContainText('I saved Kiambu AA v1, but the machine has not confirmed it. Tap Retry above, then pull a shot.');
  await expect(chat(page)).not.toContainText('Decaid loads it when the machine connects');
  await expect(banner(page)).toContainText('The machine has not confirmed Kiambu AA v1.');
  // The Profile line agrees with the banner.
  await expect(profileLine(page)).toContainText('Kiambu AA v1');
  await expect(profileLine(page)).toContainText('not confirmed');
  await expect(profileLine(page)).not.toContainText('This bag');
  // The coach heard why, and not that the machine is away.
  const picked = toolResultsSent(seen).find((content) => content.includes('"picked"')) ?? '';
  expect(picked).toContain('"onMachine":null');
  expect(picked).toMatch(/"loadError":"[^"]+"/);

  await banner(page).getByTestId(TID.retryButton).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await expect(profileLine(page)).toContainText('This bag');

  // A confirmed change the machine does not confirm: the same.
  await page.getByTestId(TID.espressoButton).click();
  const sour = page.getByTestId(TID.optionChip('Sour / sharp'));
  await expect(sour).toHaveCount(1, { timeout: 60_000 });
  await sour.click();
  const diff = page.getByTestId(TID.diffCard);
  await expect(diff).toHaveCount(1);
  await expect(diff.getByTestId(TID.diffConfirm)).toBeVisible();
  await failNextBarrier(page);
  await diff.getByTestId(TID.diffConfirm).click();
  await expect(chat(page)).toContainText('Saved v2, but the machine has not confirmed it. Tap Retry above, then pull another shot.');
  await expect(profileLine(page)).toContainText('Kiambu AA v2');
  await expect(profileLine(page)).toContainText('not confirmed');
  await expect(chat(page)).not.toContainText('Decaid loads it when the machine connects');
});

test('the Profile line says loading… until the machine holds the version, never "This bag" before (defect 7)', async ({ page }) => {
  await openAppWithSwitches(page, { mockUploadMs: '3000' });
  await saveApiKey(page);
  await startBag(page, 'Kiambu AA, light roast, washed', 'blooming-espresso');
  await pickNewest(page, 'blooming-espresso');

  await expect(page.getByRole('status').filter({ hasText: 'Loading Kiambu AA v1 on the machine…' })).toBeVisible();
  await expect(profileLine(page)).toContainText('Kiambu AA v1');
  await expect(profileLine(page)).toContainText('loading…');
  await expect(profileLine(page)).not.toContainText('This bag');

  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  await expect(profileLine(page)).toContainText('This bag');
  await expect(profileLine(page)).not.toContainText('loading…');
});

test('a shot that ran another bag’s same-named version names the title once (defect 8)', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  await startBag(page, 'Kiambu AA, light roast, washed', 'blooming-espresso');
  await pickNewest(page, 'blooming-espresso');
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();

  // The same "Kiambu AA v1", tagged as another bag's version.
  await page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    state.updateWorkflow({
      profile: state.getWorkflow().profile,
      context: { extras: { cafai: { versionId: 'ver_other', bagId: 'bag_other' } } },
    });
  });
  await page.getByTestId(TID.espressoButton).click();
  await expect(chat(page)).toContainText(
    'That shot ran a different "Kiambu AA v1" (another bag or version), so it is not part of this dial-in.',
    { timeout: 60_000 },
  );
  await expect(chat(page)).not.toContainText('ran "Kiambu AA v1", not Kiambu AA v1');
  await expect(page.getByTestId(TID.shotCard)).toHaveCount(0);
});
