import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachSource } from '../storage/coachSource.ts';
import { watchTransactions, type TransactionWatch } from '../storage/openTransactions.ts';
import { releaseOnPageExit } from '../storage/pageExit.ts';
import { DEBUG_CACHE_KEY } from './flags.ts';
import { bridgeTarget, compactReport, startDebug, type DebugReport, type DebugSession, type StartDebugOptions } from './session.ts';

const BRIDGE: CoachSource = { kind: 'computer', address: '192.168.1.90:8877', code: 'ABCD-EFGH' };

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const ON = { [DEBUG_CACHE_KEY]: JSON.stringify({ enabled: true }) };

function fakePage({ search = '', fetchImpl }: { search?: string; fetchImpl?: typeof fetch } = {}) {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible', referrer: '' });
  const sendBeacon = vi.fn((_url: string, _body: string) => true);
  const fetchMock = vi.fn(fetchImpl ?? (async () => new Response('{"ok":true}', { status: 200 })));
  const win = Object.assign(new EventTarget(), {
    document,
    location: { search, href: `http://localhost:27749/${search}` },
    navigator: { userAgent: 'iPad test', sendBeacon },
    history: { length: 3 },
    performance: globalThis.performance,
    fetch: fetchMock as unknown as typeof fetch,
    IDBDatabase: globalThis.IDBDatabase,
    indexedDB: new IDBFactory(),
  });
  return { win, document, sendBeacon, fetchMock };
}

function silentConsole() {
  return { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Console;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let session: DebugSession | null = null;
let watch: TransactionWatch | null = null;
afterEach(() => {
  session?.stop();
  session = null;
  watch?.stop();
  watch = null;
});

/** Decaid's store, answering `flags` for cafai-debug/flags (null: no such key) and keeping what is set. */
function fakeKv(flags: unknown, kept: Array<{ key: string; value: DebugReport }> = []): StartDebugOptions['kv'] {
  return {
    get: (async () => flags) as StartDebugOptions['kv']['get'],
    set: async (_namespace: string, key: string, value: unknown) => void kept.push({ key, value: value as DebugReport }),
  };
}

/**
 * A session on a fake page. `flags` is Decaid's answer; on (the default here) it is kept on the device as well, so the
 * page has it from its first line, as every page after the first does.
 */
function start(overrides: Partial<StartDebugOptions> & { page?: ReturnType<typeof fakePage>; flags?: unknown } = {}) {
  const { page = fakePage(), flags = { enabled: true }, ...rest } = overrides;
  const lines: string[] = [];
  const kept: Array<{ key: string; value: DebugReport }> = [];
  const on = typeof flags === 'object' && flags !== null && (flags as { enabled?: unknown }).enabled === true;
  watch ??= watchTransactions(globalThis, Date, { stacks: false });
  const options: StartDebugOptions = {
    win: page.win as unknown as Window,
    appVersion: '0.1.6',
    kv: fakeKv(flags, kept),
    deviceStorage: memoryStorage(on ? { [DEBUG_CACHE_KEY]: JSON.stringify(flags) } : {}),
    coachSource: async () => BRIDGE,
    transactions: watch,
    console: silentConsole(),
    log: (line) => lines.push(line),
    ...rest,
  };
  session = startDebug(options);
  return { page, lines, kept, session };
}

function openTransaction(page: ReturnType<typeof fakePage>): Promise<{ db: IDBDatabase; tx: IDBTransaction }> {
  return new Promise((resolve, reject) => {
    const request = page.win.indexedDB.open('cafai', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['settings'], 'readwrite');
      // Aborted as the page is put away, the write fails: that is the point.
      tx.objectStore('settings').put('x', 'current').onerror = (event) => event.preventDefault();
      resolve({ db, tx });
    };
    request.onerror = () => reject(request.error);
  });
}

describe('startDebug', () => {
  it('does nothing at all while the flag is off', async () => {
    const { page, lines, kept } = start({ flags: null });
    await flush();
    expect(session!.enabled()).toBe(false);
    expect(page.win.fetch).toBe(page.fetchMock);
    expect(await session!.report('manual')).toBe('The DEBUG flag is off.');
    page.win.dispatchEvent(new Event('pagehide'));
    expect(lines).toEqual([]);
    expect(kept).toEqual([]);
    expect(page.sendBeacon).not.toHaveBeenCalled();
  });

  it('says what the page leaves open as it is put away, by beacon to CafAI Bridge and in Decaid', async () => {
    const { page, lines, kept } = start();
    expect(session!.enabled()).toBe(true);
    await flush();
    const { db } = await openTransaction(page);
    page.win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    expect(lines.at(-1)).toMatch(/^\[CafAI\] debug: pagehide \(persisted true\) at \S+; cafai readwrite \[settings\] \d+ ms; no request waiting$/);
    expect(page.sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = page.sendBeacon.mock.calls[0]!;
    expect(url).toBe('http://192.168.1.90:8877/v1/debug/report?code=ABCDEFGH');
    const sent = JSON.parse(body) as DebugReport;
    expect(sent).toMatchObject({ kind: 'pagehide', app: '0.1.6', userAgent: 'iPad test', page: { historyLength: 3, visibility: 'visible' } });
    expect(sent.inFlight.transactions).toEqual([expect.objectContaining({ db: 'cafai', mode: 'readwrite', stores: ['settings'] })]);
    expect(sent.lifecycle.map((e) => e.type)).toEqual(['pagehide']);
    await flush();
    expect(kept.map((k) => k.key)).toEqual(['last-pagehide']);
    db.close();
  });

  it('turns on when Decaid says so, keeps that for the next page, and says so to the start screen', async () => {
    const deviceStorage = memoryStorage();
    const heard = vi.fn();
    const { lines } = start({ deviceStorage });
    session!.subscribe(heard);
    expect(session!.enabled()).toBe(false);
    await flush();
    expect(session!.enabled()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(deviceStorage.items.get(DEBUG_CACHE_KEY)).toBe(JSON.stringify({ enabled: true }));
    expect(lines[0]).toMatch(/^\[CafAI\] debug: on; /);
  });

  it('turns off when Decaid says so, and forgets it here', async () => {
    const deviceStorage = memoryStorage(ON);
    const { page } = start({ deviceStorage, flags: { enabled: false } });
    expect(session!.enabled()).toBe(true);
    expect(page.win.fetch).not.toBe(page.fetchMock);
    await flush();
    expect(session!.enabled()).toBe(false);
    expect(page.win.fetch).toBe(page.fetchMock);
    expect(deviceStorage.items.has(DEBUG_CACHE_KEY)).toBe(false);
  });

  it("stays on for ?debug=1 and for a debug build, whatever Decaid says", async () => {
    start({ page: fakePage({ search: '?debug=1' }), flags: { enabled: false } });
    await flush();
    expect(session!.enabled()).toBe(true);
    session!.stop();
    start({ forced: true, flags: null });
    await flush();
    expect(session!.enabled()).toBe(true);
  });

  it('sends a report by hand to CafAI Bridge with its code, after the probe, and keeps a copy in Decaid', async () => {
    const { page, kept } = start();
    await flush();
    const said = await session!.report('manual', { stage: "opening the coach's chat", probe: true });
    expect(said).toBe('Report sent to CafAI Bridge at 192.168.1.90:8877, and a copy kept in Decaid.');
    const [url, init] = page.fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.90:8877/v1/debug/report');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-api-key': 'ABCDEFGH' });
    const report = JSON.parse(init.body as string) as DebugReport;
    expect(report).toMatchObject({ kind: 'manual', stage: "opening the coach's chat" });
    expect(report.probes?.length).toBeGreaterThan(10);
    expect(kept.map((k) => k.key)).toEqual(['last-manual']);
  });

  it('says when CafAI Bridge did not take the report, and when the coach runs elsewhere', async () => {
    const failing = fakePage({ fetchImpl: async () => new Response('', { status: 401 }) });
    start({ page: failing });
    await flush();
    expect(await session!.report('manual')).toBe('CafAI Bridge at 192.168.1.90:8877 did not take the report (it answered 401). A copy is kept in Decaid.');
    session!.stop();
    start({ coachSource: async () => ({ kind: 'anthropic', address: '', code: '' }) });
    await flush();
    expect(await session!.report('manual')).toBe('The coach does not run on a computer, so the report is kept in Decaid only.');
  });

  it('says what the page had open as it was put away, which the page exit then aborted', async () => {
    const { page, lines } = start();
    releaseOnPageExit(page.win as unknown as Window, watch!, (line) => lines.push(line));
    await flush();
    const { db, tx } = await openTransaction(page);
    const ended = new Promise((resolve) => (tx.onabort = () => resolve('abort')));
    page.win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    expect(lines.at(-2)).toMatch(/^\[CafAI\] debug: pagehide \(persisted true\) at \S+; cafai readwrite \[settings\] \d+ ms; no request waiting$/);
    expect(lines.at(-1)).toMatch(/^\[CafAI\] put away, the browser keeping the page, with cafai readwrite \[settings\] \d+ ms open: aborted/);
    expect(await ended).toBe('abort');
    // The page watch notes the stack while the flag is on.
    expect(JSON.parse(page.sendBeacon.mock.calls[0]![1]).inFlight.transactions[0].stack.length).toBeGreaterThan(0);
    db.close();
  });

  it('takes what the page exit aborted into the report when it went first', async () => {
    const { page } = start({ flags: null });
    releaseOnPageExit(page.win as unknown as Window, watch!, () => undefined);
    await flush();
    // On a moment later, as Decaid's answer turns it on: its listener comes after the page exit's.
    session!.stop();
    start({ page });
    await flush();
    const { db } = await openTransaction(page);
    page.win.dispatchEvent(new Event('pagehide'));
    const sent = JSON.parse(page.sendBeacon.mock.calls[0]![1]) as DebugReport;
    expect(sent.inFlight.transactions).toEqual([]);
    expect(sent.aborted).toEqual([expect.objectContaining({ db: 'cafai', mode: 'readwrite', stores: ['settings'] })]);
    db.close();
  });
});

describe('bridgeTarget', () => {
  it('is CafAI Bridge only when the coach runs on a computer with an address and a code', () => {
    expect(bridgeTarget(BRIDGE)).toEqual({ baseUrl: 'http://192.168.1.90:8877', display: '192.168.1.90:8877', code: 'ABCDEFGH' });
    expect(bridgeTarget({ ...BRIDGE, code: '' })).toBeNull();
    expect(bridgeTarget({ ...BRIDGE, kind: 'anthropic' })).toBeNull();
    expect(bridgeTarget(null)).toBeNull();
  });
});

describe('compactReport', () => {
  it('fits a beacon: the last lines and events, fewer lines until it fits', () => {
    const report = {
      kind: 'pagehide',
      lifecycle: Array.from({ length: 80 }, (_, i) => ({ type: `e${i}`, at: '', perfMs: i })),
      console: Array.from({ length: 300 }, (_, i) => `${i} ${'x'.repeat(590)}`),
    } as unknown as DebugReport;
    const compact = compactReport(report);
    expect(compact.lifecycle).toHaveLength(40);
    expect(compact.lifecycle[0]!.type).toBe('e40');
    expect(JSON.stringify(compact).length).toBeLessThanOrEqual(60_000);
    expect(compact.console.at(-1)).toBe(report.console.at(-1));
  });
});
