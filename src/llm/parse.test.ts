// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/parse.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest; only the JSON extraction and number coercion cases.
import { describe, expect, it } from 'vitest';
import { coerceNumber, extractJsonObject } from './parse.ts';

describe('extractJsonObject', () => {
  it('extracts JSON from inside markdown fences and prose', () => {
    const reply = 'Sure! Here you go:\n```json\n{"a":1}\n```\nHope that helps.';
    expect(extractJsonObject(reply)).toBe('{"a":1}');
  });

  it('does not end the object early at braces inside strings', () => {
    const reply = '{"note":"a } brace","b":2}';
    expect(extractJsonObject(reply)).toBe(reply);
  });

  it('honours escaped quotes inside strings', () => {
    const reply = String.raw`{"note":"he said \"fine\" }","b":2}`;
    expect(extractJsonObject(reply)).toBe(reply);
  });

  it('returns nested objects whole', () => {
    expect(extractJsonObject('x {"a":{"b":{"c":1}}} y')).toBe('{"a":{"b":{"c":1}}}');
  });

  it('returns null, not an exception, for unbalanced or absent JSON', () => {
    expect(extractJsonObject('no object here')).toBeNull();
    expect(extractJsonObject('{"a":1')).toBeNull();
  });
});

describe('coerceNumber', () => {
  it('reads numbers arriving as strings, with units and a Unicode minus', () => {
    expect(coerceNumber(12.4)).toBe(12.4);
    expect(coerceNumber('12.4')).toBe(12.4);
    expect(coerceNumber('18g')).toBe(18);
    expect(coerceNumber('93 C')).toBe(93);
    expect(coerceNumber('−0.4')).toBe(-0.4);
    expect(coerceNumber('–0.4')).toBe(-0.4);
  });

  it('gives null rather than NaN for non-numbers', () => {
    for (const value of [null, undefined, '', 'none', 'n/a', {}, [], Number.NaN, Infinity]) {
      expect(coerceNumber(value), String(value)).toBeNull();
    }
  });
});
