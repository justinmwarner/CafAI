/**
 * The API key's optional copy in Decaid (D99). Off by default. When on, the
 * key is kept in its own namespace, never in `cafai`, which the mirror,
 * export and import use; so the backup of CafAI's records never carries it.
 * Any device on the network can read Decaid's store, and Decaid's backups
 * include it: Settings says so where the switch is.
 */
import type { KvClient } from '../api/types.ts';
import type { SecretStore } from './types.ts';

export const KEY_NAMESPACE = 'cafai-key';
export const KEY_NAME = 'anthropic';

export interface KeyBackup {
  /** Whether Decaid holds a copy. Throws when Decaid cannot be reached. */
  isOn(): Promise<boolean>;
  /** On: copy the current key to Decaid. Off: delete the copy. */
  setOn(on: boolean): Promise<void>;
  /** After the key changes on this device: refresh the copy when it is on. Never throws. */
  keyChanged(): Promise<void>;
  /** At boot: no key here and a copy in Decaid brings it back. True when restored. Never throws. */
  restoreIfMissing(): Promise<boolean>;
}

export function createKeyBackup(kv: KvClient, secrets: SecretStore): KeyBackup {
  const stored = async () => {
    const value = await kv.get<unknown>(KEY_NAMESPACE, KEY_NAME);
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  return {
    async isOn() {
      return (await stored()) !== null;
    },
    async setOn(on) {
      if (!on) {
        await kv.delete(KEY_NAMESPACE, KEY_NAME);
        return;
      }
      const key = await secrets.getApiKey();
      if (key) await kv.set(KEY_NAMESPACE, KEY_NAME, key);
    },
    async keyChanged() {
      try {
        if ((await stored()) === null) return;
        const key = await secrets.getApiKey();
        if (key) await kv.set(KEY_NAMESPACE, KEY_NAME, key);
        else await kv.delete(KEY_NAMESPACE, KEY_NAME);
      } catch {
        // The next change or the switch tries again.
      }
    },
    async restoreIfMissing() {
      try {
        if (await secrets.getApiKey()) return false;
        const key = await stored();
        if (!key) return false;
        await secrets.setApiKey(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
