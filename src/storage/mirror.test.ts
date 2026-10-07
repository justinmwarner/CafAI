// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/settings-mirror.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest; the whole cafai KV mirror (debounce, size limits, pull) instead of one settings key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_MAX_BYTES,
  conversationKey,
  DecaidKvMirror,
  isValidKvKey,
  KV_NAMESPACE,
  PAGE_TARGET_BYTES,
  VALUE_MAX_BYTES,
  type MirrorSnapshot,
  type MirrorSource,
} from './mirror.ts';
import { DEFAULT_APPEARANCE } from './settings.ts';
import { createMemoryKv, type MemoryKv } from './testing/memoryKv.ts';
import {
  API_KEY,
  MODEL,
  makeBag,
  makeConversation,
  makeIteration,
  makeSettings,
  makeVersion,
} from './testing/fixtures.ts';
import { clone } from '../util/clone.ts';
import { newId } from '../util/id.ts';
import type { IterationRecord } from './types.ts';

const NOW = new Date('2026-10-03T09:30:00.000Z');
const KEY_PATTERN = /^[a-z0-9._-]+$/;
const mirrors: DecaidKvMirror[] = [];

afterEach(() => {
  for (const mirror of mirrors.splice(0)) mirror.dispose();
  vi.useRealTimers();
});

function memorySource(seed: Partial<MirrorSnapshot> = {}) {
  const state = {
    snapshot: { settings: makeSettings(), bags: [], versions: [], iterations: [], conversations: [], ...seed } as MirrorSnapshot,
    apiKey: null as string | null,
    reads: 0,
  };
  const source: MirrorSource = {
    read: async () => {
      state.reads += 1;
      return clone(state.snapshot);
    },
    apiKey: async () => state.apiKey,
  };
  return { state, source };
}

function makeMirror(kv: MemoryKv, source: MirrorSource, options: { debounceMs?: number; retryMs?: number } = {}) {
  const mirror = new DecaidKvMirror({ kv, source, appVersion: '1.2.3', defaultModel: MODEL, now: () => NOW, ...options });
  mirrors.push(mirror);
  return mirror;
}

function fullSnapshot(): Partial<MirrorSnapshot> {
  return {
    settings: makeSettings({ grinderName: 'Niche Zero', activeBagId: 'bag_kiambu' }),
    bags: [makeBag()],
    versions: [makeVersion()],
    iterations: [makeIteration()],
    conversations: [makeConversation()],
  };
}

describe('push', () => {
  it('writes meta, settings, bags, versions, iterations and one conv key per conversation', async () => {
    const kv = createMemoryKv();
    const { source } = memorySource(fullSnapshot());
    await makeMirror(kv, source).pushNow();
    const values = kv.values();
    expect(Object.keys(values).sort()).toEqual(['bags', 'conv.bag_kiambu', 'iterations', 'meta', 'settings', 'versions']);
    expect(values['meta']).toEqual({
      schemaVersion: 1,
      appVersion: '1.2.3',
      updatedAt: NOW.toISOString(),
      pages: { bags: 1, versions: 1, iterations: 1 },
      skipped: [],
    });
    expect(values['settings']).toEqual(makeSettings({ grinderName: 'Niche Zero', activeBagId: 'bag_kiambu' }));
    expect(values['bags']).toEqual([makeBag()]);
    expect(values['versions']).toEqual([makeVersion()]);
    expect(values['conv.bag_kiambu']).toEqual(makeConversation());
  });

  it('writes only the cafai namespace, with keys of [a-z0-9._-]', async () => {
    const kv = createMemoryKv();
    const odd = makeBag({ id: 'Bag.One/2', conversationId: 'conv_odd' });
    const { source } = memorySource({
      ...fullSnapshot(),
      bags: [makeBag(), odd],
      conversations: [makeConversation(), makeConversation({ id: 'conv_odd', bagId: odd.id })],
    });
    await makeMirror(kv, source).pushNow();
    expect(KV_NAMESPACE).toBe('cafai');
    expect(kv.calls.every((call) => call.namespace === 'cafai')).toBe(true);
    const keys = kv.writes('set').map((call) => call.key ?? '');
    expect(keys.length).toBeGreaterThan(6);
    for (const key of keys) expect(key).toMatch(KEY_PATTERN);
  });

  it('mirrors iteration summaries without the series', async () => {
    const kv = createMemoryKv();
    const { source } = memorySource(fullSnapshot());
    await makeMirror(kv, source).pushNow();
    const [mirrored] = kv.values()['iterations'] as IterationRecord[];
    const { series: _series, ...summary } = makeIteration().summary!;
    expect(mirrored).toEqual({ ...makeIteration(), summary });
  });

  it('debounces a burst of changes into one push, 2 s after the last change', async () => {
    vi.useFakeTimers();
    const kv = createMemoryKv();
    const { source, state } = memorySource();
    const mirror = makeMirror(kv, source);
    for (let i = 0; i < 5; i += 1) {
      state.snapshot.bags.push(makeBag({ id: `bag_${i}` }));
      mirror.schedulePush();
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(1499);
    expect(state.reads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await mirror.settled();
    expect(state.reads).toBe(1);
    expect(kv.writes('set').filter((call) => call.key === 'bags')).toHaveLength(1);
    expect(kv.values()['bags']).toHaveLength(5);
  });

  it('skips keys whose JSON has not changed, and writes nothing when nothing changed', async () => {
    const kv = createMemoryKv();
    const { source, state } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source);
    await mirror.pushNow();
    const before = kv.writes().length;

    state.snapshot.settings = makeSettings({ grinderName: 'Lagom 01', activeBagId: 'bag_kiambu' });
    await mirror.pushNow();
    expect(kv.writes().slice(before).map((call) => call.key)).toEqual(['settings', 'meta']);

    const after = kv.writes().length;
    await mirror.pushNow();
    expect(kv.writes().length).toBe(after);
  });

  it('starts a session from what Decaid already holds, rewriting only what differs', async () => {
    const kv = createMemoryKv();
    const { source } = memorySource(fullSnapshot());
    await makeMirror(kv, source).pushNow();
    const before = kv.writes().length;
    // A new page load: a fresh mirror over the same data and the same store.
    await makeMirror(kv, source).pushNow();
    expect(kv.writes().length).toBe(before);
  });

  it('skips a conversation over 512 KiB, notes it in meta, and writes it again once it fits', async () => {
    const kv = createMemoryKv();
    const huge = makeConversation({
      apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(CONVERSATION_MAX_BYTES) }] }],
    });
    const { source, state } = memorySource({ ...fullSnapshot(), conversations: [huge] });
    const mirror = makeMirror(kv, source);
    await mirror.pushNow();
    expect(kv.values()['conv.bag_kiambu']).toBeUndefined();
    expect(kv.values()['meta']).toMatchObject({ skipped: ['conv.bag_kiambu'] });
    expect(kv.values()['bags']).toEqual([makeBag()]);

    state.snapshot.conversations = [makeConversation()];
    await mirror.pushNow();
    expect(kv.values()['conv.bag_kiambu']).toEqual(makeConversation());
    expect(kv.values()['meta']).toMatchObject({ skipped: [] });
  });

  it('splits a long list into pages under the size limit', async () => {
    const kv = createMemoryKv();
    const iterations = Array.from({ length: 300 }, (_, i) =>
      makeIteration({ id: `it_${String(i).padStart(3, '0')}`, createdAt: `2026-10-01T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}.000Z` }),
    );
    const { source } = memorySource({ iterations });
    await makeMirror(kv, source).pushNow();
    const texts = kv.texts();
    const pageKeys = Object.keys(texts).filter((key) => /^iterations(\.\d+)?$/.test(key));
    expect(pageKeys.length).toBeGreaterThan(1);
    expect(kv.values()['meta']).toMatchObject({ pages: { iterations: pageKeys.length } });
    for (const key of pageKeys) {
      const bytes = new TextEncoder().encode(texts[key]).length;
      expect(bytes).toBeLessThanOrEqual(PAGE_TARGET_BYTES);
      expect(bytes).toBeLessThan(VALUE_MAX_BYTES);
    }
    const all = pageKeys.flatMap((key) => kv.values()[key] as IterationRecord[]);
    expect(all).toHaveLength(300);
  });

  it('deletes conversation and page keys that are gone locally, and leaves keys it does not own', async () => {
    const kv = createMemoryKv({
      cafai: { 'conv.bag_gone': makeConversation({ bagId: 'bag_gone' }), 'iterations.3': [], 'notes-from-the-future': { keep: true } },
      'dye2.reaplugin': { recipes: [] },
    });
    const { source, state } = memorySource({
      ...fullSnapshot(),
      conversations: [makeConversation(), makeConversation({ id: 'conv_b', bagId: 'bag_b' })],
    });
    const mirror = makeMirror(kv, source);
    await mirror.pushNow();
    expect(Object.keys(kv.values()).sort()).toEqual([
      'bags',
      'conv.bag_b',
      'conv.bag_kiambu',
      'iterations',
      'meta',
      'notes-from-the-future',
      'settings',
      'versions',
    ]);

    state.snapshot.conversations = [makeConversation()];
    await mirror.pushNow();
    expect(kv.values()['conv.bag_b']).toBeUndefined();
    expect(kv.values('dye2.reaplugin')).toEqual({ recipes: [] });
  });

  it('never throws: a failed push keeps the error, retries later, then clears it', async () => {
    vi.useFakeTimers();
    const kv = createMemoryKv();
    kv.failNext('set', 1, new Error('Decaid is busy. Try again in a moment.'));
    const { source } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source, { retryMs: 15_000 });
    await expect(mirror.pushNow()).resolves.toBeUndefined();
    expect(mirror.lastError).toBe('Could not back up to Decaid: Decaid is busy. Try again in a moment.');

    await vi.advanceTimersByTimeAsync(15_000);
    await mirror.settled();
    expect(mirror.lastError).toBeNull();
    expect(mirror.lastPushAt).toBe(NOW.toISOString());
    expect(Object.keys(kv.values()).sort()).toEqual(['bags', 'conv.bag_kiambu', 'iterations', 'meta', 'settings', 'versions']);
  });

  it('runs one push at a time; calls during a push share one follow-up push', async () => {
    const kv = createMemoryKv();
    const { source, state } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source);
    const first = mirror.pushNow();
    const second = mirror.pushNow();
    const third = mirror.pushNow();
    expect(third).toBe(second);
    await Promise.all([first, second, third]);
    expect(state.reads).toBe(2);
  });

  it('drops a push that was queued when it gets disposed', async () => {
    const kv = createMemoryKv();
    const { source, state } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source);
    const first = mirror.pushNow();
    const queued = mirror.pushNow();
    mirror.dispose();
    await Promise.all([first, queued]);
    expect(state.reads).toBe(1);
  });

  it('stops scheduling once disposed', async () => {
    vi.useFakeTimers();
    const kv = createMemoryKv();
    const { source, state } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source);
    mirror.dispose();
    mirror.schedulePush();
    await vi.advanceTimersByTimeAsync(10_000);
    await mirror.pushNow();
    expect(state.reads).toBe(0);
    expect(kv.calls).toEqual([]);
  });
});

describe('gate: no push before the restore check', () => {
  it('pushes nothing while the gate fails, then pushes once it passes', async () => {
    const kv = createMemoryKv();
    const { source } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source);
    let open = false;
    const gate = vi.fn(async () => {
      if (!open) throw new Error('Decaid did not answer.');
    });
    mirror.setGate(gate);
    await mirror.pushNow();
    expect(kv.writes()).toEqual([]);
    expect(mirror.lastError).toBe('Could not back up to Decaid: Decaid did not answer.');

    open = true;
    await mirror.pushNow();
    await mirror.pushNow();
    expect(gate).toHaveBeenCalledTimes(2);
    expect(kv.values()['bags']).toEqual([makeBag()]);
  });

  it('drops the gate once local data replaced everything', async () => {
    const kv = createMemoryKv();
    const { source } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source);
    const gate = vi.fn(async () => undefined);
    mirror.setGate(gate);
    mirror.noteReplaced();
    await mirror.pushNow();
    expect(gate).not.toHaveBeenCalled();
    expect(kv.values()['bags']).toEqual([makeBag()]);
  });
});

describe('the API key never reaches Decaid', () => {
  // Crema: "the settings mirror round-trips through Decaid storage"; it is one
  // key, and it never carries the API key.
  it('the settings round-trip through Decaid storage as one key, without the key', async () => {
    const kv = createMemoryKv();
    const settings = makeSettings({ model: 'claude-sonnet-5', grinderName: 'Lagom 01', grinderSetting: '0.4' });
    const { source } = memorySource({ settings });
    const mirror = makeMirror(kv, source);
    await mirror.pushNow();
    expect(kv.values()['settings']).toEqual(settings);
    expect((await mirror.pull())?.settings).toEqual(settings);
    expect(kv.texts()['settings']).not.toMatch(/apiKey/i);
  });

  // Crema: "the mirror never carries the API key, whatever is in settings".
  it('no mirrored value contains the stored API key, whatever is in the data', async () => {
    const kv = createMemoryKv();
    const { source, state } = memorySource({
      settings: { ...makeSettings({ grinderName: 'Niche' }), apiKey: API_KEY },
      bags: [makeBag({ notes: `pasted ${API_KEY}` })],
      versions: [makeVersion({ title: API_KEY })],
      iterations: [makeIteration({ feedback: { question: 'Taste?', selected: [], otherText: API_KEY } })],
      conversations: [makeConversation({ apiMessages: [{ role: 'user', content: [{ type: 'text', text: `key: ${API_KEY}` }] }] })],
    });
    state.apiKey = API_KEY;
    await makeMirror(kv, source).pushNow();
    const texts = Object.values(kv.texts());
    expect(texts.length).toBeGreaterThanOrEqual(6);
    for (const text of texts) expect(text).not.toContain(API_KEY);
    expect(kv.texts()['settings']).not.toMatch(/apiKey/i);
    expect(kv.texts()['settings']).toMatch(/Niche/);
  });

  it('keeps the key out of lastError too', async () => {
    const kv = createMemoryKv();
    kv.failNext('set', 1, new Error(`Decaid rejected ${API_KEY}`));
    const { source, state } = memorySource(fullSnapshot());
    state.apiKey = API_KEY;
    const mirror = makeMirror(kv, source);
    await mirror.pushNow();
    expect(mirror.lastError).toBeTruthy();
    expect(mirror.lastError).not.toContain(API_KEY);
  });
});

describe('pull', () => {
  it('returns null when the namespace is empty', async () => {
    const kv = createMemoryKv({ 'dye2.reaplugin': { recipes: [] } });
    expect(await makeMirror(kv, memorySource().source).pull()).toBeNull();
  });

  it('rebuilds an export from the mirrored keys; series come back empty', async () => {
    const kv = createMemoryKv();
    const { source } = memorySource(fullSnapshot());
    const mirror = makeMirror(kv, source);
    await mirror.pushNow();
    const summary = {
      ...makeIteration().summary!,
      series: { tS: [], pressure: [], flow: [], weight: [], weightFlow: [], temperature: [], targetPressure: [], targetFlow: [] },
    };
    expect(await makeMirror(kv, memorySource().source).pull()).toEqual({
      format: 'cafai-export',
      schemaVersion: 1,
      exportedAt: NOW.toISOString(),
      appVersion: '1.2.3',
      settings: makeSettings({ grinderName: 'Niche Zero', activeBagId: 'bag_kiambu' }),
      bags: [makeBag()],
      versions: [makeVersion()],
      iterations: [{ ...makeIteration(), summary }],
      conversations: [makeConversation()],
    });
  });

  it('puts paged lists back together in order', async () => {
    const kv = createMemoryKv();
    const iterations = Array.from({ length: 300 }, (_, i) =>
      makeIteration({ id: `it_${String(i).padStart(3, '0')}`, createdAt: `2026-10-01T10:00:${String(i).padStart(3, '0')}Z` }),
    );
    await makeMirror(kv, memorySource({ iterations }).source).pushNow();
    const pulled = await makeMirror(kv, memorySource().source).pull();
    expect(pulled?.iterations.map((record) => record.id)).toEqual(iterations.map((record) => record.id));
  });

  it('drops records it cannot use, and conversations of bags it does not have', async () => {
    const kv = createMemoryKv({
      cafai: {
        bags: [makeBag(), { id: 'junk' }],
        'conv.bag_kiambu': makeConversation(),
        'conv.bag_lost': makeConversation({ id: 'conv_lost', bagId: 'bag_lost' }),
        'conv.bag_junk': { hello: 'world' },
      },
    });
    const pulled = await makeMirror(kv, memorySource().source).pull();
    expect(pulled?.bags).toEqual([makeBag()]);
    expect(pulled?.conversations).toEqual([makeConversation()]);
    expect(pulled?.settings).toEqual(makeSettings());
  });

  it('carries the grinder link both ways, and restores a backup made before links as not linked', async () => {
    const kv = createMemoryKv();
    const linked = makeSettings({ grinderName: 'Niche Zero', grinderSetting: '14', grinderId: 'c0ffee00-0a5e-4c1e-8a11-000000000001' });
    await makeMirror(kv, memorySource({ settings: linked }).source).pushNow();
    expect(kv.values()['settings']).toEqual(linked);
    expect((await makeMirror(kv, memorySource().source).pull())?.settings).toEqual(linked);

    const older = { model: MODEL, grinderName: 'DF64', grinderSetting: '2.5', activeBagId: 'bag_kiambu' };
    const oldKv = createMemoryKv({ cafai: { settings: older, bags: [makeBag()] } });
    expect((await makeMirror(oldKv, memorySource().source).pull())?.settings).toEqual({ ...older, grinderId: null, appearance: DEFAULT_APPEARANCE });
  });

  it('rejects when Decaid cannot be read, so a failure never looks like an empty backup', async () => {
    const kv = createMemoryKv();
    kv.failNext('getAll');
    await expect(makeMirror(kv, memorySource().source).pull()).rejects.toThrow('Decaid is not answering.');
  });
});

describe('conversationKey', () => {
  it('keeps ids made by newId readable', () => {
    const bagId = newId('bag');
    expect(conversationKey(bagId)).toBe(`conv.${bagId}`);
    expect(isValidKvKey(conversationKey(bagId))).toBe(true);
  });

  it('escapes everything else, so different ids never share a key', () => {
    const ids = ['a', 'A', 'a.b', 'a-b', 'a_b', 'a/b', 'é', 'a.0062'];
    const keys = ids.map(conversationKey);
    expect(new Set(keys).size).toBe(ids.length);
    for (const key of keys) expect(isValidKvKey(key)).toBe(true);
  });
});

describe('restored summaries', () => {
  it('come back with an empty series instead of none', async () => {
    const { exportFromMirror } = await import('./mirror.ts');
    const restored = exportFromMirror(
      {
        meta: { schemaVersion: 1, appVersion: '0.1.0', updatedAt: '2026-10-03T08:00:00.000Z', pages: { bags: 0, versions: 0, iterations: 1 }, skipped: [] },
        iterations: [
          {
            id: 'iter-1',
            bagId: 'bag-1',
            bagName: 'Kiambu',
            profileVersionId: null,
            profileVersion: null,
            shotId: 'shot-1',
            summary: { shotId: 'shot-1', timestamp: 't', durationS: 30, channelingFlags: [], phases: [] },
            feedback: null,
            proposal: null,
            change: null,
            outcome: 'pending',
            createdAt: '2026-10-03T08:00:00.000Z',
            updatedAt: '2026-10-03T08:00:00.000Z',
          },
        ],
      },
      { appVersion: '0.1.0', defaultModel: 'claude-opus-5-5', now: () => new Date(0) },
    );
    expect(restored?.iterations[0]?.summary?.series).toEqual({
      tS: [],
      pressure: [],
      flow: [],
      weight: [],
      weightFlow: [],
      temperature: [],
      targetPressure: [],
      targetFlow: [],
    });
  });
});
