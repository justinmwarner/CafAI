// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/settings.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: the API key moved out of the settings into its own IndexedDB database; isReady means a key is stored.
/**
 * The API key, and beside it what its optional copy in Decaid is still owed
 * (keyBackup.ts, D99): nothing else.
 *
 * The key lives in this device's browser storage. It is never exported or
 * logged, and leaves the device only as the header on requests to Anthropic
 * and, when the user chooses so in Settings, as its copy in a namespace of
 * its own in Decaid's store (which has no auth and is readable over the LAN).
 *
 * It sits in a separate database from CafAI's data, so an import that
 * replaces everything, an export, or the mirror cannot touch it even by
 * accident: they never open this database. Errors are fixed sentences that
 * carry no cause, so the key cannot ride along in one.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { closeEventTarget, createDbHandle, DURABLE, type LostReason } from './db.ts';
import { isVersionError, StorageError } from './errors.ts';
import type { KeyCopyState, KeyCopyStore } from './keyBackup.ts';
import type { SecretStore } from './types.ts';
import { REDACTED, redactKeyLike } from './redact.ts';

export const SECRETS_DB_NAME = 'cafai-secrets';
const SECRETS_DB_VERSION = 1;
const API_KEY_RECORD = 'anthropicApiKey';
const KEY_COPY_RECORD = 'anthropicKeyCopy';

interface SecretsDbSchema extends DBSchema {
  /** The key (a string), and what its copy in Decaid is owed (KeyCopyState). */
  secrets: { key: string; value: unknown };
}

type SecretsDb = IDBPDatabase<SecretsDbSchema>;

export interface IdbSecretStore extends SecretStore {
  /** What the key's copy in Decaid is still owed, kept beside the key on this device (D99). */
  readonly keyCopy: KeyCopyStore;
  close(): void;
}

function openSecretsDb(name: string, onLost: (reason: LostReason) => void): Promise<SecretsDb> {
  return openDB<SecretsDbSchema>(name, SECRETS_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('secrets');
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

function secretError(error: unknown, action: 'read' | 'save' | 'remove'): StorageError {
  if (isVersionError(error)) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : null;
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', 'This device is out of storage space, so the API key was not saved.', name);
  }
  const sentence = {
    read: 'Could not read the saved API key on this device. Reload the page and try again.',
    save: 'Could not save the API key on this device. Try again.',
    remove: 'Could not remove the API key from this device. Try again.',
  }[action];
  return new StorageError(action === 'read' ? 'read' : 'write', sentence, name);
}

export function createSecretStore(db: () => Promise<SecretsDb>): SecretStore {
  async function forget(): Promise<void> {
    try {
      const tx = (await db()).transaction('secrets', 'readwrite', DURABLE);
      await Promise.all([tx.store.delete(API_KEY_RECORD), tx.done]);
    } catch (error) {
      throw secretError(error, 'remove');
    }
  }

  return {
    async getApiKey() {
      let value: unknown;
      try {
        value = await (await db()).get('secrets', API_KEY_RECORD);
      } catch (error) {
        throw secretError(error, 'read');
      }
      return typeof value === 'string' && value.trim() !== '' ? value : null;
    },
    async setApiKey(key) {
      const trimmed = key.trim();
      if (trimmed === '') return forget();
      try {
        const tx = (await db()).transaction('secrets', 'readwrite', DURABLE);
        await Promise.all([tx.store.put(trimmed, API_KEY_RECORD), tx.done]);
      } catch (error) {
        throw secretError(error, 'save');
      }
    },
    forgetApiKey: forget,
  };
}

/** A stored KeyCopyState, read leniently: anything else is nothing owed and nothing forgotten. */
function keyCopyState(value: unknown): KeyCopyState {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    owed: record['owed'] === 'copy' || record['owed'] === 'delete' ? record['owed'] : null,
    forgotten: record['forgotten'] === true,
  };
}

/** What the key's copy in Decaid is owed, in the key's own database: no import, export or mirror ever opens it. */
export function createKeyCopyStore(db: () => Promise<SecretsDb>): KeyCopyStore {
  return {
    async get() {
      try {
        return keyCopyState(await (await db()).get('secrets', KEY_COPY_RECORD));
      } catch (error) {
        throw secretError(error, 'read');
      }
    },
    async set(state) {
      try {
        const tx = (await db()).transaction('secrets', 'readwrite', DURABLE);
        await Promise.all([tx.store.put({ owed: state.owed, forgotten: state.forgotten }, KEY_COPY_RECORD), tx.done]);
      } catch (error) {
        throw secretError(error, 'save');
      }
    },
  };
}

export async function openSecretStore(name: string = SECRETS_DB_NAME): Promise<IdbSecretStore> {
  const handle = createDbHandle((onLost) => openSecretsDb(name, onLost));
  // Fail at start-up, not on the first key save, when storage is blocked.
  await handle.get();
  const db = () => handle.get();
  return { ...createSecretStore(db), keyCopy: createKeyCopyStore(db), close: () => handle.close() };
}

/** Whether CafAI has what it needs to ask the coach anything: a stored API key. */
export async function isReady(secrets: Pick<SecretStore, 'getApiKey'>): Promise<boolean> {
  const key = await secrets.getApiKey();
  return key !== null && key.trim() !== '';
}

export { REDACTED };
/** Shorter "keys" would redact ordinary words; real API keys are ~100 characters. */
const MIN_SECRET_LENGTH = 8;

/**
 * Replace every occurrence of the key, and anything shaped like an Anthropic
 * key, in a piece of text (often JSON).
 *
 * The key is not part of any record, but a user can paste it into a bag note or
 * the chat. Anything about to leave the device (the Decaid mirror, an export)
 * goes through this. The key is matched in its JSON-escaped form, which is the
 * plain key for real API keys, so redacting inside JSON keeps it valid.
 */
export function redactSecret(text: string, secret: string | null | undefined): string {
  let result = redactKeyLike(text);
  if (!secret || secret.length < MIN_SECRET_LENGTH) return result;
  const escaped = JSON.stringify(secret).slice(1, -1);
  for (const needle of escaped === secret ? [secret] : [escaped, secret]) {
    result = result.split(needle).join(REDACTED);
  }
  return result;
}
