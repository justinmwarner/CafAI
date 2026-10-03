// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/provider.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest; CafAI's model list, prices, effort and fallbacks.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODELS, modelInfo, resolveModel, supportsRefusalFallbacks } from './models.ts';

describe('model registry', () => {
  it('offers every published id exactly as published, with no date suffix', () => {
    // "opus", "opus 5", "opus-5" and "claude-opus-5" are all plausible and only
    // one works. That is the reason the picker exists, so the list must be right.
    const ids = MODELS.map((m) => m.id);
    expect(ids).toEqual(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1']);
    for (const id of ids) {
      expect(id, `${id} carries a date suffix it should not`).not.toMatch(/\d{8}$/);
      expect(id).toBe(id.toLowerCase().trim());
    }
  });

  it('defaults to Opus 5.5, which is itself offered', () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(MODELS.map((m) => m.id)).toContain(DEFAULT_MODEL);
  });

  it('carries the per-million-token prices for the cost hint', () => {
    const prices = Object.fromEntries(MODELS.map((m) => [m.id, [m.inputPerMTok, m.outputPerMTok]]));
    expect(prices).toEqual({
      'claude-opus-5-5': [4, 20],
      'claude-opus-5': [5, 25],
      'claude-sonnet-5': [2, 10],
      'claude-haiku-4-5': [1, 5],
      'claude-fable-5-1': [10, 50],
    });
  });

  it('knows that only Haiku 4.5 rejects the effort setting', () => {
    const noEffort = MODELS.filter((m) => !m.supportsEffort).map((m) => m.id);
    expect(noEffort).toEqual(['claude-haiku-4-5']);
  });

  it('gives every model a short label and a one-line note', () => {
    for (const model of MODELS) {
      expect(model.label.length).toBeGreaterThan(0);
      expect(model.label.length).toBeLessThanOrEqual(12);
      expect(model.note).toMatch(/^[A-Z].*\.$/);
      expect(model.note).not.toContain('\n');
    }
  });

  it('describes a known id from the list', () => {
    expect(modelInfo('claude-sonnet-5')).toBe(MODELS[2]);
    expect(modelInfo(' claude-sonnet-5 ')).toBe(MODELS[2]);
  });

  it('gives an unknown id a generic entry that never sends effort', () => {
    const info = modelInfo('claude-future-9');
    expect(info.id).toBe('claude-future-9');
    expect(info.label).toBe('claude-future-9');
    expect(info.supportsEffort).toBe(false);
    expect(info.inputPerMTok).toBe(0);
    expect(info.outputPerMTok).toBe(0);
  });

  it('falls back to the default for a blank model', () => {
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL);
    expect(resolveModel('')).toBe(DEFAULT_MODEL);
    expect(resolveModel('   ')).toBe(DEFAULT_MODEL);
    expect(resolveModel(' claude-haiku-4-5 ')).toBe('claude-haiku-4-5');
    expect(resolveModel('claude-opus-4-8')).toBe('claude-opus-4-8');
  });

  it('opts into server-side refusal fallbacks only for Opus 5 and Fable 5.1', () => {
    const withFallbacks = MODELS.filter((m) => supportsRefusalFallbacks(m.id)).map((m) => m.id);
    expect(withFallbacks).toEqual(['claude-opus-5', 'claude-fable-5-1']);
    expect(supportsRefusalFallbacks('claude-future-9')).toBe(false);
  });
});
