import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { goTo, openApp, saveApiKey, sendChat, type Screen } from './helpers.ts';

/**
 * The phone layout (D84), upright and on its side: one screen at a time
 * under a slim top bar, four tabs at the bottom (a rail on the left when the
 * phone lies on its side), Exit and Decaid settings on every screen, and
 * nothing wider than the screen. The Machine tab is the machine column at
 * full width: status, the buttons and the big graph.
 */

/** How wide the page and its scrolling boxes are against the window, and any box that scrolls sideways. */
async function widths(page: Page, frameTestId: string) {
  return page.evaluate((frameId) => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''}.${[...el.classList].join('.')}`;
    // A box with more content than it shows, and a sideways scroll to reach it.
    const sideways = [...document.querySelectorAll('*')]
      .filter((el) => {
        const { overflowX } = getComputedStyle(el);
        return (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
      })
      .map((el) => `${describe(el)}: ${el.scrollWidth} > ${el.clientWidth}`);
    // The app's frame clips (overflow hidden), but a clipped box still scrolls from script
    // (a scroll into view does it), panning the whole app: it must hold nothing past its edges.
    const frame = document.querySelector(`[data-testid="${frameId}"]`);
    return {
      window: window.innerWidth,
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      sideways,
      frame: frame && {
        overflowX: frame.scrollWidth - frame.clientWidth,
        overflowY: frame.scrollHeight - frame.clientHeight,
        scrolledX: frame.scrollLeft,
        scrolledY: frame.scrollTop,
      },
    };
  }, frameTestId);
}

async function expectNoSidewaysOverflow(page: Page, where: string): Promise<void> {
  const seen = await widths(page, TID.appReady);
  expect(seen.html, `${where}: the page is no wider than the screen`).toBeLessThanOrEqual(seen.window);
  expect(seen.body, `${where}: the body is no wider than the screen`).toBeLessThanOrEqual(seen.window);
  expect(seen.sideways, `${where}: nothing scrolls sideways`).toEqual([]);
  expect(seen.frame, `${where}: the app's frame`).not.toBeNull();
  // Within a pixel of rounding.
  expect(seen.frame!.overflowX, `${where}: the app's frame holds nothing past its sides`).toBeLessThanOrEqual(1);
  expect(seen.frame!.overflowY, `${where}: the app's frame holds nothing past its bottom`).toBeLessThanOrEqual(1);
  expect([seen.frame!.scrolledX, seen.frame!.scrolledY], `${where}: the app's frame has not panned`).toEqual([0, 0]);
}

interface TabScreen {
  screen: Screen;
  tab: string;
  hash: string;
  /** Something only that screen shows. */
  shows: (page: Page) => Locator;
}

const SCREENS: readonly TabScreen[] = [
  {
    screen: 'coach',
    tab: TID.tabCoach,
    hash: '#/',
    shows: (page) => page.getByRole('heading', { name: 'Add your Anthropic API key to start coaching' }),
  },
  { screen: 'shot', tab: TID.tabMachine, hash: '#/shot', shows: (page) => page.getByTestId(TID.espressoButton) },
  { screen: 'history', tab: TID.tabHistory, hash: '#/history', shows: (page) => page.getByRole('heading', { name: 'History', level: 1 }) },
  { screen: 'settings', tab: TID.tabSettings, hash: '#/settings', shows: (page) => page.getByRole('heading', { name: 'Settings', level: 1 }) },
];

const hashOf = (page: Page) => new URL(page.url()).hash;

/** The room the app keeps at the bottom for the home indicator, in px (src/ui/platform/safeArea.ts). */
function bottomInset(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')));
}

test('every tab shows its screen, with Exit and Decaid settings, and nothing runs off the side', async ({ page }) => {
  await openApp(page);
  // The phone's navigation, not the tablet's.
  await expect(page.getByTestId(TID.navCoach)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Machine' })).toHaveCount(0);
  // The page fills the phone's screen, so the home indicator's room is inferred: 34 px upright, 21 px on its side.
  const { width, height } = page.viewportSize()!;
  const inset = await bottomInset(page);
  expect(inset).toBe(height > width ? 34 : 21);

  // Twice round, so every tab is reached from another one.
  for (const round of [1, 2]) {
    for (const { screen, tab, hash, shows } of SCREENS) {
      const where = `${screen} (round ${round})`;
      await goTo(page, screen);
      expect(hashOf(page), where).toBe(hash);
      await expect(page.getByTestId(tab), where).toHaveAttribute('aria-current', 'page');
      for (const other of SCREENS.filter((s) => s.tab !== tab)) {
        await expect(page.getByTestId(other.tab), where).not.toHaveAttribute('aria-current', 'page');
      }
      await expect(shows(page), where).toBeVisible();
      // The ways out, whole and on screen.
      await expect(page.getByTestId(TID.exitToSkins), where).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId(TID.decaidSettings), where).toBeInViewport({ ratio: 1 });
      // Every tab stays whole on screen too, clear of the home indicator.
      for (const other of SCREENS) {
        const tabButton = page.getByTestId(other.tab);
        await expect(tabButton, where).toBeInViewport({ ratio: 1 });
        const box = (await tabButton.boundingBox())!;
        expect(box.y + box.height, `${where}: the ${other.screen} tab clears the home indicator`).toBeLessThanOrEqual(height - inset);
      }
      await expectNoSidewaysOverflow(page, where);
    }
  }
});

test('the Machine tab has Espresso, Stop and the big graph', async ({ page }) => {
  await openApp(page);
  await goTo(page, 'shot');
  await expect(page.getByTestId(TID.machineState)).toBeVisible();
  for (const id of [TID.espressoButton, TID.stopButton, TID.liveGraph]) {
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
  // The full graph, with its four readouts, not the tablet's small panel.
  await expect(page.getByRole('list', { name: 'Shot readouts' })).toBeVisible();
  await expect(page.getByTestId(TID.previewGraph)).toHaveCount(0);
  for (const id of [TID.steamButton, TID.flushButton, TID.hotWaterButton, TID.tareButton, TID.sleepWakeButton]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expectNoSidewaysOverflow(page, 'the Machine tab');
});

test('the bag header keeps the picker, the version, Undo and New bag on one row', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed, blackcurrant and grapefruit');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v1');

  // A shot from the Machine tab, a taste and a confirmed change: v2, so Undo shows.
  await goTo(page, 'shot');
  await page.getByTestId(TID.espressoButton).click();
  await goTo(page, 'coach');
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(TID.optionChip('Sour / sharp')).click();
  await page.getByTestId(TID.diffConfirm).click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v2');

  // Inside <main>, so a plain header to assistive tech, not the banner landmark.
  const header = page.locator('header[aria-label="Bag"]');
  const parts = {
    picker: page.getByTestId(TID.bagPicker),
    version: page.getByTestId(TID.activeVersion),
    undo: header.getByRole('button', { name: 'Undo' }),
    newBag: header.getByRole('button', { name: 'New bag' }),
  };
  await expect(parts.undo).toBeVisible();
  await expect(parts.undo).toHaveAttribute('data-testid', TID.undoButton);
  await expect(parts.newBag).toHaveAttribute('data-testid', TID.newBag);
  const row = (await header.boundingBox())!;
  for (const [name, part] of Object.entries(parts)) {
    await expect(part, name).toBeInViewport({ ratio: 1 });
    const box = (await part.boundingBox())!;
    // One row: each part's middle on the header's middle, and inside the header.
    expect(Math.abs(box.y + box.height / 2 - (row.y + row.height / 2)), `${name} sits on the header's one row`).toBeLessThanOrEqual(4);
    expect(box.x + box.width, `${name} ends inside the header`).toBeLessThanOrEqual(row.x + row.width);
  }
  for (const button of [parts.undo, parts.newBag]) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(47.5);
    expect(box.height).toBeGreaterThanOrEqual(47.5);
  }
  expect(row.height, 'the header is one row tall').toBeLessThanOrEqual(65);
  await expectNoSidewaysOverflow(page, 'the coach with a bag');

  await parts.undo.click();
  await expect(page.getByTestId(TID.activeVersion)).toContainText('Kiambu AA v1');
});
