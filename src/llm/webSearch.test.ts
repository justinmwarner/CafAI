import { describe, expect, it } from 'vitest';
import { LlmError, type ContentBlock } from './types.ts';
import { citedSites, siteOf, WEB_SEARCH_TOOL, webSearchUnavailable } from './webSearch.ts';

describe('the web search tool (D203)', () => {
  it('is the basic search, once per request', () => {
    expect(WEB_SEARCH_TOOL).toEqual({ type: 'web_search_20250305', name: 'web_search', max_uses: 1 });
  });
});

describe('webSearchUnavailable', () => {
  it('is a bad request that names the web search', () => {
    expect(webSearchUnavailable(new LlmError('bad_request', 'Web search is not enabled for this organization.', 400))).toBe(true);
    expect(webSearchUnavailable(new LlmError('bad_request', 'tools.0: web_search_20250305 is not supported on this model', 400))).toBe(true);
  });

  it('is nothing else', () => {
    expect(webSearchUnavailable(new LlmError('bad_request', 'max_tokens: must be at most 128000', 400))).toBe(false);
    expect(webSearchUnavailable(new LlmError('server', 'web search failed', 500))).toBe(false);
    expect(webSearchUnavailable(new Error('Web search is not enabled'))).toBe(false);
    expect(webSearchUnavailable(null)).toBe(false);
  });
});

describe('siteOf', () => {
  it('is the host without www', () => {
    expect(siteOf('https://www.onyxcoffeelab.com/pages/about')).toBe('onyxcoffeelab.com');
    expect(siteOf('https://sca.coffee/research/protocols-best-practices')).toBe('sca.coffee');
    expect(siteOf('http://Varieties.WorldCoffeeResearch.org/varieties/gesha')).toBe('varieties.worldcoffeeresearch.org');
    expect(siteOf('  https://example.org  ')).toBe('example.org');
  });

  it('is null for anything but an http(s) address', () => {
    for (const url of ['javascript:alert(1)', 'ftp://example.org/x', 'not a url', '', null, undefined]) {
      expect(siteOf(url), String(url)).toBeNull();
    }
  });
});

describe('citedSites', () => {
  it('lists the cited sites in order, each once', () => {
    const content = [
      { type: 'text', text: 'I looked it up.' },
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'onyx coffee lab founded' } },
      {
        type: 'text',
        text: 'Onyx began in Arkansas.',
        citations: [
          { type: 'web_search_result_location', url: 'https://onyxcoffeelab.com/pages/about', title: 'About', cited_text: '...' },
          { type: 'web_search_result_location', url: 'https://sprudge.com/onyx', title: 'Sprudge', cited_text: '...' },
          { type: 'web_search_result_location', url: 'https://www.onyxcoffeelab.com/pages/story', title: 'Story', cited_text: '...' },
        ],
      },
    ] as unknown as ContentBlock[];
    expect(citedSites(content)).toEqual(['onyxcoffeelab.com', 'sprudge.com']);
  });

  it('is empty without citations', () => {
    expect(citedSites([{ type: 'text', text: 'No search.' }])).toEqual([]);
  });
});
