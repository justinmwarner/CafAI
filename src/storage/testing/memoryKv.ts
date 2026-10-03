/**
 * An in-memory KvClient that behaves like Decaid's store, for storage tests.
 *
 * Values are kept as JSON text, as Decaid keeps them, so a test sees exactly
 * what crossed the wire. It also enforces the rules CafAI promises to follow,
 * so a violation fails loudly instead of passing quietly: keys of
 * [a-z0-9._-] only and each value under 1 MiB (Decaid answers 413 above it).
 */
import type { KvClient } from '../../api/types.ts';

export type KvMethod = 'list' | 'getAll' | 'get' | 'set' | 'delete';

export interface KvCall {
  method: KvMethod;
  namespace: string;
  key?: string;
}

export interface MemoryKv extends KvClient {
  readonly calls: KvCall[];
  /** Namespace -> key -> JSON text. */
  readonly data: Map<string, Map<string, string>>;
  /** Parsed values of one namespace (default `cafai`). */
  values(namespace?: string): Record<string, unknown>;
  /** JSON text of one namespace (default `cafai`). */
  texts(namespace?: string): Record<string, string>;
  /** Make the next `times` calls of `method` reject. */
  failNext(method: KvMethod, times?: number, error?: Error): void;
  /** Calls that wrote or deleted, optionally for one method. */
  writes(method?: 'set' | 'delete'): KvCall[];
}

const KEY_PATTERN = /^[a-z0-9._-]+$/;
const MAX_BODY_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export function createMemoryKv(seed: Record<string, Record<string, unknown>> = {}): MemoryKv {
  const data = new Map<string, Map<string, string>>();
  const calls: KvCall[] = [];
  const failures = new Map<KvMethod, { remaining: number; error: Error }>();

  const space = (namespace: string): Map<string, string> => {
    let found = data.get(namespace);
    if (!found) {
      found = new Map();
      data.set(namespace, found);
    }
    return found;
  };

  for (const [namespace, entries] of Object.entries(seed)) {
    for (const [key, value] of Object.entries(entries)) space(namespace).set(key, JSON.stringify(value));
  }

  const enter = async (method: KvMethod, namespace: string, key?: string): Promise<void> => {
    calls.push(key === undefined ? { method, namespace } : { method, namespace, key });
    const failure = failures.get(method);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error;
    }
  };

  return {
    calls,
    data,
    values(namespace = 'cafai') {
      return Object.fromEntries([...space(namespace)].map(([key, text]) => [key, JSON.parse(text) as unknown]));
    },
    texts(namespace = 'cafai') {
      return Object.fromEntries(space(namespace));
    },
    failNext(method, times = 1, error = new Error('Decaid is not answering.')) {
      failures.set(method, { remaining: times, error });
    },
    writes(method) {
      return calls.filter((call) => (method ? call.method === method : call.method === 'set' || call.method === 'delete'));
    },
    async list(namespace) {
      await enter('list', namespace);
      return [...space(namespace).keys()];
    },
    async getAll(namespace) {
      await enter('getAll', namespace);
      const result: Record<string, unknown> = {};
      for (const [key, text] of space(namespace)) {
        const value = JSON.parse(text) as unknown;
        // Decaid omits null values from ?full=1.
        if (value !== null) result[key] = value;
      }
      return { notModified: false, data: result, etag: null };
    },
    async get<T = unknown>(namespace: string, key: string): Promise<T | null> {
      await enter('get', namespace, key);
      const text = space(namespace).get(key);
      return text === undefined ? null : (JSON.parse(text) as T);
    },
    async set(namespace, key, value) {
      await enter('set', namespace, key);
      if (!KEY_PATTERN.test(key)) throw new Error(`Key "${key}" has characters outside [a-z0-9._-].`);
      const text = JSON.stringify(value);
      if (text === undefined) throw new Error('Value is not JSON.');
      if (encoder.encode(text).length > MAX_BODY_BYTES) throw new Error('Request body is too large');
      space(namespace).set(key, text);
    },
    async delete(namespace, key) {
      await enter('delete', namespace, key);
      space(namespace).delete(key);
    },
  };
}
