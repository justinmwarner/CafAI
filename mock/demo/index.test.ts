// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bag } from '../../src/storage/types.ts';
import { TID } from '../../src/ui/testIds.ts';
import { createDbHandle, openCafaiDb, readAll, SETTINGS_KEY, type CafaiDb } from '../../src/storage/db.ts';
import { createRepositories } from '../../src/storage/repositories.ts';
import { openSecretStore } from '../../src/storage/secrets.ts';
import { createMockDecaid } from '../decaid/state.ts';
import type { MockDecaid } from '../decaid/state.ts';
import { DEMO_API_KEY, DEMO_MARKER_KEY, GUARD_NOTE, startDemo, type DemoHost } from './index.ts';
import { judge } from './guard.ts';
import { SHOTS } from './story.ts';

const NOW = Date.UTC(2026, 9, 6, 9, 30, 0);
let run = 0;
let names: { dbName: string; secretsDbName: string };
let state: MockDecaid;
let host: DemoHost & { location: { hash: string; replaced: string[] }; storage: Map<string, string> };

function fakeHost(hash = '#/history'): typeof host {
  const storage = new Map<string, string>();
  const location = {
    pathname: '/',
    search: '?demo=1',
    hash,
    replaced: [] as string[],
    replace(url: string) {
      this.replaced.push(url);
      this.hash = url.slice(url.indexOf('#'));
    },
  };
  return {
    location,
    storage,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    document,
  };
}

async function withDb<T>(work: (db: CafaiDb) => Promise<T>): Promise<T> {
  const handle = createDbHandle((onLost) => openCafaiDb(names.dbName, onLost));
  try {
    return await work(await handle.get());
  } finally {
    handle.close();
  }
}

async function storedKey(): Promise<string | null> {
  const secrets = await openSecretStore(names.secretsDbName);
  try {
    return await secrets.getApiKey();
  } finally {
    secrets.close();
  }
}

async function saveKey(key: string): Promise<void> {
  const secrets = await openSecretStore(names.secretsDbName);
  try {
    await secrets.setApiKey(key);
  } finally {
    secrets.close();
  }
}

/** A bag made through the storage module's own repositories, as the app would. */
async function addOwnBag(): Promise<void> {
  await withDb(async (db) => {
    const repos = createRepositories({ db: async () => db, onWrite: () => undefined, defaultModel: 'claude-opus-5-5' });
    const at = new Date(NOW - 3_600_000).toISOString();
    const bag: Bag = {
      id: 'bag-own',
      name: 'My own bag',
      roaster: null,
      origin: null,
      roastLevel: null,
      process: null,
      notes: null,
      templateId: null,
      activeVersionId: null,
      conversationId: 'conv-own',
      archived: false,
      createdAt: at,
      updatedAt: at,
    };
    await repos.bags.put(bag);
  });
}

async function saveOwnSettings(): Promise<void> {
  await withDb(async (db) => {
    const repos = createRepositories({ db: async () => db, onWrite: () => undefined, defaultModel: 'claude-opus-5-5' });
    await repos.settings.update({ grinderName: 'EK43', grinderSetting: '3' });
  });
}

const everything = () => withDb((db) => readAll(db));

beforeEach(() => {
  run += 1;
  names = { dbName: `cafai-demo-test-${run}`, secretsDbName: `cafai-demo-secrets-${run}` };
  state = createMockDecaid({ seedExamples: false, uploadMs: 0 });
  host = fakeHost();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

afterEach(() => {
  state.dispose();
});

describe('startDemo on an address with no CafAI data', () => {
  it('seeds the story, the placeholder key, the coach route and the marker', async () => {
    const outcome = await startDemo(state, host, { ...names, now: NOW });
    expect(outcome).toEqual({ seeded: true });

    const stored = await everything();
    expect(stored.bags.map((bag) => bag.name).sort()).toEqual(['Kiambu AA', 'Santos']);
    expect(stored.conversations).toHaveLength(2);
    expect(stored.versions).toHaveLength(5);
    expect(stored.iterations).toHaveLength(5);
    expect(stored.settings).toMatchObject({ grinderName: 'Niche Zero', grinderSetting: '14.5' });
    expect(await storedKey()).toBe(DEMO_API_KEY);

    expect(host.location.hash).toBe('#/');
    expect(host.location.replaced).toEqual(['/?demo=1#/']);
    expect(JSON.parse(host.storage.get(DEMO_MARKER_KEY)!)).toEqual({ seededAt: new Date(NOW).toISOString() });
    expect(document.body.textContent).not.toContain(GUARD_NOTE);
  });

  it('loads the mock Decaid with the shots, the versions and the active one', async () => {
    await startDemo(state, host, { ...names, now: NOW });
    expect(state.getShotIds()).toEqual(Object.values(SHOTS).map((shot) => shot.id).sort((a, b) => order(a) - order(b)));
    expect(state.getWorkflow().profile.title).toBe('Kiambu AA v4');
    const titles = state.listProfiles({ includeHidden: true }).filter((record) => !record.isDefault).map((record) => record.profile.title);
    expect(titles.sort()).toEqual(['Kiambu AA v1', 'Kiambu AA v2', 'Kiambu AA v3', 'Kiambu AA v4']);
    // The machine takes the loaded version as Decaid would after a restart.
    await state.runMachineWrite(() => undefined);
    expect(state.getMachineProfile().title).toBe('Kiambu AA v4');
  });

  it('counts the placeholder key alone as no data', async () => {
    await saveKey(DEMO_API_KEY);
    expect(await startDemo(state, host, { ...names, now: NOW })).toEqual({ seeded: true });
  });

  it('leaves the route alone when the page is already on the coach', async () => {
    host = fakeHost('#/');
    await startDemo(state, host, { ...names, now: NOW });
    expect(host.location.replaced).toEqual([]);
  });
});

/** Shots in the order the story pulled them. */
function order(id: string): number {
  return ['santos', 'kiambu1', 'kiambu2', 'stray', 'kiambu3', 'kiambu4'].indexOf(Object.entries(SHOTS).find(([, shot]) => shot.id === id)![0]);
}

describe('startDemo under its own marker', () => {
  it('starts over: what the viewer added in the demo is gone, and the key is the placeholder again', async () => {
    await startDemo(state, host, { ...names, now: NOW });
    await addOwnBag();
    await saveOwnSettings();
    await saveKey('sk-ant-overloaded');
    const before = await everything();
    expect(before.bags).toHaveLength(3);

    state.dispose();
    state = createMockDecaid({ seedExamples: false, uploadMs: 0 });
    const outcome = await startDemo(state, host, { ...names, now: NOW + 600_000 });
    expect(outcome).toEqual({ seeded: true });
    const after = await everything();
    expect(after.bags.map((bag) => bag.name).sort()).toEqual(['Kiambu AA', 'Santos']);
    expect(after.settings).toMatchObject({ grinderName: 'Niche Zero', grinderSetting: '14.5' });
    expect(await storedKey()).toBe(DEMO_API_KEY);
    expect(JSON.parse(host.storage.get(DEMO_MARKER_KEY)!)).toEqual({ seededAt: new Date(NOW + 600_000).toISOString() });
  });

  it('still keeps away from a real-looking key: someone used this address for real since', async () => {
    host.storage.set(DEMO_MARKER_KEY, JSON.stringify({ seededAt: new Date(NOW - 86_400_000).toISOString() }));
    await addOwnBag();
    await saveKey('sk-ant-api03-real-looking-key-0123456789');
    const before = await everything();
    const outcome = await startDemo(state, host, { ...names, now: NOW });
    expect(outcome.seeded).toBe(false);
    expect(await everything()).toEqual(before);
    expect(await storedKey()).toBe('sk-ant-api03-real-looking-key-0123456789');
    expect(document.body.textContent).toContain(GUARD_NOTE);
  });
});

describe('startDemo on an address with CafAI data of its own', () => {
  const cases: Array<[string, () => Promise<void>]> = [
    ['a bag', addOwnBag],
    ['a settings record', saveOwnSettings],
    ['a real-looking key', () => saveKey('sk-ant-api03-real-looking-key-0123456789')],
  ];

  for (const [what, make] of cases) {
    it(`refuses with ${what}, writes nothing in either store, and says why`, async () => {
      await make();
      const before = await everything();
      const keyBefore = await storedKey();
      const workflowBefore = state.getWorkflow();

      const outcome = await startDemo(state, host, { ...names, now: NOW });
      expect(outcome.seeded).toBe(false);
      expect(await everything()).toEqual(before);
      expect(await storedKey()).toBe(keyBefore);
      expect(host.storage.has(DEMO_MARKER_KEY)).toBe(false);
      expect(host.location.replaced).toEqual([]);
      // The mock Decaid is the normal mock app's.
      expect(state.getShotIds()).toEqual([]);
      expect(state.getWorkflow()).toEqual(workflowBefore);

      const note = document.body.querySelector('[role="status"]')!;
      expect(note.textContent).toContain(GUARD_NOTE);
      (note.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement).click();
      expect(document.body.querySelector('[role="status"]')).toBeNull();
    });
  }

  it('puts its note at the top of the page and moves the app below it, so it covers nothing; Dismiss gives the room back', async () => {
    await addOwnBag();
    // The app's frame as AppShell draws it: fixed over the whole page, the top bar first.
    const app = document.createElement('div');
    app.setAttribute('data-testid', TID.appReady);
    app.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0';
    document.body.append(app);

    expect((await startDemo(state, host, { ...names, now: NOW })).seeded).toBe(false);
    const note = document.body.querySelector<HTMLElement>('[role="status"]')!;
    expect(note.textContent).toContain(GUARD_NOTE);
    expect(note.style.position).toBe('fixed');
    expect(note.style.top).toBe('0px');
    expect(note.style.bottom).toBe('');
    expect([note.style.left, note.style.right]).toEqual(['0px', '0px']);
    // Not over the composer or a field: the app starts where the note's one slim line ends.
    expect(note.style.height).toBe('34px');
    expect(getComputedStyle(app).top).toBe('34px');

    note.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click();
    expect(document.body.querySelector('[role="status"]')).toBeNull();
    expect(getComputedStyle(app).top).toBe('0px');
  });

  it('reads a saved settings record as data, even with every field blank', async () => {
    await withDb(async (db) => {
      const tx = db.transaction('settings', 'readwrite');
      await Promise.all([tx.store.put({ model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, grinderId: null, activeBagId: null }, SETTINGS_KEY), tx.done]);
    });
    expect((await startDemo(state, host, { ...names, now: NOW })).seeded).toBe(false);
  });
});

describe('judge', () => {
  const none = { records: 0, settings: false, apiKey: null };
  it('seeds an empty address, or one holding only the placeholder key', () => {
    expect(judge(none, false)).toEqual({ seed: true });
    expect(judge({ ...none, apiKey: DEMO_API_KEY }, false)).toEqual({ seed: true });
  });

  it('refuses records, settings or another key without the marker', () => {
    expect(judge({ ...none, records: 1 }, false).seed).toBe(false);
    expect(judge({ ...none, settings: true }, false).seed).toBe(false);
    for (const key of ['sk-ant-overloaded', 'sk-ant-api03-abc', 'anything']) expect(judge({ ...none, apiKey: key }, false).seed, key).toBe(false);
  });

  it('under the marker seeds over anything but a key the scripted coach does not know', () => {
    for (const key of [null, DEMO_API_KEY, 'sk-ant-invalid', 'sk-ant-overloaded']) {
      expect(judge({ records: 40, settings: true, apiKey: key }, true), String(key)).toEqual({ seed: true });
    }
    expect(judge({ records: 40, settings: true, apiKey: 'sk-ant-api03-abc' }, true).seed).toBe(false);
  });
});
