import { describe, expect, it } from 'vitest';
import { createDbHandle, openCafaiDb, SETTINGS_KEY } from './db.ts';
import { buildMirrorEntries, exportFromMirror } from './mirror.ts';
import { createDataPorter } from './porter.ts';
import { createRepositories } from './repositories.ts';
import {
  applySettingsPatch,
  DEFAULT_APPEARANCE,
  defaultSettings,
  fillBlankSettings,
  normalizeAppearance,
  normalizeSettings,
  sameAppearance,
} from './settings.ts';
import type { CafaiExport, Settings } from './types.ts';
import { API_KEY, MODEL, makeSettings, uniqueDbName } from './testing/fixtures.ts';

/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const PASTED_KEY = ['sk', 'ant', 'api03', 'nOtArEaLkEy0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');

describe('defaultSettings', () => {
  it('uses the default model and leaves everything else blank', () => {
    expect(defaultSettings(MODEL)).toEqual({
      model: MODEL,
      grinderName: null,
      grinderSetting: null,
      grinderId: null,
      activeBagId: null,
      appearance: DEFAULT_APPEARANCE,
      keepKeyInDecaid: false,
    });
  });
});

describe('normalizeSettings', () => {
  it('returns the defaults when nothing usable is stored', () => {
    for (const raw of [undefined, null, 'settings', 42, ['model']]) {
      expect(normalizeSettings(raw, MODEL)).toEqual(defaultSettings(MODEL));
    }
  });

  it('keeps every valid field', () => {
    const stored = makeSettings({ model: 'claude-haiku-4-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_1' });
    expect(normalizeSettings(stored, MODEL)).toEqual(stored);
  });

  it('falls back field by field when a stored value has the wrong type', () => {
    const raw = { model: 5, grinderName: 3, grinderSetting: '2.5', grinderId: 7, activeBagId: {} };
    expect(normalizeSettings(raw, MODEL)).toEqual({
      model: MODEL,
      grinderName: null,
      grinderSetting: '2.5',
      grinderId: null,
      activeBagId: null,
      appearance: DEFAULT_APPEARANCE,
      keepKeyInDecaid: false,
    });
  });

  it('treats a blank model as the default model', () => {
    expect(normalizeSettings({ model: '   ' }, MODEL).model).toBe(MODEL);
  });

  it('never carries fields outside Settings, such as an API key', () => {
    const normalized = normalizeSettings({ ...makeSettings(), apiKey: API_KEY, theme: 'dark' }, MODEL);
    expect(Object.keys(normalized).sort()).toEqual([
      'activeBagId',
      'appearance',
      'grinderId',
      'grinderName',
      'grinderSetting',
      'keepKeyInDecaid',
      'model',
    ]);
    expect(JSON.stringify(normalized)).not.toContain(API_KEY);
  });

  it('reads settings saved before grinder links as not linked', () => {
    const older = { model: MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_1' };
    expect(normalizeSettings(older, MODEL)).toEqual({ ...older, grinderId: null, appearance: DEFAULT_APPEARANCE, keepKeyInDecaid: false });
  });

  it('keeps a linked grinder id, and reads an empty one as no link', () => {
    expect(normalizeSettings(makeSettings({ grinderId: 'c0ffee00-0a5e-4c1e-8a11-000000000001' }), MODEL).grinderId).toBe(
      'c0ffee00-0a5e-4c1e-8a11-000000000001',
    );
    expect(normalizeSettings({ ...makeSettings(), grinderId: '' }, MODEL).grinderId).toBeNull();
    expect(normalizeSettings({ ...makeSettings(), grinderId: '   ' }, MODEL).grinderId).toBeNull();
  });
});

describe('normalizeSettings: a pasted API key is taken out (D37)', () => {
  it('takes a key out of the grinder fields; a field left empty is null', () => {
    const raw = makeSettings({ grinderName: PASTED_KEY, grinderSetting: ` ${PASTED_KEY} `, activeBagId: 'bag_1' });
    expect(normalizeSettings(raw, MODEL)).toEqual(makeSettings({ activeBagId: 'bag_1' }));
  });

  it('keeps the rest of a field that holds a key among other text', () => {
    const raw = makeSettings({ grinderName: `Niche Zero ${PASTED_KEY}`, grinderSetting: `${PASTED_KEY} 14` });
    expect(normalizeSettings(raw, MODEL)).toEqual(makeSettings({ grinderName: 'Niche Zero', grinderSetting: '14' }));
    const twice = makeSettings({ grinderName: `${PASTED_KEY} Niche ${PASTED_KEY} Zero`, grinderSetting: `14${PASTED_KEY}` });
    expect(normalizeSettings(twice, MODEL)).toMatchObject({ grinderName: 'Niche Zero', grinderSetting: '14' });
  });

  it('takes out the start of a key too, as a field with a length limit keeps it', () => {
    // The Settings fields take 60 (name) and 20 (setting) characters.
    const raw = makeSettings({ grinderName: `Niche ${PASTED_KEY}`.slice(0, 60), grinderSetting: PASTED_KEY.slice(0, 20) });
    expect(normalizeSettings(raw, MODEL)).toEqual(makeSettings({ grinderName: 'Niche', grinderSetting: null }));
  });

  it('never takes a key for a model id: the default model is used', () => {
    expect(normalizeSettings(makeSettings({ model: PASTED_KEY }), MODEL).model).toBe(MODEL);
    expect(normalizeSettings(makeSettings({ model: `  ${PASTED_KEY.slice(0, 30)}` }), MODEL).model).toBe(MODEL);
    expect(normalizeSettings(makeSettings({ model: `claude-sonnet-5 ${PASTED_KEY}` }), MODEL).model).toBe('claude-sonnet-5');
  });

  it('never links a key-shaped grinder id (the id travels to Decaid)', () => {
    expect(normalizeSettings(makeSettings({ grinderId: PASTED_KEY, grinderName: 'Niche Zero' }), MODEL)).toEqual(
      makeSettings({ grinderName: 'Niche Zero' }),
    );
  });

  it('changes nothing in a record without a key', () => {
    const stored = makeSettings({ model: 'claude-haiku-4-5', grinderName: ' Niche  Zero ', grinderSetting: ' 14 ', grinderId: 'g-1', activeBagId: 'bag_1' });
    expect(normalizeSettings(stored, MODEL)).toEqual(stored);
  });

  it('leaves nothing key-shaped in any field', () => {
    const raw = { model: PASTED_KEY, grinderName: PASTED_KEY, grinderSetting: PASTED_KEY, grinderId: PASTED_KEY, activeBagId: 'bag_1', apiKey: PASTED_KEY };
    expect(JSON.stringify(normalizeSettings(raw, MODEL))).not.toContain('sk-ant-');
  });
});

describe('applySettingsPatch', () => {
  it('applies the patched fields and keeps the rest', () => {
    const current = makeSettings({ grinderName: 'Niche Zero' });
    expect(applySettingsPatch(current, { grinderSetting: '14' }, MODEL)).toEqual({ ...current, grinderSetting: '14' });
  });

  it('ignores undefined values, so a missing field never clears a saved one', () => {
    const current = makeSettings({ grinderName: 'Niche Zero', activeBagId: 'bag_1' });
    expect(applySettingsPatch(current, { grinderName: undefined, activeBagId: undefined }, MODEL)).toEqual(current);
  });

  it('can clear a field with an explicit null', () => {
    const current = makeSettings({ grinderName: 'Niche Zero' });
    expect(applySettingsPatch(current, { grinderName: null }, MODEL).grinderName).toBeNull();
  });

  it('drops anything that is not a setting', () => {
    const patch = { grinderName: 'Lagom 01', apiKey: API_KEY } as unknown as Partial<ReturnType<typeof makeSettings>>;
    const next = applySettingsPatch(makeSettings(), patch, MODEL);
    expect(next).toEqual(makeSettings({ grinderName: 'Lagom 01' }));
    expect(JSON.stringify(next)).not.toContain(API_KEY);
  });

  it('links a grinder, keeps the link across other edits, and unlinks with an explicit null', () => {
    const linked = applySettingsPatch(makeSettings(), { grinderId: 'g-1', grinderName: 'Niche Zero', grinderSetting: '14' }, MODEL);
    expect(linked).toEqual(makeSettings({ grinderId: 'g-1', grinderName: 'Niche Zero', grinderSetting: '14' }));
    expect(applySettingsPatch(linked, { grinderSetting: '13.5' }, MODEL).grinderId).toBe('g-1');
    expect(applySettingsPatch(linked, { grinderId: undefined }, MODEL).grinderId).toBe('g-1');
    expect(applySettingsPatch(linked, { grinderId: null }, MODEL).grinderId).toBeNull();
  });

  it('takes a pasted key out of the patch and applies the rest', () => {
    const current = makeSettings({ model: 'claude-haiku-4-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_1' });
    const patch = { model: PASTED_KEY, grinderName: `Lagom 01 ${PASTED_KEY}`, grinderSetting: PASTED_KEY.slice(0, 20) };
    const next = applySettingsPatch(current, patch, MODEL);
    expect(next).toEqual({ ...current, model: MODEL, grinderName: 'Lagom 01', grinderSetting: null });
    expect(JSON.stringify(next)).not.toContain('sk-ant-');
  });
});

describe('a key in the settings never reaches storage, the backup or an import', () => {
  function setup() {
    const name = uniqueDbName();
    const handle = createDbHandle((onLost) => openCafaiDb(name, onLost));
    const db = () => handle.get();
    const repos = createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL });
    const porter = createDataPorter({
      db,
      secrets: { getApiKey: async () => null },
      mirror: { schedulePush: () => undefined },
      appVersion: '1.2.3',
      defaultModel: MODEL,
      now: () => new Date('2026-10-04T09:30:00.000Z'),
    });
    return { db, repos, porter };
  }

  const withKey = (): Settings => ({
    model: PASTED_KEY,
    grinderName: `Niche Zero ${PASTED_KEY}`,
    grinderSetting: PASTED_KEY.slice(0, 20),
    grinderId: null,
    activeBagId: 'bag_1',
  });
  const cleaned = makeSettings({ grinderName: 'Niche Zero', activeBagId: 'bag_1' });

  function exportWith(settings: Settings): CafaiExport {
    return {
      format: 'cafai-export',
      schemaVersion: 1,
      exportedAt: '2026-10-04T09:00:00.000Z',
      appVersion: '1.2.3',
      settings,
      bags: [],
      versions: [],
      iterations: [],
      conversations: [],
    };
  }

  it('a save from Settings stores the settings without the key', async () => {
    const { db, repos } = setup();
    expect(await repos.settings.update(withKey())).toEqual(cleaned);
    expect(JSON.stringify(await (await db()).get('settings', SETTINGS_KEY))).not.toContain('sk-ant-');
  });

  it('a record saved before this fix is read without the key, and written back clean at the next save', async () => {
    const { db, repos } = setup();
    await (await db()).put('settings', withKey(), SETTINGS_KEY);
    expect(await repos.settings.get()).toEqual(cleaned);
    await repos.settings.update({ activeBagId: 'bag_2' });
    const raw = await (await db()).get('settings', SETTINGS_KEY);
    expect(raw).toEqual({ ...cleaned, activeBagId: 'bag_2' });
  });

  it('an import holding a key stores the settings without it, replace and merge alike', async () => {
    for (const mode of ['replace', 'merge'] as const) {
      const { db, repos, porter } = setup();
      await porter.importAll(exportWith(withKey()), mode);
      expect(await repos.settings.get(), mode).toEqual(cleaned);
      expect(JSON.stringify(await (await db()).get('settings', SETTINGS_KEY)), mode).not.toContain('sk-ant-');
    }
  });

  it('an import without a key is stored as before', async () => {
    const settings = makeSettings({ model: 'claude-sonnet-5', grinderName: 'Lagom 01', grinderSetting: '0.4', grinderId: 'g-1', activeBagId: 'bag_1' });
    for (const mode of ['replace', 'merge'] as const) {
      const { repos, porter } = setup();
      await porter.importAll(exportWith(settings), mode);
      expect(await repos.settings.get(), mode).toEqual(settings);
    }
  });

  it("the backup in Decaid holds the settings without the key, not a redaction mark", () => {
    const snapshot = { settings: withKey(), bags: [], versions: [], iterations: [], conversations: [] };
    expect(buildMirrorEntries(snapshot, null, MODEL).entries.get('settings')).toBe(JSON.stringify(cleaned));
    const plain = makeSettings({ model: 'claude-sonnet-5', grinderName: 'Lagom 01', grinderSetting: '0.4', activeBagId: 'bag_1' });
    expect(buildMirrorEntries({ ...snapshot, settings: plain }, null, MODEL).entries.get('settings')).toBe(JSON.stringify(plain));
  });

  it('a restored backup holding a key comes back without it', () => {
    const restored = exportFromMirror({ settings: withKey() }, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings).toEqual(cleaned);
  });
});

describe('fillBlankSettings: a restore fills blanks and never overwrites local settings', () => {
  it('fills every blank local field from the incoming copy', () => {
    const incoming = makeSettings({ model: 'claude-sonnet-5', grinderName: 'Lagom 01', grinderSetting: '0.4', activeBagId: 'bag_1' });
    expect(fillBlankSettings(makeSettings(), incoming, MODEL)).toEqual(incoming);
  });

  it('keeps every value already set on this device', () => {
    const local = makeSettings({ model: 'claude-haiku-4-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_2' });
    const incoming = makeSettings({ model: 'claude-sonnet-5', grinderName: 'Lagom 01', grinderSetting: '0.4', activeBagId: 'bag_1' });
    expect(fillBlankSettings(local, incoming, MODEL)).toEqual(local);
  });

  it('adopts the incoming model only while the local one is still the default', () => {
    const incoming = makeSettings({ model: 'claude-sonnet-5' });
    expect(fillBlankSettings(makeSettings(), incoming, MODEL).model).toBe('claude-sonnet-5');
    expect(fillBlankSettings(makeSettings({ model: 'claude-haiku-4-5' }), incoming, MODEL).model).toBe('claude-haiku-4-5');
  });

  it('treats empty grinder text as blank', () => {
    const local = makeSettings({ grinderName: '  ', grinderSetting: '' });
    const incoming = makeSettings({ grinderName: 'Lagom 01', grinderSetting: '0.4' });
    expect(fillBlankSettings(local, incoming, MODEL)).toMatchObject({ grinderName: 'Lagom 01', grinderSetting: '0.4' });
  });

  it('takes the incoming grinder whole, link included, when this device has none', () => {
    const incoming = makeSettings({ grinderName: 'Niche Zero', grinderId: 'g-1', grinderSetting: '14' });
    expect(fillBlankSettings(makeSettings(), incoming, MODEL)).toEqual(incoming);
  });

  it('never pairs a grinder named here with the link of another one', () => {
    // The name and the link describe one grinder: a typed name stays unlinked,
    // and a linked grinder keeps its own link.
    const incoming = makeSettings({ grinderName: 'Niche Zero', grinderId: 'g-1' });
    expect(fillBlankSettings(makeSettings({ grinderName: 'DF64' }), incoming, MODEL)).toMatchObject({ grinderName: 'DF64', grinderId: null });
    const linkedHere = makeSettings({ grinderName: 'Lagom P64', grinderId: 'g-2' });
    expect(fillBlankSettings(linkedHere, incoming, MODEL)).toMatchObject({ grinderName: 'Lagom P64', grinderId: 'g-2' });
    const linkWithoutName = makeSettings({ grinderId: 'g-2' });
    expect(fillBlankSettings(linkWithoutName, incoming, MODEL)).toMatchObject({ grinderName: null, grinderId: 'g-2' });
  });
});

describe('appearance', () => {
  it("defaults to dark Crema, today's look", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ mode: 'dark', tint: 'crema' });
    expect(defaultSettings(MODEL).appearance).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeSettings({ model: MODEL }, MODEL).appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps a valid mode and tint', () => {
    expect(normalizeAppearance({ mode: 'light', tint: 'matcha' })).toEqual({ mode: 'light', tint: 'matcha' });
    expect(normalizeAppearance({ mode: 'auto', tint: { hue: 210 } })).toEqual({ mode: 'auto', tint: { hue: 210 } });
    // An id this build does not know is kept; the UI decides what it looks like.
    expect(normalizeAppearance({ mode: 'dark', tint: 'forest' })).toEqual({ mode: 'dark', tint: 'forest' });
  });

  it('falls back field by field', () => {
    expect(normalizeAppearance({ mode: 'sepia', tint: 'matcha' })).toEqual({ mode: 'dark', tint: 'matcha' });
    expect(normalizeAppearance({ mode: 'light', tint: 'Not An Id!' })).toEqual({ mode: 'light', tint: 'crema' });
    expect(normalizeAppearance({ mode: 'light', tint: { hue: 'red' } })).toEqual({ mode: 'light', tint: 'crema' });
    expect(normalizeAppearance({ mode: 'light', tint: { hue: Number.NaN } })).toEqual({ mode: 'light', tint: 'crema' });
    for (const raw of [undefined, null, 'dark', 7, []]) expect(normalizeAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
  });

  it('wraps and rounds a stored hue', () => {
    expect(normalizeAppearance({ mode: 'dark', tint: { hue: 370.4 } }).tint).toEqual({ hue: 10 });
    expect(normalizeAppearance({ mode: 'dark', tint: { hue: -20 } }).tint).toEqual({ hue: 340 });
  });

  it('is patched like any other setting', () => {
    const next = applySettingsPatch(defaultSettings(MODEL), { appearance: { mode: 'light', tint: { hue: 120 } } }, MODEL);
    expect(next.appearance).toEqual({ mode: 'light', tint: { hue: 120 } });
    expect(applySettingsPatch(next, { grinderSetting: '14' }, MODEL).appearance).toEqual({ mode: 'light', tint: { hue: 120 } });
  });

  it('takes an imported appearance only while this device still has the default', () => {
    const incoming = { ...defaultSettings(MODEL), appearance: { mode: 'light' as const, tint: 'ocean' } };
    expect(fillBlankSettings(defaultSettings(MODEL), incoming, MODEL).appearance).toEqual({ mode: 'light', tint: 'ocean' });
    const mine = { ...defaultSettings(MODEL), appearance: { mode: 'auto' as const, tint: 'plum' } };
    expect(fillBlankSettings(mine, incoming, MODEL).appearance).toEqual({ mode: 'auto', tint: 'plum' });
  });

  it('compares appearances by value', () => {
    expect(sameAppearance({ mode: 'dark', tint: { hue: 5 } }, { mode: 'dark', tint: { hue: 5 } })).toBe(true);
    expect(sameAppearance({ mode: 'dark', tint: 'crema' }, { mode: 'dark', tint: { hue: 68 } })).toBe(false);
    expect(sameAppearance({ mode: 'dark', tint: 'crema' }, { mode: 'light', tint: 'crema' })).toBe(false);
  });

  it('survives the Decaid mirror round trip (buildMirrorEntries then exportFromMirror)', () => {
    // Same setup style as "the backup in Decaid holds the settings without the key": a bare
    // snapshot pushed through buildMirrorEntries, then read back with exportFromMirror.
    const settings = makeSettings({ appearance: { mode: 'light', tint: { hue: 200 } } });
    const snapshot = { settings, bags: [], versions: [], iterations: [], conversations: [] };
    const { entries } = buildMirrorEntries(snapshot, null, MODEL);
    const data = Object.fromEntries([...entries].map(([key, text]) => [key, JSON.parse(text)]));
    const restored = exportFromMirror(data, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings.appearance).toEqual({ mode: 'light', tint: { hue: 200 } });
  });
});
