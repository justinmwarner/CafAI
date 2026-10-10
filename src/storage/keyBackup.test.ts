import { describe, expect, it } from 'vitest';
import { createKeyBackup, KEY_NAME, KEY_NAMESPACE } from './keyBackup.ts';
import { createMemoryKv } from './testing/memoryKv.ts';
import { API_KEY } from './testing/fixtures.ts';
import type { SecretStore } from './types.ts';

/** A SecretStore kept in a plain variable, for tests that do not need IndexedDB. */
function memorySecrets(initial: string | null = null): SecretStore {
  let value = initial;
  return {
    getApiKey: async () => value,
    setApiKey: async (key) => {
      value = key;
    },
    forgetApiKey: async () => {
      value = null;
    },
  };
}

describe('key backup (D99)', () => {
  it('setOn(true) copies the key to cafai-key/anthropic', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY));
    await backup.setOn(true);
    expect(kv.values(KEY_NAMESPACE)).toEqual({ [KEY_NAME]: API_KEY });
  });

  it('setOn(true) with no key saved yet copies nothing (and does not throw)', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(null));
    await backup.setOn(true);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
  });

  it('setOn(false) deletes the copy', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY));
    await backup.setOn(true);
    await backup.setOn(false);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
  });

  it('setOn(true) called again after the key changes refreshes the copy (the caller decides to call it, e.g. on every save)', async () => {
    const kv = createMemoryKv();
    const secrets = memorySecrets(API_KEY);
    const backup = createKeyBackup(kv, secrets);
    await backup.setOn(true);
    await secrets.setApiKey('sk-ant-api03-REPLACED-0123456789abcdefghijklmnopqrstuvwxyz');
    await backup.setOn(true);
    expect(await kv.get(KEY_NAMESPACE, KEY_NAME)).toBe('sk-ant-api03-REPLACED-0123456789abcdefghijklmnopqrstuvwxyz');
  });

  it('setOn throws on a KV failure, so the caller never believes a copy went through (or came off) when it did not', async () => {
    const kv = createMemoryKv();
    kv.failNext('set');
    const backup = createKeyBackup(kv, memorySecrets(API_KEY));
    await expect(backup.setOn(true)).rejects.toThrow();
    kv.failNext('delete');
    await expect(backup.setOn(false)).rejects.toThrow();
  });

  it('restoreIfMissing restores the key only when this device has none', async () => {
    const kv = createMemoryKv();
    await createKeyBackup(kv, memorySecrets(API_KEY)).setOn(true);

    const withoutKey = memorySecrets(null);
    expect(await createKeyBackup(kv, withoutKey).restoreIfMissing()).toBe(true);
    expect(await withoutKey.getApiKey()).toBe(API_KEY);

    const withKey = memorySecrets('sk-ant-already-here');
    expect(await createKeyBackup(kv, withKey).restoreIfMissing()).toBe(false);
    expect(await withKey.getApiKey()).toBe('sk-ant-already-here');
  });

  it('restoreIfMissing does nothing when Decaid holds no copy', async () => {
    const backup = createKeyBackup(createMemoryKv(), memorySecrets(null));
    expect(await backup.restoreIfMissing()).toBe(false);
  });

  it('a KV failure during restore answers false, never throws', async () => {
    const kv = createMemoryKv();
    kv.failNext('get');
    const backup = createKeyBackup(kv, memorySecrets(null));
    expect(await backup.restoreIfMissing()).toBe(false);
  });

  it('never writes to the cafai namespace the mirror, export and import use', async () => {
    const kv = createMemoryKv();
    const secrets = memorySecrets(API_KEY);
    const backup = createKeyBackup(kv, secrets);
    await backup.setOn(true);
    await secrets.setApiKey('sk-ant-api03-REPLACED-0123456789abcdefghijklmnopqrstuvwxyz');
    await backup.setOn(true);
    await backup.setOn(false);
    expect(kv.calls.some((call) => call.namespace === 'cafai')).toBe(false);
  });
});
