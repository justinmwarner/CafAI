/**
 * Where the coach runs, copied in Decaid (D229), so that a Decaid update does
 * not lose it. Decaid serves a skin from an origin of its own, a port it
 * derives from the skin folder's full path, and an iPad's Decaid update moves
 * that folder: CafAI then starts on a new origin, with empty browser storage
 * (docs/upstream/decaid-skin-origin-ios.md). The mirror brings CafAI's records
 * back from Decaid's store, but where the coach runs lives only in the
 * device's own database (coachSource.ts), so the choice, the bridge's address
 * and its code were gone. This copy brings them back.
 *
 * On unless the user turns it off: the choice lives in
 * Settings.keepCoachSourceInDecaid (settings.ts), mirrored like any setting so
 * it survives the move too, and unset reads as on (D230). The copy is what is
 * saved on this device while the coach runs on the computer with an address
 * and a code, in a namespace of its own, never in `cafai`, which the mirror,
 * export and import use, so no backup file carries the code. With the coach
 * on Anthropic, Decaid holds no copy: there is nothing worth keeping, and the
 * code leaves Decaid's store once it is not used. A computer chosen with no
 * address or code yet is nothing to copy, and changes no copy. Any device on
 * the network can read Decaid's store, and Decaid's backups include it:
 * Settings says so where the switch is.
 *
 * Every change to the source goes through here, one at a time, so the copy
 * follows it. What Decaid did not take is owed (CoachSourceCopyState, kept
 * beside the source on this device only) and goes out whenever Decaid may be
 * back. A device with nothing it can use saved takes Decaid's copy, as a
 * device with no API key takes the key's (D99). A sync copies a source of its
 * own when Decaid holds none, so a source saved before there was a copy gets
 * one, and with the choice off it takes a copy of this device's code off
 * Decaid; it never replaces another device's copy. Whatever reads the choice
 * waits for Decaid's backup when that is still to come back (createServices.ts),
 * as it may bring back a choice made before a move.
 */
import type { KvClient } from '../api/types.ts';
import { normalizeAddress, normalizeCode, type CoachSource, type CoachSourceStore } from './coachSource.ts';

export const COACH_SOURCE_NAMESPACE = 'cafai-coach-source';
export const COACH_SOURCE_KEY = 'current';

/** What this device still owes the copy in Decaid. It never holds the source. */
export interface CoachSourceCopyState {
  /** A change Decaid did not take: its copy is brought in line with what is saved here when Decaid may be back. */
  owed: boolean;
}

/** Where CoachSourceCopyState is kept: beside the source (coachSource.ts), never mirrored, exported or imported. */
export interface CoachSourceCopyStore {
  get(): Promise<CoachSourceCopyState>;
  set(state: CoachSourceCopyState): Promise<void>;
}

/** The choice to keep the copy (Settings.keepCoachSourceInDecaid). */
export interface CoachSourceChoice {
  /** The choice as this device holds it, on while none was made (D230). Throws when it cannot be read. */
  read(): Promise<boolean>;
  /** Keeps a choice made on this device. */
  write(on: boolean): Promise<void>;
}

export interface CoachSourceBackup {
  /**
   * The switch. On: copy what is saved here (nothing to copy is not an
   * error). Off: delete the copy. The choice is kept in the same turn, so
   * nothing in between reads the old one; when the device cannot keep it,
   * Decaid is put back as it was, as far as it can be, and that error is
   * thrown. Throws Decaid's error when Decaid does not take the change; the
   * caller says what that means for the choice (Settings).
   */
  setOn(on: boolean): Promise<void>;
  /**
   * Save `change` of what is saved now on this device (throws a sentence when
   * that fails) and, with the choice on, bring the copy in line with it. False
   * when Decaid did not take that: it is owed, and goes out when Decaid may be
   * back. In its turn, so a change of the kind alone keeps an address and a
   * code brought back meanwhile.
   */
  update(change: (current: CoachSource) => CoachSource): Promise<boolean>;
  /** update() with the whole source. */
  save(source: CoachSource): Promise<boolean>;
  /**
   * With nothing saved here that the coach can use, bring Decaid's copy
   * back. Reads no choice, so it is safe before Decaid's backup is back.
   * True when a source came back. Never throws.
   */
  restoreIfMissing(): Promise<boolean>;
  /**
   * Whenever Decaid may answer and the settings are back (start-up after the
   * backup, each try of the late restore, Decaid back): send what is owed,
   * bring the copy back as restoreIfMissing() does, and then, with the choice
   * on, copy a source of this device's own when Decaid holds none, or, with
   * it off, take a copy of this device's code off Decaid. With the choice
   * unreadable nothing is owed or copied, and nothing owed is dropped. True
   * when a source was brought back. Never throws.
   */
  sync(): Promise<boolean>;
}

/** A computer source the coach can use: an address and a code that read. */
function usable(source: CoachSource): boolean {
  return source.kind === 'computer' && normalizeAddress(source.address).ok && normalizeCode(source.code).ok;
}

/** Decaid's copy as a source, or null when it holds none the coach could use. */
function readCopy(value: unknown): CoachSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { address, code } = record;
  if (record['kind'] !== 'computer' || typeof address !== 'string' || typeof code !== 'string') return null;
  const copy: CoachSource = { kind: 'computer', address, code };
  return usable(copy) ? copy : null;
}

/**
 * The copy for the source of `store`, kept in `kv`. `choice` reads and keeps
 * Settings.keepCoachSourceInDecaid; a choice that cannot be read copies
 * nothing.
 */
export function createCoachSourceBackup(
  kv: KvClient,
  store: CoachSourceStore,
  state: CoachSourceCopyStore,
  choice: CoachSourceChoice,
): CoachSourceBackup {
  const stored = async () => readCopy(await kv.get<unknown>(COACH_SOURCE_NAMESPACE, COACH_SOURCE_KEY));
  const remove = () => kv.delete(COACH_SOURCE_NAMESPACE, COACH_SOURCE_KEY);
  /**
   * Decaid's copy brought in line with what is saved here: the source while
   * the coach runs on the computer, none on Anthropic. Nothing saved, or a
   * computer without an address or a code, changes nothing.
   */
  const follow = async () => {
    const here = await store.getSaved();
    if (here === null) return;
    if (here.kind !== 'computer') return remove();
    if (usable(here)) await kv.set(COACH_SOURCE_NAMESPACE, COACH_SOURCE_KEY, { kind: here.kind, address: here.address, code: here.code });
  };
  /** With the choice off: Decaid's copy goes when it holds this device's code, so another bridge's copy stays. */
  const removeOurs = async () => {
    const here = await store.getSaved();
    if (here === null || here.code === '') return;
    const copy = await stored();
    if (copy !== null && copy.code === here.code) await remove();
  };
  /** The choice, or null when it cannot be read. */
  const readChoice = () => choice.read().catch(() => null);
  /** What is owed sits beside the source, which has just been saved; one that cannot be written is left as it was. */
  async function owe(owed: boolean): Promise<void> {
    try {
      await state.set({ owed });
    } catch {
      // Kept as it was.
    }
  }
  /** Decaid's copy, for a device with nothing saved that the coach can use (the kind alone is not enough). */
  async function bringBack(): Promise<boolean> {
    const here = await store.getSaved();
    if (here !== null && (here.kind !== 'computer' || usable(here))) return false;
    const copy = await stored();
    if (copy === null) return false;
    await store.set(copy);
    return true;
  }

  // One change at a time: a copy brought back never lands between a source saved here and its copy.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  const update: CoachSourceBackup['update'] = (change) =>
    inTurn(async () => {
      await store.set(change(await store.get()));
      const on = await readChoice();
      if (on === false) return true;
      // Owed until Decaid has it, so a page unloaded meanwhile sends it next time;
      // with the choice unreadable, the next sync that can read it decides.
      await owe(true);
      if (on === null) return true;
      try {
        await follow();
      } catch {
        return false;
      }
      await owe(false);
      return true;
    });

  return {
    setOn: (on) =>
      inTurn(async () => {
        await (on ? follow() : remove());
        try {
          await choice.write(on);
        } catch (error) {
          await (on ? remove() : follow()).catch(() => undefined);
          throw error;
        }
        await owe(false);
      }),
    update,
    save: (source) => update(() => source),
    restoreIfMissing: () => inTurn(() => bringBack().catch(() => false)),
    sync: () =>
      inTurn(async () => {
        try {
          const on = await readChoice();
          if (on !== null && (await state.get()).owed) {
            await (on ? follow() : removeOurs());
            await state.set({ owed: false });
          }
          if (await bringBack()) return true;
          if (on === true) {
            const here = await store.getSaved();
            if (here !== null && usable(here) && (await stored()) === null) await follow();
          } else if (on === false) {
            await removeOurs();
          }
          return false;
        } catch {
          return false;
        }
      }),
  };
}
