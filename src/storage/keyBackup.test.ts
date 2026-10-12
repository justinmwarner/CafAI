import { describe, expect, it } from 'vitest';
import type { KvClient } from '../api/types.ts';
import { createKeyBackup, KEY_NAME, KEY_NAMESPACE, type KeyCopyState, type KeyCopyStore } from './keyBackup.ts';
import { createMemoryKv } from './testing/memoryKv.ts';
import { API_KEY } from './testing/fixtures.ts';
import type { SecretStore } from './types.ts';

/** A placeholder for a second key; never a real one. */
const NEW_KEY = 'sk-ant-api03-REPLACED-0123456789abcdefghijklmnopqrstuvwxyz';

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

/** What the copy is owed, kept in a plain variable as the secrets database keeps it across a reload. */
function memoryKeyCopy(initial: KeyCopyState = { owed: null, forgotten: false }): KeyCopyStore & { current(): KeyCopyState } {
  let state = initial;
  return {
    get: async () => state,
    set: async (next) => {
      state = next;
    },
    current: () => state,
  };
}

describe('key backup (D99)', () => {
  it('setOn(true) copies the key to cafai-key/anthropic', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY), memoryKeyCopy());
    await backup.setOn(true);
    expect(kv.values(KEY_NAMESPACE)).toEqual({ [KEY_NAME]: API_KEY });
  });

  it('setOn(true) with no key saved yet copies nothing (and does not throw)', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(null), memoryKeyCopy());
    await backup.setOn(true);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
  });

  it('setOn(false) deletes the copy', async () => {
    const kv = createMemoryKv();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY), memoryKeyCopy());
    await backup.setOn(true);
    await backup.setOn(false);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
  });

  it('a key saved while the choice is on replaces the copy; one saved while it is off stays here', async () => {
    const kv = createMemoryKv();
    const secrets = memorySecrets(API_KEY);
    const backup = createKeyBackup(kv, secrets, memoryKeyCopy());
    await backup.setOn(true);
    expect(await backup.saveKey(NEW_KEY, true)).toBe(true);
    expect(await secrets.getApiKey()).toBe(NEW_KEY);
    expect(await kv.get(KEY_NAMESPACE, KEY_NAME)).toBe(NEW_KEY);

    await backup.setOn(false);
    expect(await backup.saveKey(API_KEY, false)).toBe(true);
    expect(await secrets.getApiKey()).toBe(API_KEY);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
  });

  it('setOn throws on a KV failure, so the caller never believes a copy went through (or came off) when it did not', async () => {
    const kv = createMemoryKv();
    kv.failNext('set');
    const backup = createKeyBackup(kv, memorySecrets(API_KEY), memoryKeyCopy());
    await expect(backup.setOn(true)).rejects.toThrow();
    kv.failNext('delete');
    await expect(backup.setOn(false)).rejects.toThrow();
  });

  it('restoreIfMissing restores the key only when this device has none', async () => {
    const kv = createMemoryKv();
    await createKeyBackup(kv, memorySecrets(API_KEY), memoryKeyCopy()).setOn(true);

    const withoutKey = memorySecrets(null);
    expect(await createKeyBackup(kv, withoutKey, memoryKeyCopy()).restoreIfMissing()).toBe(true);
    expect(await withoutKey.getApiKey()).toBe(API_KEY);

    const withKey = memorySecrets('sk-ant-already-here');
    expect(await createKeyBackup(kv, withKey, memoryKeyCopy()).restoreIfMissing()).toBe(false);
    expect(await withKey.getApiKey()).toBe('sk-ant-already-here');
  });

  it('restoreIfMissing does nothing when Decaid holds no copy', async () => {
    const backup = createKeyBackup(createMemoryKv(), memorySecrets(null), memoryKeyCopy());
    expect(await backup.restoreIfMissing()).toBe(false);
  });

  it('a KV failure during restore answers false, never throws', async () => {
    const kv = createMemoryKv();
    kv.failNext('get');
    const backup = createKeyBackup(kv, memorySecrets(null), memoryKeyCopy());
    expect(await backup.restoreIfMissing()).toBe(false);
  });

  it('never writes to the cafai namespace the mirror, export and import use', async () => {
    const kv = createMemoryKv();
    const secrets = memorySecrets(API_KEY);
    const backup = createKeyBackup(kv, secrets, memoryKeyCopy());
    await backup.setOn(true);
    await backup.saveKey(NEW_KEY, true);
    await backup.forgetKey(true);
    await backup.setOn(false);
    expect(kv.calls.some((call) => call.namespace === 'cafai')).toBe(false);
  });
});

describe('key backup: what Decaid did not take (D99)', () => {
  it('forgetting the key while Decaid is away owes the delete, sends it before any restore, and never brings the key back', async () => {
    const kv = createMemoryKv();
    const secrets = memorySecrets(API_KEY);
    const owed = memoryKeyCopy();
    const backup = createKeyBackup(kv, secrets, owed);
    await backup.setOn(true);
    kv.failNext('delete');
    expect(await backup.forgetKey(true)).toBe(false);
    expect(await secrets.getApiKey()).toBeNull();
    expect(await kv.get(KEY_NAMESPACE, KEY_NAME)).toBe(API_KEY);
    expect(owed.current()).toEqual({ owed: 'delete', forgotten: true });

    // The next start, or Decaid back: the copy goes, and the key stays forgotten.
    expect(await backup.restoreIfMissing()).toBe(false);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
    expect(await secrets.getApiKey()).toBeNull();
    expect(owed.current()).toEqual({ owed: null, forgotten: true });
  });

  it('keeps the delete owed, and restores nothing, while Decaid still does not take it', async () => {
    const kv = createMemoryKv({ [KEY_NAMESPACE]: { [KEY_NAME]: API_KEY } });
    const secrets = memorySecrets(null);
    const owed = memoryKeyCopy({ owed: 'delete', forgotten: true });
    kv.failNext('delete');
    expect(await createKeyBackup(kv, secrets, owed).restoreIfMissing()).toBe(false);
    expect(await secrets.getApiKey()).toBeNull();
    expect(owed.current()).toEqual({ owed: 'delete', forgotten: true });
  });

  it('a key forgotten here never comes back from a copy in Decaid, until a key is saved here or the switch is turned on', async () => {
    // Another device keeps its copy there.
    const kv = createMemoryKv({ [KEY_NAMESPACE]: { [KEY_NAME]: API_KEY } });
    const secrets = memorySecrets(API_KEY);
    const backup = createKeyBackup(kv, secrets, memoryKeyCopy());
    expect(await backup.forgetKey(false)).toBe(true);
    expect(await backup.restoreIfMissing()).toBe(false);
    expect(await secrets.getApiKey()).toBeNull();

    // A key saved here ends that: a key lost later (storage cleared) comes back again.
    await backup.saveKey(NEW_KEY, false);
    await secrets.forgetApiKey();
    expect(await backup.restoreIfMissing()).toBe(true);
    expect(await secrets.getApiKey()).toBe(API_KEY);

    // So does turning the switch on.
    await backup.forgetKey(false);
    expect(await backup.restoreIfMissing()).toBe(false);
    await backup.setOn(true);
    expect(await backup.restoreIfMissing()).toBe(true);
  });

  it('a key saved while Decaid is away owes the copy, and the new key replaces the old one once Decaid is back', async () => {
    const kv = createMemoryKv({ [KEY_NAMESPACE]: { [KEY_NAME]: API_KEY } });
    const secrets = memorySecrets(API_KEY);
    const owed = memoryKeyCopy();
    const backup = createKeyBackup(kv, secrets, owed);
    kv.failNext('set');
    expect(await backup.saveKey(NEW_KEY, true)).toBe(false);
    expect(await secrets.getApiKey()).toBe(NEW_KEY);
    expect(await kv.get(KEY_NAMESPACE, KEY_NAME)).toBe(API_KEY);
    expect(owed.current()).toEqual({ owed: 'copy', forgotten: false });

    expect(await backup.restoreIfMissing()).toBe(false);
    expect(await kv.get(KEY_NAMESPACE, KEY_NAME)).toBe(NEW_KEY);
    expect(owed.current()).toEqual({ owed: null, forgotten: false });
  });

  it('turning the switch off settles whatever was owed', async () => {
    const kv = createMemoryKv({ [KEY_NAMESPACE]: { [KEY_NAME]: API_KEY } });
    const owed = memoryKeyCopy({ owed: 'delete', forgotten: true });
    await createKeyBackup(kv, memorySecrets(null), owed).setOn(false);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
    expect(owed.current()).toEqual({ owed: null, forgotten: true });
  });

  it('one change at a time: a restore that was under way never puts the old key over a key saved meanwhile', async () => {
    const kv = createMemoryKv({ [KEY_NAMESPACE]: { [KEY_NAME]: API_KEY } });
    let answer: () => void = () => undefined;
    const slow: KvClient = {
      ...kv,
      get: async <T>(namespace: string, key: string) => {
        await new Promise<void>((resolve) => (answer = resolve));
        return kv.get<T>(namespace, key);
      },
    };
    const secrets = memorySecrets(null);
    const backup = createKeyBackup(slow, secrets, memoryKeyCopy());
    const restoring = backup.restoreIfMissing();
    const saving = backup.saveKey(NEW_KEY, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer();
    expect(await restoring).toBe(true);
    expect(await saving).toBe(true);
    expect(await secrets.getApiKey()).toBe(NEW_KEY);
  });

  it('a key that cannot be saved or forgotten here throws before anything goes to Decaid', async () => {
    const kv = createMemoryKv();
    const failing: SecretStore = {
      getApiKey: async () => API_KEY,
      setApiKey: async () => {
        throw new Error('Could not save the API key on this device. Try again.');
      },
      forgetApiKey: async () => {
        throw new Error('Could not remove the API key from this device. Try again.');
      },
    };
    const backup = createKeyBackup(kv, failing, memoryKeyCopy());
    await expect(backup.saveKey(NEW_KEY, true)).rejects.toThrow('Could not save the API key on this device. Try again.');
    await expect(backup.forgetKey(true)).rejects.toThrow('Could not remove the API key from this device. Try again.');
    expect(kv.writes()).toEqual([]);
  });

  it('never keeps the key in what it remembers', async () => {
    const kv = createMemoryKv();
    const owed = memoryKeyCopy();
    const backup = createKeyBackup(kv, memorySecrets(API_KEY), owed);
    kv.failNext('set');
    await backup.saveKey(NEW_KEY, true);
    expect(JSON.stringify(owed.current())).not.toContain('sk-ant-');
    kv.failNext('delete');
    await backup.forgetKey(true);
    expect(JSON.stringify(owed.current())).not.toContain('sk-ant-');
  });
});
