/**
 * What the Overhead plugin is given (docs/overhead/DISCOVERY.md, section 2):
 * Decaid's `host` object, and the runtime's own fetch and timers, passed in
 * so the tests can drive the plugin with a fake clock and fake providers.
 * Decaid's QuickJS has no Intl, TextDecoder or performance; nothing in the
 * plugin uses them.
 */

/** Decaid's `host`, the parts the plugin's manifest permissions allow. */
export interface PluginHost {
  log(message: string): void;
  emit(event: string, payload: unknown): void;
  storage(command: { type: 'read' | 'write'; key: string; namespace: string; data?: unknown }): void;
}

/** The answer of the runtime's fetch, as Decaid's polyfill builds it. */
export interface PluginResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type PluginFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<PluginResponse>;

export interface PluginDeps {
  fetch: PluginFetch;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A request to one of the plugin's endpoints. */
export interface PluginRequest {
  requestId?: string;
  endpoint: string;
  method: string;
  headers?: Record<string, string>;
  body: unknown;
  query: Record<string, string>;
}

export interface PluginReply {
  status: number;
  headers: Record<string, string>;
  /** Decaid hands it to shelf as is, so it must be text. */
  body: string;
}

/** An event from Decaid. */
export interface PluginEvent {
  name: string;
  payload?: unknown;
}
