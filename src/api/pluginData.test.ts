import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { driftLog } from './drift.ts';
import { isVisualizerShotUrl, readDye2, visualizerIdFor, visualizerShotUrl, type PluginReads } from './pluginData.ts';

const drift = () => driftLog.list().map(({ source, problem }) => ({ source, problem }));

beforeEach(() => {
  driftLog.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Decaid's key-value store and the loaded plugins' endpoints, as a test sets them. */
function fakeReads(store: Record<string, unknown>, endpoints: Record<string, unknown | Error> = {}) {
  const calls: string[] = [];
  const reads: PluginReads = {
    async readStore(namespace, key) {
      calls.push(`store ${namespace}/${key}`);
      const value = store[`${namespace}/${key}`];
      if (value instanceof Error) throw value;
      return value ?? null;
    },
    async getPluginEndpoint(pluginId, endpoint) {
      calls.push(`endpoint ${pluginId}/${endpoint}`);
      const reply = endpoints[`${pluginId}/${endpoint}`];
      if (reply instanceof Error) throw reply;
      return reply ?? null;
    },
  };
  return { reads, calls };
}

/** A DYE2 recent setup, in the shape of its toRecentFavourite(). */
function recent(n: number, batch: string, fields: Record<string, unknown> = {}) {
  return {
    id: `recent:shot-${n}`,
    auto: true,
    recentRank: n,
    title: 'Red Brick',
    snapshot: {
      profileTitle: 'D-Flow / default',
      beanBatchId: batch,
      coffeeName: 'Red Brick',
      coffeeRoaster: 'Square Mile',
      grinderModel: 'Niche Zero',
      grindSetting: '4.2',
      rpm: null,
      dose: 18,
      drink: 36,
      ...fields,
    },
    capturedAt: '2026-10-08T07:12:00.000Z',
    workflow: { context: {} },
  };
}

const SAVED = {
  id: 'fav-1',
  title: 'Weekend',
  favSlot: 1,
  snapshot: { profileTitle: 'Londonium', coffeeName: 'Red Brick', coffeeRoaster: 'Square Mile', grindSetting: 4.5, dose: '18.5', drink: 40, basketName: 'VST 18g', rpm: 1200 },
  capturedAt: '2026-10-01T09:00:00.000Z',
};
const RECIPE = {
  id: '1',
  name: 'Morning Espresso',
  beanId: 'bean-red-brick',
  beanName: 'Red Brick',
  profileTitle: 'D-Flow / default',
  dashboardVariables: { dose: 18, drink: 36, grind: '4.2', rpm: null, basketName: null },
  capturedAt: '2026-09-30T08:00:00.000Z',
};
const KIT = {
  'dye2.reaplugin/equipment': [{ id: 'eqp-1', name: 'WDT tool' }, { id: 'eqp-2', name: 'Acaia Lunar scale' }],
  'dye2.reaplugin/baskets': [{ id: 'bskt-1', name: 'VST 18g', size: 'double' }],
};

describe('readDye2 (6.5)', () => {
  it("takes DYE2's fresh recent setups from its endpoint while it is loaded, and the rest from the store", async () => {
    const { reads, calls } = fakeReads(
      { 'dye2.reaplugin/autoFavourites': [recent(9, 'batch-old'), SAVED], 'dye2.reaplugin/recipes': [RECIPE], ...KIT },
      { 'dye2.reaplugin/recent-favs': [recent(1, 'batch-1'), recent(2, 'batch-1', { profileTitle: 'Londonium' })] },
    );
    const data = await readDye2(reads, true);
    expect(calls).toContain('endpoint dye2.reaplugin/recent-favs');
    expect(data?.setups.map((setup) => [setup.kind, setup.beanBatchId, setup.profileTitle])).toEqual([
      ['recent', 'batch-1', 'D-Flow / default'],
      ['recent', 'batch-1', 'Londonium'],
      ['favourite', null, 'Londonium'],
      ['recipe', null, 'D-Flow / default'],
    ]);
    expect(data?.setups[0]).toEqual({
      kind: 'recent',
      beanBatchId: 'batch-1',
      beanId: null,
      coffeeName: 'Red Brick',
      coffeeRoaster: 'Square Mile',
      profileTitle: 'D-Flow / default',
      grindSetting: '4.2',
      doseG: 18,
      yieldG: 36,
      rpm: null,
      basket: null,
      capturedAt: '2026-10-08T07:12:00.000Z',
    });
    // A number written as text, and a grind kept as a number, still read.
    expect(data?.setups[2]).toMatchObject({ grindSetting: '4.5', doseG: 18.5, yieldG: 40, rpm: 1200, basket: 'VST 18g' });
    expect(data?.setups[3]).toMatchObject({ beanId: 'bean-red-brick', coffeeName: 'Red Brick', coffeeRoaster: null, grindSetting: '4.2' });
    expect(data?.equipment).toEqual(['WDT tool', 'Acaia Lunar scale']);
    expect(data?.baskets).toEqual(['VST 18g']);
    expect(drift()).toEqual([]);
  });

  it("reads DYE2's keys from the store when it is not loaded, and never calls the plugin", async () => {
    const { reads, calls } = fakeReads({ 'dye2.reaplugin/autoFavourites': [recent(1, 'batch-1'), SAVED], ...KIT });
    const data = await readDye2(reads, false);
    expect(calls.some((call) => call.startsWith('endpoint'))).toBe(false);
    expect(calls).toEqual([
      'store dye2.reaplugin/autoFavourites',
      'store dye2.reaplugin/recipes',
      'store dye2.reaplugin/equipment',
      'store dye2.reaplugin/baskets',
    ]);
    expect(data?.setups.map((setup) => setup.kind)).toEqual(['recent', 'favourite']);
    expect(data?.equipment).toEqual(['WDT tool', 'Acaia Lunar scale']);
  });

  it('reads a value that is not a list as empty, and reports it', async () => {
    const { reads } = fakeReads({ 'dye2.reaplugin/autoFavourites': [recent(1, 'batch-1')], 'dye2.reaplugin/recipes': { 1: RECIPE }, 'dye2.reaplugin/equipment': 'WDT tool' });
    const data = await readDye2(reads, false);
    expect(data).toEqual({ setups: [expect.objectContaining({ kind: 'recent' })], equipment: [], baskets: [] });
    expect(drift()).toEqual([
      { source: 'GET /api/v1/store/dye2.reaplugin/recipes', problem: 'value: expected list, got object' },
      { source: 'GET /api/v1/store/dye2.reaplugin/equipment', problem: 'value: expected list, got string' },
    ]);
  });

  it('drops an entry that is not an object, or a favourite without its snapshot, and reports it', async () => {
    const { reads } = fakeReads({ 'dye2.reaplugin/autoFavourites': [recent(1, 'batch-1'), 'oops', { id: 'fav-x' }] });
    const data = await readDye2(reads, false);
    expect(data?.setups).toHaveLength(1);
    expect(drift()).toEqual([
      { source: 'GET /api/v1/store/dye2.reaplugin/autoFavourites', problem: 'item: not an object' },
      { source: 'GET /api/v1/store/dye2.reaplugin/autoFavourites', problem: 'snapshot: missing' },
    ]);
  });

  it('falls back to the stored setups when the loaded plugin fails or answers something else', async () => {
    const failing = fakeReads({ 'dye2.reaplugin/autoFavourites': [recent(1, 'batch-1')] }, { 'dye2.reaplugin/recent-favs': new Error('HTTP 502') });
    expect((await readDye2(failing.reads, true))?.setups.map((setup) => setup.beanBatchId)).toEqual(['batch-1']);
    const odd = fakeReads({ 'dye2.reaplugin/autoFavourites': [recent(1, 'batch-1')] }, { 'dye2.reaplugin/recent-favs': { error: 'busy' } });
    expect((await readDye2(odd.reads, true))?.setups.map((setup) => setup.beanBatchId)).toEqual(['batch-1']);
    expect(drift()).toEqual([{ source: 'GET /api/v1/plugins/dye2.reaplugin/recent-favs', problem: 'reply: expected list, got object' }]);
  });

  it('is null without DYE2: not loaded and nothing in its store', async () => {
    expect(await readDye2(fakeReads({}).reads, false)).toBeNull();
    // Loaded with nothing recorded yet is DYE2 all the same.
    expect(await readDye2(fakeReads({}, { 'dye2.reaplugin/recent-favs': [] }).reads, true)).toEqual({ setups: [], equipment: [], baskets: [] });
  });

  it('throws when Decaid cannot be read at all', async () => {
    const { reads } = fakeReads({ 'dye2.reaplugin/autoFavourites': new Error('Decaid is not reachable.') });
    await expect(readDye2(reads, false)).rejects.toThrow('Decaid is not reachable.');
  });
});

describe('visualizerIdFor (6.4)', () => {
  it("gives Visualizer's id once the plugin's last upload names the shot", async () => {
    const { reads } = fakeReads({ 'visualizer.reaplugin/lastUploadedShot': 'shot-7', 'visualizer.reaplugin/lastVisualizerId': 'c5b6b2b8-0f2e' });
    expect(await visualizerIdFor(reads, 'shot-7')).toBe('c5b6b2b8-0f2e');
    const numbered = fakeReads({ 'visualizer.reaplugin/lastUploadedShot': 'shot-7', 'visualizer.reaplugin/lastVisualizerId': 1042 });
    expect(await visualizerIdFor(numbered.reads, 'shot-7')).toBe('1042');
  });

  it('is null while the last upload is another shot, or none, and then reads nothing more', async () => {
    const other = fakeReads({ 'visualizer.reaplugin/lastUploadedShot': 'shot-6', 'visualizer.reaplugin/lastVisualizerId': 'abc' });
    expect(await visualizerIdFor(other.reads, 'shot-7')).toBeNull();
    expect(other.calls).toEqual(['store visualizer.reaplugin/lastUploadedShot']);
    expect(await visualizerIdFor(fakeReads({}).reads, 'shot-7')).toBeNull();
    expect(drift()).toEqual([]);
  });

  it('reports a value of a shape the plugin does not write, and reads it as no upload', async () => {
    const { reads } = fakeReads({ 'visualizer.reaplugin/lastUploadedShot': { id: 'shot-7' } });
    expect(await visualizerIdFor(reads, 'shot-7')).toBeNull();
    const noId = fakeReads({ 'visualizer.reaplugin/lastUploadedShot': 'shot-7', 'visualizer.reaplugin/lastVisualizerId': true });
    expect(await visualizerIdFor(noId.reads, 'shot-7')).toBeNull();
    expect(drift()).toEqual([
      { source: 'GET /api/v1/store/visualizer.reaplugin/lastUploadedShot', problem: 'value: expected string, got object' },
      { source: 'GET /api/v1/store/visualizer.reaplugin/lastVisualizerId', problem: 'value: expected string, got boolean' },
    ]);
  });
});

describe('visualizerShotUrl', () => {
  it("is the shot's page on Visualizer, its id made safe for the path", () => {
    expect(visualizerShotUrl('c5b6b2b8-0f2e')).toBe('https://visualizer.coffee/shots/c5b6b2b8-0f2e');
    expect(visualizerShotUrl('a/b?c')).toBe('https://visualizer.coffee/shots/a%2Fb%3Fc');
  });

  it("tells a Visualizer shot page from anything else, so a stored link can only lead there", () => {
    expect(isVisualizerShotUrl(visualizerShotUrl('1042'))).toBe(true);
    for (const url of ['javascript:alert(1)', 'https://evil.example/shots/1', 'https://visualizer.coffee/', 'http://visualizer.coffee/shots/1', 'https://visualizer.coffee/shots/1/edit', null, 7]) {
      expect(isVisualizerShotUrl(url), String(url)).toBe(false);
    }
  });
});
