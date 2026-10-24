import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { goTo, openApp, saveApiKey, sendChat } from './helpers.ts';

/**
 * Settings > Data and privacy > Log (D139), end to end against the mock
 * Decaid and the scripted coach, which answer through the same code as the
 * real ones: the log holds Decaid's REST calls, its WebSocket frames and the
 * coach's turns, opens an entry to its raw body, never holds the key (saved,
 * sent to the coach in its header, and copied into Decaid's store), and goes
 * out by Email's mailto: link and by Share (stubbed: Chromium has no share
 * sheet here).
 */

/** A made-up key, built at run time. */
const KEY = ['sk', 'ant', 'api03', `TrafficLogE2e${Date.now().toString(36)}`, 'Zz9Yy8Xx7Ww6Vv5Uu4AA'].join('-');

interface Shared {
  title?: string;
  text?: string;
  files: Array<{ name: string; type: string; text: string }>;
}

/**
 * A share sheet the test can read back (what was shared goes on
 * window.__shared), and a mail app: a mailto: link is not followed, its
 * address goes on window.__mailto. The listener is on window, so it hears
 * the tap after CafAI's own handler has set the link.
 */
async function stubShareAndMail(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shared: unknown[] = [];
    (window as unknown as { __shared: unknown[] }).__shared = shared;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const files = await Promise.all((data.files ?? []).map(async (file) => ({ name: file.name, type: file.type, text: await file.text() })));
        shared.push({ title: data.title, text: data.text, files });
      },
    });
    window.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="mailto:"]') : null;
      if (!link) return;
      (window as unknown as { __mailto: string | null }).__mailto = link.getAttribute('href');
      event.preventDefault();
    });
  });
}

/** What the last mailto: link tapped was. */
function lastMailto(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __mailto?: string | null }).__mailto ?? '');
}

function entries(view: Locator, text?: string | RegExp): Locator {
  const all = view.getByTestId(TID.logEntries).locator('[data-testid^="log-entry-"]');
  return text === undefined ? all : all.filter({ hasText: text });
}

/** The newest entry whose line matches, through Show more when the view shows only the newest 200. */
async function findEntry(view: Locator, text: RegExp): Promise<Locator> {
  for (let page = 0; page < 5 && (await entries(view, text).count()) === 0; page += 1) {
    const more = view.getByTestId(TID.logMore);
    if ((await more.count()) === 0) break;
    await more.click();
  }
  const found = entries(view, text).first();
  await expect(found).toBeVisible();
  return found;
}

// Copy uses the clipboard API where the page may (127.0.0.1 is a secure origin), and the test reads it back.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('Settings > Log holds what went to Decaid and the coach, without the key, and shares it', async ({ page }) => {
  await stubShareAndMail(page);
  await openApp(page);
  await saveApiKey(page, KEY);
  await expect(page.getByText('Key saved on this device.')).toBeVisible();
  // The key's copy in Decaid (D99): its write goes through the log too.
  const keep = page.getByTestId(TID.keyInDecaid);
  await keep.click();
  await expect(keep).toBeChecked();

  // A turn of the coach.
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await expect(page.locator('[data-testid^="template-card-"]').first()).toBeVisible();

  // Settings > Data and privacy > Log: the summary, and Email's link.
  await goTo(page, 'settings', 'data');
  const section = page.getByTestId(TID.logSection);
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId(TID.logSummary)).toHaveText(/^\d+ entries since \d\d:\d\d, [\d.]+ (B|KB|MB)$/);
  await section.getByTestId(TID.logEmail).click();
  await expect.poll(() => lastMailto(page)).toMatch(/^mailto:\?subject=/);
  const href = await lastMailto(page);
  expect(href).toMatch(/^mailto:\?subject=CafAI%20log%2C%20\d{4}-\d\d-\d\d%20\d\d%3A\d\d&body=/);
  expect(href.length).toBeLessThanOrEqual(8000);
  const email = decodeURIComponent(href.slice(href.indexOf('&body=') + '&body='.length));
  expect(email).toMatch(/^CafAI log, \d{4}-\d\d-\d\d \d\d:\d\d\r\nCafAI \S+, Decaid \S+ at http:\/\/127\.0\.0\.1:8080\r\n/);
  expect(email).toContain("The API key and CafAI Bridge's pairing code are never in this log");
  expect(email).not.toContain(KEY);

  // The view, full screen.
  await section.getByTestId(TID.logOpen).click();
  const view = page.getByTestId(TID.logView);
  await expect(view).toBeVisible();
  const box = (await view.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);

  // Decaid's REST calls, with their replies.
  await view.getByTestId(TID.logFilter('decaid')).click();
  const reply = await findEntry(view, /↓.*REST.*GET \/api\/v1\/workflow.*200/);
  await reply.click();
  await expect(view.getByTestId(TID.logDetail).first()).toContainText('"profile": {');
  await reply.click();
  // The key's copy is in the log, its body never.
  const copy = await findEntry(view, /↑.*REST.*POST \/api\/v1\/store\/cafai-key\/anthropic/);
  await copy.click();
  await expect(view.getByTestId(TID.logDetail).first()).toContainText("[not kept: the API key's copy in Decaid]");
  await copy.click();

  // Decaid's WebSockets: their opening, and their frames.
  await view.getByTestId(TID.logFilter('frames')).click();
  await findEntry(view, /WS.*ws\/v1\/machine\/snapshot.*frame/);
  await findEntry(view, /WS.*ws\/v1\/devices.*open/);

  // The coach: the request with the key's header by name only (its system prompt cut until Show all),
  // and the reply as assembled, with its stream.
  await view.getByTestId(TID.logFilter('coach')).click();
  const request = await findEntry(view, /↑.*Coach.*POST api\.anthropic\.com\/v1\/messages/);
  await request.click();
  const sent = view.getByTestId(TID.logDetail).first();
  await expect(sent).toContainText('x-api-key: [key redacted]');
  await expect(sent).toContainText('"system": "');
  await expect(sent).toContainText('Share and Copy always have all of it.');
  await sent.getByTestId(TID.logShowAll).click();
  await expect(sent).toContainText('"messages": [');
  await expect(sent).toContainText('Kiambu AA, light roast, washed');
  await request.click();
  const answer = await findEntry(view, /↓.*Coach.*POST api\.anthropic\.com\/v1\/messages.*200 tool_use/);
  await answer.click();
  const received = view.getByTestId(TID.logDetail).first();
  await expect(received).toContainText('"stopReason": "tool_use"');
  await expect(received).toContainText('Stream events');
  await expect(received).toContainText('event: message_start');

  // The key is nowhere on the page, the Email link included.
  expect(await page.content()).not.toContain(KEY);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(KEY);

  // Share: the whole log as a .txt file.
  await view.getByTestId(TID.logFilter('all')).click();
  await view.getByTestId(TID.logShare).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared.length)).toBe(1);
  const shared = await page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared[0]!);
  expect(shared.title).toMatch(/^CafAI log, /);
  expect(shared.files).toHaveLength(1);
  const file = shared.files[0]!;
  expect(file.name).toMatch(/^cafai-log-\d{4}-\d\d-\d\d-\d{4}\.txt$/);
  expect(file.type).toBe('text/plain');
  for (const part of ['CafAI log, ', 'Browser: ', 'Screen: ', 'Entries: ', 'REST GET /api/v1/workflow', 'WS ws/v1/machine/snapshot', 'Coach POST api.anthropic.com/v1/messages', 'event: message_stop']) {
    expect(file.text).toContain(part);
  }
  expect(file.text).not.toContain(KEY);

  // Copy puts the same on the clipboard, and says so; Close goes back to Data and privacy.
  await view.getByTestId(TID.logCopy).click();
  await expect(view.getByTestId(TID.logSaid)).toHaveText('Copied the whole log.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^CafAI log, /);
  expect(copied).toContain('Coach POST api.anthropic.com/v1/messages');
  expect(copied).not.toContain(KEY);
  await view.getByTestId(TID.logClose).click();
  await expect(view).toBeHidden();
  await expect(section).toBeVisible();
});

test('Pause holds the view still while the log keeps recording', async ({ page }) => {
  await openApp(page, '#/settings/data');
  await page.getByTestId(TID.logOpen).click();
  const view = page.getByTestId(TID.logView);
  await view.getByTestId(TID.logFilter('frames')).click();
  await expect(entries(view).first()).toBeVisible();
  await view.getByTestId(TID.logPause).click();
  const held = await entries(view).count();
  // The mock's machine and scale send a frame a second: new ones come in, the view stays.
  await expect(view.getByTestId(TID.logPause)).toHaveText(/Resume \(\d+ new\)/, { timeout: 10_000 });
  expect(await entries(view).count()).toBe(held);
  await view.getByTestId(TID.logPause).click();
  await expect.poll(() => entries(view).count()).toBeGreaterThan(held);
});

test('Copy works where the page has no clipboard API (plain http on the network), in Settings and in the view', async ({ page }) => {
  // A page over plain http has no navigator.clipboard: Copy selects and copies a text area. The test keeps
  // the real clipboard to read it back.
  await page.addInitScript(() => {
    const real = navigator.clipboard;
    const kept = window as unknown as { __clipboard: Clipboard };
    kept.__clipboard = real;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  const clipboard = () => page.evaluate(() => (window as unknown as { __clipboard: Clipboard }).__clipboard.readText());
  const stale = () => page.evaluate(() => (window as unknown as { __clipboard: Clipboard }).__clipboard.writeText('stale'));
  await openApp(page, '#/settings/data');
  const section = page.getByTestId(TID.logSection);
  await section.scrollIntoViewIfNeeded();
  await stale();
  await section.getByTestId(TID.logCopy).click();
  await expect(section.getByTestId(TID.logSaid)).toHaveText('Copied the whole log.');
  expect(await clipboard()).toMatch(/^CafAI log, /);

  // Inside the view's dialog, which keeps focus to itself: the copy still carries the log.
  await stale();
  await section.getByTestId(TID.logOpen).click();
  const view = page.getByTestId(TID.logView);
  await view.getByTestId(TID.logFilter('frames')).click();
  await view.getByTestId(TID.logCopy).click();
  await expect(view.getByTestId(TID.logSaid)).toHaveText('Copied the whole log.');
  const copied = await clipboard();
  expect(copied).toMatch(/^CafAI log, /);
  // Every entry, whatever the filter shows.
  expect(copied).toContain('REST GET /api/v1/workflow');
  expect(copied).toContain('WS ws/v1/');
});
