// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/provider.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest; Anthropic-only wording; LlmError kinds and retry hints.
import { describe, expect, it } from 'vitest';
import { LlmError } from './types.ts';
import {
  describeHttpError,
  errorFromHttp,
  errorFromStreamError,
  extractErrorDetail,
  networkError,
  noApiKeyError,
  parseRetryAfter,
} from './errors.ts';

const body = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } });

describe('describeHttpError', () => {
  it('turns HTTP failures into sentences a person can act on', () => {
    expect(describeHttpError(401, '')).toMatch(/did not accept your API key.*Settings/);
    expect(describeHttpError(403, '')).toMatch(/did not accept your API key/);
    expect(describeHttpError(429, '')).toMatch(/rate limiting/);
    expect(describeHttpError(503, '')).toMatch(/trouble at its end/);
    expect(describeHttpError(529, '')).toMatch(/overloaded/);
  });

  it('keeps a hosted 500 generic, because its body is noise', () => {
    expect(describeHttpError(500, body('api_error', 'Internal server error'))).toMatch(/trouble at its end/);
  });

  it("passes the API's own reason through for a bad request, such as an unknown model", () => {
    const message = describeHttpError(404, body('not_found_error', 'model: claude-opus-9'));
    expect(message).toBe('Anthropic rejected the request: model: claude-opus-9');
    expect(describeHttpError(400, body('invalid_request_error', 'max_tokens: too big'))).toBe(
      'Anthropic rejected the request: max_tokens: too big',
    );
  });

  it('still says what to check when a bad request has no detail', () => {
    expect(describeHttpError(400, '')).toMatch(/rejected the request.*model/);
    expect(describeHttpError(404, '')).toMatch(/no such model/);
  });
});

describe('extractErrorDetail', () => {
  it('pulls details from either envelope shape', () => {
    expect(extractErrorDetail('{"detail":"a"}')).toBe('a');
    expect(extractErrorDetail('{"error":"b"}')).toBe('b');
    expect(extractErrorDetail('{"error":{"message":"c"}}')).toBe('c');
    expect(extractErrorDetail('plain text')).toBe('plain text');
    expect(extractErrorDetail('')).toBe('');
    expect(extractErrorDetail('   ')).toBe('');
  });

  it('keeps a long non-JSON body short', () => {
    expect(extractErrorDetail('x'.repeat(1000))).toHaveLength(300);
  });
});

describe('errorFromHttp', () => {
  const cases: Array<[number, string, LlmError['kind'], boolean]> = [
    [400, body('invalid_request_error', 'bad'), 'bad_request', false],
    [401, body('authentication_error', 'invalid x-api-key'), 'auth', false],
    [403, body('permission_error', 'no access'), 'auth', false],
    [404, body('not_found_error', 'model: x'), 'bad_request', false],
    [413, body('request_too_large', 'too large'), 'bad_request', false],
    [429, body('rate_limit_error', 'slow down'), 'rate_limit', true],
    [500, body('api_error', 'oops'), 'server', true],
    [502, '<html>bad gateway</html>', 'server', true],
    [503, '', 'server', true],
    [529, body('overloaded_error', 'Overloaded'), 'overloaded', true],
    // The error type wins over a status that would say otherwise.
    [500, body('overloaded_error', 'Overloaded'), 'overloaded', true],
  ];

  it.each(cases)('maps HTTP %i to its kind', (status, text, kind, retryable) => {
    const error = errorFromHttp(status, text);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toMatch(/^[A-Z].*\.?/);
  });
});

describe('errorFromStreamError', () => {
  it('maps an error event in the middle of a stream by its type', () => {
    const overloaded = errorFromStreamError({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    expect(overloaded.kind).toBe('overloaded');
    expect(overloaded.retryable).toBe(true);
    expect(errorFromStreamError({ type: 'error', error: { type: 'api_error', message: 'x' } }).kind).toBe('server');
    expect(errorFromStreamError({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }).kind).toBe(
      'rate_limit',
    );
    expect(errorFromStreamError({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }).message).toBe(
      'Anthropic rejected the request: bad',
    );
    expect(errorFromStreamError({ nonsense: true }).kind).toBe('server');
  });
});

describe('fixed sentences', () => {
  it('asks for a key when there is none', () => {
    const error = noApiKeyError();
    expect(error.kind).toBe('no_api_key');
    expect(error.message).toBe('Add your Anthropic API key in Settings.');
    expect(error.retryable).toBe(false);
  });

  it('points at the internet connection when Anthropic cannot be reached', () => {
    const error = networkError();
    expect(error.kind).toBe('network');
    // A phone calls Anthropic itself too: "this device", not the tablet.
    expect(error.message).toBe("Could not reach Anthropic. Check this device's internet connection.");
    expect(error.retryable).toBe(true);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds or an HTTP date, and ignores nonsense', () => {
    const now = Date.parse('2026-10-03T10:00:00Z');
    expect(parseRetryAfter('3', now)).toBe(3000);
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter('Sat, 03 Oct 2026 10:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('Sat, 03 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-4', now)).toBeNull();
  });
});
