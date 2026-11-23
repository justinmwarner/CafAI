/**
 * plugin.js's entry (vite.plugin.config.ts). Decaid pastes plugin.js inside
 * its loader function, where `fetch`, `setTimeout` and `clearTimeout` are the
 * plugin's own constants (plugin_manager.dart at v0.9.2, lines 2214-2216), so
 * they are named bare here, never through globalThis. The build appends
 * `function createPlugin(host) {...}`, which the loader looks for.
 */
import type { PluginDeps, PluginFetch, PluginHost } from './host.ts';
import { createOverheadPlugin } from './plugin.ts';

declare const __OVERHEAD_VERSION__: string;

export function createPlugin(host: PluginHost) {
  const deps: PluginDeps = {
    fetch: ((url, init) => fetch(url, init)) as PluginFetch,
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  return createOverheadPlugin(host, deps, __OVERHEAD_VERSION__);
}
