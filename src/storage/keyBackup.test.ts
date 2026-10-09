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
  it('is off by default', async () => {
    const backup = createKeyBackup(createMemoryKv(), memorySecrets(API_KEY));
    expect(await backup.isOn()).toBe(false);
  });

  it('setOn(true) copies the key to cafai-key/anthropic', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY));
    await backup.setOn(true);
    expect(kv.values(KEY_NAMESPACE)).toEqual({ [KEY_NAME]: API_KEY });
    expect(await backup.isOn()).toBe(true);
  });

  it('setOn(false) deletes the copy', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY));
    await backup.setOn(true);
    await backup.setOn(false);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
    expect(await backup.isOn()).toBe(false);
  });

  it('keyChanged does nothing while backup is off', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY));
    await backup.keyChanged();
    expect(kv.writes()).toEqual([]);
  });

  it('keyChanged refreshes the copy while backup is on', async () => {
    const kv = createMemoryKv();
    const secrets = memorySecrets(API_KEY);
    const backup = createKeyBackup(kv, secrets);
    await backup.setOn(true);
    await secrets.setApiKey('sk-ant-api03-REPLACED-0123456789abcdefghijklmnopqrstuvwxyz');
    await backup.keyChanged();
    expect(await kv.get(KEY_NAMESPACE, KEY_NAME)).toBe('sk-ant-api03-REPLACED-0123456789abcdefghijklmnopqrstuvwxyz');
  });

  it('keyChanged deletes the copy once the key is forgotten', async () => {
    const kv = createMemoryKv();
    const secrets = memorySecrets(API_KEY);
    const backup = createKeyBackup(kv, secrets);
    await backup.setOn(true);
    await secrets.forgetApiKey();
    await backup.keyChanged();
    expect(await backup.isOn()).toBe(false);
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
    await backup.keyChanged();
    await backup.setOn(false);
    expect(kv.calls.some((call) => call.namespace === 'cafai')).toBe(false);
  });
});
