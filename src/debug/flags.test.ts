import { describe, expect, it } from 'vitest';
import { cachedDebugFlags, DEBUG_CACHE_KEY, debugInQuery, fetchDebugFlags, parseDebugFlags, rememberDebugFlags } from './flags.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe('the DEBUG flag', () => {
  it('is on only for {"enabled": true}, and the experiment only with it', () => {
    expect(parseDebugFlags({ enabled: true })).toEqual({ enabled: true, releaseOnPagehide: false });
    expect(parseDebugFlags({ enabled: true, releaseOnPagehide: true })).toEqual({ enabled: true, releaseOnPagehide: true });
    expect(parseDebugFlags({ enabled: false, releaseOnPagehide: true })).toEqual({ enabled: false, releaseOnPagehide: false });
    for (const value of [null, undefined, true, 'true', { enabled: 'true' }, { enabled: 1 }]) {
      expect(parseDebugFlags(value).enabled).toBe(false);
    }
  });

  it("keeps Decaid's answer for the next page, and nothing once it is off", () => {
    const storage = memoryStorage();
    rememberDebugFlags(storage, { enabled: true, releaseOnPagehide: true });
    expect(cachedDebugFlags(storage)).toEqual({ enabled: true, releaseOnPagehide: true });
    rememberDebugFlags(storage, { enabled: false, releaseOnPagehide: false });
    expect(storage.items.has(DEBUG_CACHE_KEY)).toBe(false);
    expect(cachedDebugFlags(storage).enabled).toBe(false);
  });

  it('is off where storage is blocked or holds something unreadable', () => {
    expect(cachedDebugFlags(null).enabled).toBe(false);
    expect(cachedDebugFlags(memoryStorage({ [DEBUG_CACHE_KEY]: '{ broken' })).enabled).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(cachedDebugFlags(blocked).enabled).toBe(false);
    expect(() => rememberDebugFlags(blocked, { enabled: true, releaseOnPagehide: false })).not.toThrow();
  });

  it("reads cafai-debug/flags from Decaid, and gives no answer when Decaid does not answer", async () => {
    const asked: string[] = [];
    const kv = {
      get: async (namespace: string, key: string) => {
        asked.push(`${namespace}/${key}`);
        return { enabled: true };
      },
    };
    expect(await fetchDebugFlags(kv as never)).toEqual({ enabled: true, releaseOnPagehide: false });
    expect(asked).toEqual(['cafai-debug/flags']);
    expect(await fetchDebugFlags({ get: async () => null } as never)).toEqual({ enabled: false, releaseOnPagehide: false });
    expect(
      await fetchDebugFlags({
        get: async () => {
          throw new Error('offline');
        },
      } as never),
    ).toBeNull();
  });

  it('turns on for one page with ?debug=1', () => {
    expect(debugInQuery('?debug=1')).toBe(true);
    expect(debugInQuery('?_=1794572590923&debug=1')).toBe(true);
    expect(debugInQuery('?_=1794572590923')).toBe(false);
    expect(debugInQuery('?debug=0')).toBe(false);
  });
});
