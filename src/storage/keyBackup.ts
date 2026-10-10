/**
 * The API key's optional copy in Decaid (D99). Off by default. When on, the
 * key is kept in its own namespace, never in `cafai`, which the mirror,
 * export and import use; so the backup of CafAI's records never carries it.
 * Any device on the network can read Decaid's store, and Decaid's backups
 * include it: Settings says so where the switch is.
 *
 * The choice itself (on or off) lives in Settings.keepKeyInDecaid
 * (settings.ts), mirrored like any other setting, not here: this module
 * only does the copying. Settings decides when to call setOn, so that
 * turning the choice on or off always matches whether a copy really went
 * to or came off Decaid, never a copy's own presence standing in for the
 * choice (that let the switch show on while nothing was backed up, and a
 * Forget that could not reach Decaid still say the key was gone).
 */
import type { KvClient } from '../api/types.ts';
import type { SecretStore } from './types.ts';

export const KEY_NAMESPACE = 'cafai-key';
export const KEY_NAME = 'anthropic';

export interface KeyBackup {
  /**
   * On: copy the current key to Decaid (nothing to copy is not an error).
   * Off: delete the copy. Throws on failure, e.g. Decaid unreachable; the
   * caller decides what that means for the choice (Settings) and what to
   * say about it.
   */
  setOn(on: boolean): Promise<void>;
  /** At boot: no key here and a copy in Decaid brings it back. True when restored. Never throws. */
  restoreIfMissing(): Promise<boolean>;
}

export function createKeyBackup(kv: KvClient, secrets: SecretStore): KeyBackup {
  const stored = async () => {
    const value = await kv.get<unknown>(KEY_NAMESPACE, KEY_NAME);
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  return {
    async setOn(on) {
      if (!on) {
        await kv.delete(KEY_NAMESPACE, KEY_NAME);
        return;
      }
      const key = await secrets.getApiKey();
      if (key) await kv.set(KEY_NAMESPACE, KEY_NAME, key);
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
