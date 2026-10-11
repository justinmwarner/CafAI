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
 *
 * Every change to the key on this device goes through here, one at a time,
 * so the copy follows it: a key saved while the choice is on is copied, and
 * Forget deletes the copy. What Decaid did not take is owed (KeyCopyState,
 * kept beside the key on this device only) and goes out whenever Decaid may
 * be back, before anything is restored from it. A key forgotten here never
 * comes back from a copy in Decaid, until a key is saved here or the switch
 * is turned on again.
 */
import type { KvClient } from '../api/types.ts';
import type { SecretStore } from './types.ts';

export const KEY_NAMESPACE = 'cafai-key';
export const KEY_NAME = 'anthropic';

/** What this device still owes the key's copy in Decaid. It never holds the key. */
export interface KeyCopyState {
  /** A copy or a delete Decaid did not take, sent again when Decaid may be back. */
  owed: 'copy' | 'delete' | null;
  /** The key was forgotten here: no copy in Decaid brings it back until a key is saved here or the switch is turned on. */
  forgotten: boolean;
}

/** Where KeyCopyState is kept: on this device only, beside the key (secrets.ts), never mirrored, exported or imported. */
export interface KeyCopyStore {
  get(): Promise<KeyCopyState>;
  set(state: KeyCopyState): Promise<void>;
}

export interface KeyBackup {
  /**
   * The switch. On: copy the current key to Decaid (nothing to copy is not
   * an error); a forgotten key may come back again. Off: delete the copy.
   * Either way nothing is owed after it. Throws on failure, e.g. Decaid
   * unreachable; the caller decides what that means for the choice
   * (Settings) and what to say about it.
   */
  setOn(on: boolean): Promise<void>;
  /**
   * Save the key on this device (throws a sentence when that fails), and
   * with `copy` (the choice is on) copy it to Decaid. False when Decaid did
   * not take the copy: it is owed, and goes out when Decaid may be back.
   */
  saveKey(key: string, copy: boolean): Promise<boolean>;
  /**
   * Forget the key on this device for good (throws a sentence when that
   * fails), and with `deleteCopy` (the choice is on) delete the copy in
   * Decaid. False when Decaid could not be reached: the delete is owed.
   */
  forgetKey(deleteCopy: boolean): Promise<boolean>;
  /**
   * Whenever Decaid may answer (start-up, each try of the late restore,
   * Decaid back): send what is owed, then, with no key here and none
   * forgotten, bring Decaid's copy back. True when a key was restored.
   * Never throws.
   */
  restoreIfMissing(): Promise<boolean>;
}

export function createKeyBackup(kv: KvClient, secrets: SecretStore, state: KeyCopyStore): KeyBackup {
  const stored = async () => {
    const value = await kv.get<unknown>(KEY_NAMESPACE, KEY_NAME);
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const copy = async () => {
    const key = await secrets.getApiKey();
    if (key) await kv.set(KEY_NAMESPACE, KEY_NAME, key);
  };
  const remove = () => kv.delete(KEY_NAMESPACE, KEY_NAME);
  /**
   * Change what is owed. It sits in the key's own database, which has just
   * taken (or dropped) the key, so it fails only when that store does; a
   * change it could not read or write is left as it was, never a reason to
   * call the key unsaved.
   */
  async function update(change: (now: KeyCopyState) => KeyCopyState): Promise<void> {
    try {
      await state.set(change(await state.get()));
    } catch {
      // Kept as it was.
    }
  }

  // One change at a time: a restore in the background never lands between a key saved here and its copy.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    setOn: (on) =>
      inTurn(async () => {
        await (on ? copy() : remove());
        await update((now) => ({ owed: null, forgotten: on ? false : now.forgotten }));
      }),
    saveKey: (key, copyIt) =>
      inTurn(async () => {
        await secrets.setApiKey(key);
        if (!copyIt) {
          await update((now) => ({ ...now, forgotten: false }));
          return true;
        }
        // Owed until Decaid has it, so a page unloaded meanwhile sends it next time.
        await update(() => ({ owed: 'copy', forgotten: false }));
        try {
          await copy();
        } catch {
          return false;
        }
        await update(() => ({ owed: null, forgotten: false }));
        return true;
      }),
    forgetKey: (deleteCopy) =>
      inTurn(async () => {
        // Marked before the key goes, so a page unloaded at any point after never takes the copy back
        // (and harmless if the key stays: only a device without one restores).
        await update((now) => ({ ...now, forgotten: true }));
        await secrets.forgetApiKey();
        await update(() => ({ owed: deleteCopy ? 'delete' : null, forgotten: true }));
        if (!deleteCopy) return true;
        try {
          await remove();
        } catch {
          return false;
        }
        await update(() => ({ owed: null, forgotten: true }));
        return true;
      }),
    restoreIfMissing: () =>
      inTurn(async () => {
        try {
          const now = await state.get();
          if (now.owed !== null) {
            await (now.owed === 'copy' ? copy() : remove());
            await state.set({ ...now, owed: null });
          }
          if (now.forgotten || (await secrets.getApiKey())) return false;
          const key = await stored();
          if (!key) return false;
          await secrets.setApiKey(key);
          return true;
        } catch {
          return false;
        }
      }),
  };
}
