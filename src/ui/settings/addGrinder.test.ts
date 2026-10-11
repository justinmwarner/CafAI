import { describe, expect, it } from 'vitest';
import { NO_GRINDER_LIBRARY, type Grinder } from '../../api/grinders.ts';
import { GatewayError } from '../../api/types.ts';
import {
  KEY_REFUSED,
  NEEDS_MODEL,
  NEEDS_SETTINGS,
  SETTING_TOO_LONG,
  STEP_HELP,
  TOO_MANY_SETTINGS,
  addGrinderError,
  addedNote,
  checkAddGrinder,
  dye2GrindersUrl,
  emptyAddGrinderForm,
  parseSettings,
  parseStep,
  type AddGrinderForm,
} from './addGrinder.ts';

const form = (fields: Partial<AddGrinderForm>): AddGrinderForm => ({ ...emptyAddGrinderForm('Niche Zero'), ...fields });
const KEY = 'sk-ant-api03-abcdefghijklmnop';

describe('emptyAddGrinderForm', () => {
  it('starts from the grinder name typed in Settings, with a numbered dial', () => {
    expect(emptyAddGrinderForm('  DF64 ')).toEqual({ model: 'DF64', burrs: '', dial: 'numeric', smallStep: '', bigStep: '', settings: '' });
    expect(emptyAddGrinderForm().model).toBe('');
  });
});

describe('parseStep and parseSettings: what was typed', () => {
  it('reads a step with a point or a comma; blank is no step, anything else not one', () => {
    expect(parseStep(' 0.5 ')).toBe(0.5);
    expect(parseStep('0,25')).toBe(0.25);
    expect(parseStep('2')).toBe(2);
    expect(parseStep('  ')).toBeNull();
    for (const text of ['0', '-1', 'half', '1/2', 'Infinity']) expect(parseStep(text), text).toBeNaN();
  });

  it('splits settings at commas and new lines, blanks left out', () => {
    expect(parseSettings(' 1, 2,,3\n4 , ')).toEqual(['1', '2', '3', '4']);
    expect(parseSettings('  ')).toEqual([]);
  });
});

describe('checkAddGrinder', () => {
  it('sends the model alone when nothing else was typed', () => {
    expect(checkAddGrinder(form({}))).toEqual({ ok: true, request: { model: 'Niche Zero', settingType: 'numeric' } });
  });

  it('sends a numbered dial with its steps and the burrs', () => {
    expect(checkAddGrinder(form({ burrs: ' 63 mm conical ', smallStep: '0,5', bigStep: '2' }))).toEqual({
      ok: true,
      request: { model: 'Niche Zero', burrs: '63 mm conical', settingType: 'numeric', settingSmallStep: 0.5, settingBigStep: 2 },
    });
  });

  it("sends a list of settings, finest first, and never a numbered dial's steps typed before switching", () => {
    expect(checkAddGrinder(form({ dial: 'preset', settings: '1, 2, 3', smallStep: '0.5' }))).toEqual({
      ok: true,
      request: { model: 'Niche Zero', settingType: 'preset', settingValues: ['1', '2', '3'] },
    });
  });

  it('says which field to fix, and how', () => {
    expect(checkAddGrinder(form({ model: '  ' }))).toEqual({ ok: false, field: 'model', message: NEEDS_MODEL });
    expect(checkAddGrinder(form({ smallStep: 'half' }))).toEqual({ ok: false, field: 'smallStep', message: STEP_HELP });
    expect(checkAddGrinder(form({ smallStep: '1', bigStep: '0' }))).toEqual({ ok: false, field: 'bigStep', message: STEP_HELP });
    expect(checkAddGrinder(form({ dial: 'preset', settings: ' , ' }))).toEqual({ ok: false, field: 'settings', message: NEEDS_SETTINGS });
    expect(checkAddGrinder(form({ dial: 'preset', settings: `1, ${'x'.repeat(21)}` }))).toEqual({
      ok: false,
      field: 'settings',
      message: SETTING_TOO_LONG,
    });
    const many = Array.from({ length: 101 }, (_, index) => String(index + 1)).join(',');
    expect(checkAddGrinder(form({ dial: 'preset', settings: many }))).toEqual({ ok: false, field: 'settings', message: TOO_MANY_SETTINGS });
  });

  it('a step left on a list of settings, or a setting left on a numbered dial, is not checked: it is not sent', () => {
    expect(checkAddGrinder(form({ dial: 'preset', settings: '1, 2', smallStep: 'half' })).ok).toBe(true);
    expect(checkAddGrinder(form({ settings: ' , ' })).ok).toBe(true);
  });

  it('refuses a key in any field rather than send it to Decaid (D69)', () => {
    expect(checkAddGrinder(form({ model: `Niche ${KEY}` }))).toEqual({ ok: false, field: 'model', message: KEY_REFUSED });
    expect(checkAddGrinder(form({ burrs: KEY }))).toEqual({ ok: false, field: 'burrs', message: KEY_REFUSED });
    expect(checkAddGrinder(form({ dial: 'preset', settings: `1, ${KEY}` }))).toEqual({ ok: false, field: 'settings', message: KEY_REFUSED });
  });
});

describe('what Settings says', () => {
  const philos: Grinder = { id: 'g', model: 'Mazzer Philos', burrs: '64 mm flat', archived: false, settingType: 'numeric' };

  it('after the grinder is added, or found in Decaid already', () => {
    expect(addedNote(philos, true)).toBe("Added Mazzer Philos (64 mm flat) to Decaid's grinders. Save settings to use it.");
    expect(addedNote(philos, false)).toBe('Decaid already has Mazzer Philos (64 mm flat), so CafAI picked it. Save settings to use it.');
  });

  it('when the grinder could not be added: Decaid without a library, or Decaid’s own words', () => {
    expect(addGrinderError(new GatewayError(404, '/api/v1/grinders', 'Route not found', 'http'))).toBe(NO_GRINDER_LIBRARY);
    expect(addGrinderError(new GatewayError(0, '/api/v1/grinders', 'Could not reach Decaid.', 'network'))).toBe(
      "Couldn't add the grinder: Could not reach Decaid.",
    );
  });
});

describe('dye2GrindersUrl', () => {
  it("is DYE2's Grinders page on Decaid's origin, which keeps it inside Decaid's window", () => {
    expect(dye2GrindersUrl('http://localhost:8080/')).toBe('http://localhost:8080/api/v1/plugins/dye2.reaplugin/grinders');
  });
});
