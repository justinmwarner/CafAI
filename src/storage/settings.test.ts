import { describe, expect, it } from 'vitest';
import { openCareDb } from './careDb.ts';
import { createDbHandle, openCafaiDb, SETTINGS_KEY } from './db.ts';
import { buildMirrorEntries, exportFromMirror } from './mirror.ts';
import { createDataPorter } from './porter.ts';
import { createRepositories } from './repositories.ts';
import {
  applySettingsPatch,
  DEFAULT_APPEARANCE,
  DEFAULT_BUDGET,
  DEFAULT_CARE,
  DEFAULT_CLOCK,
  DEFAULT_COACH_EFFORT,
  DEFAULT_SCREENSAVER,
  defaultSettings,
  fillBlankSettings,
  finerIsHigher,
  grinderDirectionKey,
  normalizeAppearance,
  normalizeCareSettings,
  normalizeCoachBudget,
  normalizeDrinkScreens,
  normalizeGrinderFinerHigher,
  normalizeScreensaver,
  normalizeSettings,
  SAVER_DIM_TO,
  SAVER_START_AFTER_MINUTES,
  sameAppearance,
  withGrinderDirection,
} from './settings.ts';
import type { CafaiExport, Settings } from './types.ts';
import { API_KEY, MODEL, makeSettings, uniqueDbName } from './testing/fixtures.ts';

/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const PASTED_KEY = ['sk', 'ant', 'api03', 'nOtArEaLkEy0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');

/** Machine care's own database (careDb.ts), which a porter opens beside CafAI's. */
function careDbOfItsOwn() {
  const handle = createDbHandle((onLost) => openCareDb(uniqueDbName('care'), onLost));
  return () => handle.get();
}

describe('defaultSettings', () => {
  it('uses the default model and leaves everything else blank, the key-copy choice unmade', () => {
    expect(defaultSettings(MODEL)).toEqual({
      model: MODEL,
      grinderName: null,
      grinderSetting: null,
      grinderId: null,
      activeBagId: null,
      appearance: DEFAULT_APPEARANCE,
    });
    expect(defaultSettings(MODEL)).not.toHaveProperty('keepKeyInDecaid');
    expect(defaultSettings(MODEL)).not.toHaveProperty('care');
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
    const raw = { model: 5, grinderName: 3, grinderSetting: '2.5', grinderId: 7, activeBagId: {}, keepKeyInDecaid: 'yes' };
    expect(normalizeSettings(raw, MODEL)).toEqual({
      model: MODEL,
      grinderName: null,
      grinderSetting: '2.5',
      grinderId: null,
      activeBagId: null,
      appearance: DEFAULT_APPEARANCE,
    });
  });

  it('keeps the key-copy choice only as someone made it, never writing off as a default (D99)', () => {
    expect(normalizeSettings(makeSettings({ keepKeyInDecaid: false }), MODEL)).toHaveProperty('keepKeyInDecaid', false);
    expect(normalizeSettings(makeSettings({ keepKeyInDecaid: true }), MODEL)).toHaveProperty('keepKeyInDecaid', true);
    expect(normalizeSettings(makeSettings(), MODEL)).not.toHaveProperty('keepKeyInDecaid');
    expect(applySettingsPatch(makeSettings(), { activeBagId: 'bag_1' }, MODEL)).not.toHaveProperty('keepKeyInDecaid');
    expect(applySettingsPatch(makeSettings(), { keepKeyInDecaid: false }, MODEL)).toHaveProperty('keepKeyInDecaid', false);
  });

  it('treats a blank model as the default model', () => {
    expect(normalizeSettings({ model: '   ' }, MODEL).model).toBe(MODEL);
  });

  it('never carries fields outside Settings, such as an API key', () => {
    const normalized = normalizeSettings(
      { ...makeSettings({ keepKeyInDecaid: true, care: { water: 'to120', filter: null, reminders: true } }), apiKey: API_KEY, theme: 'dark' },
      MODEL,
    );
    expect(Object.keys(normalized).sort()).toEqual([
      'activeBagId',
      'appearance',
      'care',
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
    expect(normalizeSettings(older, MODEL)).toEqual({ ...older, grinderId: null, appearance: DEFAULT_APPEARANCE });
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
      careDb: careDbOfItsOwn(),
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

  it('keeps the key-copy choice made on this device, off as much as on, whatever comes in (D99)', () => {
    const on = makeSettings({ keepKeyInDecaid: true });
    const off = makeSettings({ keepKeyInDecaid: false });
    expect(fillBlankSettings(off, on, MODEL)).toHaveProperty('keepKeyInDecaid', false);
    expect(fillBlankSettings(on, off, MODEL)).toHaveProperty('keepKeyInDecaid', true);
    expect(fillBlankSettings(on, makeSettings(), MODEL)).toHaveProperty('keepKeyInDecaid', true);
  });

  it('takes the incoming key-copy choice only on a device that never made one, as after its storage was lost', () => {
    expect(fillBlankSettings(makeSettings(), makeSettings({ keepKeyInDecaid: true }), MODEL)).toHaveProperty('keepKeyInDecaid', true);
    expect(fillBlankSettings(makeSettings(), makeSettings({ keepKeyInDecaid: false }), MODEL)).toHaveProperty('keepKeyInDecaid', false);
    expect(fillBlankSettings(makeSettings(), makeSettings(), MODEL)).not.toHaveProperty('keepKeyInDecaid');
  });
});

describe('the key-copy choice through an import (D99)', () => {
  function setup() {
    const handle = createDbHandle((onLost) => openCafaiDb(uniqueDbName(), onLost));
    const db = () => handle.get();
    const repos = createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL });
    const porter = createDataPorter({
      db,
      careDb: careDbOfItsOwn(),
      secrets: { getApiKey: async () => null },
      mirror: { schedulePush: () => undefined },
      appVersion: '1.2.3',
      defaultModel: MODEL,
      now: () => new Date('2026-10-04T09:30:00.000Z'),
    });
    return { repos, porter };
  }
  const exportWith = (settings: Settings): CafaiExport => ({
    format: 'cafai-export',
    schemaVersion: 1,
    exportedAt: '2026-10-04T09:00:00.000Z',
    appVersion: '1.2.3',
    settings,
    bags: [],
    versions: [],
    iterations: [],
    conversations: [],
  });

  it('an import made while it was on never turns it back on after it was turned off here', async () => {
    const { repos, porter } = setup();
    await repos.settings.update({ keepKeyInDecaid: true });
    const exported = (await porter.exportAll()).settings;
    await repos.settings.update({ keepKeyInDecaid: false });
    await porter.importAll(exportWith(exported), 'merge');
    expect((await repos.settings.get()).keepKeyInDecaid).toBe(false);
  });

  it('a device that never chose takes it, even after other settings were saved there', async () => {
    const { repos, porter } = setup();
    await repos.settings.update({ activeBagId: 'bag_1', grinderName: 'Niche Zero' });
    await porter.importAll(exportWith(makeSettings({ keepKeyInDecaid: true })), 'merge');
    expect(await repos.settings.get()).toMatchObject({ keepKeyInDecaid: true, activeBagId: 'bag_1', grinderName: 'Niche Zero' });
  });
});

describe('machine care (D187)', () => {
  it('reads the water, the filter and the switch leniently: an answer it does not know is not said, the switch on', () => {
    expect(normalizeCareSettings(undefined)).toEqual(DEFAULT_CARE);
    expect(normalizeCareSettings({ water: 'over120', filter: 'v2', reminders: false })).toEqual({ water: 'over120', filter: 'v2', reminders: false });
    expect(normalizeCareSettings({ water: 'hard', filter: 'v3', reminders: 'yes' })).toEqual(DEFAULT_CARE);
    expect(normalizeSettings({ ...makeSettings(), care: { water: 'to120' } }, MODEL).care).toEqual({ water: 'to120', filter: null, reminders: true });
    // Absent until someone answers, as the key-copy choice: the settings of a CafAI that never set it stay as they were.
    expect(normalizeSettings({ model: MODEL }, MODEL)).not.toHaveProperty('care');
    // Once answered it stays, every answer at its default included: that is a choice too.
    expect(normalizeSettings({ ...makeSettings(), care: DEFAULT_CARE }, MODEL).care).toEqual(DEFAULT_CARE);
  });

  it('a patch changes the care block field by field: the water never resets the filter', () => {
    const set = applySettingsPatch(makeSettings(), { care: { water: null, filter: 'v2', reminders: true } }, MODEL);
    const next = applySettingsPatch(set, { care: { water: 'under30' } }, MODEL);
    expect(next.care).toEqual({ water: 'under30', filter: 'v2', reminders: true });
    expect(applySettingsPatch(next, { activeBagId: 'bag_1' }, MODEL).care).toEqual(next.care);
    // A field left undefined is not part of the edit.
    expect(applySettingsPatch(next, { care: { water: undefined, reminders: false } }, MODEL).care).toEqual({ water: 'under30', filter: 'v2', reminders: false });
    // Put back to Not sure, the block stays: answered here.
    expect(applySettingsPatch(next, { care: { water: null, filter: null } }, MODEL).care).toEqual(DEFAULT_CARE);
  });

  it("a merge takes the incoming answers only on a device that never answered, the block whole, as the key-copy choice", () => {
    const incoming = makeSettings({ care: { water: 'over120', filter: 'v1', reminders: false } });
    expect(fillBlankSettings(makeSettings(), incoming, MODEL).care).toEqual({ water: 'over120', filter: 'v1', reminders: false });
    const mine = makeSettings({ care: { water: 'under30', filter: null, reminders: true } });
    expect(fillBlankSettings(mine, incoming, MODEL).care).toEqual({ water: 'under30', filter: null, reminders: true });
    const off = makeSettings({ care: { water: null, filter: 'v2', reminders: false } });
    expect(fillBlankSettings(off, makeSettings(), MODEL).care).toEqual({ water: null, filter: 'v2', reminders: false });
    expect(fillBlankSettings(makeSettings(), makeSettings(), MODEL)).not.toHaveProperty('care');
  });

  it('an answer put back to its default stays a choice: an older export merged in brings nothing back', () => {
    let local = applySettingsPatch(normalizeSettings(null, MODEL), { care: { water: 'over120' } }, MODEL);
    local = applySettingsPatch(local, { care: { water: null } }, MODEL);
    expect(local.care).toEqual(DEFAULT_CARE);
    // An export made before the water went back to Not sure, with the switch off then.
    const older = normalizeSettings({ ...local, care: { water: 'over120', filter: null, reminders: false } }, MODEL);
    expect(fillBlankSettings(local, older, MODEL).care).toEqual(DEFAULT_CARE);
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

  it('reads a tint saved under its old name as the coffee one (D123), and leaves every other id alone', () => {
    expect(normalizeAppearance({ mode: 'light', tint: 'lagoon' })).toEqual({ mode: 'light', tint: 'cold-brew' });
    expect(normalizeAppearance({ mode: 'dark', tint: 'ocean' })).toEqual({ mode: 'dark', tint: 'blueberry' });
    expect(normalizeAppearance({ mode: 'auto', tint: 'steel' })).toEqual({ mode: 'auto', tint: 'tamper' });
    for (const id of ['crema', 'matcha', 'cold-brew', 'blueberry', 'plum', 'cherry', 'tamper', 'forest', 'constructor']) {
      expect(normalizeAppearance({ mode: 'dark', tint: id }).tint, id).toBe(id);
    }
  });

  it('a look stored, backed up or exported before the rename comes back under the new name', async () => {
    const name = uniqueDbName();
    const handle = createDbHandle((onLost) => openCafaiDb(name, onLost));
    const db = () => handle.get();
    const repos = createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL });
    await (await db()).put('settings', makeSettings({ appearance: { mode: 'light', tint: 'steel' } }), SETTINGS_KEY);
    expect((await repos.settings.get()).appearance).toEqual({ mode: 'light', tint: 'tamper' });
    // Written back under the new id at the next save.
    await repos.settings.update({ grinderSetting: '14' });
    expect(((await (await db()).get('settings', SETTINGS_KEY)) as Settings).appearance).toEqual({ mode: 'light', tint: 'tamper' });

    const restored = exportFromMirror(
      { settings: makeSettings({ appearance: { mode: 'dark', tint: 'ocean' } }) },
      { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) },
    );
    expect(restored?.settings.appearance).toEqual({ mode: 'dark', tint: 'blueberry' });
  });

  it('takes an imported appearance only while this device still has the default', () => {
    const incoming = { ...defaultSettings(MODEL), appearance: { mode: 'light' as const, tint: 'blueberry' } };
    expect(fillBlankSettings(defaultSettings(MODEL), incoming, MODEL).appearance).toEqual({ mode: 'light', tint: 'blueberry' });
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

describe('the temperature unit (D172)', () => {
  function setup() {
    const handle = createDbHandle((onLost) => openCafaiDb(uniqueDbName(), onLost));
    const db = () => handle.get();
    const repos = createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL });
    const porter = createDataPorter({
      db,
      careDb: careDbOfItsOwn(),
      secrets: { getApiKey: async () => null },
      mirror: { schedulePush: () => undefined },
      appVersion: '1.2.3',
      defaultModel: MODEL,
      now: () => new Date('2026-10-15T09:30:00.000Z'),
    });
    return { db, repos, porter };
  }
  const exportWith = (settings: unknown): CafaiExport =>
    ({
      format: 'cafai-export',
      schemaVersion: 1,
      exportedAt: '2026-10-15T09:00:00.000Z',
      appVersion: '1.2.3',
      settings,
      bags: [],
      versions: [],
      iterations: [],
      conversations: [],
    }) as CafaiExport;

  it('is absent until chosen, so a record saved before it, or by a device that never chose, is unchanged', () => {
    expect(defaultSettings(MODEL)).not.toHaveProperty('temperatureUnit');
    expect(normalizeSettings(makeSettings(), MODEL)).not.toHaveProperty('temperatureUnit');
    expect(applySettingsPatch(makeSettings(), { activeBagId: 'bag_1' }, MODEL)).not.toHaveProperty('temperatureUnit');
  });

  it('keeps °C or °F as chosen, and reads anything else as none chosen', () => {
    expect(normalizeSettings(makeSettings({ temperatureUnit: 'fahrenheit' }), MODEL)).toHaveProperty('temperatureUnit', 'fahrenheit');
    expect(normalizeSettings(makeSettings({ temperatureUnit: 'celsius' }), MODEL)).toHaveProperty('temperatureUnit', 'celsius');
    for (const other of ['F', 'Fahrenheit', 'kelvin', 7, null, {}]) {
      expect(normalizeSettings({ ...makeSettings(), temperatureUnit: other }, MODEL), String(other)).not.toHaveProperty('temperatureUnit');
    }
  });

  it('is patched like any other setting, and kept across other edits', () => {
    const next = applySettingsPatch(makeSettings(), { temperatureUnit: 'fahrenheit' }, MODEL);
    expect(next.temperatureUnit).toBe('fahrenheit');
    expect(applySettingsPatch(next, { grinderSetting: '14' }, MODEL).temperatureUnit).toBe('fahrenheit');
    expect(applySettingsPatch(next, { temperatureUnit: 'celsius' }, MODEL).temperatureUnit).toBe('celsius');
  });

  it('keeps a choice made on this device, °C as much as °F, and fills only a device that never chose', () => {
    const f = makeSettings({ temperatureUnit: 'fahrenheit' });
    const c = makeSettings({ temperatureUnit: 'celsius' });
    expect(fillBlankSettings(c, f, MODEL).temperatureUnit).toBe('celsius');
    expect(fillBlankSettings(f, c, MODEL).temperatureUnit).toBe('fahrenheit');
    expect(fillBlankSettings(makeSettings(), f, MODEL).temperatureUnit).toBe('fahrenheit');
    expect(fillBlankSettings(makeSettings(), makeSettings(), MODEL)).not.toHaveProperty('temperatureUnit');
  });

  it('is stored, exported and imported with the other settings', async () => {
    const { db, repos, porter } = setup();
    await repos.settings.update({ temperatureUnit: 'fahrenheit' });
    expect(((await (await db()).get('settings', SETTINGS_KEY)) as Settings).temperatureUnit).toBe('fahrenheit');
    const exported = await porter.exportAll();
    expect(exported.settings.temperatureUnit).toBe('fahrenheit');
    for (const mode of ['replace', 'merge'] as const) {
      const other = setup();
      await other.porter.importAll(exportWith(exported.settings), mode);
      expect((await other.repos.settings.get()).temperatureUnit, mode).toBe('fahrenheit');
    }
  });

  it("imports a file from a newer CafAI with a unit this one does not know, without the unit", async () => {
    const { repos, porter } = setup();
    await porter.importAll(exportWith({ ...makeSettings(), temperatureUnit: 'kelvin' }), 'replace');
    expect(await repos.settings.get()).not.toHaveProperty('temperatureUnit');
  });

  it('survives the Decaid mirror round trip', () => {
    const settings = makeSettings({ temperatureUnit: 'fahrenheit' });
    const { entries } = buildMirrorEntries({ settings, bags: [], versions: [], iterations: [], conversations: [] }, null, MODEL);
    const data = Object.fromEntries([...entries].map(([key, text]) => [key, JSON.parse(text)]));
    const restored = exportFromMirror(data, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings.temperatureUnit).toBe('fahrenheit');
  });
});

describe('where fun facts come from (D198)', () => {
  it('is absent until chosen, so a record saved before it, or by a device that never chose, is unchanged', () => {
    expect(defaultSettings(MODEL)).not.toHaveProperty('funFacts');
    expect(normalizeSettings(makeSettings(), MODEL)).not.toHaveProperty('funFacts');
    expect(applySettingsPatch(makeSettings(), { activeBagId: 'bag_1' }, MODEL)).not.toHaveProperty('funFacts');
  });

  it('keeps each of the four choices, and reads anything else as none chosen', () => {
    for (const source of ['off', 'list', 'coach', 'web'] as const) {
      expect(normalizeSettings(makeSettings({ funFacts: source }), MODEL), source).toHaveProperty('funFacts', source);
    }
    for (const other of ['Off', 'search', 1, null, {}]) {
      expect(normalizeSettings({ ...makeSettings(), funFacts: other }, MODEL), String(other)).not.toHaveProperty('funFacts');
    }
  });

  it('is patched like any other setting, and kept across other edits', () => {
    const next = applySettingsPatch(makeSettings(), { funFacts: 'off' }, MODEL);
    expect(next.funFacts).toBe('off');
    expect(applySettingsPatch(next, { grinderSetting: '14' }, MODEL).funFacts).toBe('off');
    expect(applySettingsPatch(next, { funFacts: 'web' }, MODEL).funFacts).toBe('web');
  });

  it('keeps a choice made on this device, Off as much as any other, and fills only a device that never chose', () => {
    const off = makeSettings({ funFacts: 'off' });
    const web = makeSettings({ funFacts: 'web' });
    expect(fillBlankSettings(off, web, MODEL).funFacts).toBe('off');
    expect(fillBlankSettings(web, off, MODEL).funFacts).toBe('web');
    expect(fillBlankSettings(makeSettings(), web, MODEL).funFacts).toBe('web');
    expect(fillBlankSettings(makeSettings(), makeSettings(), MODEL)).not.toHaveProperty('funFacts');
  });

  it('survives the Decaid mirror round trip', () => {
    const settings = makeSettings({ funFacts: 'list' });
    const { entries } = buildMirrorEntries({ settings, bags: [], versions: [], iterations: [], conversations: [] }, null, MODEL);
    const data = Object.fromEntries([...entries].map(([key, text]) => [key, JSON.parse(text)]));
    const restored = exportFromMirror(data, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings.funFacts).toBe('list');
  });
});

describe('the drinks’ screens (D222)', () => {
  it('is absent until chosen, so a record saved before it, or by a device that never chose, is unchanged', () => {
    expect(defaultSettings(MODEL)).not.toHaveProperty('drinkScreens');
    expect(normalizeSettings(makeSettings(), MODEL)).not.toHaveProperty('drinkScreens');
    expect(applySettingsPatch(makeSettings(), { activeBagId: 'bag_1' }, MODEL)).not.toHaveProperty('drinkScreens');
  });

  it('keeps each drink’s fields that read and leaves out the rest, so they read as the defaults', () => {
    expect(
      normalizeDrinkScreens({
        steam: { scene: 'whirlpool', goBack: false, goBackSeconds: 20 },
        hotWater: { scene: 'Pour!', goBack: 'yes', goBackSeconds: 'ten' },
        flush: { goBackSeconds: 7.4 },
        espresso: { scene: 'spray' },
      }),
    ).toEqual({ steam: { scene: 'whirlpool', goBack: false, goBackSeconds: 20 }, flush: { goBackSeconds: 7 } });
    expect(normalizeDrinkScreens(null)).toEqual({});
    expect(normalizeDrinkScreens({ steam: 'spray' })).toEqual({});
  });

  it('keeps a scene this build does not know, for the build that does', () => {
    expect(normalizeDrinkScreens({ steam: { scene: 'tornado' } })).toEqual({ steam: { scene: 'tornado' } });
  });

  it('keeps the seconds whole and within 5-60', () => {
    expect(normalizeDrinkScreens({ steam: { goBackSeconds: 2 } }).steam?.goBackSeconds).toBe(5);
    expect(normalizeDrinkScreens({ steam: { goBackSeconds: 600 } }).steam?.goBackSeconds).toBe(60);
    expect(normalizeDrinkScreens({ steam: { goBackSeconds: 12.5 } }).steam?.goBackSeconds).toBe(13);
    expect(normalizeDrinkScreens({ steam: { goBackSeconds: Number.NaN } })).toEqual({});
  });

  it('is patched one field of one drink at a time, every other kept', () => {
    const first = applySettingsPatch(makeSettings(), { drinkScreens: { steam: { scene: 'rosetta' } } }, MODEL);
    expect(first.drinkScreens).toEqual({ steam: { scene: 'rosetta' } });
    const second = applySettingsPatch(first, { drinkScreens: { steam: { goBack: false }, flush: { goBackSeconds: 5 } } }, MODEL);
    expect(second.drinkScreens).toEqual({ steam: { scene: 'rosetta', goBack: false }, flush: { goBackSeconds: 5 } });
    expect(applySettingsPatch(second, { grinderSetting: '14' }, MODEL).drinkScreens).toEqual(second.drinkScreens);
    expect(applySettingsPatch(second, { drinkScreens: { steam: { scene: undefined } } }, MODEL).drinkScreens?.steam).toEqual({
      scene: 'rosetta',
      goBack: false,
    });
  });

  it('keeps the choices made on this device whole, and fills only a device that never chose', () => {
    const mine = makeSettings({ drinkScreens: { steam: { goBack: false } } });
    const theirs = makeSettings({ drinkScreens: { flush: { scene: 'screen' } } });
    expect(fillBlankSettings(mine, theirs, MODEL).drinkScreens).toEqual({ steam: { goBack: false } });
    expect(fillBlankSettings(makeSettings(), theirs, MODEL).drinkScreens).toEqual({ flush: { scene: 'screen' } });
    expect(fillBlankSettings(makeSettings(), makeSettings(), MODEL)).not.toHaveProperty('drinkScreens');
  });

  it('survives the Decaid mirror round trip', () => {
    const settings = makeSettings({ drinkScreens: { hotWater: { scene: 'above', goBackSeconds: 30 } } });
    const { entries } = buildMirrorEntries({ settings, bags: [], versions: [], iterations: [], conversations: [] }, null, MODEL);
    const data = Object.fromEntries([...entries].map(([key, text]) => [key, JSON.parse(text)]));
    const restored = exportFromMirror(data, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings.drinkScreens).toEqual({ hotWater: { scene: 'above', goBackSeconds: 30 } });
  });
});

describe('the screensaver (D225)', () => {
  function setup() {
    const handle = createDbHandle((onLost) => openCafaiDb(uniqueDbName(), onLost));
    const db = () => handle.get();
    const repos = createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL });
    const porter = createDataPorter({
      db,
      careDb: careDbOfItsOwn(),
      secrets: { getApiKey: async () => null },
      mirror: { schedulePush: () => undefined },
      appVersion: '1.2.3',
      defaultModel: MODEL,
      now: () => new Date('2026-10-22T09:30:00.000Z'),
    });
    return { repos, porter };
  }
  const exportWith = (settings: unknown): CafaiExport =>
    ({
      format: 'cafai-export',
      schemaVersion: 1,
      exportedAt: '2026-10-22T09:00:00.000Z',
      appVersion: '1.2.3',
      settings,
      bags: [],
      versions: [],
      iterations: [],
      conversations: [],
    }) as CafaiExport;

  it('is absent until changed here, and reads as on, a different one each day', () => {
    expect(DEFAULT_SCREENSAVER).toEqual({ on: true, pick: 'daily' });
    expect(defaultSettings(MODEL)).not.toHaveProperty('screensaver');
    expect(normalizeSettings(makeSettings(), MODEL)).not.toHaveProperty('screensaver');
    expect(applySettingsPatch(makeSettings(), { activeBagId: 'bag_1' }, MODEL)).not.toHaveProperty('screensaver');
  });

  it('reads the switch and the pick leniently, field by field', () => {
    expect(normalizeScreensaver(undefined)).toEqual(DEFAULT_SCREENSAVER);
    expect(normalizeScreensaver('off')).toEqual(DEFAULT_SCREENSAVER);
    expect(normalizeScreensaver({ on: false, pick: 'beanfield' })).toEqual({ on: false, pick: 'beanfield' });
    // A pick this build does not know is kept: a newer CafAI's choice survives, and the screen shows the day's.
    expect(normalizeScreensaver({ on: true, pick: 'etching' })).toEqual({ on: true, pick: 'etching' });
    expect(normalizeScreensaver({ on: 'no', pick: 7 })).toEqual(DEFAULT_SCREENSAVER);
    expect(normalizeScreensaver({ on: false, pick: '' })).toEqual({ on: false, pick: 'daily' });
    expect(normalizeScreensaver({ on: false, pick: 'x'.repeat(40) }).pick).toBe('x'.repeat(40));
    expect(normalizeScreensaver({ on: false, pick: 'x'.repeat(41) }).pick).toBe('daily');
    expect(normalizeSettings({ ...makeSettings(), screensaver: { pick: 'rain' } }, MODEL).screensaver).toEqual({ on: true, pick: 'rain' });
    // Once changed it stays, the default's values included: that is a choice too.
    expect(normalizeSettings({ ...makeSettings(), screensaver: DEFAULT_SCREENSAVER }, MODEL).screensaver).toEqual(DEFAULT_SCREENSAVER);
    expect(normalizeSettings({ ...makeSettings(), screensaver: true }, MODEL)).not.toHaveProperty('screensaver');
  });

  it('is patched whole like any other setting, and kept across other edits', () => {
    const next = applySettingsPatch(makeSettings(), { screensaver: { on: false, pick: 'steam' } }, MODEL);
    expect(next.screensaver).toEqual({ on: false, pick: 'steam' });
    expect(applySettingsPatch(next, { grinderSetting: '14' }, MODEL).screensaver).toEqual({ on: false, pick: 'steam' });
    expect(applySettingsPatch(next, { screensaver: { on: true, pick: 'daily' } }, MODEL).screensaver).toEqual(DEFAULT_SCREENSAVER);
  });

  it('keeps a choice made on this device, turned off as much as on, and fills only a device that never chose', () => {
    const off = makeSettings({ screensaver: { on: false, pick: 'daily' } });
    const lava = makeSettings({ screensaver: { on: true, pick: 'lava' } });
    expect(fillBlankSettings(off, lava, MODEL).screensaver).toEqual({ on: false, pick: 'daily' });
    expect(fillBlankSettings(lava, off, MODEL).screensaver).toEqual({ on: true, pick: 'lava' });
    expect(fillBlankSettings(makeSettings(), lava, MODEL).screensaver).toEqual({ on: true, pick: 'lava' });
    expect(fillBlankSettings(makeSettings(), makeSettings(), MODEL)).not.toHaveProperty('screensaver');
  });

  it('is stored, exported and imported with the other settings, a pick from a newer CafAI included', async () => {
    const { repos, porter } = setup();
    await repos.settings.update({ screensaver: { on: false, pick: 'portafilter' } });
    expect((await repos.settings.get()).screensaver).toEqual({ on: false, pick: 'portafilter' });
    const exported = await porter.exportAll();
    expect(exported.settings.screensaver).toEqual({ on: false, pick: 'portafilter' });
    for (const mode of ['replace', 'merge'] as const) {
      const other = setup();
      await other.porter.importAll(exportWith({ ...exported.settings, screensaver: { on: true, pick: 'latteArt' } }), mode);
      expect((await other.repos.settings.get()).screensaver, mode).toEqual({ on: true, pick: 'latteArt' });
    }
  });

  it('survives the Decaid mirror round trip', () => {
    const settings = makeSettings({ screensaver: { on: false, pick: 'nightstand' } });
    const { entries } = buildMirrorEntries({ settings, bags: [], versions: [], iterations: [], conversations: [] }, null, MODEL);
    const data = Object.fromEntries([...entries].map(([key, text]) => [key, JSON.parse(text)]));
    const restored = exportFromMirror(data, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings.screensaver).toEqual({ on: false, pick: 'nightstand' });
  });
});

describe('the choice to keep where the coach runs in Decaid (D229)', () => {
  function setup() {
    const handle = createDbHandle((onLost) => openCafaiDb(uniqueDbName(), onLost));
    const db = () => handle.get();
    const repos = createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL });
    const porter = createDataPorter({
      db,
      careDb: careDbOfItsOwn(),
      secrets: { getApiKey: async () => null },
      mirror: { schedulePush: () => undefined },
      appVersion: '1.2.3',
      defaultModel: MODEL,
      now: () => new Date('2026-10-23T21:00:00.000Z'),
    });
    return { repos, porter };
  }
  const exportWith = (settings: Settings): CafaiExport => ({
    format: 'cafai-export',
    schemaVersion: 1,
    exportedAt: '2026-10-23T20:00:00.000Z',
    appVersion: '1.2.3',
    settings,
    bags: [],
    versions: [],
    iterations: [],
    conversations: [],
  });

  it('is absent until someone chooses on this device, and only a yes or a no is kept', () => {
    expect(defaultSettings(MODEL)).not.toHaveProperty('keepCoachSourceInDecaid');
    expect(normalizeSettings(makeSettings(), MODEL)).not.toHaveProperty('keepCoachSourceInDecaid');
    expect(normalizeSettings({ ...makeSettings(), keepCoachSourceInDecaid: 'yes' }, MODEL)).not.toHaveProperty('keepCoachSourceInDecaid');
    expect(normalizeSettings(makeSettings({ keepCoachSourceInDecaid: false }), MODEL)).toHaveProperty('keepCoachSourceInDecaid', false);
    expect(normalizeSettings(makeSettings({ keepCoachSourceInDecaid: true }), MODEL)).toHaveProperty('keepCoachSourceInDecaid', true);
    expect(applySettingsPatch(makeSettings(), { activeBagId: 'bag_1' }, MODEL)).not.toHaveProperty('keepCoachSourceInDecaid');
    const off = applySettingsPatch(makeSettings(), { keepCoachSourceInDecaid: false }, MODEL);
    expect(off).toHaveProperty('keepCoachSourceInDecaid', false);
    expect(applySettingsPatch(off, { grinderSetting: '14' }, MODEL)).toHaveProperty('keepCoachSourceInDecaid', false);
  });

  it('keeps a choice made on this device, off as much as on, and fills only a device that never chose', () => {
    const on = makeSettings({ keepCoachSourceInDecaid: true });
    const off = makeSettings({ keepCoachSourceInDecaid: false });
    expect(fillBlankSettings(off, on, MODEL)).toHaveProperty('keepCoachSourceInDecaid', false);
    expect(fillBlankSettings(on, off, MODEL)).toHaveProperty('keepCoachSourceInDecaid', true);
    expect(fillBlankSettings(makeSettings(), off, MODEL)).toHaveProperty('keepCoachSourceInDecaid', false);
    expect(fillBlankSettings(makeSettings(), makeSettings(), MODEL)).not.toHaveProperty('keepCoachSourceInDecaid');
  });

  it('is stored, exported and imported with the other settings', async () => {
    const { repos, porter } = setup();
    await repos.settings.update({ keepCoachSourceInDecaid: false });
    expect((await repos.settings.get()).keepCoachSourceInDecaid).toBe(false);
    const exported = await porter.exportAll();
    expect(exported.settings.keepCoachSourceInDecaid).toBe(false);
    for (const mode of ['replace', 'merge'] as const) {
      const other = setup();
      await other.porter.importAll(exportWith(exported.settings), mode);
      expect((await other.repos.settings.get()).keepCoachSourceInDecaid, mode).toBe(false);
    }
  });

  it('survives the Decaid mirror round trip, so turned off it stays off on a new origin', () => {
    const settings = makeSettings({ keepCoachSourceInDecaid: false });
    const { entries } = buildMirrorEntries({ settings, bags: [], versions: [], iterations: [], conversations: [] }, null, MODEL);
    const data = Object.fromEntries([...entries].map(([key, text]) => [key, JSON.parse(text)]));
    const restored = exportFromMirror(data, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings.keepCoachSourceInDecaid).toBe(false);
  });
});

describe('the settings of Settings regrouped (D240, D241, D243, D245, D246, D247)', () => {
  function setup() {
    const handle = createDbHandle((onLost) => openCafaiDb(uniqueDbName(), onLost));
    const db = () => handle.get();
    const repos = createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL });
    const porter = createDataPorter({
      db,
      careDb: careDbOfItsOwn(),
      secrets: { getApiKey: async () => null },
      mirror: { schedulePush: () => undefined },
      appVersion: '1.2.3',
      defaultModel: MODEL,
      now: () => new Date('2026-10-24T21:00:00.000Z'),
    });
    return { repos, porter };
  }
  const exportWith = (settings: Settings): CafaiExport => ({
    format: 'cafai-export',
    schemaVersion: 1,
    exportedAt: '2026-10-24T20:00:00.000Z',
    appVersion: '1.2.3',
    settings,
    bags: [],
    versions: [],
    iterations: [],
    conversations: [],
  });
  const FIELDS = ['coachEffort', 'coachBudget', 'grinderFinerHigher', 'clock', 'showTds'] as const;
  const chosen = (): Partial<Settings> => ({
    coachEffort: 'high',
    coachBudget: { monthlyUsd: 5, pauseAtBudget: true },
    grinderFinerHigher: ['id:grinder-1', 'name:niche zero'],
    clock: '12h',
    showTds: false,
  });

  it('are absent until someone chooses on this device', () => {
    const settings = normalizeSettings(makeSettings(), MODEL);
    for (const field of FIELDS) {
      expect(defaultSettings(MODEL), field).not.toHaveProperty(field);
      expect(settings, field).not.toHaveProperty(field);
    }
    expect(DEFAULT_COACH_EFFORT).toBe('medium');
    expect(DEFAULT_CLOCK).toBe('24h');
    expect(DEFAULT_BUDGET).toEqual({ monthlyUsd: null, pauseAtBudget: false });
  });

  it('keep every valid choice', () => {
    expect(normalizeSettings({ ...makeSettings(), ...chosen() }, MODEL)).toMatchObject(chosen());
  });

  it('read leniently: a value this build does not know reads as none chosen', () => {
    const settings = normalizeSettings({ ...makeSettings(), coachEffort: 'max', clock: '13h', showTds: 'no' }, MODEL);
    expect(settings).not.toHaveProperty('coachEffort');
    expect(settings).not.toHaveProperty('clock');
    expect(settings).not.toHaveProperty('showTds');
  });

  it('keep a budget in whole dollars from 1 to 1,000, or none, and the pause off unless it says on', () => {
    expect(normalizeCoachBudget({ monthlyUsd: 4.6, pauseAtBudget: true })).toEqual({ monthlyUsd: 5, pauseAtBudget: true });
    expect(normalizeCoachBudget({ monthlyUsd: 0 })).toEqual({ monthlyUsd: 1, pauseAtBudget: false });
    expect(normalizeCoachBudget({ monthlyUsd: 5000, pauseAtBudget: 'yes' })).toEqual({ monthlyUsd: 1000, pauseAtBudget: false });
    expect(normalizeCoachBudget({ monthlyUsd: null, pauseAtBudget: true })).toEqual({ monthlyUsd: null, pauseAtBudget: true });
    expect(normalizeCoachBudget({ monthlyUsd: Number.NaN })).toEqual(DEFAULT_BUDGET);
    expect(normalizeCoachBudget('5')).toEqual(DEFAULT_BUDGET);
  });

  it('change the budget field by field: setting the dollars never turns the pause off', () => {
    const paused = applySettingsPatch(makeSettings(), { coachBudget: { pauseAtBudget: true } }, MODEL);
    expect(paused.coachBudget).toEqual({ monthlyUsd: null, pauseAtBudget: true });
    const set = applySettingsPatch(paused, { coachBudget: { monthlyUsd: 8 } }, MODEL);
    expect(set.coachBudget).toEqual({ monthlyUsd: 8, pauseAtBudget: true });
    expect(applySettingsPatch(set, { coachBudget: { monthlyUsd: null } }, MODEL).coachBudget).toEqual({ monthlyUsd: null, pauseAtBudget: true });
    expect(applySettingsPatch(set, { activeBagId: 'bag_1' }, MODEL).coachBudget).toEqual(set.coachBudget);
  });

  it("keep the grinders' directions as a clean list: each key once, nothing key-shaped, an emptied list a choice too", () => {
    expect(normalizeGrinderFinerHigher(['id:a', 'id:a', '', 7, 'x'.repeat(81), `name:${PASTED_KEY}`, 'name:ek43'])).toEqual(['id:a', 'name:ek43']);
    expect(normalizeGrinderFinerHigher(Array.from({ length: 60 }, (_, i) => `id:g${i}`))).toHaveLength(50);
    expect(normalizeGrinderFinerHigher('id:a')).toEqual([]);
    expect(normalizeSettings({ ...makeSettings(), grinderFinerHigher: [] }, MODEL).grinderFinerHigher).toEqual([]);
  });

  it("name a grinder's direction by Decaid's id while linked, else by the typed name, and read it back", () => {
    expect(grinderDirectionKey({ grinderId: 'g-9', grinderName: 'Niche Zero' })).toBe('id:g-9');
    expect(grinderDirectionKey({ grinderId: null, grinderName: '  Niche   Zero ' })).toBe('name:niche zero');
    expect(grinderDirectionKey({ grinderId: '  ', grinderName: '' })).toBeNull();
    const linked = { grinderId: 'g-9', grinderName: 'Niche Zero', grinderFinerHigher: ['id:g-9'] };
    expect(finerIsHigher(linked)).toBe(true);
    expect(finerIsHigher({ ...linked, grinderId: 'g-10' })).toBe(false);
    expect(finerIsHigher({ grinderId: null, grinderName: 'Niche Zero' })).toBe(false);
    expect(withGrinderDirection(['id:a'], 'id:b', true)).toEqual(['id:a', 'id:b']);
    expect(withGrinderDirection(['id:a', 'id:b'], 'id:b', true)).toEqual(['id:a', 'id:b']);
    expect(withGrinderDirection(['id:a', 'id:b'], 'id:a', false)).toEqual(['id:b']);
    expect(withGrinderDirection(undefined, 'id:a', false)).toEqual([]);
  });

  it("keep the screensaver's wait and brightness only at a value on offer (D247)", () => {
    expect(normalizeScreensaver({ on: true, pick: 'daily', startAfterMinutes: 5, dimTo: 20 })).toEqual({
      on: true,
      pick: 'daily',
      startAfterMinutes: 5,
      dimTo: 20,
    });
    expect(normalizeScreensaver({ on: true, pick: 'daily', startAfterMinutes: 3, dimTo: 25 })).toEqual(DEFAULT_SCREENSAVER);
    expect(normalizeScreensaver({ on: false, pick: 'nightstand', startAfterMinutes: 15, dimTo: 70 })).toEqual({
      on: false,
      pick: 'nightstand',
      startAfterMinutes: 15,
    });
    expect(SAVER_START_AFTER_MINUTES).toEqual([1, 2, 5, 10, 15]);
    expect(SAVER_DIM_TO).toEqual({ min: 10, max: 60, step: 10 });
  });

  it('merge as the unit: a choice made here wins whole; a device that never chose takes the incoming one', () => {
    expect(fillBlankSettings(makeSettings(), makeSettings(chosen()), MODEL)).toMatchObject(chosen());
    const mine: Partial<Settings> = {
      coachEffort: 'low',
      coachBudget: { monthlyUsd: null, pauseAtBudget: false },
      grinderFinerHigher: [],
      clock: '24h',
      showTds: true,
    };
    expect(fillBlankSettings(makeSettings(mine), makeSettings(chosen()), MODEL)).toMatchObject(mine);
    const none = fillBlankSettings(makeSettings(), makeSettings(), MODEL);
    for (const field of FIELDS) expect(none, field).not.toHaveProperty(field);
  });

  it('are stored, exported and imported with the other settings', async () => {
    const { repos, porter } = setup();
    await repos.settings.update(chosen());
    expect(await repos.settings.get()).toMatchObject(chosen());
    const exported = await porter.exportAll();
    expect(exported.settings).toMatchObject(chosen());
    for (const mode of ['replace', 'merge'] as const) {
      const other = setup();
      await other.porter.importAll(exportWith(exported.settings), mode);
      expect(await other.repos.settings.get(), mode).toMatchObject(chosen());
    }
  });

  it('survive the Decaid mirror round trip, so a new origin gets them back', () => {
    const settings = makeSettings(chosen());
    const { entries } = buildMirrorEntries({ settings, bags: [], versions: [], iterations: [], conversations: [] }, null, MODEL);
    const data = Object.fromEntries([...entries].map(([key, text]) => [key, JSON.parse(text)]));
    const restored = exportFromMirror(data, { appVersion: '1.2.3', defaultModel: MODEL, now: () => new Date(0) });
    expect(restored?.settings).toMatchObject(chosen());
  });
});
