import { describe, expect, it } from 'vitest';
import { modelInfo } from '../llm/models.ts';
import type { LlmUsage } from '../llm/types.ts';
import { requestCost } from './pricing.ts';

const usage = (over: Partial<LlmUsage>): LlmUsage => ({ inputTokens: 0, outputTokens: 0, ...over });

describe('requestCost (D237)', () => {
  it('prices Opus 5.5: input, output, cache reads and cache writes each at their own rate, in millionths of a dollar', () => {
    // 1,000 x $4 + 500 x $20 + 20,000 x $0.20 + 3,000 x $5, per million tokens.
    const cost = requestCost(modelInfo('claude-opus-5-5'), usage({ inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 20000, cacheCreationInputTokens: 3000 }));
    expect(cost).toEqual({ costMicros: 33000, webSearchMicros: 0, priced: true });
  });

  it("prices Fable 5.1's cache reads at its 0.025x, and web searches at $10 per 1,000, in the cost and apart", () => {
    // 2,000 x $10 + 1,000 x $50 + 10,000 x $0.25, and two searches at a cent each.
    const cost = requestCost(modelInfo('claude-fable-5-1'), usage({ inputTokens: 2000, outputTokens: 1000, cacheReadInputTokens: 10000, webSearchRequests: 2 }));
    expect(cost).toEqual({ costMicros: 92500, webSearchMicros: 20000, priced: true });
  });

  it('prices a Haiku 5.5 prompt of 100,000 tokens, cache reads and writes included, at its first tier', () => {
    // 50,000 x $0.10 + 40,000 x $0.01 + 10,000 x $0.125 + 1,000 x $0.50.
    const cost = requestCost(modelInfo('claude-haiku-5-5'), usage({ inputTokens: 50000, cacheReadInputTokens: 40000, cacheCreationInputTokens: 10000, outputTokens: 1000 }));
    expect(cost).toEqual({ costMicros: 7150, webSearchMicros: 0, priced: true });
  });

  it('prices a Haiku 5.5 prompt that passes 100,000 tokens at its second tier, output included, rounded once', () => {
    // 50,001 x $0.50 + 40,000 x $0.05 + 10,000 x $0.625 + 1,000 x $2.50 = 35,750.5 millionths.
    const cost = requestCost(modelInfo('claude-haiku-5-5'), usage({ inputTokens: 50001, cacheReadInputTokens: 40000, cacheCreationInputTokens: 10000, outputTokens: 1000 }));
    expect(cost).toEqual({ costMicros: 35751, webSearchMicros: 0, priced: true });
  });

  it('rounds the millionths once per request, never per kind of token', () => {
    // 3 x $0.10 + 30 x $0.01 = 0.6 millionths: 1, where rounding each kind would make it 0.
    expect(requestCost(modelInfo('claude-haiku-5-5'), usage({ inputTokens: 3, cacheReadInputTokens: 30 })).costMicros).toBe(1);
  });

  it('prices Sonnet 5 and Haiku 4.5, no longer offered, at their own prices', () => {
    expect(requestCost(modelInfo('claude-sonnet-5'), usage({ inputTokens: 1000, cacheReadInputTokens: 1000 })).costMicros).toBe(2200);
    expect(requestCost(modelInfo('claude-haiku-4-5'), usage({ outputTokens: 1000 })).costMicros).toBe(5000);
  });

  it('counts nothing for the tokens of a model whose price is not known, but still prices its web searches', () => {
    const typed = requestCost(modelInfo('claude-future-9'), usage({ inputTokens: 5000, outputTokens: 900, webSearchRequests: 1 }));
    expect(typed).toEqual({ costMicros: 10000, webSearchMicros: 10000, priced: false });
    expect(requestCost(undefined, usage({ inputTokens: 5000 }))).toEqual({ costMicros: 0, webSearchMicros: 0, priced: false });
  });

  it('reads a usage with nothing in it as nothing', () => {
    expect(requestCost(modelInfo('claude-opus-5-5'), usage({}))).toEqual({ costMicros: 0, webSearchMicros: 0, priced: true });
  });
});
