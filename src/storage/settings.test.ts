import { describe, expect, it } from 'vitest';
import { applySettingsPatch, defaultSettings, fillBlankSettings, normalizeSettings } from './settings.ts';
import { API_KEY, MODEL, makeSettings } from './testing/fixtures.ts';

describe('defaultSettings', () => {
  it('uses the default model and leaves everything else blank', () => {
    expect(defaultSettings(MODEL)).toEqual({ model: MODEL, grinderName: null, grinderSetting: null, activeBagId: null });
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
    const raw = { model: 5, grinderName: 3, grinderSetting: '2.5', activeBagId: {} };
    expect(normalizeSettings(raw, MODEL)).toEqual({ model: MODEL, grinderName: null, grinderSetting: '2.5', activeBagId: null });
  });

  it('treats a blank model as the default model', () => {
    expect(normalizeSettings({ model: '   ' }, MODEL).model).toBe(MODEL);
  });

  it('never carries fields outside Settings, such as an API key', () => {
    const normalized = normalizeSettings({ ...makeSettings(), apiKey: API_KEY, theme: 'dark' }, MODEL);
    expect(Object.keys(normalized).sort()).toEqual(['activeBagId', 'grinderName', 'grinderSetting', 'model']);
    expect(JSON.stringify(normalized)).not.toContain(API_KEY);
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
});
