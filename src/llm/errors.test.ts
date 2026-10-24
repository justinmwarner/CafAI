// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/provider.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest; Anthropic-only wording; LlmError kinds and retry hints.
import { describe, expect, it } from 'vitest';
import { LlmError } from './types.ts';
import {
  ANTHROPIC_WORDING,
  computerWording,
  describeHttpError,
  errorFromHttp,
  errorFromStreamError,
  extractErrorDetail,
  hideSecret,
  networkError,
  noApiKeyError,
  parseRetryAfter,
  streamDroppedError,
  timeoutError,
  unreadableReplyError,
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
    expect(error.message).toBe('Add your Anthropic API key in Settings > Coach.');
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

describe('wording per provider', () => {
  const ADDRESS = '192.168.1.20:8877';
  const computer = computerWording(ADDRESS);

  it("is Anthropic's by default, word for word as before", () => {
    expect(timeoutError('first_byte').message).toBe('Anthropic took too long to answer. Try again.');
    expect(timeoutError('idle').message).toBe('The reply from Anthropic stalled. Try again.');
    expect(streamDroppedError().message).toBe('The connection to Anthropic dropped before the reply finished. Try again.');
    expect(unreadableReplyError().message).toBe('Anthropic sent a reply CafAI could not read. Try again.');
    expect(describeHttpError(401, body('authentication_error', 'invalid x-api-key'), ANTHROPIC_WORDING)).toBe(
      'Anthropic did not accept your API key. Check it in Settings > Coach.',
    );
    // Anthropic's own sentences are for developers: only a bad request's reason is repeated, after ours.
    expect(describeHttpError(429, body('rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit'))).toBe(
      'Anthropic is rate limiting. Wait a moment and try again.',
    );
  });

  it('names CafAI Bridge, its address and your computer, for the coach on the computer', () => {
    expect(noApiKeyError(computer)).toMatchObject({ kind: 'no_api_key', message: 'Add the code CafAI Bridge shows on your computer in Settings > Coach.' });
    expect(networkError(computer)).toMatchObject({
      kind: 'network',
      retryable: true,
      message: 'Could not reach CafAI Bridge at 192.168.1.20:8877. Check it is running on your computer and that this device is on the same network.',
    });
    expect(timeoutError('first_byte', computer).message).toBe('Your computer took too long to answer. Try again.');
    expect(timeoutError('idle', computer).message).toBe('The reply from your computer stalled. Try again.');
    expect(streamDroppedError(computer).message).toBe('The connection to your computer dropped before the reply finished. Try again.');
    expect(unreadableReplyError(computer).message).toBe(
      'CafAI Bridge sent a reply CafAI could not read. Update CafAI Bridge and try again.',
    );
  });

  it("shows the bridge's own sentence for any failed status, as it is, keeping the kind", () => {
    const cases: Array<[number, string, LlmError['kind']]> = [
      [400, 'invalid_request_error', 'bad_request'],
      [401, 'authentication_error', 'auth'],
      [403, 'permission_error', 'auth'],
      [404, 'not_found_error', 'bad_request'],
      [429, 'rate_limit_error', 'rate_limit'],
      [500, 'api_error', 'server'],
      [503, 'overloaded_error', 'overloaded'],
    ];
    for (const [status, type, kind] of cases) {
      const sentence = `Claude Code on your computer says ${status}. Do this.`;
      const error = errorFromHttp(status, body(type, sentence), computer);
      expect(error, String(status)).toMatchObject({ kind, status, message: sentence });
      // Never "Anthropic rejected the request:", nor any other prefix.
      expect(describeHttpError(status, body(type, sentence), computer)).toBe(sentence);
    }
    const tooOld = 'Claude Code on your computer is too old for claude-opus-5-5 (it needs 2.1.280 or newer). Run claude update there, then try again.';
    expect(errorFromStreamError({ type: 'error', error: { type: 'invalid_request_error', message: tooOld } }, computer)).toMatchObject({
      kind: 'bad_request',
      message: tooOld,
    });
  });

  it('falls back to its own words when the bridge sent no sentence', () => {
    expect(describeHttpError(401, '', computer)).toBe('CafAI Bridge did not accept the code. Check it in Settings > Coach.');
    expect(describeHttpError(403, '<html>Forbidden</html>', computer)).toBe('CafAI Bridge did not accept the code. Check it in Settings > Coach.');
    expect(describeHttpError(429, '', computer)).toBe('CafAI Bridge is rate limiting. Wait a moment and try again.');
    expect(describeHttpError(529, '', computer)).toBe('Claude is overloaded right now. Try again in a minute.');
    expect(describeHttpError(502, '<html>bad gateway</html>', computer)).toBe('CafAI Bridge ran into trouble on your computer. Try again shortly.');
    expect(describeHttpError(400, '', computer)).toBe('CafAI Bridge rejected the request. Update CafAI Bridge and try again.');
    expect(describeHttpError(404, 'Not Found', computer)).toBe('Could not find CafAI Bridge at 192.168.1.20:8877. Check the address in Settings > Coach.');
    expect(describeHttpError(400, '{"detail":"no such route"}', computer)).toBe('CafAI Bridge rejected the request: no such route');
    expect(describeHttpError(500, body('api_error', '   '), computer)).toBe('CafAI Bridge ran into trouble on your computer. Try again shortly.');
    expect(errorFromStreamError({ nonsense: true }, computer)).toMatchObject({
      kind: 'server',
      message: 'CafAI Bridge ran into trouble on your computer. Try again shortly.',
    });
  });

  it('keeps a long sentence from the bridge to a readable length', () => {
    expect(describeHttpError(500, body('api_error', 'x'.repeat(1000)), computer)).toHaveLength(300);
  });
});

describe('hideSecret', () => {
  it('hides a secret in any case and through the dashes or spaces it may be written with', () => {
    expect(hideSecret('Code ABCDEFGH, ABCD-EFGH, abcd efgh, a-b-c-d-e-f-g-h.', 'ABCD-EFGH')).toBe('Code [key], [key], [key], [key].');
    expect(hideSecret('key sk-ant-api03-x.y+z here', 'sk-ant-api03-x.y+z')).toBe('key [key] here');
    expect(hideSecret('nothing here', 'ABCDEFGH')).toBe('nothing here');
    expect(hideSecret('nothing here', ' - ')).toBe('nothing here');
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
