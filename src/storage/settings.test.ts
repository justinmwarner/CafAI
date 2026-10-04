import { describe, expect, it } from 'vitest';
import { applySettingsPatch, defaultSettings, fillBlankSettings, normalizeSettings } from './settings.ts';
import { API_KEY, MODEL, makeSettings } from './testing/fixtures.ts';

describe('defaultSettings', () => {
  it('uses the default model and leaves everything else blank', () => {
    expect(defaultSettings(MODEL)).toEqual({ model: MODEL, grinderName: null, grinderSetting: null, grinderId: null, activeBagId: null });
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
    expect(normalizeSettings(raw, MODEL)).toEqual({ model: MODEL, grinderName: null, grinderSetting: '2.5', grinderId: null, activeBagId: null });
  });

  it('treats a blank model as the default model', () => {
    expect(normalizeSettings({ model: '   ' }, MODEL).model).toBe(MODEL);
  });

  it('never carries fields outside Settings, such as an API key', () => {
    const normalized = normalizeSettings({ ...makeSettings(), apiKey: API_KEY, theme: 'dark' }, MODEL);
    expect(Object.keys(normalized).sort()).toEqual(['activeBagId', 'grinderId', 'grinderName', 'grinderSetting', 'model']);
    expect(JSON.stringify(normalized)).not.toContain(API_KEY);
  });

  it('reads settings saved before grinder links as not linked', () => {
    const older = { model: MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_1' };
    expect(normalizeSettings(older, MODEL)).toEqual({ ...older, grinderId: null });
  });

  it('keeps a linked grinder id, and reads an empty one as no link', () => {
    expect(normalizeSettings(makeSettings({ grinderId: 'c0ffee00-0a5e-4c1e-8a11-000000000001' }), MODEL).grinderId).toBe(
      'c0ffee00-0a5e-4c1e-8a11-000000000001',
    );
    expect(normalizeSettings({ ...makeSettings(), grinderId: '' }, MODEL).grinderId).toBeNull();
    expect(normalizeSettings({ ...makeSettings(), grinderId: '   ' }, MODEL).grinderId).toBeNull();
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
