/**
 * Talking to CafAI Bridge outside the coach's turns (protocol 1,
 * docs/superpowers/specs/2026-10-11-local-claude-design.md): its status for
 * Settings' Test, and Find, which looks for a bridge on this same computer
 * (Decaid on a Mac or PC, where CafAI's page and the bridge share 127.0.0.1).
 * The coach's own requests go through the Anthropic provider (anthropic.ts).
 *
 * Chromium 91: the time limit is AbortController + setTimeout (no
 * AbortSignal.timeout), and replies are read whole with text().
 *
 * Both go into the traffic log (D139), the pairing code's header by name
 * only, and its value taken out of the reply too.
 */
import { recordExchange, trafficName } from '../traffic/recorder.ts';
import { computerWording, hideSecret, parseRetryAfter } from './errors.ts';

export const BRIDGE_APP = 'cafai-bridge';
/** What Find fills in: the bridge on the computer CafAI itself runs on. */
export const LOCAL_BRIDGE_ADDRESS = '127.0.0.1';
const LOCAL_HEALTH_URL = 'http://127.0.0.1:8877/health';
/** A bridge on this computer answers at once; nothing there fails at once too, or never. */
const FIND_TIMEOUT_MS = 3000;

export interface BridgeUsageWindow {
  /** The share of the window's limit used, 0-1. */
  utilization: number;
  /** ISO time, or null when Claude Code did not say. */
  resetsAt: string | null;
}

/** GET /v1/status, as far as CafAI reads it. */
export interface BridgeStatus {
  ok: boolean;
  app: 'cafai-bridge';
  version: string;
  protocol: number;
  claude: { found: boolean; version?: string; path?: string };
  account: { loggedIn: boolean; authMethod: string | null; subscriptionType: string | null } | null;
  /** Null until a run has reported the plan's usage. */
  usage: { status: string; fiveHour?: BridgeUsageWindow; sevenDay?: BridgeUsageWindow } | null;
  runs: { live: number; max: number };
  /** Sentences for the barista: Claude Code not installed, not signed in, signed in with an API key, too old. */
  problems: string[];
  /** Only for ?probe=1: one tiny real turn. */
  probe?: { ok: true; ms: number; model: string } | { ok: false; error: string };
}

/** Why Test got no status. The bridge's own sentences are written for baristas. */
export type BridgeFailure =
  | { kind: 'unreachable' }
  | { kind: 'timeout' }
  | { kind: 'wrong_code'; message: string }
  | { kind: 'locked_out'; message: string; retryAfterMs: number | null }
  /** Something answered, but not as CafAI Bridge does. */
  | { kind: 'not_bridge' }
  | { kind: 'failed'; status: number; message: string };

export type BridgeStatusResult = { ok: true; status: BridgeStatus } | { ok: false; failure: BridgeFailure };

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The `error.message` of an Anthropic-shaped error body: how the bridge says what went wrong. */
function errorMessage(body: unknown): string | null {
  return isRecord(body) && isRecord(body.error) ? text(body.error.message) : null;
}

function usageWindow(value: unknown): BridgeUsageWindow | undefined {
  if (!isRecord(value) || typeof value.utilization !== 'number' || !Number.isFinite(value.utilization)) return undefined;
  return { utilization: value.utilization, resetsAt: text(value.resetsAt) };
}

/** A status reply, with what is missing or malformed left out; null when it is not CafAI Bridge's. */
export function parseBridgeStatus(value: unknown): BridgeStatus | null {
  if (!isRecord(value) || value.app !== BRIDGE_APP) return null;
  const claude = isRecord(value.claude) ? value.claude : {};
  const account = isRecord(value.account) ? value.account : null;
  const usage = isRecord(value.usage) ? value.usage : null;
  const runs = isRecord(value.runs) ? value.runs : {};
  const status: BridgeStatus = {
    ok: value.ok === true,
    app: BRIDGE_APP,
    version: text(value.version) ?? '',
    protocol: count(value.protocol),
    claude: { found: claude.found === true },
    account: account
      ? { loggedIn: account.loggedIn === true, authMethod: text(account.authMethod), subscriptionType: text(account.subscriptionType) }
      : null,
    usage: null,
    runs: { live: count(runs.live), max: count(runs.max) },
    problems: Array.isArray(value.problems) ? value.problems.flatMap((problem) => text(problem) ?? []) : [],
  };
  const claudeVersion = text(claude.version);
  if (claudeVersion) status.claude.version = claudeVersion;
  const claudePath = text(claude.path);
  if (claudePath) status.claude.path = claudePath;
  if (usage) {
    status.usage = { status: text(usage.status) ?? '' };
    const fiveHour = usageWindow(usage.fiveHour);
    const sevenDay = usageWindow(usage.sevenDay);
    if (fiveHour) status.usage.fiveHour = fiveHour;
    if (sevenDay) status.usage.sevenDay = sevenDay;
  }
  if (isRecord(value.probe)) {
    status.probe =
      value.probe.ok === true
        ? { ok: true, ms: count(value.probe.ms), model: text(value.probe.model) ?? '' }
        : { ok: false, error: text(value.probe.error) ?? 'The test reply failed.' };
  }
  return status;
}

/** Settle with `promise`, or reject once `signal` aborts, whatever the fetch implementation does with it. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    if (signal.aborted) {
      promise.catch(() => undefined);
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

type Reply = { response: Response; body: string } | 'unreachable' | 'timeout';

async function fetchText(url: string, headers: Record<string, string>, timeoutMs: number, doFetch?: typeof globalThis.fetch): Promise<Reply> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const traffic = recordExchange('coach', trafficName('GET', url), { headers });
  try {
    const init: RequestInit = { method: 'GET', headers, signal: controller.signal };
    // Resolved per call, as the provider does: test servers and service workers may swap fetch.
    const response = await untilAborted(doFetch ? doFetch(url, init) : globalThis.fetch(url, init), controller.signal);
    const body = await untilAborted(response.text(), controller.signal);
    traffic.reply(response.status, { headers: response.headers, body });
    return { response, body };
  } catch {
    traffic.fail(timedOut ? 'timeout' : 'network error');
    // In a browser a CORS rejection looks the same as nothing listening.
    return timedOut ? 'timeout' : 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export interface BridgeStatusRequest {
  /** From normalizeAddress, e.g. http://192.168.1.20:8877. */
  baseUrl: string;
  /** The pairing code, sent as x-api-key as the coach's requests send it. */
  code: string;
  /** Also run one tiny real turn (?probe=1), so a Claude Code that starts but never answers shows up. The bridge caps it at 60 s. */
  probe: boolean;
  /** The coach's model, for the probe's turn: a Claude Code too old for it shows up then. */
  model?: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

function statusUrl(request: BridgeStatusRequest): string {
  const base = `${request.baseUrl.replace(/\/+$/, '')}/v1/status`;
  if (!request.probe) return base;
  return request.model ? `${base}?probe=1&model=${encodeURIComponent(request.model)}` : `${base}?probe=1`;
}

export async function getBridgeStatus(request: BridgeStatusRequest): Promise<BridgeStatusResult> {
  const url = statusUrl(request);
  const reply = await fetchText(url, { 'x-api-key': request.code }, request.timeoutMs, request.fetch);
  if (reply === 'unreachable' || reply === 'timeout') return { ok: false, failure: { kind: reply } };
  const body = parseJson(reply.body);
  // Belt and braces: whatever the server echoed back, the code is not shown.
  const hide = (said: string) => hideSecret(said, request.code);
  if (!reply.response.ok) {
    // Every error the bridge sends is Anthropic-shaped; anything else is something else answering.
    const said = errorMessage(body);
    if (said === null) return { ok: false, failure: { kind: 'not_bridge' } };
    const message = hide(said);
    if (reply.response.status === 401) return { ok: false, failure: { kind: 'wrong_code', message } };
    if (reply.response.status === 429) {
      const retryAfterMs = parseRetryAfter(reply.response.headers.get('retry-after'));
      return { ok: false, failure: { kind: 'locked_out', message, retryAfterMs } };
    }
    return { ok: false, failure: { kind: 'failed', status: reply.response.status, message } };
  }
  const status = parseBridgeStatus(body);
  if (!status) return { ok: false, failure: { kind: 'not_bridge' } };
  status.problems = status.problems.map(hide);
  if (status.probe && !status.probe.ok) status.probe = { ok: false, error: hide(status.probe.error) };
  return { ok: true, status };
}

/** Find: the address of a CafAI Bridge on this same computer, or null when none answers there. */
export async function findBridge(options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {}): Promise<string | null> {
  const reply = await fetchText(LOCAL_HEALTH_URL, {}, options.timeoutMs ?? FIND_TIMEOUT_MS, options.fetch);
  if (typeof reply === 'string' || !reply.response.ok) return null;
  const body = parseJson(reply.body);
  return isRecord(body) && body.app === BRIDGE_APP ? LOCAL_BRIDGE_ADDRESS : null;
}

const PLANS: Record<string, string> = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise' };

function planName(account: BridgeStatus['account']): string | null {
  const type = account?.loggedIn ? account.subscriptionType : null;
  if (!type) return null;
  return PLANS[type.toLowerCase()] ?? `Claude ${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function usageSentence(usage: BridgeStatus['usage']): string | null {
  if (usage === null) return null;
  if (usage.status === 'rejected') return "Your Claude plan's usage limit is reached for now.";
  const percent = (window: BridgeUsageWindow) => Math.min(100, Math.max(0, Math.round(window.utilization * 100)));
  if (usage.fiveHour) return `${percent(usage.fiveHour)}% of the 5-hour limit used.`;
  if (usage.sevenDay) return `${percent(usage.sevenDay)}% of the weekly limit used.`;
  return null;
}

/**
 * The one line Settings shows after Test: connected, or what is wrong on the
 * computer in the bridge's own sentences, as they are (a failed test reply is
 * among its problems too).
 */
export function bridgeStatusLine(status: BridgeStatus): { ok: boolean; text: string } {
  if (status.problems.length > 0) return { ok: false, text: status.problems.join(' ') };
  if (status.probe && !status.probe.ok) return { ok: false, text: status.probe.error };
  const plan = planName(status.account);
  const claude = status.claude.version ? `Claude Code ${status.claude.version}` : 'Claude Code';
  const usage = usageSentence(status.usage);
  return { ok: true, text: `Connected. ${plan ? `${claude}, signed in with ${plan}.` : `${claude}.`}${usage ? ` ${usage}` : ''}` };
}

/** The line Settings shows when Test got no status from `address` (as Settings shows it). */
export function bridgeFailureLine(failure: BridgeFailure, address: string): string {
  switch (failure.kind) {
    case 'unreachable':
      return computerWording(address).unreachable;
    case 'timeout':
      return `CafAI Bridge at ${address} did not answer in time. Check your computer is awake, then try again.`;
    case 'not_bridge':
      return `Something answered at ${address}, but it is not CafAI Bridge. Check the address.`;
    default:
      return failure.message;
  }
}
