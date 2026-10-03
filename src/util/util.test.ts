import { describe, expect, it } from 'vitest';
import { newId } from './id.ts';
import { clone } from './clone.ts';

describe('newId', () => {
  it('produces RFC 4122 v4 UUIDs, optionally prefixed', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId('bag')).toMatch(/^bag_[0-9a-f-]{36}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });
});

describe('clone', () => {
  it('deep-copies JSON data', () => {
    const original = { a: [1, { b: 'x' }], c: null };
    const copy = clone(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.a[1]).not.toBe(original.a[1]);
  });

  it('passes undefined through', () => {
    expect(clone(undefined)).toBeUndefined();
  });
});
