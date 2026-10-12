// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { recordExchange, trafficLog } from '../../traffic/recorder.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { knownDecaidVersion, useDecaidVersion } from './decaidVersion.ts';
import { COPIED, COPY_FAILED, INSIDE_DECAID_NOTE, SHARE_FAILED } from './LogActions.tsx';
import { LOG_NOTE, LogSection, SUMMARY_EVERY_MS, summaryText } from './LogSection.tsx';
import { closeLogView, useLogViewOpen } from './logShare.ts';

/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const KEY = ['sk', 'ant', 'api03', 'LoGsEcTiOnTeSt0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');

function seed() {
  recordExchange('rest', 'GET /api/v1/workflow').reply(200, { body: '{"profile":{"title":"Kiambu AA v2"}}' });
  recordExchange('coach', 'POST api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: `my key is ${KEY}` }] }),
  }).reply(200, { body: '{"stopReason":"end_turn"}', outcome: 'end_turn' });
}

/** What Settings has on screen with the log: About asks Decaid's version, which the log's header then carries. */
function WithAbout() {
  useDecaidVersion();
  return <LogSection />;
}

function OpenState() {
  return <span data-testid="open-state">{useLogViewOpen() ? 'open' : 'closed'}</span>;
}

/** A navigator with only what the log reads, and what the test gives it. */
function stubNavigator(extra: Record<string, unknown> = {}) {
  const writeText = vi.fn(async (_text: string) => undefined);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (test)', clipboard: { writeText }, ...extra });
  return { writeText };
}

beforeEach(() => {
  trafficLog.clear();
  closeLogView();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('summaryText', () => {
  it('counts the entries since the oldest, with their size, or says there are none', () => {
    const at = new Date(2026, 9, 11, 21, 4).getTime();
    expect(summaryText({ count: 0, oldestAt: null, chars: 0, since: at })).toBe('Nothing recorded since 21:04.');
    expect(summaryText({ count: 1, oldestAt: at, chars: 500, since: at })).toBe('1 entry since 21:04, 500 B');
    expect(summaryText({ count: 214, oldestAt: at, chars: 1_258_291, since: at })).toBe('214 entries since 21:04, 1.2 MB');
  });
});

describe('LogSection', () => {
  it('says how much the log holds and what it is, read every 2 seconds, never on each entry', async () => {
    vi.useFakeTimers();
    try {
      stubNavigator();
      renderWithServices(<LogSection />);
      expect(screen.getByTestId(TID.logSummary)).toHaveTextContent(/^Nothing recorded since \d\d:\d\d\.$/);
      expect(screen.getByText(LOG_NOTE)).toBeInTheDocument();
      act(() => seed());
      act(() => void vi.advanceTimersByTime(SUMMARY_EVERY_MS - 1));
      expect(screen.getByTestId(TID.logSummary)).toHaveTextContent(/^Nothing recorded/);
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.getByTestId(TID.logSummary)).toHaveTextContent(/^4 entries since \d\d:\d\d, \d+ B$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never listens to the log itself', () => {
    stubNavigator();
    const subscribe = vi.spyOn(trafficLog, 'subscribe');
    renderWithServices(<LogSection />);
    act(() => seed());
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('copies the whole log under its header, with the key nowhere', async () => {
    const { writeText } = stubNavigator();
    seed();
    const { services } = renderWithServices(<WithAbout />);
    await waitFor(() => expect(knownDecaidVersion(services.decaid)).toBe('0.9.0+1'));
    await userEvent.click(screen.getByTestId(TID.logCopy));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0];
    expect(text.split('\n').slice(0, 4)).toEqual([
      expect.stringMatching(/^CafAI log, \d{4}-\d\d-\d\d \d\d:\d\d$/),
      'CafAI 0.1.0-test, Decaid 0.9.0+1 at http://localhost:8080',
      'Browser: Mozilla/5.0 (test)',
      expect.stringMatching(/^Screen: \d+ x \d+, pixel ratio [\d.]+ \(screen \d+ x \d+\)$/),
    ]);
    expect(text).toContain('↑ REST GET /api/v1/workflow');
    expect(text).toContain('{"profile":{"title":"Kiambu AA v2"}}');
    expect(text).toContain('x-api-key: [key redacted]');
    expect(text).not.toContain(KEY);
    expect(await screen.findByText(COPIED)).toBeInTheDocument();
  });

  it('says when the browser would not copy', async () => {
    // Plain http on the local network: no navigator.clipboard, so the select-and-copy fallback, which refuses here.
    vi.stubGlobal('navigator', { userAgent: 'test' });
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    try {
      renderWithServices(<LogSection />);
      await userEvent.click(screen.getByTestId(TID.logCopy));
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(await screen.findByText(COPY_FAILED)).toBeInTheDocument();
    } finally {
      delete (document as unknown as Record<string, unknown>).execCommand;
    }
  });

  it('offers Share only where the browser has it, and shares the log as a .txt file', async () => {
    stubNavigator();
    const { unmount } = renderWithServices(<LogSection />);
    expect(screen.queryByTestId(TID.logShare)).toBeNull();
    unmount();

    const share = vi.fn(async (_data: ShareData) => undefined);
    stubNavigator({ share, canShare: (data: ShareData) => Array.isArray(data.files) });
    seed();
    renderWithServices(<LogSection />);
    await userEvent.click(screen.getByTestId(TID.logShare));
    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0]![0];
    expect(data.title).toMatch(/^CafAI log, /);
    const file = data.files![0]!;
    expect(file.name).toMatch(/^cafai-log-\d{4}-\d\d-\d\d-\d{4}\.txt$/);
    expect(file.type).toBe('text/plain');
    const text = await file.text();
    expect(text).toContain('GET /api/v1/workflow');
    expect(text).not.toContain(KEY);
  });

  it('shares text where files cannot go, says nothing when the sheet is closed, and says when sharing failed', async () => {
    const share = vi
      .fn(async (_data: ShareData) => undefined)
      .mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'AbortError' }))
      .mockRejectedValueOnce(new Error('denied'));
    stubNavigator({ share });
    seed();
    renderWithServices(<LogSection />);
    await userEvent.click(screen.getByTestId(TID.logShare));
    expect(share.mock.calls[0]![0].text).toContain('GET /api/v1/workflow');
    expect(share.mock.calls[0]![0].files).toBeUndefined();
    expect(screen.queryByTestId(TID.logSaid)).toBeNull();
    await userEvent.click(screen.getByTestId(TID.logShare));
    expect(await screen.findByText(SHARE_FAILED)).toBeInTheDocument();
  });

  it('opens an email with the log in its body, dated in its subject, built at the tap', async () => {
    stubNavigator();
    renderWithServices(<LogSection />);
    const link = screen.getByTestId(TID.logEmail);
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'mailto:');
    // What came after the screen rendered goes in too.
    seed();
    // The test follows no link: what the tap set is read off the link.
    const stay = (event: Event) => event.preventDefault();
    window.addEventListener('click', stay);
    try {
      await userEvent.click(link);
    } finally {
      window.removeEventListener('click', stay);
    }
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:?subject=CafAI%20log%2C%20')).toBe(true);
    const body = decodeURIComponent(href.slice(href.indexOf('&body=') + 6));
    expect(body).toContain('CafAI 0.1.0-test');
    expect(body).toContain('↓ Coach POST api.anthropic.com/v1/messages · 200 end_turn');
    expect(body).not.toContain(KEY);
  });

  it("leaves Email out inside Decaid, whose window opens no mailto: link, and says to copy instead", () => {
    stubNavigator();
    renderWithServices(<LogSection />, createFakeServices({ insideDecaid: true }));
    expect(screen.queryByTestId(TID.logEmail)).toBeNull();
    expect(screen.queryByTestId(TID.logShare)).toBeNull();
    expect(screen.getByTestId(TID.logCopy)).toBeInTheDocument();
    expect(screen.getByText(INSIDE_DECAID_NOTE)).toBeInTheDocument();
  });

  it('clears the log, and says so at once', async () => {
    stubNavigator();
    seed();
    renderWithServices(<LogSection />);
    expect(screen.getByTestId(TID.logSummary)).toHaveTextContent(/^4 entries/);
    await userEvent.click(screen.getByTestId(TID.logClear));
    expect(trafficLog.list()).toEqual([]);
    expect(screen.getByTestId(TID.logSummary)).toHaveTextContent(/^Nothing recorded since/);
  });

  it("copies through a text area beside its buttons where the page has no clipboard API (plain http)", async () => {
    vi.stubGlobal('navigator', { userAgent: 'test' });
    seed();
    let selected = '';
    let insideSection = false;
    const execCommand = vi.fn(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea[readonly]');
      selected = area?.value.slice(area.selectionStart, area.selectionEnd) ?? '';
      insideSection = Boolean(area && screen.getByTestId(TID.logSection).contains(area));
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    try {
      renderWithServices(<LogSection />);
      await userEvent.click(screen.getByTestId(TID.logCopy));
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(insideSection).toBe(true);
      expect(selected).toMatch(/^CafAI log, /);
      expect(selected).toContain('GET /api/v1/workflow');
      expect(await screen.findByText(COPIED)).toBeInTheDocument();
    } finally {
      delete (document as unknown as Record<string, unknown>).execCommand;
    }
  });

  it('opens the log view', async () => {
    stubNavigator();
    renderWithServices(
      <>
        <LogSection />
        <OpenState />
      </>,
    );
    expect(screen.getByTestId('open-state')).toHaveTextContent('closed');
    await userEvent.click(screen.getByTestId(TID.logOpen));
    expect(screen.getByTestId('open-state')).toHaveTextContent('open');
  });
});
