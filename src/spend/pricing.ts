/**
 * What one request cost at the prices in the model catalog (D237,
 * src/llm/models.ts): its input, cache read and cache write tokens and its
 * output each at their own rate, Haiku 5.5's second tier when the prompt
 * passes it, and web searches at $10 per 1,000 whatever the model. Worked out
 * when the request is counted and kept in millionths of a dollar, so a later
 * change of price never rewrites a past month.
 */
import { WEB_SEARCH_USD_PER_1000 } from '../llm/models.ts';
import type { LlmUsage, ModelInfo } from '../llm/types.ts';

export interface RequestCost {
  /** Millionths of a dollar, web searches included; the tokens of a model of unknown price count 0. */
  costMicros: number;
  webSearchMicros: number;
  /** False for a model whose price is not known (typed by hand, or newer than this build). */
  priced: boolean;
}

/** A search's price in millionths of a dollar: $10 per 1,000 is 10,000. */
const WEB_SEARCH_MICROS = (WEB_SEARCH_USD_PER_1000 / 1000) * 1_000_000;

/**
 * A price per million tokens is the cost of one token in millionths of a
 * dollar. Prices have at most three decimals ($0.125): in thousandths they are
 * whole, so the sum is exact and rounded once.
 */
const thousandths = (usdPerMTok: number) => Math.round(usdPerMTok * 1000);

const count = (tokens: number | undefined) => (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0 ? tokens : 0);

export function requestCost(model: ModelInfo | undefined, usage: LlmUsage): RequestCost {
  const webSearchMicros = count(usage.webSearchRequests) * WEB_SEARCH_MICROS;
  if (!model || (model.inputPerMTok <= 0 && model.outputPerMTok <= 0)) return { costMicros: webSearchMicros, webSearchMicros, priced: false };
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  const cacheRead = count(usage.cacheReadInputTokens);
  const cacheWrite = count(usage.cacheCreationInputTokens);
  const long = model.longPrompt;
  const prices = long && input + cacheRead + cacheWrite > long.aboveTokens ? long : model;
  const sum =
    input * thousandths(prices.inputPerMTok) +
    output * thousandths(prices.outputPerMTok) +
    cacheRead * thousandths(prices.cacheReadPerMTok) +
    cacheWrite * thousandths(prices.cacheWritePerMTok);
  return { costMicros: Math.round(sum / 1000) + webSearchMicros, webSearchMicros, priced: true };
}
