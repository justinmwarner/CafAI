import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { composerField, goTo, isPhone, machineRow, openApp, pullShot, pullShotOnMachine, saveApiKey, sendChat } from './helpers.ts';

/**
 * Shot focus (D85), in every layout. A shot that starts shows itself: the
 * Shot view, in a tablet's main pane or as a phone's Shot tab, with the
 * coach's note. Once the chat has the shot's card the coach comes back by
 * itself, but only from a switch the app made. A shot that starts while the
 * barista types leaves the coach where it is.
 *
 * The shot starts from Espresso in the top bar's machine row, there on every
 * screen of both layouts (D90). One that starts while the barista types is
 * started on the machine itself, as the group-head button does: a tap on
 * Espresso would take the focus from the field.
 *
 * mockSpeed 10 plays the scripted shot (about 30 s of data) in about 3 s:
 * short, but long enough to look at it and move around while it runs.
 */
const SPEED = 10;

type HashLog = Window & { __hashChanges?: string[] };

async function loadFirstVersion(page: Page): Promise<void> {
  await openApp(page, '#/', SPEED);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed, blackcurrant and grapefruit');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v1');
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
}

/** The screen a shot takes: the Shot view, in a tablet's main pane and on a phone's Shot tab alike. */
function shotScreen(page: Page): Locator {
  return page.getByTestId(TID.shotView);
}

/** The shot route is up with the big graph (its four readouts) and the coach's note, over the hidden coach. */
async function expectShotOnScreen(page: Page): Promise<void> {
  await expect(page).toHaveURL(/#\/shot$/);
  await expect(shotScreen(page)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Shot readouts' })).toBeVisible();
  await expect(page.getByTestId(isPhone(page) ? TID.tabShot : TID.navShot)).toHaveAttribute('aria-current', 'page');
  const note = page.getByTestId(TID.coachNote);
  await expect(note).toBeVisible();
  // Watching the pour, or once it is over, reading the shot.
  await expect(note).toContainText(/watching|Reading the shot/);
  // Still mounted under the shot, so its scroll and draft survive; just not on screen.
  await expect(page.getByTestId(TID.chat)).toBeAttached();
  await expect(page.getByTestId(TID.chat)).toBeHidden();
}

test('a shot takes the screen by itself, and the coach comes back with its card', async ({ page }) => {
  // Two shots on a phone.
  test.setTimeout(150_000);
  await loadFirstVersion(page);
  const composer = await composerField(page);
  // Nobody is typing, so the shot may take the screen.
  await expect(composer).not.toBeFocused();
  const cards = page.getByTestId(TID.shotCard);

  await pullShot(page);
  await expectShotOnScreen(page);

  // The card in the chat brings the coach back by itself, the shot's view gone.
  await expect(cards).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/#\/$/);
  await expect(shotScreen(page)).toHaveCount(0);
  await expect(page.getByTestId(TID.coachNote)).toHaveCount(0);
  await expect(page.getByTestId(TID.chat)).toBeVisible();
  await expect(page.getByTestId(isPhone(page) ? TID.tabCoach : TID.navCoach)).toHaveAttribute('aria-current', 'page');

  // The newest card opens that shot's big graph, and the coach is a tap away.
  await cards.getByTestId(TID.openShotGraph).click();
  await expect(page).toHaveURL(/#\/shot$/);
  await expect(shotScreen(page)).toContainText('Last shot');
  await goTo(page, 'coach');
  await expect(cards).toBeVisible();

  // Shot (the tablet's top bar item, the phone's tab) opens the last shot's graph too, and Coach goes back.
  await goTo(page, 'shot');
  await expect(page).toHaveURL(/#\/shot$/);
  await expect(shotScreen(page)).toContainText('Last shot');
  await goTo(page, 'coach');
  await expect(page).toHaveURL(/#\/$/);
  await expect(cards).toBeVisible();
  // The live strip below is the phone's.
  if (!isPhone(page)) return;

  // A phone: a second shot started on the Shot tab, where it is on screen already, so the app switches nothing.
  await goTo(page, 'shot');
  await pullShot(page);
  await expect(page.getByTestId(TID.coachNote)).toBeVisible();
  // On the Coach tab the live strip shows the shot...
  await goTo(page, 'coach');
  const strip = page.getByTestId(TID.liveStrip);
  await expect(strip).toBeVisible();
  await expect(strip).toContainText(/Live shot|Last shot/);
  // ...and opens its graph.
  await strip.click();
  await expect(page).toHaveURL(/#\/shot$/);
  await expect(page.getByTestId(TID.liveGraph)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Shot readouts' })).toBeVisible();
  // The app made no switch for this shot, so its card makes none back: the barista stays on the graph.
  await expect(cards).toHaveCount(2, { timeout: 60_000 });
  await expect(page).toHaveURL(/#\/shot$/);
  await expect(page.getByTestId(TID.liveGraph)).toBeVisible();
  await goTo(page, 'coach');
  await expect(cards.last()).toBeVisible();
  // Its outcome is in the chat, so the strip is gone.
  await expect(strip).toHaveCount(0);
});

test('a shot that starts while the barista types leaves the coach on screen', async ({ page }) => {
  await loadFirstVersion(page);
  // Every route change from here on.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as HashLog).__hashChanges = seen;
    window.addEventListener('hashchange', () => seen.push(window.location.hash));
  });
  const composer = await composerField(page);
  await composer.click();
  await composer.pressSequentially('Sour');
  await expect(composer).toBeFocused();

  // The group head starts it: a tap on Espresso would take the focus from the field.
  await pullShotOnMachine(page);
  // The shot runs: Stop has taken Espresso's place in the top bar, and on a phone the Coach tab has the live strip.
  await expect(machineRow(page).getByTestId(TID.stopButton)).toBeVisible();
  if (isPhone(page)) await expect(page.getByTestId(TID.liveStrip)).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId(TID.chat)).toBeVisible();
  await expect(page.getByTestId(TID.shotView)).toHaveCount(0);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Sour');

  // Its card lands in the chat on screen, with the draft untouched and still being typed.
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/#\/$/);
  await expect(composer).toHaveValue('Sour');
  await expect(composer).toBeFocused();
  expect(await page.evaluate(() => (window as HashLog).__hashChanges)).toEqual([]);
});
