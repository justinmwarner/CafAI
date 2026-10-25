// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { recordExchange, recordFrame, recordSocket, trafficLog } from '../../traffic/recorder.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServicesShowing } from '../testing/displayServices.ts';
import { TID } from '../testIds.ts';
import { closeLogView, openLogView } from './logShare.ts';
import { DETAIL_CHARS, LogView, moreNote } from './LogView.tsx';

/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const KEY = ['sk', 'ant', 'api03', 'LoGvIeWtEsT0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');

/** One of each: a REST exchange, a socket with a frame (and one counted on it), and a coach exchange: six entries. */
function seed() {
  recordExchange('rest', 'GET /api/v1/workflow').reply(200, { body: '{"profile":{"title":"Kiambu AA v2"}}' });
  recordSocket('ws/v1/machine/snapshot', 'received', 'open');
  recordFrame('ws/v1/machine/snapshot', '{"state":{"state":"idle"}}', true);
  recordFrame('ws/v1/machine/snapshot', '{"state":{"state":"idle"}}', true);
  recordExchange('coach', 'POST api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': KEY },
    body: JSON.stringify({ system: 'You are an espresso coach.', messages: [{ role: 'user', content: KEY }] }),
  }).reply(200, { body: '{"stopReason":"end_turn"}', outcome: 'end_turn', raw: 'event: message_stop\ndata: {}\n\n' });
}

function rows(): HTMLElement[] {
  return [...screen.getByTestId(TID.logEntries).querySelectorAll<HTMLElement>('[data-testid^="log-entry-"]')];
}

const idOf = (predicate: (what: string, direction: string) => boolean) =>
  trafficLog.list().find((entry) => predicate(entry.what, entry.direction))!.id;

beforeEach(() => {
  trafficLog.clear();
  closeLogView();
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (test)', clipboard: { writeText: vi.fn(async () => undefined) } });
});

afterEach(() => {
  act(() => closeLogView());
  vi.unstubAllGlobals();
});

describe('LogView', () => {
  it("keeps what it shows out of Clarity's recordings (D214)", () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    expect(screen.getByTestId(TID.logView)).toHaveAttribute('data-clarity-mask', 'true');
  });

  it('renders nothing, and listens to nothing, while closed', () => {
    const subscribe = vi.spyOn(trafficLog, 'subscribe');
    seed();
    renderWithServices(<LogView />);
    expect(screen.queryByTestId(TID.logView)).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
    act(() => openLogView());
    expect(screen.getByTestId(TID.logView)).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalled();
  });

  it('shows the entries newest first, one line each: time, direction, channel, what, status, size', () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    const lines = rows().map((row) => row.textContent ?? '');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d↓receivedCoachPOST api\.anthropic\.com\/v1\/messages200 end_turn\d+ B$/);
    expect(lines[1]).toMatch(/↑sentCoachPOST api\.anthropic\.com\/v1\/messages\d+ B$/);
    expect(lines[2]).toMatch(/↓receivedWSws\/v1\/machine\/snapshotframe \+1\d+ B$/);
    expect(lines[3]).toMatch(/WSws\/v1\/machine\/snapshotopen$/);
    expect(lines[4]).toMatch(/↓receivedRESTGET \/api\/v1\/workflow200\d+ B$/);
    expect(lines[5]).toMatch(/↑sentRESTGET \/api\/v1\/workflow$/);
    expect(screen.getByText('6 entries')).toBeInTheDocument();
  });

  it('writes each time in the clock chosen, the open entry’s line too, and follows a change of it (D245)', async () => {
    seed();
    openLogView();
    const services = createFakeServicesShowing({ clock: '12h' });
    renderWithServices(<LogView />, services);
    expect(rows()[0]!.textContent).toMatch(/^\d{1,2}:\d\d:\d\d [ap]m↓receivedCoach/);
    await userEvent.click(screen.getByTestId(TID.logEntry(idOf((what, direction) => what === 'GET /api/v1/workflow' && direction === 'received'))));
    expect(screen.getByTestId(TID.logDetail)).toHaveTextContent(/^\d{1,2}:\d\d:\d\d\.\d{3} [ap]m ↓ REST GET \/api\/v1\/workflow/);
    await act(async () => {
      await services.displayPrefs.setClock('24h');
    });
    expect(rows()[0]!.textContent).toMatch(/^\d\d:\d\d:\d\d↓receivedCoach/);
  });

  it('opens an entry to its raw headers and body, JSON pretty-printed, and closes it again', async () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    const row = screen.getByTestId(TID.logEntry(idOf((what, direction) => what === 'GET /api/v1/workflow' && direction === 'received')));
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByTestId(TID.logDetail);
    expect(detail.querySelector('pre')?.textContent).toBe('{\n  "profile": {\n    "title": "Kiambu AA v2"\n  }\n}');
    expect(detail).toHaveTextContent(/↓ REST GET \/api\/v1\/workflow · 200 · \d+ ms · 36 B/);
    await userEvent.click(row);
    expect(screen.queryByTestId(TID.logDetail)).toBeNull();
  });

  it('says how many frames after a kept one were counted', async () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    await userEvent.click(screen.getByTestId(TID.logEntry(trafficLog.list().find((entry) => entry.frame)!.id)));
    expect(screen.getByTestId(TID.logDetail)).toHaveTextContent('(the frame after it on this channel was counted, not kept)');
    expect(moreNote(4)).toBe('the 4 frames after it on this channel were counted, not kept');
  });

  it("shows a coach request's headers by name only, and its stream events", async () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    await userEvent.click(screen.getByTestId(TID.logEntry(idOf((what, direction) => what.startsWith('POST api') && direction === 'sent'))));
    await userEvent.click(screen.getByTestId(TID.logEntry(idOf((what, direction) => what.startsWith('POST api') && direction === 'received'))));
    const [reply, request] = screen.getAllByTestId(TID.logDetail);
    expect(request).toHaveTextContent('x-api-key: [key redacted]');
    expect(reply).toHaveTextContent('Stream events');
    expect(reply).toHaveTextContent('event: message_stop');
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('cuts a huge body until Show all', async () => {
    recordExchange('coach', 'POST api.anthropic.com/v1/messages', { body: JSON.stringify({ system: 'You are an espresso coach. '.repeat(800) }) });
    openLogView();
    renderWithServices(<LogView />);
    await userEvent.click(rows()[0]!);
    const pre = () => screen.getByTestId(TID.logDetail).querySelector('pre')!;
    expect(pre().textContent).toHaveLength(DETAIL_CHARS + 1);
    expect(screen.getByText('Share and Copy always have all of it.')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(TID.logShowAll));
    expect(pre().textContent!.length).toBeGreaterThan(20_000);
    expect(screen.queryByTestId(TID.logShowAll)).toBeNull();
  });

  it('filters by Decaid, Live frames and Coach', async () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    const show = async (filter: string) => {
      await userEvent.click(screen.getByTestId(TID.logFilter(filter)));
      return rows().map((row) => row.textContent ?? '');
    };
    expect((await show('decaid')).every((line) => line.includes('REST'))).toBe(true);
    expect(await show('decaid')).toHaveLength(2);
    expect(screen.getByTestId(TID.logFilter('decaid'))).toHaveAttribute('aria-checked', 'true');
    const frames = await show('frames');
    expect(frames).toHaveLength(2);
    expect(frames.every((line) => line.includes('WS'))).toBe(true);
    expect(await show('coach')).toHaveLength(2);
    expect(screen.getByText('6 entries, 2 shown')).toBeInTheDocument();
    expect(await show('all')).toHaveLength(6);
  });

  it('holds still while paused, says how many came meanwhile, and catches up on Resume', async () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    await userEvent.click(screen.getByTestId(TID.logPause));
    expect(screen.getByText('6 entries, paused')).toBeInTheDocument();
    act(() => {
      recordExchange('rest', 'GET /api/v1/devices').reply(200, { body: '[]' });
    });
    await waitFor(() => expect(screen.getByTestId(TID.logPause)).toHaveTextContent('Resume (2 new)'));
    expect(rows()).toHaveLength(6);
    await userEvent.click(screen.getByTestId(TID.logPause));
    expect(rows()).toHaveLength(8);
    expect(rows()[0]).toHaveTextContent('GET /api/v1/devices');
  });

  it('follows the log while it runs, at most twice a second', async () => {
    openLogView();
    renderWithServices(<LogView />);
    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
    act(() => seed());
    await waitFor(() => expect(rows()).toHaveLength(6));
  });

  it('has the same Share, Email and Copy, over what it shows', async () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    const view = screen.getByTestId(TID.logView);
    const email = within(view).getByTestId(TID.logEmail);
    const stay = (event: Event) => event.preventDefault();
    window.addEventListener('click', stay);
    try {
      await userEvent.click(email);
    } finally {
      window.removeEventListener('click', stay);
    }
    expect(email.getAttribute('href')).toMatch(/^mailto:\?subject=CafAI%20log/);
    await userEvent.click(within(view).getByTestId(TID.logCopy));
    const writeText = (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(writeText).toContain('Entries: 6 entries');
    expect(writeText).not.toContain(KEY);
  });

  it('copies through a text area inside the dialog where there is no clipboard API, so the dialog keeps its focus and the copy its text', async () => {
    vi.stubGlobal('navigator', { userAgent: 'test' });
    seed();
    let insideView = false;
    const execCommand = vi.fn(() => {
      const area = document.querySelector('textarea[readonly]');
      insideView = Boolean(area && screen.getByTestId(TID.logView).contains(area));
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    try {
      openLogView();
      renderWithServices(<LogView />);
      await userEvent.click(within(screen.getByTestId(TID.logView)).getByTestId(TID.logCopy));
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(insideView).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>).execCommand;
    }
  });

  it('moves between the filters with the arrow keys, Home and End, as a radio group does', async () => {
    seed();
    openLogView();
    renderWithServices(<LogView />);
    const chip = (filter: string) => screen.getByTestId(TID.logFilter(filter));
    expect(chip('all')).toHaveAttribute('tabindex', '0');
    expect(chip('coach')).toHaveAttribute('tabindex', '-1');
    act(() => chip('all').focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(chip('decaid')).toHaveAttribute('aria-checked', 'true');
    expect(chip('decaid')).toHaveFocus();
    expect(rows()).toHaveLength(2);
    await userEvent.keyboard('{End}');
    expect(chip('coach')).toHaveFocus();
    expect(chip('coach')).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(chip('all')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(chip('coach')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(chip('all')).toHaveAttribute('aria-checked', 'true');
    expect(chip('decaid')).toHaveAttribute('tabindex', '-1');
  });

  it('keeps the focus where the reader is when Show all and Show more go away', async () => {
    recordExchange('coach', 'POST api.anthropic.com/v1/messages', { body: JSON.stringify({ system: 'You are an espresso coach. '.repeat(800) }) });
    for (let i = 0; i < 250; i += 1) recordExchange('rest', `GET /api/v1/shots/${i}`).reply(200, { body: '{}' });
    openLogView();
    renderWithServices(<LogView />);
    expect(rows()).toHaveLength(200);
    await userEvent.click(screen.getByTestId(TID.logMore));
    expect(rows()).toHaveLength(400);
    expect(document.activeElement).toBe(rows()[200]);
    await userEvent.click(screen.getByTestId(TID.logMore));
    expect(rows()).toHaveLength(501);
    expect(screen.queryByTestId(TID.logMore)).toBeNull();
    expect(document.activeElement).toBe(rows()[400]);
    await userEvent.click(rows()[500]!);
    await userEvent.click(screen.getByTestId(TID.logShowAll));
    expect(document.activeElement).toBe(screen.getByTestId(TID.logDetail).querySelector('pre'));
  });

  it('closes', async () => {
    openLogView();
    renderWithServices(<LogView />);
    await userEvent.click(screen.getByTestId(TID.logClose));
    expect(screen.queryByTestId(TID.logView)).toBeNull();
  });
});
