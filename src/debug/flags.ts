/**
 * CafAI's DEBUG flag: off unless Decaid's key-value store holds
 * `cafai-debug/flags` as {"enabled": true}, put there from a computer on the
 * LAN while a problem is chased (docs/DEBUG.md). Nothing in CafAI's own
 * screens sets it. The device keeps the last answer in its own storage, so the
 * next page knows before anything starts: the IndexedDB watch has to be on
 * before the first database opens. `?debug=1` turns it on for one page
 * (a desktop browser, the mocks), without keeping it.
 */
import type { KvClient } from '../api/types.ts';

export const DEBUG_NAMESPACE = 'cafai-debug';
export const DEBUG_FLAGS_KEY = 'flags';
/** Where this device keeps the last answer (localStorage). */
export const DEBUG_CACHE_KEY = 'cafai.debug';

export interface DebugFlags {
  enabled: boolean;
  /**
   * An experiment, off unless set: when the page is put away (pagehide), abort
   * every IndexedDB transaction it still has open, so none outlives it.
   */
  releaseOnPagehide: boolean;
}

export const DEBUG_OFF: Readonly<DebugFlags> = Object.freeze({ enabled: false, releaseOnPagehide: false });

/** The flags in a stored value: anything but {"enabled": true} is off. */
export function parseDebugFlags(value: unknown): DebugFlags {
  if (typeof value !== 'object' || value === null) return { ...DEBUG_OFF };
  const record = value as Record<string, unknown>;
  const enabled = record['enabled'] === true;
  return { enabled, releaseOnPagehide: enabled && record['releaseOnPagehide'] === true };
}

type DeviceStorage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The flags this device kept from the last answer; off where storage is blocked or holds nothing. */
export function cachedDebugFlags(storage: DeviceStorage | null): DebugFlags {
  try {
    const text = storage?.getItem(DEBUG_CACHE_KEY);
    return text ? parseDebugFlags(JSON.parse(text)) : { ...DEBUG_OFF };
  } catch {
    return { ...DEBUG_OFF };
  }
}

/** Keep Decaid's answer for the next page: nothing at all while it is off. */
export function rememberDebugFlags(storage: DeviceStorage | null, flags: DebugFlags): void {
  try {
    if (flags.enabled) storage?.setItem(DEBUG_CACHE_KEY, JSON.stringify(flags));
    else storage?.removeItem(DEBUG_CACHE_KEY);
  } catch {
    // Storage blocked: every page asks Decaid again.
  }
}

/** Decaid's answer, or null when Decaid did not give one (the kept flags stand). */
export async function fetchDebugFlags(kv: Pick<KvClient, 'get'>): Promise<DebugFlags | null> {
  try {
    return parseDebugFlags(await kv.get(DEBUG_NAMESPACE, DEBUG_FLAGS_KEY));
  } catch {
    return null;
  }
}

/** `?debug=1` in the page's address. */
export function debugInQuery(search: string): boolean {
  try {
    return new URLSearchParams(search).get('debug') === '1';
  } catch {
    return false;
  }
}
