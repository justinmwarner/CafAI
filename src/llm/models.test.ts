// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/provider.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest; CafAI's model list, prices, effort and fallbacks.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  FORMER_MODELS,
  KNOWN_MODELS,
  MODELS,
  PRICES_AS_OF,
  WEB_SEARCH_USD_PER_1000,
  modelInfo,
  priceText,
  resolveModel,
  supportsRefusalFallbacks,
} from './models.ts';

describe('model registry', () => {
  it('offers every published id exactly as published, with no date suffix', () => {
    // "opus", "opus 5", "opus-5" and "claude-opus-5" are all plausible and only
    // one works. That is the reason the picker exists, so the list must be right.
    const ids = MODELS.map((m) => m.id);
    expect(ids).toEqual(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']);
    for (const id of [...ids, ...FORMER_MODELS.map((m) => m.id)]) {
      expect(id, `${id} carries a date suffix it should not`).not.toMatch(/\d{8}$/);
      expect(id).toBe(id.toLowerCase().trim());
    }
  });

  it('defaults to Opus 5.5, which is itself offered', () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(MODELS.map((m) => m.id)).toContain(DEFAULT_MODEL);
  });

  it("carries Anthropic's prices per million tokens: input, output, a 5-minute cache write and a cache read (D242)", () => {
    const prices = Object.fromEntries(
      MODELS.map((m) => [m.id, [m.inputPerMTok, m.outputPerMTok, m.cacheWritePerMTok, m.cacheReadPerMTok]]),
    );
    expect(prices).toEqual({
      // Cache reads at 0.05x the input on Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.1, 0.1x on the others.
      'claude-opus-5-5': [4, 20, 5, 0.2],
      'claude-opus-5': [5, 25, 6.25, 0.5],
      'claude-sonnet-5-5': [2, 10, 2.5, 0.1],
      'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.01],
      'claude-fable-5-1': [10, 50, 12.5, 0.25],
    });
    // A cache write (5-minute, as CafAI's cache_control asks) is 1.25x the input on every model.
    for (const model of KNOWN_MODELS) expect(model.cacheWritePerMTok, model.id).toBeCloseTo(model.inputPerMTok * 1.25, 10);
  });

  it("prices Haiku 5.5's prompts over 100,000 tokens at its second tier, and no other model's", () => {
    expect(modelInfo('claude-haiku-5-5').longPrompt).toEqual({
      aboveTokens: 100_000,
      inputPerMTok: 0.5,
      outputPerMTok: 2.5,
      cacheWritePerMTok: 0.625,
      cacheReadPerMTok: 0.05,
    });
    expect(KNOWN_MODELS.filter((m) => m.longPrompt).map((m) => m.id)).toEqual(['claude-haiku-5-5']);
  });

  it('says when the prices were read, and what a web search costs whatever the model', () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(WEB_SEARCH_USD_PER_1000).toBe(10);
  });

  it('knows that only Haiku 4.5, no longer offered, rejects the effort setting: Sonnet 5.5 and Haiku 5.5 take it', () => {
    expect(MODELS.filter((m) => !m.supportsEffort)).toEqual([]);
    expect(FORMER_MODELS.filter((m) => !m.supportsEffort).map((m) => m.id)).toEqual(['claude-haiku-4-5']);
    expect(modelInfo('claude-sonnet-5-5').supportsEffort).toBe(true);
    expect(modelInfo('claude-haiku-5-5').supportsEffort).toBe(true);
  });

  it('gives every model a short label and a one-line note', () => {
    for (const model of KNOWN_MODELS) {
      expect(model.label.length).toBeGreaterThan(0);
      expect(model.label.length).toBeLessThanOrEqual(12);
      expect(model.note).toMatch(/^[A-Z].*\.$/);
      expect(model.note).not.toContain('\n');
    }
  });

  it('describes a known id from the list', () => {
    expect(modelInfo('claude-sonnet-5-5')).toBe(MODELS[2]);
    expect(modelInfo(' claude-sonnet-5-5 ')).toBe(MODELS[2]);
  });

  it('still knows Sonnet 5 and Haiku 4.5, so a device that chose one keeps its requests and its prices, though the picker no longer lists them (D242)', () => {
    expect(FORMER_MODELS.map((m) => m.id)).toEqual(['claude-sonnet-5', 'claude-haiku-4-5']);
    for (const former of FORMER_MODELS) expect(MODELS.map((m) => m.id)).not.toContain(former.id);
    expect(modelInfo('claude-sonnet-5')).toMatchObject({ label: 'Sonnet 5', inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2, supportsEffort: true });
    expect(modelInfo('claude-haiku-4-5')).toMatchObject({ label: 'Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, supportsEffort: false });
    expect(KNOWN_MODELS).toEqual([...MODELS, ...FORMER_MODELS]);
  });

  it('gives an unknown id a generic entry that never sends effort and has no price', () => {
    const info = modelInfo('claude-future-9');
    expect(info.id).toBe('claude-future-9');
    expect(info.label).toBe('claude-future-9');
    expect(info.supportsEffort).toBe(false);
    expect(info.inputPerMTok).toBe(0);
    expect(info.outputPerMTok).toBe(0);
    expect(info.cacheWritePerMTok).toBe(0);
    expect(info.cacheReadPerMTok).toBe(0);
    expect(info.longPrompt).toBeUndefined();
  });

  it('falls back to the default for a blank model', () => {
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL);
    expect(resolveModel('')).toBe(DEFAULT_MODEL);
    expect(resolveModel('   ')).toBe(DEFAULT_MODEL);
    expect(resolveModel(' claude-haiku-5-5 ')).toBe('claude-haiku-5-5');
    expect(resolveModel('claude-opus-4-8')).toBe('claude-opus-4-8');
  });

  it('opts into server-side refusal fallbacks only for Opus 5 and Fable 5.1', () => {
    const withFallbacks = KNOWN_MODELS.filter((m) => supportsRefusalFallbacks(m.id)).map((m) => m.id);
    expect(withFallbacks).toEqual(['claude-opus-5', 'claude-fable-5-1']);
    expect(supportsRefusalFallbacks('claude-future-9')).toBe(false);
  });

  it('writes a price per million tokens as people read one: whole dollars plain, the rest in cents', () => {
    expect(priceText(4)).toBe('$4');
    expect(priceText(0.1)).toBe('$0.10');
    expect(priceText(0.5)).toBe('$0.50');
    expect(priceText(12.5)).toBe('$12.50');
    expect(priceText(0.125)).toBe('$0.125');
  });
});
