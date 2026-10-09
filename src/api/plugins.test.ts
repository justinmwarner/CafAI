import { describe, expect, it, vi } from 'vitest';
import { createPluginDirectory, PLUGIN } from './plugins.ts';
import type { PluginInfo } from './types.ts';

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
});
