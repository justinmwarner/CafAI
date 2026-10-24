// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { PRICES_AS_OF } from '../../llm/models.ts';
import { requestUsageReveal } from '../../spend/reveal.ts';
import { makeRecord } from '../../spend/testing/fixtures.ts';
import type { SpendRecord, SpendService } from '../../spend/types.ts';
import { createMemoryCoachSourceStore, type CoachSource, type CoachSourceStore } from '../../storage/coachSource.ts';
import { revealInOwnColumn } from '../care/careReveal.ts';
import { previewTheme } from '../chat/testing/previewTheme.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, createFakeSpend, type FakeServices } from '../testing/fakeServices.ts';
import { BUDGET_TID } from './BudgetControls.tsx';
import { USAGE_CARD_TID, UsageCard } from './UsageCard.tsx';
import { sayDate } from './usageFormat.ts';

vi.mock('../care/careReveal.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../care/careReveal.ts')>()),
  revealInOwnColumn: vi.fn(),
}));

/** Saturday 24 October 2026, 15:00 on this device's clock. */
const NOW = new Date(2026, 9, 24, 15, 0);

/**
 * October on the API key: $1.84, 412 k tokens and 63 replies in all; $1.20 of
 * replies on the 3rd, $0.48 of replies after shots on the 12th, and today 16
 * web searches ($0.16).
 */
const OCTOBER: SpendRecord[] = [
  makeRecord({
    day: '2026-10-03',
    kind: 'reply',
    requests: 40,
    replies: 30,
    inputTokens: 100_000,
    outputTokens: 20_000,
    cacheReadTokens: 150_000,
    cacheWriteTokens: 30_000,
    webSearches: 0,
    costMicros: 1_200_000,
    webSearchMicros: 0,
  }),
  makeRecord({
    day: '2026-10-12',
    kind: 'shot',
    requests: 20,
    replies: 20,
    inputTokens: 40_000,
    outputTokens: 10_000,
    cacheReadTokens: 40_000,
    cacheWriteTokens: 10_000,
    webSearches: 0,
    costMicros: 480_000,
    webSearchMicros: 0,
  }),
  makeRecord({
    day: '2026-10-24',
    kind: 'reply',
    requests: 13,
    replies: 13,
    inputTokens: 4_000,
    outputTokens: 1_000,
    cacheReadTokens: 6_000,
    cacheWriteTokens: 1_000,
    webSearches: 16,
    costMicros: 160_000,
    webSearchMicros: 160_000,
  }),
];

/** September's $2.10 and August's $1.38: $5.32 all time with October. */
const EARLIER: SpendRecord[] = [
  makeRecord({ day: '2026-09-15', costMicros: 2_100_000, webSearches: 0, webSearchMicros: 0 }),
  makeRecord({ day: '2026-08-02', costMicros: 1_380_000, webSearches: 0, webSearchMicros: 0 }),
];

/** 230 k tokens through CafAI Bridge on the 20th, $0.80 at the API's prices. */
const ON_COMPUTER = makeRecord({
  day: '2026-10-20',
  source: 'computer',
  inputTokens: 80_000,
  outputTokens: 20_000,
  cacheReadTokens: 120_000,
  cacheWriteTokens: 10_000,
  webSearches: 0,
  costMicros: 800_000,
  webSearchMicros: 0,
});

const onComputer = (records: SpendRecord[]) => records.map((record) => ({ ...record, source: 'computer' as const }));

const BRIDGE: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };

function servicesWith(records: SpendRecord[], source?: CoachSourceStore): FakeServices & { spend: SpendService } {
  const spend = createFakeSpend({ records });
  const services = createFakeServices({ spend });
  if (source) services.coachSource = source;
  return services as FakeServices & { spend: SpendService };
}

/** A theme colour as getComputedStyle gives it back. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/** Words as a text query matches them: Testing Library reads a no-break space as a space. */
const plain = (text: string) => text.split('\xa0').join(' ');

const card = (name: 'Usage and cost' | 'Usage') => screen.getByRole('region', { name });

beforeEach(() => {
  // Only the clock: React's own timers and Testing Library's waits run as usual.
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(revealInOwnColumn).mockClear();
});

describe('Settings > Coach > Usage and cost, on the API key (D239)', () => {
  it("heads with the month's estimated cost, its tokens and replies", async () => {
    renderWithServices(<UsageCard />, servicesWith([...OCTOBER, ...EARLIER]));
    const usage = await screen.findByRole('region', { name: 'Usage and cost' });
    expect(within(usage).getByTestId(USAGE_CARD_TID.cost)).toHaveTextContent('$1.84');
    expect(within(usage).getByTestId(USAGE_CARD_TID.summary)).toHaveTextContent('estimated this month · 412 k tokens · 63 replies');
    expect(within(usage).queryByTestId(USAGE_CARD_TID.also)).toBeNull();
    expect(within(usage).queryByTestId(USAGE_CARD_TID.unpriced)).toBeNull();
  });

  it('draws a bar for each day of the month so far, today in ink, each named with its day and cost', async () => {
    renderWithServices(<UsageCard />, servicesWith([...OCTOBER, ...EARLIER]));
    const days = await screen.findByRole('list', { name: 'Each day this month' });
    const bars = within(days).getAllByRole('listitem');
    expect(bars).toHaveLength(24);
    expect(bars[0]).toHaveTextContent('1 October: $0.00');
    expect(bars[2]).toHaveTextContent('3 October: $1.20');
    expect(bars[11]).toHaveTextContent('12 October: $0.48');
    expect(bars[23]).toHaveTextContent('24 October: $0.16');
    const bar = (index: number) => bars[index]!.querySelector<HTMLElement>('.usage-day-bar')!;
    // The tallest day is the scale.
    expect(getComputedStyle(bar(2)).height).toBe('100%');
    expect(getComputedStyle(bar(11)).height).toBe('40%');
    expect(getComputedStyle(bar(0)).height).toBe('0%');
    expect(getComputedStyle(bar(23)).backgroundColor).toBe(rgb(previewTheme.palette.text.primary));
    expect(getComputedStyle(bar(2)).backgroundColor).toBe(rgb(previewTheme.palette.primary.main));
    // The month's slots stay as wide all month: 31 columns in October, today the 24th of them.
    expect(getComputedStyle(days).gridTemplateColumns).toBe('repeat(31, minmax(0, 1fr))');
  });

  it('shows today, last month and all time', async () => {
    renderWithServices(<UsageCard />, servicesWith([...OCTOBER, ...EARLIER]));
    await screen.findByRole('region', { name: 'Usage and cost' });
    expect(screen.getByTestId(USAGE_CARD_TID.period('today'))).toHaveTextContent(/^Today\$0\.16$/);
    expect(screen.getByTestId(USAGE_CARD_TID.period('last-month'))).toHaveTextContent(/^Last month\$2\.10$/);
    expect(screen.getByTestId(USAGE_CARD_TID.period('all-time'))).toHaveTextContent(/^All time\$5\.32$/);
  });

  it("says what the month went on, each with a meter of the month's share", async () => {
    renderWithServices(<UsageCard />, servicesWith([...OCTOBER, ...EARLIER]));
    const list = await screen.findByRole('list', { name: 'What it went on' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => plain(row.textContent ?? ''))).toEqual([
      'Replies to you$1.20 (65 % of this month)',
      'Replies after shots$0.48 (26 % of this month)',
      'Bag photos$0.00 (0 % of this month)',
      'Web searches$0.16 (9 % of this month)',
    ]);
    const fill = (index: number) => getComputedStyle(rows[index]!.querySelector<HTMLElement>('.usage-meter-fill')!);
    expect(fill(0).width).toBe('65.2%');
    expect(fill(1).width).toBe('26.1%');
    expect(fill(2).width).toBe('0%');
    expect(fill(3).width).toBe('8.7%');
    expect(fill(0).backgroundColor).toBe(rgb(previewTheme.palette.primary.main));
  });

  it("holds the budget's controls, then the footnote on where the count comes from", async () => {
    renderWithServices(<UsageCard />, servicesWith(OCTOBER));
    const usage = await screen.findByRole('region', { name: 'Usage and cost' });
    expect(within(usage).getByRole('spinbutton', { name: 'Monthly budget' })).toBe(screen.getByTestId(BUDGET_TID.amount));
    expect(within(usage).getByRole('switch', { name: 'Pause the coach at the budget' })).toBeInTheDocument();
    expect(sayDate(PRICES_AS_OF)).toMatch(/^\d{1,2}\xa0[A-Z][a-z]+\xa0\d{4}$/);
    expect(
      within(usage).getByText(
        plain(`Counted on every device that uses this Decaid, at Anthropic's prices of ${sayDate(PRICES_AS_OF)}. Your bill is in Anthropic's Console.`),
      ),
    ).toBeInTheDocument();
  });

  it('adds the tokens spent on the computer this month, at what they would cost on the API', async () => {
    renderWithServices(<UsageCard />, servicesWith([...OCTOBER, ON_COMPUTER]));
    expect(await screen.findByTestId(USAGE_CARD_TID.also)).toHaveTextContent('Also 230 k tokens on your computer (≈ $0.80 on the API).');
    // The dollars are the API key's alone.
    expect(screen.getByTestId(USAGE_CARD_TID.cost)).toHaveTextContent('$1.84');
  });

  it('names a model whose price is not known, its cost left out', async () => {
    const mystery = makeRecord({ day: '2026-10-20', model: 'claude-mystery-1', unpriced: 3, requests: 3, costMicros: 0, webSearches: 0, webSearchMicros: 0 });
    renderWithServices(<UsageCard />, servicesWith([...OCTOBER, mystery]));
    expect(await screen.findByTestId(USAGE_CARD_TID.unpriced)).toHaveTextContent('Price not known for claude-mystery-1, so its cost is left out.');
  });

  it('names every model whose price is not known', async () => {
    const records = ['claude-mystery-1', 'claude-mystery-2'].map((model) =>
      makeRecord({ day: '2026-10-20', model, unpriced: 1, costMicros: 0, webSearches: 0, webSearchMicros: 0 }),
    );
    renderWithServices(<UsageCard />, servicesWith(records));
    expect(await screen.findByTestId(USAGE_CARD_TID.unpriced)).toHaveTextContent(
      'Price not known for claude-mystery-1 and claude-mystery-2, so their cost is left out.',
    );
  });

  it('says nothing yet this month, with no bars and nothing it went on, and keeps the other periods and the budget', async () => {
    renderWithServices(<UsageCard />, servicesWith(EARLIER));
    const usage = await screen.findByRole('region', { name: 'Usage and cost' });
    expect(within(usage).getByTestId(USAGE_CARD_TID.cost)).toHaveTextContent('$0.00');
    expect(within(usage).getByTestId(USAGE_CARD_TID.summary)).toHaveTextContent('Nothing yet this month.');
    expect(within(usage).queryByRole('list', { name: 'Each day this month' })).toBeNull();
    expect(within(usage).queryByRole('list', { name: 'What it went on' })).toBeNull();
    expect(screen.getByTestId(USAGE_CARD_TID.period('last-month'))).toHaveTextContent('$2.10');
    expect(screen.getByTestId(USAGE_CARD_TID.period('all-time'))).toHaveTextContent('$3.48');
    expect(within(usage).getByRole('spinbutton', { name: 'Monthly budget' })).toBeInTheDocument();
  });

  it('says nothing on the API key yet when the month ran on the computer only', async () => {
    renderWithServices(<UsageCard />, servicesWith([ON_COMPUTER]));
    expect(await screen.findByTestId(USAGE_CARD_TID.summary)).toHaveTextContent('Nothing on your API key yet this month.');
    expect(screen.getByTestId(USAGE_CARD_TID.also)).toHaveTextContent('Also 230 k tokens on your computer (≈ $0.80 on the API).');
  });

  it('follows each count as it is made', async () => {
    const services = servicesWith(OCTOBER);
    renderWithServices(<UsageCard />, services);
    await screen.findByRole('region', { name: 'Usage and cost' });
    // 100,000 input tokens of Opus 5.5 at $4 per million: $0.40 more, today.
    act(() => {
      services.spend.count({ at: NOW, source: 'anthropic', model: 'claude-opus-5-5', kind: 'photo', call: 0, usage: { inputTokens: 100_000, outputTokens: 0 } });
    });
    expect(screen.getByTestId(USAGE_CARD_TID.cost)).toHaveTextContent('$2.24');
    expect(screen.getByTestId(USAGE_CARD_TID.period('today'))).toHaveTextContent('$0.56');
  });

  it("reads Decaid's copy of every device's counts when it shows", async () => {
    const services = servicesWith(OCTOBER);
    const refresh = vi.spyOn(services.spend, 'refresh');
    renderWithServices(<UsageCard />, services);
    await screen.findByRole('region', { name: 'Usage and cost' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('draws nothing without a spend service', () => {
    const { container } = renderWithServices(<UsageCard />, createFakeServices());
    expect(container).toBeEmptyDOMElement();
  });

  it("comes into view when the pause card's Open Settings asked, once", async () => {
    requestUsageReveal();
    const first = renderWithServices(<UsageCard />, servicesWith(OCTOBER));
    const usage = await screen.findByRole('region', { name: 'Usage and cost' });
    await waitFor(() => expect(revealInOwnColumn).toHaveBeenCalledTimes(1));
    expect(revealInOwnColumn).toHaveBeenCalledWith(usage);
    first.unmount();
    // Another visit by another way brings nothing into view.
    renderWithServices(<UsageCard />, servicesWith(OCTOBER));
    await screen.findByRole('region', { name: 'Usage and cost' });
    expect(revealInOwnColumn).toHaveBeenCalledTimes(1);
  });
});

/** GET /v1/status from a bridge whose last run reported the plan's use: 23 % of this 5 hours, 41 % of the week. */
function bridgeStatus(over: { fiveHour?: number; usage?: unknown } = {}) {
  return {
    ok: true,
    app: 'cafai-bridge',
    version: '0.1.0',
    protocol: 1,
    claude: { found: true, version: '2.1.301' },
    account: { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' },
    usage:
      over.usage !== undefined
        ? over.usage
        : {
            status: 'allowed',
            fiveHour: { utilization: over.fiveHour ?? 0.23, resetsAt: new Date(2026, 9, 24, 18, 0).toISOString() },
            sevenDay: { utilization: 0.41, resetsAt: new Date(2026, 9, 28, 9, 0).toISOString() },
          },
    runs: { live: 0, max: 3 },
    problems: [],
  };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('Settings > Coach > Usage, while the coach runs on the computer (D239)', () => {
  let answer: () => Response | Promise<Response>;
  const fetched: Array<{ url: string; headers: unknown }> = [];

  beforeEach(() => {
    answer = () => json(bridgeStatus());
    fetched.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        fetched.push({ url, headers: init?.headers });
        if (url.startsWith('http://192.168.1.20:8877/')) return answer();
        throw new TypeError('Failed to fetch');
      }),
    );
  });

  it('says the plan pays, with the month and today in tokens and the same replies at API prices', async () => {
    renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    const usage = await screen.findByRole('region', { name: 'Usage' });
    expect(within(usage).getByText('The coach runs on your Claude plan, so there is nothing to pay per reply.')).toBeInTheDocument();
    expect(screen.getByTestId(USAGE_CARD_TID.period('month-tokens'))).toHaveTextContent(/^This month412 ktokens$/);
    expect(screen.getByTestId(USAGE_CARD_TID.period('today-tokens'))).toHaveTextContent(/^Today12 ktokens$/);
    expect(screen.getByTestId(USAGE_CARD_TID.period('on-api'))).toHaveTextContent(/^On the API≈ \$1\.84this month$/);
    // Nothing of the API key's: no budget, no dollars of its own.
    expect(within(usage).queryByRole('spinbutton', { name: 'Monthly budget' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Usage and cost' })).toBeNull();
    expect(within(usage).queryByTestId(USAGE_CARD_TID.also)).toBeNull();
    expect(within(usage).getByText(plain(`Counted on every device that uses this Decaid, at Anthropic's prices of ${sayDate(PRICES_AS_OF)}.`))).toBeInTheDocument();
  });

  it("shows the plan's use this 5 hours and this week, read from the bridge without a test reply", async () => {
    renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    const plan = await screen.findByTestId(USAGE_CARD_TID.plan);
    expect(within(plan).getByTestId(USAGE_CARD_TID.planWindow('five-hour'))).toHaveTextContent(/^Plan, this 5 hours23 %Resets today at 18:00$/);
    expect(within(plan).getByTestId(USAGE_CARD_TID.planWindow('seven-day'))).toHaveTextContent(/^Plan, this week41 %Resets Wednesday at 09:00$/);
    expect(within(plan).getByText("As Claude Code reported them with the coach's last reply.")).toBeInTheDocument();
    const fill = within(plan).getByTestId(USAGE_CARD_TID.planWindow('five-hour')).querySelector<HTMLElement>('.usage-meter-fill')!;
    expect(getComputedStyle(fill).width).toBe('23%');
    expect(getComputedStyle(fill).backgroundColor).toBe(rgb(previewTheme.palette.primary.main));
    // The status alone: no probe, so no test reply is spent; the pairing code as the coach sends it.
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.url).toBe('http://192.168.1.20:8877/v1/status');
    expect(fetched[0]?.headers).toEqual({ 'x-api-key': 'ABCDEFGH' });
  });

  it("reads the plan's use again every 60 s while the card shows, and stops when it goes", async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    const { unmount } = renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    const fiveHour = () => screen.getByTestId(USAGE_CARD_TID.planWindow('five-hour'));
    await waitFor(() => expect(fiveHour()).toHaveTextContent('23 %'));
    expect(fetched).toHaveLength(1);

    answer = () => json(bridgeStatus({ fiveHour: 0.31 }));
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(fetched).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await waitFor(() => expect(fiveHour()).toHaveTextContent('31 %'));
    expect(fetched).toHaveLength(2);

    unmount();
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(fetched).toHaveLength(2);
  });

  it("shows nothing of the plan when the bridge cannot be reached, and the rest as ever", async () => {
    answer = () => {
      throw new TypeError('Failed to fetch');
    };
    renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    await screen.findByRole('region', { name: 'Usage' });
    await waitFor(() => expect(fetched).toHaveLength(1));
    // Let the failed read settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId(USAGE_CARD_TID.plan)).toBeNull();
    expect(screen.getByTestId(USAGE_CARD_TID.period('on-api'))).toHaveTextContent('≈ $1.84');
  });

  it('takes the plan away again when a later read gets no status (a code changed on the computer, say)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    await screen.findByTestId(USAGE_CARD_TID.plan);
    answer = () => json({ type: 'error', error: { type: 'authentication_error', message: 'Wrong code.' } }, 401);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(screen.queryByTestId(USAGE_CARD_TID.plan)).toBeNull());
  });

  it("says the plan's use comes with the next reply while Claude Code has reported none", async () => {
    answer = () => json(bridgeStatus({ usage: null }));
    renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    const plan = await screen.findByTestId(USAGE_CARD_TID.plan);
    expect(plan).toHaveTextContent("Your plan's use shows here after the coach's next reply on your computer.");
    expect(within(plan).queryByTestId(USAGE_CARD_TID.planWindow('five-hour'))).toBeNull();
  });

  it('says a window started again since Claude Code reported it, rather than show its old use', async () => {
    answer = () =>
      json(
        bridgeStatus({
          usage: {
            status: 'allowed',
            fiveHour: { utilization: 0.8, resetsAt: new Date(2026, 9, 24, 14, 0).toISOString() },
            sevenDay: { utilization: 0.41, resetsAt: new Date(2026, 9, 28, 9, 0).toISOString() },
          },
        }),
      );
    renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    const fiveHour = await screen.findByTestId(USAGE_CARD_TID.planWindow('five-hour'));
    expect(fiveHour).toHaveTextContent(/^Plan, this 5 hours—Started again at 14:00: the coach's next reply updates it\.$/);
    expect(getComputedStyle(fiveHour.querySelector<HTMLElement>('.usage-meter-fill')!).width).toBe('0%');
  });

  it("says when the plan's limit is reached", async () => {
    answer = () =>
      json(
        bridgeStatus({
          usage: { status: 'rejected', fiveHour: { utilization: 1, resetsAt: new Date(2026, 9, 24, 18, 0).toISOString() } },
        }),
      );
    renderWithServices(<UsageCard />, servicesWith(onComputer(OCTOBER), createMemoryCoachSourceStore(BRIDGE)));
    const plan = await screen.findByTestId(USAGE_CARD_TID.plan);
    expect(plan).toHaveTextContent("The plan's limit is reached for now. The coach answers again once it resets.");
    expect(within(plan).getByTestId(USAGE_CARD_TID.planWindow('five-hour'))).toHaveTextContent('100 %');
    expect(within(plan).queryByTestId(USAGE_CARD_TID.planWindow('seven-day'))).toBeNull();
  });

  it('adds what the API key spent this month too', async () => {
    const onKey = makeRecord({ day: '2026-10-02', costMicros: 1_200_000, webSearches: 0, webSearchMicros: 0 });
    renderWithServices(<UsageCard />, servicesWith([...onComputer(OCTOBER), onKey], createMemoryCoachSourceStore(BRIDGE)));
    expect(await screen.findByTestId(USAGE_CARD_TID.also)).toHaveTextContent('Also $1.20 on your API key this month.');
  });

  it('says nothing yet this month', async () => {
    renderWithServices(<UsageCard />, servicesWith(onComputer(EARLIER), createMemoryCoachSourceStore(BRIDGE)));
    const usage = await screen.findByRole('region', { name: 'Usage' });
    expect(within(usage).getByText('Nothing yet this month.')).toBeInTheDocument();
    expect(screen.queryByTestId(USAGE_CARD_TID.period('month-tokens'))).toBeNull();
  });

  it("never shows the API key's card while it reads where the coach runs, and follows a change of place", async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    const store = createMemoryCoachSourceStore(BRIDGE);
    renderWithServices(<UsageCard />, servicesWith(OCTOBER, store));
    expect(screen.queryByRole('region', { name: 'Usage and cost' })).toBeNull();
    await screen.findByRole('region', { name: 'Usage' });
    await waitFor(() => expect(fetched).toHaveLength(1));

    // Back on the API key: its card, and no more reads of the plan.
    await act(async () => {
      await store.set({ ...BRIDGE, kind: 'anthropic' });
    });
    await screen.findByRole('region', { name: 'Usage and cost' });
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(fetched).toHaveLength(1);
    expect(card('Usage and cost')).toBeInTheDocument();
  });
});
