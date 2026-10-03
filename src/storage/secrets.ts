// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/settings.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: the API key moved out of the settings into its own IndexedDB database; isReady means a key is stored.
/**
 * The API key, and nothing else.
 *
 * The key lives in this device's browser storage and nowhere else. It is never
 * written to Decaid (whose store has no auth and is readable over the LAN),
 * never exported, never logged, and never leaves the device except as the
 * header on requests to Anthropic.
 *
 * It sits in a separate database from CafAI's data, so an import that
 * replaces everything, an export, or the mirror cannot touch it even by
 * accident: they never open this database. Errors are fixed sentences that
 * carry no cause, so the key cannot ride along in one.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { closeEventTarget, createDbHandle, DURABLE, type LostReason } from './db.ts';
import { StorageError } from './errors.ts';
import type { SecretStore } from './types.ts';

export const SECRETS_DB_NAME = 'cafai-secrets';
const SECRETS_DB_VERSION = 1;
const API_KEY_RECORD = 'anthropicApiKey';

interface SecretsDbSchema extends DBSchema {
  secrets: { key: string; value: string };
}

type SecretsDb = IDBPDatabase<SecretsDbSchema>;

export interface IdbSecretStore extends SecretStore {
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
  if (error instanceof StorageError && error.kind === 'superseded') return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : null;
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', 'This tablet is out of storage space, so the API key was not saved.', name);
  }
  const sentence = {
    read: 'Could not read the saved API key on this tablet. Reload the page and try again.',
    save: 'Could not save the API key on this tablet. Try again.',
    remove: 'Could not remove the API key from this tablet. Try again.',
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

export async function openSecretStore(name: string = SECRETS_DB_NAME): Promise<IdbSecretStore> {
  const handle = createDbHandle((onLost) => openSecretsDb(name, onLost));
  // Fail at start-up, not on the first key save, when storage is blocked.
  await handle.get();
  return { ...createSecretStore(() => handle.get()), close: () => handle.close() };
}

/** Whether CafAI has what it needs to ask the coach anything: a stored API key. */
export async function isReady(secrets: Pick<SecretStore, 'getApiKey'>): Promise<boolean> {
  const key = await secrets.getApiKey();
  return key !== null && key.trim() !== '';
}

export const REDACTED = '[redacted]';
/** Shorter "keys" would redact ordinary words; real API keys are ~100 characters. */
const MIN_SECRET_LENGTH = 8;

/**
 * Replace every occurrence of the key in a piece of text (often JSON).
 *
 * The key is not part of any record, but a user can paste it into a bag note or
 * the chat. Anything about to leave the device (the Decaid mirror, an export)
 * goes through this. The key is matched in its JSON-escaped form, which is the
 * plain key for real API keys, so redacting inside JSON keeps it valid.
 */
export function redactSecret(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return text;
  let result = text;
  const escaped = JSON.stringify(secret).slice(1, -1);
  for (const needle of escaped === secret ? [secret] : [escaped, secret]) {
    result = result.split(needle).join(REDACTED);
  }
  return result;
}
