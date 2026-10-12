/**
 * Which of Decaid's plugins are running (D103). A failed read keeps the last
 * answer, and before the first answer every plugin counts as absent. A
 * change notifies the subscribers: the stats card's ready-in line follows it
 * (AppShell), and the engine asks it each time (the Visualizer link, DYE2).
 *
 * Decaid serves the skin before it starts its plugins, and lists none until
 * its scan of them is over (initialization_step.dart, plugin_loader_service.dart
 * at aab5f93), so a read at start often finds none; and a tablet's page never
 * leaves view to be read again. So watchPlugins keeps reading: every 30 s for
 * 10 minutes from the start, and again for 10 minutes from each time Decaid
 * comes back (its devices socket opens again) or the machine connects, until
 * every plugin CafAI uses is loaded. createServices also reads when the page
 * comes back into view.
 */
import type { TimerApi } from './telemetry.ts';
import type { DecaidClient, TelemetryStore } from './types.ts';

export const PLUGIN = {
  timeToReady: 'time-to-ready.reaplugin',
  visualizer: 'visualizer.reaplugin',
  dye2: 'dye2.reaplugin',
} as const;

/** Every plugin CafAI uses: once all are loaded, there is nothing left to wait for. */
const CAFAI_PLUGINS: readonly string[] = Object.values(PLUGIN);

/** Between two reads while Decaid may still be starting its plugins. */
export const PLUGIN_READ_EVERY_MS = 30_000;
/** How long the reads go on after a start, a Decaid back or a machine connected (20 reads). */
export const PLUGIN_READ_FOR_MS = 10 * 60_000;

export interface PluginDirectory {
  isLoaded(id: string): boolean;
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createPluginDirectory(client: Pick<DecaidClient, 'listPlugins'>): PluginDirectory {
  let loaded = new Set<string>();
  const listeners = new Set<() => void>();
  /** Counts the reads sent: only the latest one's answer lands. */
  let latest = 0;
  return {
    isLoaded: (id) => loaded.has(id),
    async refresh() {
      const read = ++latest;
      try {
        const plugins = await client.listPlugins();
        if (read !== latest) return;
        const next = new Set(plugins.filter((plugin) => plugin.loaded === true).map((plugin) => plugin.id));
        const changed = next.size !== loaded.size || [...next].some((id) => !loaded.has(id));
        loaded = next;
        if (changed) for (const listener of [...listeners]) listener();
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

export interface PluginWatchOptions {
  /** Decaid's link state: its devices socket opening again, or the machine connecting, starts the reads over. */
  telemetry: Pick<TelemetryStore, 'getState' | 'subscribe'>;
  /** Timer functions (default the globals, resolved per call). */
  timers?: TimerApi;
}

/** Reads the directory now and keeps reading (see the file's comment); answers the function that stops it. */
export function watchPlugins(directory: Pick<PluginDirectory, 'isLoaded' | 'refresh'>, options: PluginWatchOptions): () => void {
  const { telemetry } = options;
  const timers: TimerApi = options.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let stopped = false;
  let timer: unknown = null;
  /** Reads left in this stretch. */
  let left = 0;

  const allLoaded = () => CAFAI_PLUGINS.every((id) => directory.isLoaded(id));
  const next = () => {
    if (stopped || timer !== null || left <= 0 || allLoaded()) return;
    timer = timers.setTimeout(() => {
      timer = null;
      left -= 1;
      void directory.refresh().then(next);
    }, PLUGIN_READ_EVERY_MS);
  };
  /** Read now, and every PLUGIN_READ_EVERY_MS for PLUGIN_READ_FOR_MS from now. */
  const startOver = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    left = Math.round(PLUGIN_READ_FOR_MS / PLUGIN_READ_EVERY_MS);
    void directory.refresh().then(next);
  };

  let machineConnected = telemetry.getState().machineConnected;
  let decaidOpen = telemetry.getState().sockets.devices === 'open';
  const unsubscribe = telemetry.subscribe(() => {
    const now = telemetry.getState();
    const back = (now.machineConnected && !machineConnected) || (now.sockets.devices === 'open' && !decaidOpen);
    machineConnected = now.machineConnected;
    decaidOpen = now.sockets.devices === 'open';
    if (back && !stopped) startOver();
  });
  startOver();

  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
}
