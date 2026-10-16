/**
 * Anthropic's web search, for a fun fact (D203): the server tool the coach's
 * requests carry when the barista chose "CafAI's, the coach's and a web
 * search" in Settings > Coach > Fun facts, the 400 that says it cannot be
 * used, and the sites a reply cites.
 */
import { LlmError, type ContentBlock, type ServerToolDefinition } from './types.ts';

/**
 * The basic search, on every model: one search per request needs no dynamic
 * filtering, which would add code-execution blocks to every such turn. $10
 * per 1,000 searches plus the pages read, as input tokens (Anthropic's web
 * search page, 2026-10-16).
 */
export const WEB_SEARCH_TOOL: ServerToolDefinition = { type: 'web_search_20250305', name: 'web_search', max_uses: 1 };

/**
 * A request refused for its web search: an organisation whose admin turned
 * web search off (or that cannot use it) gets a 400 for every request that
 * carries the tool. CafAI then asks again without it.
 */
export function webSearchUnavailable(error: unknown): boolean {
  return error instanceof LlmError && error.kind === 'bad_request' && /web[ _-]?search/i.test(error.message);
}

/** The site of a page, as the fact block shows it: "onyxcoffeelab.com" for https://www.onyxcoffeelab.com/pages/about. Null for anything but an http(s) address. */
export function siteOf(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return host === '' ? null : host;
}

/** The sites a turn's text cites (web search citations), in order of first citation, each once. */
export function citedSites(content: readonly ContentBlock[]): string[] {
  const sites: string[] = [];
  for (const block of content) {
    if (block.type !== 'text') continue;
    const citations = (block as { citations?: unknown }).citations;
    if (!Array.isArray(citations)) continue;
    for (const citation of citations) {
      const url = typeof citation === 'object' && citation !== null ? (citation as Record<string, unknown>)['url'] : null;
      const site = siteOf(typeof url === 'string' ? url : null);
      if (site !== null && !sites.includes(site)) sites.push(site);
    }
  }
  return sites;
}
