import { describe, expect, it } from 'vitest';
import { GHC_CACHE_KEY, loadKnownGhc, saveKnownGhc } from './ghcCache.ts';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('GHC cache', () => {
  it('is unknown until saved', () => {
    expect(loadKnownGhc(memoryStorage())).toBeNull();
  });

  it('remembers both answers', () => {
    const storage = memoryStorage();
    saveKnownGhc(true, storage);
    expect(storage.map.get(GHC_CACHE_KEY)).toBe('true');
    expect(loadKnownGhc(storage)).toBe(true);
    saveKnownGhc(false, storage);
    expect(loadKnownGhc(storage)).toBe(false);
  });

  it('treats junk as unknown', () => {
    const storage = memoryStorage();
    storage.setItem(GHC_CACHE_KEY, 'yes');
    expect(loadKnownGhc(storage)).toBeNull();
  });

  it('survives storage that throws or is missing', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadKnownGhc(broken)).toBeNull();
    expect(() => saveKnownGhc(true, broken)).not.toThrow();
    expect(loadKnownGhc(undefined)).toBeNull();
    expect(() => saveKnownGhc(true, undefined)).not.toThrow();
  });
});
