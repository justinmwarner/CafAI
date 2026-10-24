import { describe, expect, it } from 'vitest';
import type { KvClient } from '../api/types.ts';
import { createMemoryCoachSourceStore, type CoachSource, type CoachSourceStore } from './coachSource.ts';
import {
  COACH_SOURCE_KEY,
  COACH_SOURCE_NAMESPACE,
  createCoachSourceBackup,
  type CoachSourceChoice,
  type CoachSourceCopyState,
  type CoachSourceCopyStore,
} from './coachSourceBackup.ts';
import { createMemoryKv, type MemoryKv } from './testing/memoryKv.ts';

const COMPUTER: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };
const OTHER: CoachSource = { kind: 'computer', address: '192.168.1.30:8877', code: 'WXYZ2345' };
const ANTHROPIC: CoachSource = { ...COMPUTER, kind: 'anthropic' };
/** "Claude on my computer" chosen before an address or a code was saved: on a new origin, before the copy is back. */
const BLANK: CoachSource = { kind: 'computer', address: '', code: '' };

/** What the copy is owed, kept in a plain variable as the source's own database keeps it across a reload. */
function memoryCopyState(initial: CoachSourceCopyState = { owed: false }): CoachSourceCopyStore & { current(): CoachSourceCopyState } {
  let state = initial;
  return {
    get: async () => state,
    set: async (next) => {
      state = next;
    },
    current: () => state,
  };
}

/** Settings.keepCoachSourceInDecaid in a plain variable: unset reads as on (D230). */
function memoryChoice(initial?: boolean): CoachSourceChoice & { value: boolean | undefined; readFails: boolean; writeFails: boolean } {
  return {
    value: initial,
    readFails: false,
    writeFails: false,
    async read() {
      if (this.readFails) throw new Error('Could not read the saved data on this device. Reload the page and try again.');
      return this.value ?? true;
    },
    async write(on) {
      if (this.writeFails) throw new Error('Could not save to this device. Try again.');
      this.value = on;
    },
  };
}

interface Setup {
  kv?: MemoryKv;
  store?: CoachSourceStore;
  state?: ReturnType<typeof memoryCopyState>;
  choice?: ReturnType<typeof memoryChoice>;
}

function setup(options: Setup = {}) {
  const kv = options.kv ?? createMemoryKv();
  const store = options.store ?? createMemoryCoachSourceStore();
  const state = options.state ?? memoryCopyState();
  const choice = options.choice ?? memoryChoice();
  const backup = createCoachSourceBackup(kv, store, state, choice);
  return { kv, store, state, choice, backup };
}

const copyIn = (kv: MemoryKv) => kv.values(COACH_SOURCE_NAMESPACE);
const holding = (source: CoachSource) => createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: source } });

/** A KV whose reads wait until `release` is called: a sync caught in the middle. */
function heldKv(memory: MemoryKv): { kv: KvClient; release(): void } {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    kv: {
      ...memory,
      get: async <T>(namespace: string, key: string) => {
        await held;
        return memory.get<T>(namespace, key);
      },
    },
    release,
  };
}

describe('where the coach runs, copied in Decaid (D229)', () => {
  it('a source saved while the choice is on is copied to cafai-coach-source/current', async () => {
    const { kv, store, backup } = setup();
    expect(await backup.save(COMPUTER)).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(COACH_SOURCE_NAMESPACE).toBe('cafai-coach-source');
  });

  it('one saved while the choice is off stays on this device', async () => {
    const { kv, store, backup } = setup({ choice: memoryChoice(false) });
    expect(await backup.save(COMPUTER)).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
    expect(copyIn(kv)).toEqual({});
    expect(kv.writes()).toEqual([]);
  });

  it('with the coach back on Anthropic, Decaid holds no copy: the code leaves its store, and stays on this device', async () => {
    const { kv, store, backup } = setup();
    await backup.save(COMPUTER);
    expect(await backup.update((current) => ({ ...current, kind: 'anthropic' }))).toBe(true);
    expect(copyIn(kv)).toEqual({});
    expect(await store.get()).toEqual(ANTHROPIC);
    // And back on the computer, the copy comes back with it.
    await backup.update((current) => ({ ...current, kind: 'computer' }));
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
  });

  it('a computer with no address or code yet is nothing to copy, and never goes over the copy', async () => {
    const kv = holding(COMPUTER);
    const { store, backup } = setup({ kv });
    expect(await backup.save(BLANK)).toBe(true);
    expect(await store.get()).toEqual(BLANK);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(kv.writes()).toEqual([]);
  });

  it('setOn(true) copies what is saved here, setOn(false) deletes the copy, and each keeps the choice', async () => {
    const { kv, choice, backup } = setup({ store: createMemoryCoachSourceStore(COMPUTER), choice: memoryChoice(false) });
    await backup.setOn(true);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(choice.value).toBe(true);
    await backup.setOn(false);
    expect(copyIn(kv)).toEqual({});
    expect(choice.value).toBe(false);
  });

  it('setOn(true) copies nothing with nothing saved here, the coach on Anthropic, or no code yet', async () => {
    for (const store of [createMemoryCoachSourceStore(), createMemoryCoachSourceStore(ANTHROPIC), createMemoryCoachSourceStore(BLANK)]) {
      const { kv, backup } = setup({ store, choice: memoryChoice(false) });
      await backup.setOn(true);
      expect(copyIn(kv)).toEqual({});
    }
  });

  it('setOn throws when Decaid does not take it, and keeps the choice as it was', async () => {
    const { kv, choice, backup } = setup({ store: createMemoryCoachSourceStore(COMPUTER), choice: memoryChoice(false) });
    kv.failNext('set');
    await expect(backup.setOn(true)).rejects.toThrow('Decaid is not answering.');
    expect(copyIn(kv)).toEqual({});
    expect(choice.value).toBe(false);
    await backup.setOn(true);
    kv.failNext('delete');
    await expect(backup.setOn(false)).rejects.toThrow('Decaid is not answering.');
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(choice.value).toBe(true);
  });

  it('setOn puts Decaid back when this device cannot keep the choice, and says so', async () => {
    const { kv, choice, backup } = setup({ store: createMemoryCoachSourceStore(COMPUTER) });
    await backup.setOn(true);
    choice.writeFails = true;
    await expect(backup.setOn(false)).rejects.toThrow('Could not save to this device. Try again.');
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(choice.value).toBe(true);
    // Turning it on that the device cannot keep takes the copy back off.
    choice.value = false;
    await expect(backup.setOn(true)).rejects.toThrow('Could not save to this device. Try again.');
    expect(copyIn(kv)).toEqual({});
    expect(choice.value).toBe(false);
  });

  it('brings the copy back to a device with nothing saved: a new origin after a Decaid update', async () => {
    const kv = holding(COMPUTER);
    const store = createMemoryCoachSourceStore();
    const seen: CoachSource[] = [];
    store.subscribe((source) => seen.push(source));
    const { backup } = setup({ kv, store });
    expect(await backup.sync()).toBe(true);
    expect(await store.getSaved()).toEqual(COMPUTER);
    // Its subscribers hear of it as of any save: the coach, the usage tag, the traffic log's secrets.
    expect(seen).toEqual([COMPUTER]);
    // Brought back once: the device has its own now, and nothing went back to Decaid.
    expect(await backup.sync()).toBe(false);
    expect(kv.writes()).toEqual([]);
  });

  it('brings it back over a computer chosen with no address or code yet', async () => {
    const { store, backup } = setup({ kv: holding(COMPUTER), store: createMemoryCoachSourceStore(BLANK) });
    expect(await backup.sync()).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
  });

  it('restoreIfMissing brings it back without reading the choice, so before the settings are back', async () => {
    const choice = memoryChoice();
    choice.readFails = true;
    const { store, backup } = setup({ kv: holding(COMPUTER), choice });
    expect(await backup.restoreIfMissing()).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
    expect(await backup.restoreIfMissing()).toBe(false);
  });

  it('brings the copy back whatever this device says of the choice, as the API key comes back (D99)', async () => {
    const { store, backup } = setup({ kv: holding(COMPUTER), choice: memoryChoice(false) });
    expect(await backup.sync()).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
  });

  it('never puts the copy over a source saved here, Anthropic included', async () => {
    const kv = holding(OTHER);
    const { store, backup } = setup({ kv, store: createMemoryCoachSourceStore(ANTHROPIC) });
    expect(await backup.sync()).toBe(false);
    expect(await store.get()).toEqual(ANTHROPIC);
    // Nor does it touch another device's copy.
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: OTHER });
  });

  it('copies a source saved before there was a copy, once Decaid holds none and the choice is on', async () => {
    const { kv, backup } = setup({ store: createMemoryCoachSourceStore(COMPUTER) });
    expect(await backup.sync()).toBe(false);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });

    for (const [store, choice] of [
      [createMemoryCoachSourceStore(COMPUTER), memoryChoice(false)],
      [createMemoryCoachSourceStore(ANTHROPIC), memoryChoice()],
      [createMemoryCoachSourceStore(BLANK), memoryChoice()],
    ] as const) {
      const other = setup({ store, choice });
      await other.backup.sync();
      expect(copyIn(other.kv)).toEqual({});
    }
  });

  it('leaves a copy another device made alone', async () => {
    const kv = holding(OTHER);
    const { backup } = setup({ kv, store: createMemoryCoachSourceStore(COMPUTER) });
    await backup.sync();
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: OTHER });
    expect(kv.writes()).toEqual([]);
  });

  it("with the choice off, takes a copy of this device's code off Decaid, and leaves another code's", async () => {
    const ours = holding(COMPUTER);
    await setup({ kv: ours, store: createMemoryCoachSourceStore({ ...COMPUTER, address: '10.0.0.5:8877' }), choice: memoryChoice(false) }).backup.sync();
    expect(copyIn(ours)).toEqual({});
    const theirs = holding(OTHER);
    await setup({ kv: theirs, store: createMemoryCoachSourceStore(COMPUTER), choice: memoryChoice(false) }).backup.sync();
    expect(copyIn(theirs)).toEqual({ [COACH_SOURCE_KEY]: OTHER });
  });

  it('reads a copy the coach could not use as none', async () => {
    for (const unusable of [
      'ABCDEFGH',
      null,
      [COMPUTER],
      { kind: 'moon', address: '192.168.1.20:8877', code: 'ABCDEFGH' },
      { kind: 'computer', address: 7, code: 'ABCDEFGH' },
      BLANK,
      { ...COMPUTER, code: '' },
      { ...COMPUTER, address: 'not an address/' },
    ]) {
      const kv = createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: unusable } });
      const { store, backup } = setup({ kv });
      expect(await backup.sync()).toBe(false);
      expect(await store.getSaved()).toBeNull();
    }
  });

  it('keeps only the three fields in the copy', async () => {
    const { kv, backup } = setup();
    await backup.save({ ...COMPUTER, extra: 'nope' } as CoachSource);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
  });

  it('a change Decaid does not take is owed, and goes out at the next sync', async () => {
    const { kv, state, backup } = setup();
    kv.failNext('set');
    expect(await backup.save(COMPUTER)).toBe(false);
    expect(state.current()).toEqual({ owed: true });
    expect(copyIn(kv)).toEqual({});
    expect(await backup.sync()).toBe(false);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(state.current()).toEqual({ owed: false });
  });

  it('an owed change is what is saved here when it goes out, a switch to Anthropic included', async () => {
    const { kv, state, backup } = setup({ kv: holding(COMPUTER), store: createMemoryCoachSourceStore(COMPUTER) });
    kv.failNext('delete');
    expect(await backup.update((current) => ({ ...current, kind: 'anthropic' }))).toBe(false);
    expect(state.current()).toEqual({ owed: true });
    await backup.sync();
    expect(copyIn(kv)).toEqual({});
    expect(state.current()).toEqual({ owed: false });
  });

  it('stays owed while Decaid still does not take it, and a sync never throws', async () => {
    const { kv, state, backup } = setup();
    kv.failNext('set', 2);
    expect(await backup.save(COMPUTER)).toBe(false);
    expect(await backup.sync()).toBe(false);
    expect(state.current()).toEqual({ owed: true });
    kv.failNext('get');
    expect(await setup({ kv }).backup.sync()).toBe(false);
    await backup.sync();
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
  });

  it('keeps what is owed, and copies nothing, while the choice cannot be read', async () => {
    const choice = memoryChoice();
    const { kv, state, backup } = setup({ choice });
    choice.readFails = true;
    expect(await backup.save(COMPUTER)).toBe(true);
    expect(state.current()).toEqual({ owed: true });
    expect(await backup.sync()).toBe(false);
    expect(copyIn(kv)).toEqual({});
    expect(state.current()).toEqual({ owed: true });
    choice.readFails = false;
    await backup.sync();
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(state.current()).toEqual({ owed: false });
  });

  it("an owed change, with the choice off since, takes this device's copy off instead", async () => {
    const choice = memoryChoice();
    const { kv, state, backup } = setup({ kv: holding(COMPUTER), store: createMemoryCoachSourceStore(COMPUTER), choice });
    kv.failNext('set');
    await backup.save({ ...COMPUTER, address: '10.0.0.5:8877' });
    expect(state.current()).toEqual({ owed: true });
    // Turned off on another device, say, and merged in with the settings.
    choice.value = false;
    await backup.sync();
    expect(copyIn(kv)).toEqual({});
    expect(state.current()).toEqual({ owed: false });
  });

  it('turning the switch either way settles whatever was owed', async () => {
    const { kv, state, backup } = setup();
    kv.failNext('set');
    await backup.save(COMPUTER);
    await backup.setOn(false);
    expect(state.current()).toEqual({ owed: false });
    expect(copyIn(kv)).toEqual({});
  });

  it('one change at a time: a sync under way never puts the copy over a source saved meanwhile', async () => {
    const memory = holding(COMPUTER);
    const { kv, release } = heldKv(memory);
    const store = createMemoryCoachSourceStore();
    const backup = createCoachSourceBackup(kv, store, memoryCopyState(), memoryChoice());
    const syncing = backup.sync();
    const saving = backup.save(OTHER);
    release();
    expect(await syncing).toBe(true);
    expect(await saving).toBe(true);
    expect(await store.get()).toEqual(OTHER);
    expect(memory.values(COACH_SOURCE_NAMESPACE)).toEqual({ [COACH_SOURCE_KEY]: OTHER });
  });

  it('a choice of the computer made while the copy was on its way keeps the address and code it brought', async () => {
    const memory = holding(COMPUTER);
    const { kv, release } = heldKv(memory);
    const store = createMemoryCoachSourceStore();
    const backup = createCoachSourceBackup(kv, store, memoryCopyState(), memoryChoice());
    // A new origin: Settings shows Anthropic, and the user taps Claude on my computer while Decaid answers.
    const syncing = backup.sync();
    const choosing = backup.update((current) => ({ ...current, kind: 'computer' }));
    release();
    await Promise.all([syncing, choosing]);
    expect(await store.get()).toEqual(COMPUTER);
    expect(memory.values(COACH_SOURCE_NAMESPACE)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
  });

  it('a source that cannot be saved here throws before anything goes to Decaid', async () => {
    const failing: CoachSourceStore = {
      ...createMemoryCoachSourceStore(),
      set: () => Promise.reject(new Error('Could not save where the coach runs on this device. Try again.')),
    };
    const { kv, backup } = setup({ store: failing });
    await expect(backup.save(COMPUTER)).rejects.toThrow('Could not save where the coach runs on this device. Try again.');
    expect(kv.writes()).toEqual([]);
  });

  it('never writes to the cafai namespace the mirror, export and import use', async () => {
    const { kv, backup } = setup();
    await backup.save(COMPUTER);
    await backup.setOn(true);
    await backup.sync();
    await backup.save(ANTHROPIC);
    await backup.setOn(false);
    await backup.restoreIfMissing();
    expect(kv.calls.every((call) => call.namespace === COACH_SOURCE_NAMESPACE)).toBe(true);
    expect(kv.calls.length).toBeGreaterThan(0);
  });
});
