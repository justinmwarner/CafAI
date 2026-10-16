import { describe, expect, it } from 'vitest';
import { TOOL_NOTE, configKey, runSystemPrompt, webSearchNote } from './runs.mjs';

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
