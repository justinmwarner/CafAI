/**
 * Which of Decaid's plugins are running (D103). Read at start and again when
 * the page comes back into view; a failed read keeps the last answer, and
 * before the first answer every plugin counts as absent.
 */
import type { DecaidClient } from './types.ts';

export const PLUGIN = {
  timeToReady: 'time-to-ready.reaplugin',
  visualizer: 'visualizer.reaplugin',
  dye2: 'dye2.reaplugin',
} as const;

export interface PluginDirectory {
  isLoaded(id: string): boolean;
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createPluginDirectory(client: Pick<DecaidClient, 'listPlugins'>): PluginDirectory {
  let loaded = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    isLoaded: (id) => loaded.has(id),
    async refresh() {
      try {
        const plugins = await client.listPlugins();
        const next = new Set(plugins.filter((plugin) => plugin.loaded === true).map((plugin) => plugin.id));
        const changed = next.size !== loaded.size || [...next].some((id) => !loaded.has(id));
        loaded = next;
        if (changed) for (const listener of listeners) listener();
      } catch {
        // Keep the last answer.
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
