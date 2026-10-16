import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { decaidRequests, goTo, openApp, pullShot, saveApiKey, sendChat } from './helpers.ts';

/**
 * Overlaid shot curves (D178-D182): the shot a card's question
 * asks about, drawn faintly under it, on its card and in the Shot view, and
 * the bag's previous shot under a shot while it pulls. A shot in the chat is
 * drawn from its card, with no request; another coffee's is read from Decaid
 * once; one Decaid no longer has leaves the card alone, saying nothing.
 *
 * mockSpeed 10 plays a scripted shot in a few seconds; the live check slows
 * the mock to real time for a moment, so the shot is surely still pulling.
 */
const SPEED = 10;

/** The shot ids the mock Decaid holds, oldest first. */
function shotIds(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getShotIds() ?? []);
}

/** How many times CafAI read the shot `id` from Decaid. */
async function readsOf(page: Page, id: string): Promise<number> {
  return (await decaidRequests(page)).filter((request) => request.method === 'GET' && request.path === `/api/v1/shots/${id}`).length;
}

function setMockSpeed(page: Page, speed: number): Promise<void> {
  return page.evaluate((value) => (window as CafaiMockWindow).__CAFAI_MOCK__?.setSpeed(value), speed);
}

/** A new bag described in the chat, its starting profile loaded on the machine. */
async function startBag(page: Page, description: string, template: string): Promise<void> {
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, description);
  await page.getByTestId(TID.templatePick(template)).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('v1');
  await expect(page.getByText(/^Loaded .+ v1 on the machine\.$/)).toBeVisible();
}

async function coachIdle(page: Page): Promise<void> {
  await expect(page.getByTestId(TID.chat)).not.toHaveAttribute('data-busy', { timeout: 60_000 });
}

test('the second shot of a bag draws the first under it: while it pulls, on its card and in its graph', async ({ page }) => {
  test.setTimeout(150_000);
  await openApp(page, '#/', SPEED);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await startBag(page, 'Kiambu AA, light roast, washed, blackcurrant and grapefruit', 'blooming-espresso');
  const cards = page.getByTestId(TID.shotCard);

  // The bag's first shot, and nothing of the barista's to compare it with: its card draws it alone.
  await pullShot(page);
  await expect(cards).toHaveCount(1, { timeout: 60_000 });
  await expect(cards.first()).toContainText('Compared with the coffee you usually enjoy?');
  await expect(cards.first().getByTestId(TID.shotGuide)).toHaveCount(0);
  await expect(cards.first().getByTestId(TID.shotGuideKey)).toHaveCount(0);
  await coachIdle(page);
  const first = (await shotIds(page)).at(-1)!;
  const readsBefore = await readsOf(page, first);

  // The second shot: while it pulls, the first is under it, named over the plot with its time and yield.
  await setMockSpeed(page, 1);
  await pullShot(page);
  const view = page.getByTestId(TID.shotView);
  await expect(view.getByRole('heading', { name: 'Live shot' })).toBeVisible();
  const key = view.getByTestId(TID.shotGuideKey);
  await expect(key).toHaveText(/^Previous shot · \d+\.\d s · \d+\.\d g$/);
  await expect(view.getByRole('img', { name: /with the pressure and flow of your previous shot under them$/ })).toBeVisible();
  await expect(view.getByRole('heading', { name: 'Live shot' })).toBeVisible();
  await setMockSpeed(page, SPEED);

  // Its card asks about the first, and draws it under its own curves.
  await expect(cards).toHaveCount(2, { timeout: 60_000 });
  const second = cards.last();
  await expect(second).toContainText('Compared with your previous shot?');
  await expect(second.getByTestId(TID.shotGuide)).toBeAttached();
  await expect(second.getByTestId(TID.shotGuide).locator('path')).toHaveCount(2);
  await expect(second.getByTestId(TID.shotGuideKey)).toHaveText('Previous shot');
  await expect(second.getByRole('img', { name: 'Pressure and flow during the shot, with the pressure and flow of your previous shot under them' })).toBeVisible();
  // The first card still draws its shot alone.
  await expect(cards.first().getByTestId(TID.shotGuide)).toHaveCount(0);
  await coachIdle(page);

  // Its graph, opened from the card, draws the first under it too.
  await second.getByTestId(TID.openShotGraph).click();
  await expect(view).toContainText('Last shot');
  await expect(view.getByTestId(TID.shotGuideKey)).toHaveText(/^Previous shot · \d+\.\d s · \d+\.\d g$/);
  await goTo(page, 'coach');
  await expect(cards).toHaveCount(2);

  // The first shot came from its card in the chat: CafAI never read it from Decaid again.
  expect(await readsOf(page, first)).toBe(readsBefore);

  // Nor as the chat moves to a new bag and the old cards go.
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.beanCard)).toBeVisible();
  // Time for a read the old cards might start to reach the mock Decaid.
  await page.waitForTimeout(500);
  expect(await readsOf(page, first)).toBe(readsBefore);
});

test("the demo's first Kiambu AA shot draws Santos's last shot, read from Decaid once; its other shots come from the chat", async ({ page }) => {
  await page.goto(`./?demo=1&mockSpeed=25#/`);
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v4');
  const cards = page.getByTestId(TID.shotCard);
  await expect(cards).toHaveCount(4);

  // Shot one asks about the last shot of another coffee: that one is drawn under it.
  await cards.first().scrollIntoViewIfNeeded();
  await expect(cards.first()).toContainText('Compared with your last shot of Santos?');
  await expect(cards.first().getByTestId(TID.shotGuideKey)).toHaveText('Last shot of Santos');
  await expect(cards.first().getByTestId(TID.shotGuide).locator('path')).toHaveCount(2);
  // The newest asks about the shot before it, drawn from that shot's card.
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last().getByTestId(TID.shotGuideKey)).toHaveText('Previous shot');

  const ids = await page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    return state.getShotIds().map((id) => ({ id, title: String(state.getShot(id).workflow?.profile?.title ?? '') }));
  });
  const santos = ids.find((shot) => shot.title.startsWith('Santos'));
  expect(santos, "Santos's shot in the mock Decaid").toBeDefined();
  // Scrolling the chat up and down again asks nothing more.
  await cards.first().scrollIntoViewIfNeeded();
  await cards.last().scrollIntoViewIfNeeded();
  expect(await readsOf(page, santos!.id)).toBe(1);
  for (const shot of ids.filter((other) => other.id !== santos!.id)) expect(await readsOf(page, shot.id), shot.title).toBe(0);
});

test("a bag's first shot whose comparison Decaid no longer has draws its own shot alone, and says nothing", async ({ page }) => {
  test.setTimeout(150_000);
  await openApp(page, '#/', SPEED);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await startBag(page, 'Kiambu AA, light roast, washed, blackcurrant and grapefruit', 'blooming-espresso');
  const cards = page.getByTestId(TID.shotCard);
  await pullShot(page);
  await expect(cards).toHaveCount(1, { timeout: 60_000 });
  await coachIdle(page);
  const kiambu = (await shotIds(page)).at(-1)!;
  // Deleted in Decaid's own shot history.
  await page.evaluate((id) => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.deleteShot(id), kiambu);
  const readsBefore = await readsOf(page, kiambu);

  await startBag(page, 'Rwanda Huye, medium roast, natural', 'd-flow');
  await pullShot(page);
  await expect(cards).toHaveCount(1, { timeout: 60_000 });
  const card = cards.first();
  // The question still names it; nothing is drawn under, and nothing is said about why.
  await expect(card).toContainText('Compared with your last shot of Kiambu AA?');
  await expect.poll(() => readsOf(page, kiambu)).toBe(readsBefore + 1);
  await expect(card.getByTestId(TID.shotGuide)).toHaveCount(0);
  await expect(card.getByTestId(TID.shotGuideKey)).toHaveCount(0);
  await expect(card.getByRole('img', { name: 'Pressure and flow during the shot' })).toBeVisible();
  await expect(page.getByText(/not found/i)).toHaveCount(0);
  await coachIdle(page);

  // Its graph draws it alone too, and does not ask again.
  await card.getByTestId(TID.openShotGraph).click();
  const view = page.getByTestId(TID.shotView);
  await expect(view).toContainText('Last shot');
  await expect(view.getByTestId(TID.shotGuideKey)).toHaveCount(0);
  await expect(view.getByRole('img', { name: 'Pressure, flow and weight over the shot' })).toBeVisible();
  expect(await readsOf(page, kiambu)).toBe(readsBefore + 1);
});
