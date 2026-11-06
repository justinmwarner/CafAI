// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/advice/provider.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Anthropic only; LlmError kinds, retry hints, stream errors.

/**
 * Turning every way a request can fail into an LlmError with a sentence a
 * barista can act on. A bare "HTTP 401" on a tablet at 6am helps nobody.
 *
 * None of these messages ever includes the API key: they are built from the
 * status, the error body the server sent, and fixed text.
 *
 * The sentences that name the service come from a ProviderWording: Anthropic's
 * API by default, or CafAI Bridge, the coach on the user's own computer
 * (computerWording). The coach's own sentences (stopped, refused, stuck) name
 * no service and stay as they are. The wording also says what a request waits
 * on before its reply begins (D281), shown under "Thinking…".
 */
import { LlmError, type LlmErrorKind } from './types.ts';

/** What CafAI Bridge waits on before a reply begins (D281): Claude Code starting, asked, trying again, or started again. */
export type WaitStage = 'starting' | 'requesting' | 'retrying' | 'restarting';

/** Why Claude Code tries Anthropic again: 529, 429, another 5xx, no answer at all, or anything else. */
export type WaitReason = 'overloaded' | 'rate_limited' | 'server' | 'network' | 'other';

/**
 * CafAI Bridge's report of what it waits on (D281), as read from its
 * `cafai_wait` stream event (readWaitReport, anthropic.ts). Claude Code's try
 * and how many it makes (`attempt`, `of`) and why (`reason`) come only with
 * `retrying`, and only when the bridge sent them.
 */
export interface WaitReport {
  stage: WaitStage;
  attempt?: number;
  of?: number;
  reason?: WaitReason;
}

/** Every sentence below that names the service the coach talks to. */
export interface ProviderWording {
  /** Nothing to send as the key. */
  readonly noKey: string;
  /** The request never got there: offline, a CORS rejection, nothing listening. */
  readonly unreachable: string;
  /** 401 or 403. */
  readonly auth: string;
  readonly rateLimit: string;
  readonly overloaded: string;
  /** 5xx. */
  readonly server: string;
  /** Another 4xx, with the server's own reason (an unknown model, malformed history...). */
  rejected(reason: string): string;
  /** Another 4xx, without a reason. */
  readonly badRequest: string;
  /** 404 without a reason. */
  readonly notFound: string;
  readonly firstByteTimeout: string;
  readonly idleTimeout: string;
  readonly dropped: string;
  readonly unreadable: string;
  /**
   * Show the server's own sentence (the `error.message` of an error body or
   * an `error` stream event) for any failed status, whenever it sent one.
   * CafAI Bridge writes its errors for baristas; Anthropic's are written for
   * developers, so only a bad request's reason is repeated, after our words.
   */
  readonly serverSentences: boolean;
  /** Under "Thinking…", said at the start of each request (D281). */
  readonly waiting: string;
  /** Under "Thinking…" before the provider tries a failed request again (D281), by how it failed. */
  retrying(kind: LlmErrorKind): string;
  /**
   * Under "Thinking…": what CafAI Bridge reported it waits on (D281), or null
   * to say nothing of it. Only the computer's wording has it: Anthropic sends
   * no such report.
   */
  reported?(report: WaitReport): string | null;
}

function anthropicRetrying(kind: LlmErrorKind): string {
  switch (kind) {
    case 'overloaded':
      return 'Anthropic is busy right now. Trying again.';
    case 'rate_limit':
      return 'Anthropic is rate limiting. Trying again shortly.';
    case 'server':
      return 'Anthropic is having trouble. Trying again.';
    case 'network':
      return 'Could not reach Anthropic. Trying again.';
    default:
      return 'Trying again.';
  }
}

export const ANTHROPIC_WORDING: ProviderWording = {
  noKey: 'Add your Anthropic API key in Settings > Coach.',
  unreachable: "Could not reach Anthropic. Check this device's internet connection.",
  auth: 'Anthropic did not accept your API key. Check it in Settings > Coach.',
  rateLimit: 'Anthropic is rate limiting. Wait a moment and try again.',
  overloaded: 'Anthropic is overloaded right now. Try again in a minute.',
  server: 'Anthropic is having trouble at its end. Try again shortly.',
  rejected: (reason) => `Anthropic rejected the request: ${reason}`,
  badRequest: 'Anthropic rejected the request. If you changed the model, check it is one your account can use.',
  notFound: 'Anthropic has no such model. Check the model name in Settings > Coach.',
  firstByteTimeout: 'Anthropic took too long to answer. Try again.',
  idleTimeout: 'The reply from Anthropic stalled. Try again.',
  dropped: 'The connection to Anthropic dropped before the reply finished. Try again.',
  unreadable: 'Anthropic sent a reply CafAI could not read. Try again.',
  serverSentences: false,
  waiting: 'Waiting for Anthropic.',
  retrying: anthropicRetrying,
};

/** CafAI's own tries of CafAI Bridge: one it could not reach, or one busy with other conversations (its 503). */
function computerRetrying(kind: LlmErrorKind): string {
  if (kind === 'network') return 'Could not reach your computer. Trying again.';
  if (kind === 'overloaded') return 'Your computer is busy with other conversations. Trying again.';
  return 'Trying your computer again.';
}

/** What CafAI Bridge reported (D281), in a barista's words: "Claude is busy right now. Trying again (3 of 10)." */
function computerReported(report: WaitReport): string | null {
  switch (report.stage) {
    case 'starting':
      return 'Claude Code is starting on your computer.';
    case 'requesting':
      return 'Your computer is waiting for Claude to answer.';
    case 'restarting':
      return 'Claude Code went quiet. Starting it again.';
    case 'retrying': {
      // Claude Code's try of how many, when the bridge said both.
      const count = report.attempt !== undefined && report.of !== undefined ? ` (${report.attempt} of ${report.of})` : '';
      switch (report.reason) {
        case 'overloaded':
          return `Claude is busy right now. Trying again${count}.`;
        case 'rate_limited':
          return `Claude is limiting requests right now. Trying again${count}.`;
        case 'server':
          return `Claude is having trouble right now. Trying again${count}.`;
        case 'network':
          return `Your computer could not reach Claude. Trying again${count}.`;
        default:
          return `Trying Claude again${count}.`;
      }
    }
    default:
      // A stage this build does not know: nothing said.
      return null;
  }
}

/**
 * CafAI Bridge on the user's Mac or PC, at `address` as Settings shows it
 * (192.168.1.20:8877). Never given the pairing code: no sentence carries it.
 */
export function computerWording(address: string): ProviderWording {
  return {
    noKey: 'Add the code CafAI Bridge shows on your computer in Settings > Coach.',
    unreachable: `Could not reach CafAI Bridge at ${address}. Check it is running on your computer and that this device is on the same network.`,
    auth: 'CafAI Bridge did not accept the code. Check it in Settings > Coach.',
    rateLimit: 'CafAI Bridge is rate limiting. Wait a moment and try again.',
    overloaded: 'Claude is overloaded right now. Try again in a minute.',
    server: 'CafAI Bridge ran into trouble on your computer. Try again shortly.',
    rejected: (reason) => `CafAI Bridge rejected the request: ${reason}`,
    badRequest: 'CafAI Bridge rejected the request. Update CafAI Bridge and try again.',
    // The bridge names a model it cannot use itself; a bare 404 is something else answering there.
    notFound: `Could not find CafAI Bridge at ${address}. Check the address in Settings > Coach.`,
    firstByteTimeout: 'Your computer took too long to answer. Try again.',
    idleTimeout: 'The reply from your computer stalled. Try again.',
    dropped: 'The connection to your computer dropped before the reply finished. Try again.',
    unreadable: 'CafAI Bridge sent a reply CafAI could not read. Update CafAI Bridge and try again.',
    serverSentences: true,
    waiting: 'Waiting for Claude on your computer.',
    retrying: computerRetrying,
    reported: computerReported,
  };
}

/**
 * `text` with `secret` replaced by [key] (or `replacement`) wherever it
 * appears: in any case, and through the dashes or spaces it may be written
 * with (CafAI Bridge's code goes as ABCDEFGH or ABCD-EFGH). Belt and braces
 * for text a server sent.
 */
export function hideSecret(text: string, secret: string, replacement = '[key]'): string {
  const chars = [...secret].filter((char) => !/[\s-]/.test(char));
  if (chars.length === 0) return text;
  const pattern = new RegExp(chars.map((char) => char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('[\\s-]*'), 'gi');
  return text.replace(pattern, replacement);
}

/**
 * Pull the human part out of an error body.
 *
 * Anthropic uses `{"type":"error","error":{"type":...,"message":...}}`; other
 * servers in the way use `{"detail": ...}` or `{"error": "..."}`. Either way
 * there is usually one sentence worth showing.
 */
export function extractErrorDetail(body: string): string {
  const text = body.trim();
  if (text === '') return '';

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record['detail'] === 'string') return record['detail'].trim();
      const error = record['error'];
      if (typeof error === 'string') return error.trim();
      if (typeof error === 'object' && error !== null) {
        const message = (error as Record<string, unknown>)['message'];
        if (typeof message === 'string') return message.trim();
      }
    }
  } catch {
    // Not JSON; the raw text is the best we have.
  }

  return text.slice(0, 300);
}

/** The `error.type` of an Anthropic error body, if it has one. */
function errorType(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const error = (parsed as Record<string, unknown>)['error'];
    if (typeof error !== 'object' || error === null) return null;
    const type = (error as Record<string, unknown>)['type'];
    return typeof type === 'string' ? type : null;
  } catch {
    return null;
  }
}

/** Only a JSON envelope carries a reason worth repeating; an HTML error page does not. */
function apiReason(body: string): string {
  return body.trim().startsWith('{') ? extractErrorDetail(body) : '';
}

/** The `error.message` of an Anthropic-shaped error body, or ''. */
function serverSentence(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return '';
    const error = (parsed as Record<string, unknown>)['error'];
    if (typeof error !== 'object' || error === null) return '';
    const message = (error as Record<string, unknown>)['message'];
    return typeof message === 'string' ? message.trim().slice(0, 300) : '';
  } catch {
    return '';
  }
}

export function describeHttpError(status: number, body: string, wording: ProviderWording = ANTHROPIC_WORDING): string {
  if (wording.serverSentences) {
    const sentence = serverSentence(body);
    if (sentence !== '') return sentence;
  }
  if (status === 529 || errorType(body) === 'overloaded_error') return wording.overloaded;
  if (status === 401 || status === 403) return wording.auth;
  if (status === 429) return wording.rateLimit;
  if (status >= 500) return wording.server;
  // A bad request (unknown model, malformed history...): the API's own words
  // are the diagnosis, so show them.
  const reason = apiReason(body);
  if (reason !== '') return wording.rejected(reason);
  return status === 404 ? wording.notFound : wording.badRequest;
}

export function errorFromHttp(status: number, body: string, wording: ProviderWording = ANTHROPIC_WORDING): LlmError {
  const message = describeHttpError(status, body, wording);
  if (status === 529 || errorType(body) === 'overloaded_error') return new LlmError('overloaded', message, status, true);
  if (status === 401 || status === 403) return new LlmError('auth', message, status, false);
  if (status === 429) return new LlmError('rate_limit', message, status, true);
  if (status >= 500) return new LlmError('server', message, status, true);
  return new LlmError('bad_request', message, status, false);
}

/** HTTP status equivalent of each error type an `error` stream event can carry. */
const STATUS_BY_ERROR_TYPE: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

/** An `error` event that arrived inside a 200 stream, mapped like the HTTP error it stands for. */
export function errorFromStreamError(event: unknown, wording: ProviderWording = ANTHROPIC_WORDING): LlmError {
  const text = JSON.stringify(event ?? null);
  const type = errorType(text);
  const status = (type !== null ? STATUS_BY_ERROR_TYPE[type] : undefined) ?? 500;
  return errorFromHttp(status, text, wording);
}

export function noApiKeyError(wording: ProviderWording = ANTHROPIC_WORDING): LlmError {
  return new LlmError('no_api_key', wording.noKey);
}

export function networkError(wording: ProviderWording = ANTHROPIC_WORDING): LlmError {
  return new LlmError('network', wording.unreachable, 0, true);
}

export function abortedError(): LlmError {
  return new LlmError('aborted', 'The request was stopped.');
}

export function timeoutError(phase: 'first_byte' | 'idle', wording: ProviderWording = ANTHROPIC_WORDING): LlmError {
  return new LlmError('network', phase === 'first_byte' ? wording.firstByteTimeout : wording.idleTimeout, 0, true);
}

export function streamDroppedError(wording: ProviderWording = ANTHROPIC_WORDING): LlmError {
  return new LlmError('network', wording.dropped, 0, true);
}

export function unreadableReplyError(wording: ProviderWording = ANTHROPIC_WORDING): LlmError {
  return new LlmError('protocol', wording.unreadable);
}

export function refusalError(): LlmError {
  return new LlmError('refusal', 'The coach could not help with that. Try rephrasing your message.');
}

export function stuckError(): LlmError {
  return new LlmError('protocol', 'The coach got stuck. Try again.');
}

/**
 * Milliseconds to wait from a `retry-after` header: delay-seconds or an HTTP
 * date. Null when absent or unreadable (the caller falls back to backoff).
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  if (!/[a-z]/i.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
