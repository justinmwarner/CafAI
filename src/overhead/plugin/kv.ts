/**
 * Decaid's plugin storage as promises. A read is a command whose answer comes
 * back later as a `storageRead` event `{ key, value }` (a key never written
 * answers null; DISCOVERY section 2), so reads wait here, by key, until
 * onEvent hands the answer over. A read Decaid never answers gives up after
 * READ_TIMEOUT_MS with null, so a start never hangs on storage.
 */
import type { PluginDeps, PluginHost } from './host.ts';
import { OVERHEAD_PLUGIN_ID } from '../shared/settings.ts';

export const READ_TIMEOUT_MS = 5_000;

export interface PluginKv {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): void;
  /** onEvent's `storageRead`. */
  answered(payload: unknown): void;
  /** Gives up every read still waiting (unload). */
  close(): void;
}

export function createPluginKv(host: PluginHost, deps: Pick<PluginDeps, 'setTimeout' | 'clearTimeout'>): PluginKv {
  const waiting = new Map<string, Array<{ resolve: (value: unknown) => void; timer: unknown }>>();
  const settle = (key: string, value: unknown) => {
    const readers = waiting.get(key);
    if (!readers) return;
    waiting.delete(key);
    for (const reader of readers) {
      deps.clearTimeout(reader.timer);
      reader.resolve(value);
    }
  };
  return {
    read(key) {
      return new Promise((resolve) => {
        const timer = deps.setTimeout(() => {
          const readers = waiting.get(key);
          if (!readers) return;
          const left = readers.filter((reader) => reader.resolve !== resolve);
          if (left.length > 0) waiting.set(key, left);
          else waiting.delete(key);
          resolve(null);
        }, READ_TIMEOUT_MS);
        const readers = waiting.get(key) ?? [];
        readers.push({ resolve, timer });
        waiting.set(key, readers);
        // Only the first reader of a key asks; the others share its answer.
        if (readers.length === 1) host.storage({ type: 'read', key, namespace: OVERHEAD_PLUGIN_ID });
      });
    },
    write(key, value) {
      host.storage({ type: 'write', key, namespace: OVERHEAD_PLUGIN_ID, data: value });
    },
    answered(payload) {
      if (typeof payload !== 'object' || payload === null) return;
      const { key, value } = payload as { key?: unknown; value?: unknown };
      if (typeof key === 'string') settle(key, value ?? null);
    },
    close() {
      for (const key of [...waiting.keys()]) settle(key, null);
    },
  };
}
