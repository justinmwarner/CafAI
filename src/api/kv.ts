// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/store.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: the KvClient contract only (Decaid's real 200-null and 200-{} semantics, ETags, keepalive).
/**
 * Decaid's key-value store (`/api/v1/store/{namespace}/{key}`).
 *
 * The code, not the spec, is the contract: a missing key is 200 `null`
 * (a 404 is tolerated too), set and delete answer 200 `{}` (any 2xx is
 * fine), and `?full=1` returns the whole namespace with an ETag. Decaid never
 * decodes the namespace or key, so they go into the path raw and must be
 * URL-safe; anything else is refused before a request is made.
 */
import { reportDrift } from './drift.ts';
import { DEFAULT_TIMEOUT_MS, request, requestJson, type Transport } from './http.ts';
import { unexpectedReply } from './readers.ts';
import { GatewayError, type KvClient } from './types.ts';

/** A whole-namespace read, as the drift log names it. */
const FULL_READ = 'GET /api/v1/store/{ns}?full=1';

/** Chromium refuses keepalive bodies over 64 KiB; stay clear of the limit. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;
/** URL path characters that reach Decaid unchanged (no '%', '/', '?', '#', spaces). */
const SAFE_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@-]+$/;

function segment(value: string, path: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new GatewayError(0, path, 'CafAI tried to use a storage key Decaid cannot keep. Use letters, digits, dots, dashes or underscores.', 'invalid_key');
  }
  return value;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function createKvClient(origin: string, fetchImpl?: typeof globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS): KvClient {
  const transport: Transport = { origin: origin.trim().replace(/\/+$/, ''), fetch: fetchImpl, timeoutMs };
  const namespacePath = (namespace: string) => `/api/v1/store/${segment(namespace, '/api/v1/store')}`;
  const keyPath = (namespace: string, key: string) => `${namespacePath(namespace)}/${segment(key, `/api/v1/store/${namespace}`)}`;

  const kv: KvClient = {
    async list(namespace) {
      const keys = await requestJson<unknown>(transport, namespacePath(namespace));
      return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
    },

    async getAll(namespace, etag) {
      const path = `${namespacePath(namespace)}?full=1`;
      const reply = await request<unknown>(transport, path, {
        headers: etag ? { 'If-None-Match': etag } : undefined,
        allowStatus: [304, 404],
      });
      if (reply.status === 304) return { notModified: true };
      // The spec's answer for a namespace that holds nothing.
      if (reply.status === 404) return { notModified: false, data: {}, etag: null };
      // Anything else that is not an object is unreadable, never "no backup":
      // read as empty, it let a fresh device overwrite the backup (5.3).
      const data = reply.data;
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        reportDrift(FULL_READ, 'reply: not an object');
        throw unexpectedReply(FULL_READ, path);
      }
      return { notModified: false, data: data as Record<string, unknown>, etag: reply.headers.get('ETag') };
    },

    async get<T = unknown>(namespace: string, key: string): Promise<T | null> {
      const reply = await request<T>(transport, keyPath(namespace, key), { allowStatus: [404] });
      return reply.status === 404 ? null : reply.data;
    },

    async set(namespace, key, value) {
      const path = keyPath(namespace, key);
      // Decaid stores a literal null body as the string "null"; deleting is
      // the faithful way to store "absent".
      if (value === null || value === undefined) {
        await kv.delete(namespace, key);
        return;
      }
      const bodyText = JSON.stringify(value);
      await request(transport, path, {
        method: 'POST',
        bodyText,
        // keepalive lets a write made while the page unloads still land.
        keepalive: byteLength(bodyText) < KEEPALIVE_MAX_BYTES ? true : undefined,
      });
    },

    async delete(namespace, key) {
      await request(transport, keyPath(namespace, key), { method: 'DELETE', keepalive: true, allowStatus: [404] });
    },
  };
  return kv;
}
