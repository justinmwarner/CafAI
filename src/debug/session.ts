/**
 * CafAI's debug session (docs/DEBUG.md): nothing at all unless the DEBUG flag
 * is on (flags.ts). Then, from the page's first line, it watches the
 * IndexedDB transactions and requests in flight (watch.ts), the page's own
 * lifecycle (lifecycle.ts) and the console's last lines. Each time the page
 * is hidden, shown or put away, it says in the console what the page has
 * open, and it sends a report to CafAI Bridge when the coach runs on a
 * computer (POST /v1/debug/report, kept in the bridge's debug-reports.jsonl),
 * with a copy in Decaid's key-value store (cafai-debug/last-<kind>). The start
 * screen's "Send debug report" sends one by hand, after the IndexedDB probe
 * (probe.ts), and so does a start that is slow.
 */
import type { KvClient } from '../api/types.ts';
import { normalizeAddress, normalizeCode, type CoachSource } from '../storage/coachSource.ts';
import { captureConsole, type ConsoleTail } from './consoleTail.ts';
import { cachedDebugFlags, DEBUG_NAMESPACE, debugInQuery, fetchDebugFlags, rememberDebugFlags, type DebugFlags } from './flags.ts';
import { pageFacts, watchLifecycle, type LifeEvent, type LifecycleWatch, type PageFacts } from './lifecycle.ts';
import { describeProbes, probeIndexedDb, type ProbeResult } from './probe.ts';
import {
  describeFetches,
  describeTransactions,
  watchFetch,
  watchIndexedDb,
  type FetchWatch,
  type InFlightFetch,
  type InFlightTransaction,
  type IndexedDbWatch,
} from './watch.ts';

export interface DebugReport {
  kind: string;
  app: string;
  at: string;
  href: string;
  userAgent: string;
  page: PageFacts;
  /** What the start waits on, when the report comes from a start. */
  stage: string | null;
  flags: DebugFlags;
  inFlight: { transactions: InFlightTransaction[]; requests: InFlightFetch[] };
  probes?: ProbeResult[];
  /** Transactions aborted as the page was put away (the releaseOnPagehide experiment). */
  aborted?: number;
  lifecycle: LifeEvent[];
  console: string[];
}

export interface DebugReportExtra {
  stage?: string | null;
  /** Run the IndexedDB probe first: a few seconds. */
  probe?: boolean;
}

export interface DebugSession {
  enabled(): boolean;
  /** Hears the flag turn on or off: Decaid's answer can come after the first screen. */
  subscribe(listener: () => void): () => void;
  /** Send a report now; the sentence says where it went. */
  report(kind: string, extra?: DebugReportExtra): Promise<string>;
  stop(): void;
}

export interface ReportTarget {
  baseUrl: string;
  display: string;
  code: string;
}

type DeviceStorage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StartDebugOptions {
  win: Window;
  appVersion: string;
  kv: Pick<KvClient, 'get' | 'set'>;
  /** The device's own storage (localStorage), where the last answer is kept; null where it is blocked. */
  deviceStorage: DeviceStorage | null;
  /** Where the coach runs: reports go to CafAI Bridge when it runs on a computer. */
  coachSource(): Promise<CoachSource | null>;
  /** On by the build (VITE_CAFAI_DEBUG=1), whatever Decaid says. */
  forced?: boolean;
  /** The console whose last lines a report carries; the page's own by default. */
  console?: Console;
  log?: (line: string) => void;
  clock?: { now(): number };
}

/** A copy for a beacon or Decaid's store: both take at most 64 KiB. */
const COMPACT_BYTES = 60_000;
const COMPACT_CONSOLE_LINES = 60;
const COMPACT_EVENTS = 40;
const REPORT_TIMEOUT_MS = 8000;
const SOURCE_TIMEOUT_MS = 3000;

/** CafAI Bridge, when the coach runs on a computer with an address and a code. */
export function bridgeTarget(source: CoachSource | null): ReportTarget | null {
  if (!source || source.kind !== 'computer') return null;
  const address = normalizeAddress(source.address);
  const code = normalizeCode(source.code);
  return address.ok && code.ok ? { baseUrl: address.baseUrl, display: address.display, code: code.code } : null;
}

/** The report cut down to fit a beacon: the console's last lines and the last events, fewer until it fits. */
export function compactReport(report: DebugReport): DebugReport {
  let lines = COMPACT_CONSOLE_LINES;
  let compact: DebugReport = { ...report, lifecycle: report.lifecycle.slice(-COMPACT_EVENTS), console: report.console.slice(-lines) };
  while (JSON.stringify(compact).length > COMPACT_BYTES && lines > 0) {
    lines = Math.floor(lines / 2);
    compact = { ...compact, console: lines > 0 ? report.console.slice(-lines) : [] };
  }
  return compact;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

interface Tools {
  tail: ConsoleTail;
  idb: IndexedDbWatch;
  net: FetchWatch;
  life: LifecycleWatch;
  target: Promise<ReportTarget | null>;
  /** The target once known, for a beacon, which cannot wait. */
  resolved: ReportTarget | null;
}

export function startDebug(options: StartDebugOptions): DebugSession {
  const { win, appVersion, kv, deviceStorage } = options;
  const clock = options.clock ?? Date;
  const log = options.log ?? ((line: string) => console.info(line));
  const byQuery = debugInQuery(win.location.search);
  const forced = options.forced === true || byQuery;
  let flags: DebugFlags = cachedDebugFlags(deviceStorage);
  if (forced) flags = { ...flags, enabled: true };
  let tools: Tools | null = null;
  const listeners = new Set<() => void>();

  const build = (kind: string, stage: string | null, probes?: ProbeResult[], aborted?: number): DebugReport => ({
    kind,
    app: appVersion,
    at: new Date(clock.now()).toISOString(),
    href: win.location.href,
    userAgent: win.navigator.userAgent,
    page: pageFacts(win),
    stage,
    flags,
    inFlight: { transactions: tools?.idb.inFlight() ?? [], requests: tools?.net.inFlight() ?? [] },
    ...(probes ? { probes } : {}),
    ...(aborted !== undefined ? { aborted } : {}),
    lifecycle: tools?.life.events() ?? [],
    console: tools?.tail.lines() ?? [],
  });

  async function post(target: ReportTarget, report: DebugReport): Promise<void> {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = setTimeout(() => controller?.abort(), REPORT_TIMEOUT_MS);
    try {
      const response = await win.fetch(`${target.baseUrl}/v1/debug/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': target.code },
        body: JSON.stringify(report),
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(`it answered ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Decaid's copy: the last report of each kind, which a computer on the LAN can read. */
  const keep = (report: DebugReport) => kv.set(DEBUG_NAMESPACE, `last-${report.kind}`, compactReport(report));

  async function send(report: DebugReport): Promise<string> {
    const target = tools ? await tools.target : null;
    let bridge: string | null = null;
    let sent = false;
    if (target) {
      try {
        await post(target, report);
        sent = true;
      } catch (error) {
        bridge = messageOf(error);
      }
    }
    let kept = false;
    try {
      await keep(report);
      kept = true;
    } catch {
      // Decaid did not take it either: the console still has the lines.
    }
    if (sent) return `Report sent to CafAI Bridge at ${target!.display}${kept ? ', and a copy kept in Decaid' : ''}.`;
    if (target) return `CafAI Bridge at ${target.display} did not take the report (${bridge}).${kept ? ' A copy is kept in Decaid.' : ''}`;
    return kept ? 'The coach does not run on a computer, so the report is kept in Decaid only.' : 'The report could not be sent or kept.';
  }

  /** As the page is hidden or put away: a beacon, which goes out even if the page stops right after. */
  function beacon(report: DebugReport): void {
    const body = JSON.stringify(compactReport(report));
    const target = tools?.resolved ?? null;
    if (target && typeof win.navigator.sendBeacon === 'function') {
      try {
        win.navigator.sendBeacon(`${target.baseUrl}/v1/debug/report?code=${encodeURIComponent(target.code)}`, body);
      } catch {
        // A beacon the browser refused: Decaid's copy below still goes.
      }
    }
    void keep(report).catch(() => undefined);
  }

  function onEvent(event: LifeEvent): void {
    if (!tools) return;
    const persisted = event.detail?.['persisted'];
    const open = tools.idb.inFlight();
    log(
      `[CafAI] debug: ${event.type}${persisted === undefined ? '' : ` (persisted ${String(persisted)})`} at ${event.at}; ` +
        `${describeTransactions(open)}; ${describeFetches(tools.net.inFlight())}`,
    );
    let aborted: number | undefined;
    if (event.type === 'pagehide' && flags.releaseOnPagehide) {
      aborted = tools.idb.abortAll();
      log(`[CafAI] debug: aborted ${aborted} of ${open.length} open IndexedDB transactions as the page was put away`);
    }
    const report = build(event.type, null, undefined, aborted);
    if (event.type === 'hidden' || event.type === 'pagehide') beacon(report);
    else void send(report);
  }

  function install(): void {
    if (tools) return;
    const target = withTimeout(
      options.coachSource().then((source) => bridgeTarget(source)),
      SOURCE_TIMEOUT_MS,
      null,
    );
    tools = {
      tail: captureConsole(options.console ?? console),
      idb: watchIndexedDb(win as unknown as { IDBDatabase?: typeof IDBDatabase }, clock),
      net: watchFetch(win as unknown as { fetch?: typeof globalThis.fetch }, clock),
      life: watchLifecycle(win, onEvent, clock),
      target,
      resolved: null,
    };
    const current = tools;
    void target.then((found) => {
      current.resolved = found;
    });
    const page = pageFacts(win);
    log(
      `[CafAI] debug: on; ${page.navigation ?? 'unknown'} navigation, history ${page.historyLength ?? '?'}, ` +
        `${page.visibility}, page started ${page.startedAt ?? '?'}`,
    );
  }

  function uninstall(): void {
    if (!tools) return;
    tools.life.stop();
    tools.net.stop();
    tools.idb.stop();
    tools.tail.stop();
    tools = null;
  }

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  if (flags.enabled) install();
  // Decaid's answer: for this page, a moment after its start, and kept for the next one.
  void fetchDebugFlags(kv).then((answer) => {
    if (!answer) return;
    rememberDebugFlags(deviceStorage, answer);
    const was = flags.enabled;
    flags = forced ? { ...answer, enabled: true } : answer;
    if (flags.enabled) install();
    else uninstall();
    if (was !== flags.enabled) notify();
  });

  return {
    enabled: () => flags.enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async report(kind, extra = {}) {
      if (!tools) return 'The DEBUG flag is off.';
      const probes = extra.probe ? await probeIndexedDb(win.indexedDB) : undefined;
      if (probes) log(`[CafAI] debug: probe: ${describeProbes(probes)}`);
      const report = build(kind, extra.stage ?? null, probes);
      log(`[CafAI] debug: ${kind} report; ${describeTransactions(report.inFlight.transactions)}; ${describeFetches(report.inFlight.requests)}`);
      return send(report);
    },
    stop: uninstall,
  };
}
