/**
 * Where the coach runs: Anthropic's API with the user's key (the default), or
 * Claude on the user's own Mac or PC through CafAI Bridge, which answers on
 * the local network with the user's Claude plan
 * (docs/superpowers/specs/2026-10-11-local-claude-design.md).
 *
 * Kept on this device only, in its own IndexedDB database like the API key
 * (secrets.ts): the bridge's pairing code lets anyone on the network who has
 * it use the user's plan, so it is never mirrored to Decaid, never exported
 * and never logged. Switching back to Anthropic keeps the address and the
 * code, so switching loses nothing. Errors are fixed sentences that carry no
 * cause, so the code cannot ride along in one.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { closeEventTarget, createDbHandle, DURABLE, type LostReason } from './db.ts';
import { isVersionError, StorageError } from './errors.ts';

export const COACH_SOURCE_DB_NAME = 'cafai-coach-source';
const COACH_SOURCE_DB_VERSION = 1;
const RECORD_KEY = 'current';
/** CafAI Bridge's port unless it was started with another. */
export const BRIDGE_PORT = 8877;

export type CoachSourceKind = 'anthropic' | 'computer';

export interface CoachSource {
  kind: CoachSourceKind;
  /** CafAI Bridge's address as Settings shows it (192.168.1.20:8877); '' until one is saved. */
  address: string;
  /** Its pairing code, the 8 letters and digits without the dash; '' until one is saved. */
  code: string;
}

export const DEFAULT_COACH_SOURCE: Readonly<CoachSource> = Object.freeze({ kind: 'anthropic', address: '', code: '' });

export interface CoachSourceStore {
  get(): Promise<CoachSource>;
  set(source: CoachSource): Promise<void>;
  /** Calls `listener` with every source saved from now on (Settings shows it live). Returns the unsubscribe. */
  subscribe(listener: (source: CoachSource) => void): () => void;
  close(): void;
}

interface CoachSourceDbSchema extends DBSchema {
  source: { key: string; value: CoachSource };
}

type CoachSourceDb = IDBPDatabase<CoachSourceDbSchema>;

/** A stored record as a CoachSource; anything unreadable is the default. */
function toCoachSource(value: unknown): CoachSource {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    kind: record['kind'] === 'computer' ? 'computer' : 'anthropic',
    address: typeof record['address'] === 'string' ? record['address'] : '',
    code: typeof record['code'] === 'string' ? record['code'] : '',
  };
}

function openCoachSourceDb(name: string, onLost: (reason: LostReason) => void): Promise<CoachSourceDb> {
  return openDB<CoachSourceDbSchema>(name, COACH_SOURCE_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('source');
    },
    blocking(_currentVersion, blockedVersion, event) {
      closeEventTarget(event);
      onLost(blockedVersion === null ? 'deleted' : 'upgraded');
    },
    terminated() {
      onLost('terminated');
    },
  });
}

function sourceError(error: unknown, action: 'read' | 'save'): StorageError {
  if (isVersionError(error)) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : null;
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', 'This device is out of storage space, so where the coach runs was not saved.', name);
  }
  return action === 'read'
    ? new StorageError('read', 'Could not read where the coach runs on this device. Reload the page and try again.', name)
    : new StorageError('write', 'Could not save where the coach runs on this device. Try again.', name);
}

function listeners() {
  const all = new Set<(source: CoachSource) => void>();
  return {
    subscribe(listener: (source: CoachSource) => void) {
      all.add(listener);
      return () => void all.delete(listener);
    },
    notify(source: CoachSource) {
      for (const listener of [...all]) listener({ ...source });
    },
  };
}

export function createCoachSourceStore(db: () => Promise<CoachSourceDb>): Omit<CoachSourceStore, 'close'> {
  const changes = listeners();
  return {
    async get() {
      try {
        return toCoachSource(await (await db()).get('source', RECORD_KEY));
      } catch (error) {
        throw sourceError(error, 'read');
      }
    },
    async set(source) {
      const record = toCoachSource(source);
      try {
        const tx = (await db()).transaction('source', 'readwrite', DURABLE);
        await Promise.all([tx.store.put(record, RECORD_KEY), tx.done]);
      } catch (error) {
        throw sourceError(error, 'save');
      }
      changes.notify(record);
    },
    subscribe: changes.subscribe,
  };
}

export async function openCoachSourceStore(name: string = COACH_SOURCE_DB_NAME): Promise<CoachSourceStore> {
  const handle = createDbHandle((onLost) => openCoachSourceDb(name, onLost));
  // Fail at start-up, not on the first save, when storage is blocked.
  await handle.get();
  return { ...createCoachSourceStore(() => handle.get()), close: () => handle.close() };
}

/** The same store in memory, for tests and previews. */
export function createMemoryCoachSourceStore(initial: Partial<CoachSource> = {}): CoachSourceStore {
  let current = toCoachSource({ ...DEFAULT_COACH_SOURCE, ...initial });
  const changes = listeners();
  return {
    get: async () => ({ ...current }),
    async set(source) {
      current = toCoachSource(source);
      changes.notify(current);
    },
    subscribe: changes.subscribe,
    close() {},
  };
}

// ---------------------------------------------------------------------------
// What the user types in Settings
// ---------------------------------------------------------------------------

export type AddressResult = { ok: true; baseUrl: string; display: string } | { ok: false; error: string };

const NO_ADDRESS = 'Type the address CafAI Bridge shows on your computer, for example 192.168.1.20.';
const BAD_ADDRESS = 'Type only the address CafAI Bridge shows, for example 192.168.1.20 or 192.168.1.20:8877.';
const BAD_PORT = 'The port after the colon is a number from 1 to 65535, for example 192.168.1.20:8877.';

const HOST_NAME = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?)*$/;
const IPV6 = /^\[[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*\]$/;

/** The host as requests should name it, or null when it is not one. */
function canonicalHost(host: string): string | null {
  if (host.startsWith('[')) return IPV6.test(host) ? host : null;
  // All digits and dots is an IPv4 address: browsers read "192.168.1" as 192.168.0.1, so it must be all four parts.
  if (/^[\d.]+$/.test(host)) {
    const parts = host.split('.');
    if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
    // In decimal: a browser reads a leading zero as octal (192.168.001.020 is 192.168.1.16 to it).
    return parts.map(Number).join('.');
  }
  return HOST_NAME.test(host) ? host : null;
}

/** Whether a browser takes `url` as a URL at all (a host such as "mac.1" it does not). */
function parses(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * The bridge's address as typed: a host (`192.168.1.20`, `my-mac.local`,
 * `[fe80::1]`), optionally `:port` (8877 when there is none) and `http://`
 * or `https://` in front (http when there is none). `display` is what
 * Settings shows and messages name; `baseUrl` is what requests go to.
 */
export function normalizeAddress(text: string): AddressResult {
  let rest = text.trim();
  if (rest === '') return { ok: false, error: NO_ADDRESS };
  let scheme = 'http';
  const prefix = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(rest);
  if (prefix) {
    scheme = (prefix[1] ?? '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { ok: false, error: BAD_ADDRESS };
    rest = rest.slice(prefix[0].length);
  }
  if (rest.endsWith('/')) rest = rest.slice(0, -1);
  if (rest === '' || /[\s/?#@\\]/.test(rest)) return { ok: false, error: BAD_ADDRESS };

  let host = rest;
  let port: string | null = null;
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 0) return { ok: false, error: BAD_ADDRESS };
    host = rest.slice(0, close + 1);
    const after = rest.slice(close + 1);
    if (after !== '') {
      if (!after.startsWith(':')) return { ok: false, error: BAD_ADDRESS };
      port = after.slice(1);
    }
  } else if (rest.split(':').length > 2) {
    // An IPv6 address without brackets, which leaves no room for a port.
    host = `[${rest}]`;
  } else if (rest.includes(':')) {
    host = rest.slice(0, rest.indexOf(':'));
    port = rest.slice(rest.indexOf(':') + 1);
  }
  const named = canonicalHost(host);
  if (named === null) return { ok: false, error: BAD_ADDRESS };
  if (port !== null && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    return { ok: false, error: BAD_PORT };
  }

  const hostPort = `${named}:${port === null ? BRIDGE_PORT : Number(port)}`;
  const baseUrl = `${scheme}://${hostPort}`;
  if (!parses(baseUrl)) return { ok: false, error: BAD_ADDRESS };
  return { ok: true, baseUrl, display: scheme === 'http' ? hostPort : baseUrl };
}

export type CodeResult = { ok: true; code: string; display: string } | { ok: false; error: string };

/** The pairing code as typed, in any case, with or without its dash: 8 letters and digits. */
export function normalizeCode(text: string): CodeResult {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code === '') return { ok: false, error: 'Type the code CafAI Bridge shows on your computer, for example ABCD-EFGH.' };
  if (code.length !== 8) return { ok: false, error: 'The code is 8 letters and digits, for example ABCD-EFGH.' };
  return { ok: true, code, display: `${code.slice(0, 4)}-${code.slice(4)}` };
}
