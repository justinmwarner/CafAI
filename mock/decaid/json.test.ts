import { describe, expect, it } from 'vitest';
import { deepMergeJson, stableDartJson } from './json.ts';

describe('deepMergeJson (data/json_utils.dart)', () => {
  it('merges objects key by key and replaces arrays and scalars wholesale', () => {
    const base = { profile: { title: 'A', steps: [{ n: 1 }, { n: 2 }], target_volume: 36 }, context: { targetYield: 36, grinderSetting: '14' } };
    const merged = deepMergeJson(base, { profile: { title: 'B', steps: [{ n: 9 }] }, context: { targetYield: 40 } });
    expect(merged).toEqual({
      profile: { title: 'B', steps: [{ n: 9 }], target_volume: 36 },
      context: { targetYield: 40, grinderSetting: '14' },
    });
  });

  it('an explicit null replaces the value', () => {
    expect(deepMergeJson({ a: { b: 1 }, c: 2 }, { a: null, c: null })).toEqual({ a: null, c: null });
  });

  it('adds new keys and never mutates its inputs', () => {
    const base = { a: { b: 1 } };
    const merged = deepMergeJson(base, { a: { c: 2 }, d: [1] });
    expect(merged).toEqual({ a: { b: 1, c: 2 }, d: [1] });
    expect(base).toEqual({ a: { b: 1 } });
  });

  it('an object never merges into an array or the reverse', () => {
    expect(deepMergeJson({ a: [1, 2] }, { a: { 0: 9 } })).toEqual({ a: { 0: 9 } });
    expect(deepMergeJson({ a: { x: 1 } }, { a: [3] })).toEqual({ a: [3] });
  });
});

describe('stableDartJson', () => {
  it('sorts keys recursively and writes Dart doubles with a trailing .0', () => {
    expect(stableDartJson({ b: 90, a: [{ z: 0, y: 0.5 }], c: null, d: 'x', e: true })).toBe(
      '{"a":[{"y":0.5,"z":0.0}],"b":90.0,"c":null,"d":"x","e":true}',
    );
  });

  it('writes the named int fields without a fraction', () => {
    expect(stableDartJson({ target_volume_count_start: 2, tank_temperature: 0 }, ['target_volume_count_start'])).toBe(
      '{"tank_temperature":0.0,"target_volume_count_start":2}',
    );
  });

  it('escapes strings the way Dart and JSON.stringify both do', () => {
    expect(stableDartJson({ t: 'a "q" \\ é\n' })).toBe('{"t":"a \\"q\\" \\\\ é\\n"}');
  });
});
