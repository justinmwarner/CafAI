import { describe, expect, it } from 'vitest';
import type { Grinder } from '../../api/grinders.ts';
import {
  grinderLabel,
  grinderPatch,
  LIBRARY_HINT,
  missingGrinderLabel,
  MISSING_LINE,
  NO_STEP_LINE,
  NOT_LISTED,
  presetOptions,
  stepLine,
  usesPresetSetting,
  type GrinderLibrary,
} from './grinderPicker.ts';

const grinder = (fields: Partial<Grinder>): Grinder => ({ id: 'g', model: 'Niche Zero', archived: false, settingType: 'numeric', ...fields });

const NICHE = grinder({ id: 'g-niche', burrs: '63 mm conical', settingSmallStep: 0.5, settingBigStep: 2 });
const ENCORE = grinder({ id: 'g-encore', model: 'Baratza Encore ESP', settingType: 'preset', settingValues: ['1', '2', '3'] });
const READY: GrinderLibrary = { status: 'ready', grinders: [NICHE, ENCORE] };

describe('grinderLabel', () => {
  it('names the model, with the burrs when Decaid has them', () => {
    expect(grinderLabel(NICHE)).toBe('Niche Zero (63 mm conical)');
    expect(grinderLabel(ENCORE)).toBe('Baratza Encore ESP');
    expect(grinderLabel(grinder({ model: '  ', burrs: ' ' }))).toBe('Unnamed grinder');
  });

  it('names a linked grinder Decaid no longer lists', () => {
    expect(missingGrinderLabel('Niche Zero')).toBe("Niche Zero (no longer in Decaid's list)");
    expect(missingGrinderLabel(null)).toBe("Linked grinder (no longer in Decaid's list)");
  });
});

describe('stepLine: what CafAI will use', () => {
  it('says the step of a numeric grinder, with its big step when there is one', () => {
    expect(stepLine(NICHE)).toBe('Decaid lists steps of 0.5 for this grinder (big steps 2).');
    expect(stepLine(grinder({ settingSmallStep: 1 }))).toBe('Decaid lists steps of 1 for this grinder.');
    expect(stepLine(grinder({ settingSmallStep: 0.1 + 0.2, settingBigStep: 1.5 }))).toBe('Decaid lists steps of 0.3 for this grinder (big steps 1.5).');
  });

  it('counts the settings of a preset grinder', () => {
    const forty = grinder({ settingType: 'preset', settingValues: Array.from({ length: 40 }, (_, i) => String(i + 1)) });
    expect(stepLine(forty)).toBe('Decaid lists 40 settings for this grinder.');
    expect(stepLine(grinder({ settingType: 'preset', settingValues: ['fine'] }))).toBe('Decaid lists 1 setting for this grinder.');
  });

  it('says plainly when Decaid has no step size', () => {
    expect(stepLine(grinder({}))).toBe('Decaid has no step size for this grinder, so the coach gives directions only.');
    expect(NO_STEP_LINE).toBe(stepLine(grinder({ settingType: 'preset', settingValues: [] })));
  });

  it('has the hint for grinders Decaid does not know, and a line for a link Decaid lost', () => {
    expect(LIBRARY_HINT).toBe("Add your grinder to Decaid's grinder library (for example with the DYE2 plugin) and CafAI will use its step size.");
    expect(MISSING_LINE).toBe('Decaid no longer lists this grinder, so the coach gives directions only.');
  });
});

describe('the setting of a preset grinder', () => {
  it('is picked from the list only when Decaid has settings for it', () => {
    expect(usesPresetSetting(ENCORE)).toBe(true);
    expect(usesPresetSetting(NICHE)).toBe(false);
    expect(usesPresetSetting(grinder({ settingType: 'preset' }))).toBe(false);
    expect(usesPresetSetting(null)).toBe(false);
  });

  it('offers the list, keeping the current value even when Decaid does not list it', () => {
    expect(presetOptions(ENCORE, '2')).toEqual([
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
    ]);
    expect(presetOptions(ENCORE, '14.5')[0]).toEqual({ value: '14.5', label: "14.5 (not in Decaid's list)" });
    expect(presetOptions(ENCORE, '')[0]).toEqual({ value: '', label: 'Not set' });
    expect(presetOptions(grinder({ settingType: 'preset', settingValues: ['1', '1', '2'] }), '1').map((o) => o.value)).toEqual(['1', '2']);
  });
});

describe('grinderPatch: what Save writes', () => {
  const unlinked = { grinderId: null, grinderName: 'DF64' };
  const linked = { grinderId: 'g-niche', grinderName: 'Niche Zero' };

  it('a picked grinder: its id, its model as the name, and the setting', () => {
    expect(grinderPatch({ pick: 'g-niche', name: 'whatever was typed', setting: ' 13.5 ' }, READY, unlinked)).toEqual({
      grinderId: 'g-niche',
      grinderName: 'Niche Zero',
      grinderSetting: '13.5',
    });
  });

  it('"Not in Decaid\'s list": the typed name, no link, and blanks as null', () => {
    expect(grinderPatch({ pick: NOT_LISTED, name: ' DF64 ', setting: '2.5' }, READY, linked)).toEqual({
      grinderId: null,
      grinderName: 'DF64',
      grinderSetting: '2.5',
    });
    expect(grinderPatch({ pick: NOT_LISTED, name: '  ', setting: ' ' }, READY, linked)).toEqual({ grinderId: null, grinderName: null, grinderSetting: null });
  });

  it('a linked grinder Decaid no longer lists keeps its link and name', () => {
    expect(grinderPatch({ pick: 'g-gone', name: 'Old grinder', setting: '7' }, READY, { grinderId: 'g-gone', grinderName: 'Old grinder' })).toEqual({
      grinderId: 'g-gone',
      grinderName: 'Old grinder',
      grinderSetting: '7',
    });
  });

  it("without Decaid's list a link stays only while the name is unchanged", () => {
    for (const library of [{ status: 'unavailable' }, { status: 'loading' }] as GrinderLibrary[]) {
      expect(grinderPatch({ pick: 'g-niche', name: 'Niche Zero ', setting: '14' }, library, linked), library.status).toEqual({
        grinderId: 'g-niche',
        grinderName: 'Niche Zero',
        grinderSetting: '14',
      });
      expect(grinderPatch({ pick: 'g-niche', name: 'Lagom P64', setting: '14' }, library, linked), library.status).toEqual({
        grinderId: null,
        grinderName: 'Lagom P64',
        grinderSetting: '14',
      });
      expect(grinderPatch({ pick: NOT_LISTED, name: 'DF64', setting: '' }, library, unlinked), library.status).toEqual({
        grinderId: null,
        grinderName: 'DF64',
        grinderSetting: null,
      });
    }
  });
});
