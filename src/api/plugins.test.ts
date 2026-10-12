import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginDirectory, PLUGIN, PLUGIN_READ_EVERY_MS, PLUGIN_READ_FOR_MS, watchPlugins } from './plugins.ts';
import type { PluginInfo, SocketStatus, TelemetryState } from './types.ts';

function clientThatLists(plugins: PluginInfo[]) {
  return { listPlugins: async () => plugins };
}

describe('plugin directory (D103)', () => {
  it('counts every plugin as absent before the first refresh', () => {
    const directory = createPluginDirectory(clientThatLists([{ id: PLUGIN.timeToReady, loaded: true }]));
    expect(directory.isLoaded(PLUGIN.timeToReady)).toBe(false);
  });

  it('counts a plugin loaded only when Decaid says loaded: true', async () => {
    const directory = createPluginDirectory(
      clientThatLists([
        { id: PLUGIN.timeToReady, loaded: true },
        { id: PLUGIN.visualizer, loaded: false },
        { id: PLUGIN.dye2 },
      ]),
    );
    await directory.refresh();
    expect(directory.isLoaded(PLUGIN.timeToReady)).toBe(true);
    expect(directory.isLoaded(PLUGIN.visualizer)).toBe(false);
    expect(directory.isLoaded(PLUGIN.dye2)).toBe(false);
  });

  it('keeps the last answer when a refresh fails', async () => {
    const listPlugins = vi.fn();
    listPlugins.mockResolvedValueOnce([{ id: PLUGIN.timeToReady, loaded: true }]);
    listPlugins.mockRejectedValueOnce(new Error('Decaid is not answering.'));
    const directory = createPluginDirectory({ listPlugins });
    await directory.refresh();
    expect(directory.isLoaded(PLUGIN.timeToReady)).toBe(true);
    await directory.refresh();
    expect(directory.isLoaded(PLUGIN.timeToReady)).toBe(true);
  });

  it('notifies listeners only when the loaded set changes', async () => {
    const listPlugins = vi.fn();
    listPlugins.mockResolvedValueOnce([{ id: PLUGIN.timeToReady, loaded: true }]);
    listPlugins.mockResolvedValueOnce([{ id: PLUGIN.timeToReady, loaded: true }]);
    listPlugins.mockResolvedValueOnce([
      { id: PLUGIN.timeToReady, loaded: true },
      { id: PLUGIN.visualizer, loaded: true },
    ]);
    const directory = createPluginDirectory({ listPlugins });
    const listener = vi.fn();
    directory.subscribe(listener);

    await directory.refresh();
    expect(listener).toHaveBeenCalledTimes(1);

    await directory.refresh();
    expect(listener, 'the same loaded set does not notify again').toHaveBeenCalledTimes(1);

    await directory.refresh();
    expect(listener, 'a new loaded plugin notifies again').toHaveBeenCalledTimes(2);
  });

  it('stops notifying once unsubscribed', async () => {
    const listPlugins = vi.fn();
    listPlugins.mockResolvedValueOnce([{ id: PLUGIN.timeToReady, loaded: true }]);
    const directory = createPluginDirectory({ listPlugins });
    const listener = vi.fn();
    const unsubscribe = directory.subscribe(listener);
    unsubscribe();
    await directory.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it('lets only the latest read land when two overlap', async () => {
    let answerFirst: (plugins: PluginInfo[]) => void = () => {};
    const listPlugins = vi.fn();
    listPlugins.mockImplementationOnce(() => new Promise<PluginInfo[]>((resolve) => (answerFirst = resolve)));
    listPlugins.mockResolvedValueOnce([{ id: PLUGIN.visualizer, loaded: true }]);
    const directory = createPluginDirectory({ listPlugins });
    const first = directory.refresh();
    await directory.refresh();
    answerFirst([]);
    await first;
    expect(directory.isLoaded(PLUGIN.visualizer), 'the older answer does not undo the newer one').toBe(true);
  });
});

/** Decaid's link state, as far as watchPlugins reads it. */
function fakeTelemetry() {
  let state = { machineConnected: false, sockets: { devices: 'connecting' } } as unknown as TelemetryState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(patch: { machineConnected?: boolean; devices?: SocketStatus }) {
      state = {
        ...state,
        machineConnected: patch.machineConnected ?? state.machineConnected,
        sockets: { ...state.sockets, devices: patch.devices ?? state.sockets.devices },
      };
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('watchPlugins: Decaid starts its plugins after it serves the skin (D103)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A Decaid whose plugin list is `answer` at each read. */
  function decaid(answer: () => PluginInfo[]) {
    const listPlugins = vi.fn(async () => answer());
    return { listPlugins, directory: createPluginDirectory({ listPlugins }) };
  }

  it('reads at once, then every 30 s, so a plugin Decaid loads late is seen and its listeners told', async () => {
    let plugins: PluginInfo[] = [];
    const { listPlugins, directory } = decaid(() => plugins);
    const listener = vi.fn();
    directory.subscribe(listener);
    const stop = watchPlugins(directory, { telemetry: fakeTelemetry() });
    await vi.advanceTimersByTimeAsync(0);
    expect(listPlugins).toHaveBeenCalledTimes(1);
    expect(directory.isLoaded(PLUGIN.timeToReady)).toBe(false);

    // A tablet's page never leaves view: the reads go on by themselves.
    plugins = [{ id: PLUGIN.timeToReady, loaded: true }];
    await vi.advanceTimersByTimeAsync(PLUGIN_READ_EVERY_MS);
    expect(listPlugins).toHaveBeenCalledTimes(2);
    expect(directory.isLoaded(PLUGIN.timeToReady)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops after 10 minutes', async () => {
    const { listPlugins, directory } = decaid(() => []);
    const stop = watchPlugins(directory, { telemetry: fakeTelemetry() });
    await vi.advanceTimersByTimeAsync(PLUGIN_READ_FOR_MS);
    expect(listPlugins).toHaveBeenCalledTimes(1 + PLUGIN_READ_FOR_MS / PLUGIN_READ_EVERY_MS);
    await vi.advanceTimersByTimeAsync(5 * PLUGIN_READ_FOR_MS);
    expect(listPlugins).toHaveBeenCalledTimes(1 + PLUGIN_READ_FOR_MS / PLUGIN_READ_EVERY_MS);
    stop();
  });

  it('stops early once every plugin CafAI uses is loaded', async () => {
    const all = Object.values(PLUGIN).map((id) => ({ id, loaded: true }));
    const { listPlugins, directory } = decaid(() => all);
    const stop = watchPlugins(directory, { telemetry: fakeTelemetry() });
    await vi.advanceTimersByTimeAsync(PLUGIN_READ_FOR_MS);
    expect(listPlugins).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reads again, and for another 10 minutes, when Decaid comes back or the machine connects', async () => {
    const { listPlugins, directory } = decaid(() => []);
    const telemetry = fakeTelemetry();
    const stop = watchPlugins(directory, { telemetry });
    await vi.advanceTimersByTimeAsync(2 * PLUGIN_READ_FOR_MS);
    const before = listPlugins.mock.calls.length;

    telemetry.set({ devices: 'open' });
    await vi.advanceTimersByTimeAsync(0);
    expect(listPlugins, 'at once when the devices socket opens').toHaveBeenCalledTimes(before + 1);
    await vi.advanceTimersByTimeAsync(PLUGIN_READ_EVERY_MS);
    expect(listPlugins, 'and every 30 s after').toHaveBeenCalledTimes(before + 2);

    telemetry.set({ machineConnected: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(listPlugins, 'at once when the machine connects').toHaveBeenCalledTimes(before + 3);
    // Staying connected and open is no news.
    telemetry.set({});
    await vi.advanceTimersByTimeAsync(0);
    expect(listPlugins).toHaveBeenCalledTimes(before + 3);
    stop();
  });

  it('reads nothing more once stopped', async () => {
    const { listPlugins, directory } = decaid(() => []);
    const telemetry = fakeTelemetry();
    const stop = watchPlugins(directory, { telemetry });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    telemetry.set({ devices: 'open', machineConnected: true });
    await vi.advanceTimersByTimeAsync(PLUGIN_READ_FOR_MS);
    expect(listPlugins).toHaveBeenCalledTimes(1);
  });
});
