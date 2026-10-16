/**
 * CafAI's Storage in memory, for building the demo: the coach engine plays
 * the story into it, and the seed then imports the result into IndexedDB in
 * one transaction (mock/demo/seed.ts).
 *
 * It behaves like the IndexedDB repositories (src/storage/repositories.ts)
 * where the engine can tell: records are copied in and out (IndexedDB clones
 * them), lists come back in the same order, and settings go through the
 * storage module's own normalization.
 */
import { byCreatedAt, byId } from '../../src/storage/repositories.ts';
import { applySettingsPatch, normalizeSettings } from '../../src/storage/settings.ts';
import type {
  Bag,
  CafaiExport,
  CareRecord,
  ConversationRecord,
  IterationRecord,
  ProfileVersion,
  Settings,
  Storage,
} from '../../src/storage/types.ts';
import { clone } from '../../src/util/clone.ts';

export interface MemoryStorage extends Storage {
  /** Everything stored, as CafAI's export file holds it (never the key). */
  snapshot(exportedAt: string, appVersion: string): CafaiExport;
}

export interface MemoryStorageOptions {
  defaultModel: string;
  /** Settings to start with (a fresh install's otherwise). */
  settings?: Partial<Settings>;
  apiKey?: string | null;
}

function table<T extends { id: string }>() {
  const rows = new Map<string, T>();
  return {
    get: async (id: string) => clone(rows.get(id)),
    put: async (row: T) => void rows.set(row.id, clone(row)),
    all: () => [...rows.values()].map((row) => clone(row)),
  };
}

export function createMemoryStorage(options: MemoryStorageOptions): MemoryStorage {
  const { defaultModel } = options;
  const bags = table<Bag>();
  const versions = table<ProfileVersion>();
  const iterations = table<IterationRecord>();
  const conversations = table<ConversationRecord>();
  const care = table<CareRecord>();
  let settings: Settings = applySettingsPatch(normalizeSettings(null, defaultModel), options.settings ?? {}, defaultModel);
  let apiKey: string | null = options.apiKey ?? null;

  const snapshot = (exportedAt: string, appVersion: string): CafaiExport => ({
    format: 'cafai-export',
    schemaVersion: 1,
    exportedAt,
    appVersion,
    settings: clone(settings),
    bags: bags.all().sort(byCreatedAt),
    versions: versions.all().sort(byCreatedAt),
    iterations: iterations.all().sort(byCreatedAt),
    conversations: conversations.all().sort(byCreatedAt),
    care: care.all().sort(byId),
  });

  return {
    bags: {
      list: async () => bags.all().sort(byCreatedAt),
      get: bags.get,
      put: bags.put,
    },
    versions: {
      listByBag: async (bagId) =>
        versions
          .all()
          .filter((version) => version.bagId === bagId)
          .sort((a, b) => a.version - b.version || byCreatedAt(a, b)),
      get: versions.get,
      put: versions.put,
    },
    iterations: {
      listByBag: async (bagId) =>
        iterations
          .all()
          .filter((record) => record.bagId === bagId)
          .sort(byCreatedAt),
      listAll: async () => iterations.all().sort(byCreatedAt),
      get: iterations.get,
      put: iterations.put,
    },
    conversations: {
      get: conversations.get,
      put: conversations.put,
    },
    settings: {
      get: async () => clone(settings),
      update: async (patch) => {
        settings = applySettingsPatch(settings, patch, defaultModel);
        return clone(settings);
      },
    },
    care: {
      list: async () => care.all().sort(byId),
      put: care.put,
      // Compare and set, as the care database's: each change against what is held then.
      update: async (changes) => {
        const after = new Map<string, CareRecord | undefined>();
        for (const [id, change] of changes) {
          const held = await care.get(id);
          const next = change(held);
          if (next !== undefined) await care.put(next);
          after.set(id, next ?? held);
        }
        return after;
      },
    },
    secrets: {
      getApiKey: async () => apiKey,
      setApiKey: async (key) => {
        apiKey = key.trim() === '' ? null : key.trim();
      },
      forgetApiKey: async () => {
        apiKey = null;
      },
    },
    porter: {
      exportAll: async () => snapshot(new Date().toISOString(), '0.0.0'),
      importAll: async () => {
        throw new Error('The demo builds its records by playing the story; it imports nothing.');
      },
    },
    mirror: {
      schedulePush() {},
      pushNow: async () => {},
      pull: async () => null,
      lastPushAt: null,
      lastError: null,
      backupKnown: true,
      subscribe: () => () => undefined,
    },
    keyBackup: {
      setOn: async () => {},
      saveKey: async (key) => {
        apiKey = key.trim() === '' ? null : key.trim();
        return true;
      },
      forgetKey: async () => {
        apiKey = null;
        return true;
      },
      restoreIfMissing: async () => false,
    },
    snapshot,
  };
}
