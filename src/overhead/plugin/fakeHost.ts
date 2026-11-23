/**
 * A stand-in for Decaid's plugin host, for the plugin's tests and for the
 * mock build (mock/overhead/), which runs the real plugin in the browser.
 * Storage answers its reads a moment later through the plugin's onEvent, as
 * Decaid does; what was logged and emitted is kept for a test to read.
 */
import type { PluginEvent, PluginHost, PluginResponse } from './host.ts';

export interface FakeHost {
  host: PluginHost;
  /** Where storage answers go; set once the plugin exists. */
  attach(plugin: { onEvent(event: PluginEvent): void }): void;
  store: Map<string, unknown>;
  logs: string[];
  emits: Array<{ event: string; payload: unknown }>;
}

export function createFakeHost(initial: Record<string, unknown> = {}): FakeHost {
  const store = new Map<string, unknown>(Object.entries(initial));
  const logs: string[] = [];
  const emits: Array<{ event: string; payload: unknown }> = [];
  let target: { onEvent(event: PluginEvent): void } | null = null;
  return {
    store,
    logs,
    emits,
    attach(plugin) {
      target = plugin;
    },
    host: {
      log: (message) => void logs.push(message),
      emit: (event, payload) => void emits.push({ event, payload }),
      storage(command) {
        if (command.type === 'write') {
          // Decaid keeps what it is given as JSON.
          store.set(command.key, command.data === undefined ? null : JSON.parse(JSON.stringify(command.data)));
          return;
        }
        const value = store.has(command.key) ? store.get(command.key) : null;
        void Promise.resolve().then(() => target?.onEvent({ name: 'storageRead', payload: { key: command.key, value } }));
      },
    },
  };
}

/** An answer as Decaid's fetch polyfill builds one. */
export function fakeResponse(status: number, body: string, headers: Record<string, string> = {}): PluginResponse {
  const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => lower.get(name.toLowerCase()) ?? null },
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
}
