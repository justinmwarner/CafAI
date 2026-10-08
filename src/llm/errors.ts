// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/advice/provider.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Anthropic only; LlmError kinds, retry hints, stream errors.

/**
 * Turning every way a request can fail into an LlmError with a sentence a
 * barista can act on. A bare "HTTP 401" on a tablet at 6am helps nobody.
 *
 * None of these messages ever includes the API key: they are built from the
 * status, the error body Anthropic sent, and fixed text.
 */
import { LlmError } from './types.ts';

const AUTH = 'Anthropic did not accept your API key. Check it in Settings.';
const RATE_LIMIT = 'Anthropic is rate limiting. Wait a moment and try again.';
const OVERLOADED = 'Anthropic is overloaded right now. Try again in a minute.';
const SERVER = 'Anthropic is having trouble at its end. Try again shortly.';
const BAD_REQUEST = 'Anthropic rejected the request. If you changed the model, check it is one your account can use.';
const NOT_FOUND = 'Anthropic has no such model. Check the model name in Settings.';

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

export function describeHttpError(status: number, body: string): string {
  if (status === 529 || errorType(body) === 'overloaded_error') return OVERLOADED;
  if (status === 401 || status === 403) return AUTH;
  if (status === 429) return RATE_LIMIT;
  if (status >= 500) return SERVER;
  // A bad request (unknown model, malformed history...): the API's own words
  // are the diagnosis, so show them.
  const reason = apiReason(body);
  if (reason !== '') return `Anthropic rejected the request: ${reason}`;
  return status === 404 ? NOT_FOUND : BAD_REQUEST;
}

export function errorFromHttp(status: number, body: string): LlmError {
  const message = describeHttpError(status, body);
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
export function errorFromStreamError(event: unknown): LlmError {
  const text = JSON.stringify(event ?? null);
  const type = errorType(text);
  const status = (type !== null ? STATUS_BY_ERROR_TYPE[type] : undefined) ?? 500;
  return errorFromHttp(status, text);
}

export function noApiKeyError(): LlmError {
  return new LlmError('no_api_key', 'Add your Anthropic API key in Settings.');
}

export function networkError(): LlmError {
  return new LlmError('network', "Could not reach Anthropic. Check this device's internet connection.", 0, true);
}

export function abortedError(): LlmError {
  return new LlmError('aborted', 'The request was stopped.');
}

export function timeoutError(phase: 'first_byte' | 'idle'): LlmError {
  return phase === 'first_byte'
    ? new LlmError('network', 'Anthropic took too long to answer. Try again.', 0, true)
    : new LlmError('network', 'The reply from Anthropic stalled. Try again.', 0, true);
}

export function streamDroppedError(): LlmError {
  return new LlmError('network', 'The connection to Anthropic dropped before the reply finished. Try again.', 0, true);
}

export function unreadableReplyError(): LlmError {
  return new LlmError('protocol', 'Anthropic sent a reply CafAI could not read. Try again.');
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
