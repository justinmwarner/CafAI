// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/gateway/client.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: error codes and copy, tolerant bodies, deadline over the body, GET retry.
/**
 * One HTTP exchange with Decaid, shared by the REST and KV clients.
 *
 * Every call carries a deadline. A gateway that has lost its machine can
 * accept a connection and then never answer, and a skin that hangs on a
 * pending fetch looks broken in a way that is hard to diagnose from a tablet.
 * The deadline covers reading the body too, not just the headers.
 *
 * No custom request headers: Decaid's CORS allow-list only has the standard
 * ones, so a stray header turns every call into a failed preflight.
 */
import { GatewayError, type DecaidErrorBody } from './types.ts';

export const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 10_000;

export interface Transport {
  /** e.g. "http://localhost:8080", no trailing slash. */
  origin: string;
  /** Resolved at call time when absent, so a test or mock can patch the global. */
  fetch?: typeof globalThis.fetch;
  timeoutMs: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Serialized with JSON.stringify; undefined means no body. */
  body?: unknown;
  /** An already serialized JSON body (wins over `body`). */
  bodyText?: string;
  /** Only `If-None-Match` is ever needed. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  keepalive?: boolean;
  /** Non-2xx statuses to hand back instead of throwing (e.g. 304, or a tolerated 404). */
  allowStatus?: number[];
}

export interface Reply<T> {
  status: number;
  headers: Headers;
  data: T | null;
}

const NOT_CONNECTED_MACHINE = 'The machine is not connected. Wake the DE1 and check it is paired with Decaid.';
const NOT_CONNECTED_SCALE = 'The scale is not connected. Switch it on and check it is paired with Decaid.';
const BUSY = 'Decaid is busy. Try again in a moment.';
const POLICY_MESSAGES: Record<string, string> = {
  block_no_scale: 'Connect a scale before pulling a shot (Decaid is set to require one).',
  block_tare_during_shot: "The scale can't be tared during a shot.",
};

function asErrorBody(value: unknown): DecaidErrorBody | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const body: DecaidErrorBody = {};
  for (const key of ['error', 'message', 'details', 'type', 'st'] as const) {
    if (typeof source[key] === 'string') body[key] = source[key];
  }
  return body;
}

/** "FormatException: Field ..." -> "Field ...", first line only. */
function plainDetail(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine
    .trim()
    .replace(/^[A-Za-z_.]*(?:Exception|Error):\s*/, '')
    .replace(/^Invalid argument(?:\(s\)| \([^)]*\)):\s*/, '')
    .trim();
}

/**
 * Decaid reports failures as JSON, not plain text:
 *
 *   HTTP 500 {"error":"DeviceNotConnectedException: machine not connected"}
 *   HTTP 400 {"details":"No scale detected, blocking espresso request","type":"block_no_scale"}
 *   HTTP 400 {"error":"Invalid request","message":"Invalid argument(s): Profile must have \"tank_temperature\""}
 *
 * (verified against the gateway source and live captures), while unmatched
 * routes and uncaught exceptions get shelf's plain-text 404/500. Turn any of
 * them into a sentence a barista can act on, plus a code the UI can branch on.
 */
export function interpretGatewayError(
  path: string,
  status: number,
  bodyText: string,
): { message: string; code: string; body: DecaidErrorBody | null } {
  const text = bodyText.trim();
  let body: DecaidErrorBody | null = null;
  try {
    body = asErrorBody(JSON.parse(text));
  } catch {
    // Not JSON: keep a short plain-text body, never an HTML page.
    if (text && !text.startsWith('<') && text.length <= 300) body = { error: text };
  }

  const policy = body?.type ? POLICY_MESSAGES[body.type] : undefined;
  if (policy && body?.type) return { message: policy, code: body.type, body };

  const everything = [body?.message, body?.details, body?.error].filter(Boolean).join(' ');
  if (/not connected|no (?:machine|scale) connected/i.test(everything)) {
    const scale = /scale/i.test(everything) && !/machine/i.test(everything);
    return { message: scale ? NOT_CONNECTED_SCALE : NOT_CONNECTED_MACHINE, code: 'not_connected', body };
  }
  if (/admission_limit/.test(everything)) return { message: BUSY, code: 'http', body };

  const detail = [body?.message, body?.details, body?.error].map((value) => (value ? plainDetail(value) : '')).find(Boolean);
  return { message: detail || `Decaid answered HTTP ${status} for ${path}.`, code: 'http', body };
}

/** The sentence alone (Crema's original entry point). */
export function describeGatewayError(path: string, status: number, bodyText: string): string {
  return interpretGatewayError(path, status, bodyText).message;
}

function retryDelayMs(headers: Headers): number {
  const value = headers.get('Retry-After')?.trim();
  if (!value) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
  return DEFAULT_RETRY_AFTER_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exchange(
  transport: Transport,
  path: string,
  options: RequestOptions,
): Promise<{ status: number; headers: Headers; text: string }> {
  const method = options.method ?? 'GET';
  const deadline = options.timeoutMs ?? transport.timeoutMs;
  const bodyText = options.bodyText ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const headers: Record<string, string> = { ...options.headers };
  if (bodyText !== undefined) headers['Content-Type'] = 'application/json';

  const init: RequestInit = { method };
  if (Object.keys(headers).length > 0) init.headers = headers;
  if (bodyText !== undefined) init.body = bodyText;
  if (options.keepalive) init.keepalive = true;

  const controller = new AbortController();
  init.signal = controller.signal;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadline);

  try {
    const url = `${transport.origin}${path}`;
    const response = transport.fetch ? await transport.fetch(url, init) : await globalThis.fetch(url, init);
    const text = await response.text();
    return { status: response.status, headers: response.headers, text };
  } catch (cause) {
    if (timedOut || (cause as Error | null)?.name === 'AbortError') {
      throw new GatewayError(0, path, 'Decaid did not answer in time. Check that it is running, then try again.', 'timeout');
    }
    throw new GatewayError(
      0,
      path,
      'Could not reach Decaid. Check that it is running and that this device is on the same network.',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perform one request and return the parsed reply. 2xx (and `allowStatus`)
 * resolve; anything else throws a GatewayError. A GET rejected by Decaid's
 * admission control (429/503) is retried once after Retry-After; state
 * changes are never retried, because the first attempt may have acted.
 */
export async function request<T>(transport: Transport, path: string, options: RequestOptions = {}): Promise<Reply<T>> {
  const method = options.method ?? 'GET';
  let reply = await exchange(transport, path, options);
  if (method === 'GET' && (reply.status === 429 || reply.status === 503)) {
    await sleep(retryDelayMs(reply.headers));
    reply = await exchange(transport, path, options);
  }

  const ok = (reply.status >= 200 && reply.status < 300) || (options.allowStatus ?? []).includes(reply.status);
  if (!ok) {
    const { message, code, body } = interpretGatewayError(path, reply.status, reply.text);
    throw new GatewayError(reply.status, path, message, code, body);
  }

  const text = reply.text.trim();
  if (!text) return { status: reply.status, headers: reply.headers, data: null };
  try {
    return { status: reply.status, headers: reply.headers, data: JSON.parse(text) as T | null };
  } catch {
    if (reply.status >= 200 && reply.status < 300) {
      throw new GatewayError(reply.status, path, 'Decaid sent a reply CafAI could not read.', 'http');
    }
    // A tolerated non-2xx status with a plain-text body carries no data.
    return { status: reply.status, headers: reply.headers, data: null };
  }
}

/** The parsed body of a successful request (null for an empty or literal-null body). */
export async function requestJson<T>(transport: Transport, path: string, options: RequestOptions = {}): Promise<T | null> {
  return (await request<T>(transport, path, options)).data;
}

/** Like requestJson, for routes that always answer with a value. */
export async function requestValue<T>(transport: Transport, path: string, options: RequestOptions = {}): Promise<T> {
  const data = await requestJson<T>(transport, path, options);
  if (data === null) throw new GatewayError(200, path, 'Decaid sent an empty reply.', 'http');
  return data;
}
