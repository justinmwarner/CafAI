import { describe, expect, it } from 'vitest';
import type { KvClient } from '../api/types.ts';
import { createMemoryCoachSourceStore, type CoachSource, type CoachSourceStore } from './coachSource.ts';
import {
  COACH_SOURCE_KEY,
  COACH_SOURCE_NAMESPACE,
  createCoachSourceBackup,
  type CoachSourceCopyState,
  type CoachSourceCopyStore,
} from './coachSourceBackup.ts';
import { createMemoryKv, type MemoryKv } from './testing/memoryKv.ts';

const COMPUTER: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };
const OTHER: CoachSource = { kind: 'computer', address: '192.168.1.30:8877', code: 'WXYZ2345' };
const ANTHROPIC: CoachSource = { ...COMPUTER, kind: 'anthropic' };

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

interface Setup {
  kv?: MemoryKv;
  store?: CoachSourceStore;
  state?: ReturnType<typeof memoryCopyState>;
  /** Settings.keepCoachSourceInDecaid as read: on unless said otherwise. */
  keepOn?: () => Promise<boolean>;
}

function setup(options: Setup = {}) {
  const kv = options.kv ?? createMemoryKv();
  const store = options.store ?? createMemoryCoachSourceStore();
  const state = options.state ?? memoryCopyState();
  const backup = createCoachSourceBackup(kv, store, state, options.keepOn ?? (async () => true));
  return { kv, store, state, backup };
}

const copyIn = (kv: MemoryKv) => kv.values(COACH_SOURCE_NAMESPACE);

describe('where the coach runs, copied in Decaid (D229)', () => {
  it('a source saved while the choice is on is copied to cafai-coach-source/current', async () => {
    const { kv, store, backup } = setup();
    expect(await backup.save(COMPUTER)).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    expect(COACH_SOURCE_NAMESPACE).toBe('cafai-coach-source');
  });

  it('one saved while the choice is off stays on this device', async () => {
    const { kv, store, backup } = setup({ keepOn: async () => false });
    expect(await backup.save(COMPUTER)).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
    expect(copyIn(kv)).toEqual({});
    expect(kv.writes()).toEqual([]);
  });

  it('a choice that cannot be read copies nothing', async () => {
    const { kv, store, backup } = setup({ keepOn: () => Promise.reject(new Error('settings are unreadable')) });
    expect(await backup.save(COMPUTER)).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
    expect(kv.writes()).toEqual([]);
    expect(await backup.sync()).toBe(false);
    expect(kv.writes()).toEqual([]);
  });

  it('with the coach back on Anthropic, Decaid holds no copy: the code leaves its store, and stays on this device', async () => {
    const { kv, store, backup } = setup();
    await backup.save(COMPUTER);
    expect(await backup.save(ANTHROPIC)).toBe(true);
    expect(copyIn(kv)).toEqual({});
    expect(await store.get()).toEqual(ANTHROPIC);
    // And back on the computer, the copy comes back with it.
    await backup.save(COMPUTER);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
  });

  it('setOn(true) copies what is saved here, setOn(false) deletes the copy', async () => {
    const { kv, backup } = setup({ store: createMemoryCoachSourceStore(COMPUTER) });
    await backup.setOn(true);
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
    await backup.setOn(false);
    expect(copyIn(kv)).toEqual({});
  });

  it('setOn(true) copies nothing with nothing saved here, or the coach on Anthropic', async () => {
    const first = setup();
    await first.backup.setOn(true);
    expect(copyIn(first.kv)).toEqual({});
    const second = setup({ store: createMemoryCoachSourceStore(ANTHROPIC) });
    await second.backup.setOn(true);
    expect(copyIn(second.kv)).toEqual({});
  });

  it('setOn throws when Decaid does not take it, so the switch never claims a copy that is not there (or gone)', async () => {
    const { kv, backup } = setup({ store: createMemoryCoachSourceStore(COMPUTER) });
    kv.failNext('set');
    await expect(backup.setOn(true)).rejects.toThrow();
    expect(copyIn(kv)).toEqual({});
    await backup.setOn(true);
    kv.failNext('delete');
    await expect(backup.setOn(false)).rejects.toThrow();
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: COMPUTER });
  });

  it('brings the copy back to a device with nothing saved: a new origin after a Decaid update', async () => {
    const kv = createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: COMPUTER } });
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

  it('brings the copy back whatever this device says of the choice, as the API key comes back (D99)', async () => {
    const kv = createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: COMPUTER } });
    const { store, backup } = setup({ kv, keepOn: async () => false });
    expect(await backup.sync()).toBe(true);
    expect(await store.get()).toEqual(COMPUTER);
  });

  it('never puts the copy over a source saved here', async () => {
    const kv = createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: OTHER } });
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

    const off = setup({ store: createMemoryCoachSourceStore(COMPUTER), keepOn: async () => false });
    await off.backup.sync();
    expect(copyIn(off.kv)).toEqual({});

    const anthropic = setup({ store: createMemoryCoachSourceStore(ANTHROPIC) });
    await anthropic.backup.sync();
    expect(copyIn(anthropic.kv)).toEqual({});
  });

  it('leaves a copy another device made alone', async () => {
    const kv = createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: OTHER } });
    const { backup } = setup({ kv, store: createMemoryCoachSourceStore(COMPUTER) });
    await backup.sync();
    expect(copyIn(kv)).toEqual({ [COACH_SOURCE_KEY]: OTHER });
    expect(kv.writes()).toEqual([]);
  });

  it('reads a copy it cannot use as none', async () => {
    for (const unusable of ['ABCDEFGH', null, [COMPUTER], { kind: 'moon', address: '192.168.1.20:8877', code: 'ABCDEFGH' }, { kind: 'computer', address: 7, code: 'ABCDEFGH' }]) {
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

  it('a change Decaid does not take is owed, and goes out at the next sync, before anything else', async () => {
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
    const kv = createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: COMPUTER } });
    const { state, backup } = setup({ kv, store: createMemoryCoachSourceStore(COMPUTER) });
    kv.failNext('delete');
    expect(await backup.save(ANTHROPIC)).toBe(false);
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

  it('an owed change goes nowhere once the choice is off', async () => {
    let on = true;
    const { kv, state, backup } = setup({ keepOn: async () => on });
    kv.failNext('set');
    await backup.save(COMPUTER);
    on = false;
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
    const memory = createMemoryKv({ [COACH_SOURCE_NAMESPACE]: { [COACH_SOURCE_KEY]: COMPUTER } });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const kv: KvClient = {
      ...memory,
      get: async <T>(namespace: string, key: string) => {
        await held;
        return memory.get<T>(namespace, key);
      },
    };
    const store = createMemoryCoachSourceStore();
    const backup = createCoachSourceBackup(kv, store, memoryCopyState(), async () => true);
    const syncing = backup.sync();
    const saving = backup.save(ANTHROPIC);
    release();
    expect(await syncing).toBe(true);
    expect(await saving).toBe(true);
    expect(await store.get()).toEqual(ANTHROPIC);
    expect(memory.values(COACH_SOURCE_NAMESPACE)).toEqual({});
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
    expect(kv.calls.every((call) => call.namespace === COACH_SOURCE_NAMESPACE)).toBe(true);
    expect(kv.calls.length).toBeGreaterThan(0);
  });
});
