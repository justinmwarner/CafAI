import { describe, expect, it } from 'vitest';
import type { Grinder } from '../../api/grinders.ts';
import { GatewayError } from '../../api/types.ts';
import {
  canAddGrinder,
  grinderLabel,
  grinderPatch,
  grinderView,
  LIBRARY_HINT,
  libraryAfterError,
  withGrinder,
  missingGrinderLabel,
  MISSING_LINE,
  NO_STEP_LINE,
  NOT_LISTED,
  presetOptions,
  stepLine,
  UNREACHABLE_LINE,
  usesPresetSetting,
  type GrinderForm,
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
    expect(LIBRARY_HINT).toBe("Add your grinder to Decaid's grinder library and CafAI will use its step size.");
    expect(MISSING_LINE).toBe('Decaid no longer lists this grinder, so the coach gives directions only.');
  });

  it('has a line for a linked grinder while Decaid cannot be reached', () => {
    expect(UNREACHABLE_LINE).toBe("Decaid can't be reached right now, so CafAI can't show this grinder's steps.");
  });
});

describe("libraryAfterError: what a failed read of Decaid's list means", () => {
  it('a Decaid without the grinder library (404) answered: it lists no grinders, and none can be added', () => {
    const library = libraryAfterError(new GatewayError(404, '/api/v1/grinders', 'Route not found', 'http'));
    expect(library).toEqual({ status: 'ready', grinders: [], noLibrary: true });
    expect(canAddGrinder(library)).toBe(false);
  });

  it('anything else means the list cannot be read right now, a reply CafAI could not read included', () => {
    for (const error of [
      new GatewayError(0, '/api/v1/grinders', 'Could not reach Decaid.', 'network'),
      new GatewayError(0, '/api/v1/grinders', 'Decaid did not answer in time.', 'timeout'),
      new GatewayError(500, '/api/v1/grinders', 'Internal Server Error', 'http'),
      new GatewayError(200, '/api/v1/grinders', "Decaid sent a reply CafAI doesn't recognise.", 'unexpected_reply'),
      new TypeError('Failed to fetch'),
    ]) {
      expect(libraryAfterError(error), error.message).toEqual({ status: 'unavailable' });
    }
  });
});

describe('canAddGrinder and withGrinder: Add a grinder', () => {
  it('a grinder can be added once Decaid answered with its library, an empty one too', () => {
    expect(canAddGrinder(READY)).toBe(true);
    expect(canAddGrinder({ status: 'ready', grinders: [] })).toBe(true);
    expect(canAddGrinder({ status: 'loading' })).toBe(false);
    expect(canAddGrinder({ status: 'unavailable' })).toBe(false);
  });

  it('puts a grinder CafAI added first, as Decaid lists the newest, and a found one in its place', () => {
    const added = grinder({ id: 'g-new', model: 'Mazzer Philos' });
    expect(withGrinder(READY, added)).toEqual({ status: 'ready', grinders: [added, NICHE, ENCORE] });
    expect(withGrinder({ status: 'ready', grinders: [] }, added)).toEqual({ status: 'ready', grinders: [added] });
    const renamed = { ...ENCORE, burrs: 'M2' };
    expect(withGrinder(READY, renamed)).toEqual({ status: 'ready', grinders: [NICHE, renamed] });
  });
});

describe('grinderView: what the grinder fields show', () => {
  const form = (pick: string, fields: Partial<GrinderForm> = {}): GrinderForm => ({ pick, name: 'Niche Zero', setting: '14', ...fields });
  const LOADING: GrinderLibrary = { status: 'loading' };
  const EMPTY: GrinderLibrary = { status: 'ready', grinders: [] };
  const UNAVAILABLE: GrinderLibrary = { status: 'unavailable' };

  it('a grinder Decaid lists: the picker with its step line, and its setting control', () => {
    expect(grinderView(form('g-niche'), READY)).toEqual({ picker: true, picked: NICHE, lostLink: false, name: false, setting: 'text', line: stepLine(NICHE) });
    expect(grinderView(form('g-encore'), READY)).toMatchObject({ picked: ENCORE, setting: 'preset', line: 'Decaid lists 3 settings for this grinder.' });
  });

  it('"Not in Decaid\'s list": the typed name and a free-text setting, with the hint', () => {
    expect(grinderView(form(NOT_LISTED), READY)).toEqual({ picker: true, picked: null, lostLink: false, name: true, setting: 'text', line: LIBRARY_HINT });
  });

  it('a link Decaid no longer lists is kept and says so, also when Decaid lists no grinders at all', () => {
    for (const library of [READY, EMPTY]) {
      expect(grinderView(form('g-gone'), library), library.status).toEqual({
        picker: true,
        picked: null,
        lostLink: true,
        name: false,
        setting: 'text',
        line: MISSING_LINE,
      });
    }
  });

  it('no grinder linked and none in Decaid: the free-text fields and the hint, no picker', () => {
    for (const library of [EMPTY, UNAVAILABLE]) {
      expect(grinderView(form(NOT_LISTED), library), library.status).toEqual({
        picker: false,
        picked: null,
        lostLink: false,
        name: true,
        setting: 'text',
        line: LIBRARY_HINT,
      });
    }
  });

  it('a linked grinder while Decaid cannot be reached: the free-text fields and why the steps are missing', () => {
    expect(grinderView(form('g-niche'), UNAVAILABLE)).toEqual({ picker: false, picked: null, lostLink: false, name: true, setting: 'text', line: UNREACHABLE_LINE });
  });

  it("the setting control waits for its kind: the settings, and a linked grinder's entry in Decaid's list", () => {
    expect(grinderView(null, LOADING).setting).toBe('pending');
    expect(grinderView(null, READY).setting).toBe('pending');
    expect(grinderView(form('g-encore'), LOADING)).toEqual({ picker: true, picked: null, lostLink: false, name: false, setting: 'pending', line: null });
    // Typed, not linked: free text whatever Decaid lists, so it shows at once.
    expect(grinderView(form(NOT_LISTED), LOADING)).toMatchObject({ picker: true, name: true, setting: 'text', line: null });
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

  it('Decaid lists no grinders: a link is kept as one it no longer lists, a typed name stays unlinked', () => {
    const empty: GrinderLibrary = { status: 'ready', grinders: [] };
    expect(grinderPatch({ pick: 'g-niche', name: 'Niche Zero', setting: '15' }, empty, linked)).toEqual({
      grinderId: 'g-niche',
      grinderName: 'Niche Zero',
      grinderSetting: '15',
    });
    expect(grinderPatch({ pick: NOT_LISTED, name: 'DF64', setting: '15' }, empty, linked)).toEqual({ grinderId: null, grinderName: 'DF64', grinderSetting: '15' });
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
