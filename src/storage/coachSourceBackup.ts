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
 * it survives the move too, and unset reads as on. The copy is what is saved
 * on this device while the coach runs on the computer, in a namespace of its
 * own, never in `cafai`, which the mirror, export and import use, so no
 * backup file carries the code. With the coach on Anthropic, Decaid holds no
 * copy: there is nothing worth keeping, and the code leaves Decaid's store
 * once it is not used. Any device on the network can read Decaid's store,
 * and Decaid's backups include it: Settings says so where the switch is.
 *
 * Every save of the source goes through here, one at a time, so the copy
 * follows it. What Decaid did not take is owed (CoachSourceCopyState, kept
 * beside the source on this device only) and goes out whenever Decaid may be
 * back. A device with nothing saved takes Decaid's copy, as a device with no
 * API key takes the key's (D99); one with a source of its own copies it when
 * Decaid holds none, so a source saved before there was a copy gets one, and
 * another device's copy is left alone.
 */
import type { KvClient } from '../api/types.ts';
import type { CoachSource, CoachSourceStore } from './coachSource.ts';

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

export interface CoachSourceBackup {
  /**
   * The switch. On: copy what is saved here (nothing to copy is not an
   * error). Off: delete the copy. Either way nothing is owed after it.
   * Throws when Decaid does not take it; the caller decides what that means
   * for the choice (Settings) and what to say about it.
   */
  setOn(on: boolean): Promise<void>;
  /**
   * Save the source on this device (throws a sentence when that fails) and,
   * with the choice on, bring the copy in line with it. False when Decaid did
   * not take that: it is owed, and goes out when Decaid may be back.
   */
  save(source: CoachSource): Promise<boolean>;
  /**
   * Whenever Decaid may answer (start-up, each try of the late restore,
   * Decaid back): send what is owed; then, with nothing saved here, bring
   * Decaid's copy back, or, with a source of its own on the computer and
   * the choice on, copy it when Decaid holds none. True when a source was
   * brought back. Never throws.
   */
  sync(): Promise<boolean>;
}

/** Decaid's copy as a source, or null when it holds none CafAI can use. */
function readCopy(value: unknown): CoachSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { address, code } = record;
  if (record['kind'] !== 'computer' || typeof address !== 'string' || typeof code !== 'string') return null;
  return { kind: 'computer', address, code };
}

/**
 * The copy for the source of `store`, kept in `kv`. `keepOn` reads the
 * choice (Settings.keepCoachSourceInDecaid, on when unset); a choice that
 * cannot be read copies nothing.
 */
export function createCoachSourceBackup(
  kv: KvClient,
  store: CoachSourceStore,
  state: CoachSourceCopyStore,
  keepOn: () => Promise<boolean>,
): CoachSourceBackup {
  const stored = async () => readCopy(await kv.get<unknown>(COACH_SOURCE_NAMESPACE, COACH_SOURCE_KEY));
  /** Decaid's copy brought in line with what is saved here: the source while the coach runs on the computer, none otherwise. */
  const follow = async () => {
    const here = await store.getSaved();
    if (here?.kind === 'computer') {
      await kv.set(COACH_SOURCE_NAMESPACE, COACH_SOURCE_KEY, { kind: here.kind, address: here.address, code: here.code });
    } else {
      await kv.delete(COACH_SOURCE_NAMESPACE, COACH_SOURCE_KEY);
    }
  };
  const isOn = () => keepOn().catch(() => false);
  /** What is owed sits beside the source, which has just been saved; one that cannot be written is left as it was. */
  async function owe(owed: boolean): Promise<void> {
    try {
      await state.set({ owed });
    } catch {
      // Kept as it was.
    }
  }

  // One change at a time: a copy brought back never lands between a source saved here and its copy.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    setOn: (on) =>
      inTurn(async () => {
        await (on ? follow() : kv.delete(COACH_SOURCE_NAMESPACE, COACH_SOURCE_KEY));
        await owe(false);
      }),
    save: (source) =>
      inTurn(async () => {
        await store.set(source);
        if (!(await isOn())) return true;
        // Owed until Decaid has it, so a page unloaded meanwhile sends it next time.
        await owe(true);
        try {
          await follow();
        } catch {
          return false;
        }
        await owe(false);
        return true;
      }),
    sync: () =>
      inTurn(async () => {
        try {
          if ((await state.get()).owed) {
            // Turned off since: the switch took the copy off, and nothing goes there now.
            if (await isOn()) await follow();
            await state.set({ owed: false });
          }
          const here = await store.getSaved();
          if (here === null) {
            const copy = await stored();
            if (copy === null) return false;
            await store.set(copy);
            return true;
          }
          if (here.kind === 'computer' && (await isOn()) && (await stored()) === null) await follow();
          return false;
        } catch {
          return false;
        }
      }),
  };
}
