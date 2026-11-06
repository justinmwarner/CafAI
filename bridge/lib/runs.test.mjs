import { describe, expect, it } from 'vitest';
import { TOOL_NOTE, configKey, retryReason, runSystemPrompt, waitFailure, webSearchNote } from './runs.mjs';

describe('retryReason (D280)', () => {
  it('reads why Claude Code tries Anthropic again from the api_retry', () => {
    expect(retryReason(529, 'overloaded')).toBe('overloaded');
    expect(retryReason(null, 'overloaded')).toBe('overloaded');
    expect(retryReason(429, 'rate_limit')).toBe('rate_limited');
    expect(retryReason(500, 'api_error')).toBe('server');
    expect(retryReason(503, null)).toBe('server');
    expect(retryReason(null, 'unknown')).toBe('network');
    expect(retryReason(undefined)).toBe('network');
    expect(retryReason(408, 'timeout')).toBe('other');
  });
});

describe('waitFailure (D280)', () => {
  it('says what kept the reply from beginning, from the last api_retry', () => {
    const retry = (status, error = null) => ({ attempt: 4, of: 10, status, error });
    expect(waitFailure(retry(529, 'overloaded'), 300_000)).toEqual({
      status: 529,
      type: 'overloaded_error',
      message: 'Claude is overloaded right now. Try again in a few minutes.',
    });
    expect(waitFailure(retry(429), 300_000).message).toBe('Claude is limiting requests right now. Try again in a few minutes.');
    expect(waitFailure(retry(502), 300_000).message).toBe('Claude is having trouble right now. Try again in a few minutes.');
    expect(waitFailure(retry(null), 300_000).message).toBe(
      "Claude Code on your computer could not reach Claude. Check the computer's internet connection, then try again.",
    );
    for (const status of [429, 502, null]) expect(waitFailure(retry(status), 300_000)).toMatchObject({ status: 500, type: 'api_error' });
  });

  it('says how long it waited when Claude Code was not retrying', () => {
    expect(waitFailure(null, 300_000)).toEqual({ status: 500, type: 'api_error', message: 'Claude Code on your computer did not answer in 5 minutes. Try again.' });
    expect(waitFailure({ attempt: 1, of: 10, status: 408, error: 'timeout' }, 60_000).message).toBe(
      'Claude Code on your computer did not answer in 1 minute. Try again.',
    );
  });
});

const request = (over = {}) => ({
  model: 'claude-opus-5-5',
  maxTokens: undefined,
  system: 'You coach espresso.',
  messages: [],
  tools: [],
  effort: null,
  webSearch: null,
  ...over,
});
const TOOL = { name: 'share_fun_fact', description: 'Share one fact.', input_schema: { type: 'object' } };

describe('runSystemPrompt', () => {
  it("adds the tool prefix for the coach's tools, and the web search note for a request that may search (D203)", () => {
    expect(runSystemPrompt(request())).toBe('You coach espresso.');
    expect(runSystemPrompt(request({ tools: [TOOL] }))).toBe(`You coach espresso.${TOOL_NOTE}`);
    expect(runSystemPrompt(request({ tools: [TOOL], webSearch: { maxUses: 1 } }))).toBe(`You coach espresso.${TOOL_NOTE}${webSearchNote(1)}`);
  });
});

describe('webSearchNote', () => {
  it("names the search as Claude Code has it, the request's limit, and sources by their site", () => {
    expect(webSearchNote(1)).toBe(
      '\n\n[CafAI Bridge] The web search this prompt calls web_search is the WebSearch tool here: search at most once per reply. ' +
        'Its results ask you to list their sources as markdown links, which CafAI shows as plain text: name each source by its site instead (onyxcoffeelab.com).',
    );
    expect(webSearchNote(3)).toContain(': search at most 3 times per reply. ');
    expect(webSearchNote(null)).toMatch(/is the WebSearch tool here\. Its results/);
  });
});

describe('configKey', () => {
  it('keeps a run that may search apart from one that may not', () => {
    expect(configKey(request({ webSearch: { maxUses: 1 } }))).not.toBe(configKey(request()));
    expect(configKey(request({ webSearch: { maxUses: 1 } }))).toBe(configKey(request({ webSearch: { maxUses: 1 } })));
  });
});
