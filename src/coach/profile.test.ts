// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/profile.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: vitest; gateway-error tests left to src/api; added normalizeProfile tests.
import assert from 'node:assert/strict';
import { describe, expect, it, test } from 'vitest';

import blooming from './templates/source/Blooming_espresso.json';
import dflow from './templates/source/D-Flow____default.json';
import londonium from './templates/source/Londonium.json';
import {
  normalizeProfile,
  parseDecaidProfile,
  ProfileError,
  profileTemperature,
  readExit,
  readProfileStep,
  shiftProfileTemperature,
} from './profile.ts';
import { clone } from '../util/clone.ts';

/**
 * Copied verbatim from a live Decaid 0.8.4 (`GET /api/v1/profiles`, the
 * "Adaptive v3" profile). This is the contract, not a guess from docs.
 */
const realStep = {
  name: 'Fill',
  pump: 'flow',
  transition: 'fast',
  exit: { type: 'pressure', condition: 'over', value: 3.0 },
  volume: 100.0,
  seconds: 12.0,
  weight: 0.0,
  temperature: 93.0,
  sensor: 'coffee',
  flow: 8.0,
  limiter: { value: 0.0, range: 0.6 },
};

test('a real Decaid step round-trips through the parser unchanged', () => {
  assert.deepEqual(readProfileStep(realStep), {
    name: 'Fill',
    pump: 'flow',
    transition: 'fast',
    exit: { type: 'pressure', condition: 'over', value: 3 },
    volume: 100,
    seconds: 12,
    weight: 0,
    temperature: 93,
    sensor: 'coffee',
    flow: 8,
    limiter: { value: 0, range: 0.6 },
  });
});

test('a pressure step carries pressure and not flow, and vice versa', () => {
  const pressure = readProfileStep({ ...realStep, pump: 'pressure', pressure: 6, flow: 8 });
  assert.equal(pressure?.pressure, 6);
  assert.equal(pressure?.flow, undefined, 'a flow target on a pressure step would be ignored by the machine');

  const flow = readProfileStep({ ...realStep, pump: 'flow', flow: 4, pressure: 9 });
  assert.equal(flow?.flow, 4);
  assert.equal(flow?.pressure, undefined);
});

test('a null exit stays null rather than becoming a bogus condition', () => {
  assert.equal(readProfileStep({ ...realStep, exit: null })?.exit, null);
});

test('the Tcl skins flat exit fields are translated, not discarded', () => {
  // A model that has seen many de1app profiles will emit this older shape.
  const legacy = readProfileStep({
    name: 'Fill',
    pump: 'flow',
    flow: 8,
    temperature: 93,
    seconds: 12,
    exit_pressure_over: 3,
  });
  assert.deepEqual(legacy?.exit, { type: 'pressure', condition: 'over', value: 3 });

  const underFlow = readExit(undefined, { exit_flow_under: 1.2 });
  assert.deepEqual(underFlow, { type: 'flow', condition: 'under', value: 1.2 });
});

test('an exit with no value is no exit', () => {
  assert.equal(readExit({ type: 'pressure', condition: 'over' }), null);
  assert.equal(readExit(undefined, { exit_pressure_over: 0 }), null, 'zero is the de1app "unset" marker');
});

test('unknown enum values fall back rather than reaching the machine', () => {
  const step = readProfileStep({ ...realStep, pump: 'magic', transition: 'wobbly', sensor: 'elbow' });
  assert.equal(step?.pump, 'pressure');
  assert.equal(step?.transition, 'fast');
  assert.equal(step?.sensor, 'coffee');
});

test('a nameless step is unusable and dropped', () => {
  assert.equal(readProfileStep({ ...realStep, name: '   ' }), null);
  assert.equal(readProfileStep(null), null);
  assert.equal(readProfileStep('bloom'), null);
});

// ---- temperature ----------------------------------------------------------

const profile = { title: 'p', steps: [realStep, { ...realStep, temperature: 88 }].map(readProfileStep) as never };

test('brew temperature is the hottest step', () => {
  assert.equal(profileTemperature(profile), 93);
});

test('shifting keeps the gaps between stages', () => {
  const shifted = shiftProfileTemperature(profile, 2);
  assert.deepEqual(
    shifted.steps?.map((s) => s.temperature),
    [95, 90],
  );
});

// ---- normalizeProfile: Decaid's Profile.fromJson -> toJson ------------------

describe('normalizeProfile', () => {
  it('parses the bundled string-valued template into numbers', () => {
    const p = normalizeProfile(blooming);
    expect(p.version).toBe('2');
    expect(p.title).toBe('Blooming Espresso');
    expect(p.beverage_type).toBe('espresso');
    expect(p.target_weight).toBe(60);
    expect(p.target_volume).toBe(0);
    expect(p.target_volume_count_start).toBe(2);
    expect(p.tank_temperature).toBe(0);
    expect(p.steps).toHaveLength(6);
    expect(p.steps[0]).toEqual({
      name: 'preinfusion start',
      pump: 'flow',
      transition: 'fast',
      exit: null,
      volume: 500,
      seconds: 2,
      weight: 0,
      temperature: 97.5,
      sensor: 'coffee',
      flow: 4,
      limiter: { value: 0, range: 0.6 },
    });
    expect(p.steps[1]?.exit).toEqual({ type: 'pressure', condition: 'over', value: 4 });
  });

  it('keeps only the active pump target', () => {
    const p = normalizeProfile(dflow);
    expect(p.steps[0]).toHaveProperty('pressure', 3);
    expect(p.steps[0]).not.toHaveProperty('flow');
    expect(p.steps[2]).toHaveProperty('flow', 1.7);
    expect(p.steps[2]).not.toHaveProperty('pressure');
  });

  it('emits exactly the ten profile keys in Decaid order and drops unknown keys', () => {
    expect(Object.keys(normalizeProfile(dflow))).toEqual([
      'version',
      'title',
      'notes',
      'author',
      'beverage_type',
      'steps',
      'target_volume',
      'target_weight',
      'target_volume_count_start',
      'tank_temperature',
    ]);
    expect(Object.keys(normalizeProfile(londonium).steps[6]!)).toEqual([
      'name',
      'pump',
      'transition',
      'exit',
      'volume',
      'seconds',
      'weight',
      'temperature',
      'sensor',
      'flow',
      'limiter',
    ]);
  });

  it('makes absent exit, limiter and weight an explicit null', () => {
    const raw = clone(londonium) as { steps: Record<string, unknown>[] };
    delete raw.steps[2]!['weight'];
    const step = normalizeProfile(raw).steps[2]!;
    expect(step.exit).toBeNull();
    expect(step.limiter).toBeNull();
    expect(step.weight).toBeNull();
  });

  it('keeps 0 and null weights apart, because they hash differently', () => {
    const p = normalizeProfile(blooming);
    expect(p.steps.every((s) => s.weight === 0)).toBe(true);
  });

  it('accepts Dart number spellings', () => {
    const raw = clone(dflow) as Record<string, unknown> & { steps: Record<string, unknown>[] };
    raw['target_weight'] = ' 50.0 ';
    raw.steps[0]!['seconds'] = '25.00';
    raw.steps[0]!['temperature'] = '1e2';
    raw.steps[0]!['volume'] = 100;
    raw['tank_temperature'] = '.5';
    const p = normalizeProfile(raw);
    expect(p.target_weight).toBe(50);
    expect(p.steps[0]?.seconds).toBe(25);
    expect(p.steps[0]?.temperature).toBe(100);
    expect(p.tank_temperature).toBe(0.5);
  });

  it('reads target_volume_count_start as an integer like Dart parseInt', () => {
    const withValue = (v: unknown) => ({ ...clone(dflow), target_volume_count_start: v });
    expect(normalizeProfile(withValue('2')).target_volume_count_start).toBe(2);
    expect(normalizeProfile(withValue(2.0)).target_volume_count_start).toBe(2);
    expect(normalizeProfile(withValue(2.9)).target_volume_count_start).toBe(2);
    expect(() => normalizeProfile(withValue('2.0'))).toThrow(/target_volume_count_start/);
  });

  it('coerces a numeric version to a string', () => {
    expect(normalizeProfile({ ...clone(dflow), version: 2 }).version).toBe('2');
  });

  it('refuses a profile without a version, which CafAI always sends', () => {
    const raw: Record<string, unknown> = clone(dflow);
    delete raw['version'];
    expect(() => normalizeProfile(raw)).toThrow(/version/);
    expect(parseDecaidProfile(raw).version).toBeNull();
  });

  it('refuses the fields Decaid requires on create', () => {
    const without = (key: string) => {
      const raw: Record<string, unknown> = clone(dflow);
      delete raw[key];
      return raw;
    };
    expect(() => normalizeProfile(without('title'))).toThrow(/non-empty "title"/);
    expect(() => normalizeProfile({ ...clone(dflow), title: '' })).toThrow(/non-empty "title"/);
    expect(() => normalizeProfile(without('steps'))).toThrow(/non-empty "steps"/);
    expect(() => normalizeProfile({ ...clone(dflow), steps: [] })).toThrow(/non-empty "steps"/);
    expect(() => normalizeProfile(without('tank_temperature'))).toThrow(/tank_temperature/);
    expect(() => normalizeProfile(without('target_volume_count_start'))).toThrow(/target_volume_count_start/);
    expect(() => normalizeProfile('not a profile')).toThrow(ProfileError);
  });

  it('throws a clear error for invalid enums instead of guessing', () => {
    const withStep = (patch: Record<string, unknown>) => {
      const raw = clone(dflow) as { steps: Record<string, unknown>[] };
      raw.steps[0] = { ...raw.steps[0], ...patch };
      return raw;
    };
    expect(() => normalizeProfile(withStep({ pump: 'magic' }))).toThrow(/steps\[0\]\.pump must be "pressure" or "flow"/);
    expect(() => normalizeProfile(withStep({ transition: 'linear' }))).toThrow(/steps\[0\]\.transition/);
    expect(() => normalizeProfile(withStep({ transition: 'Fast' }))).toThrow(/transition/);
    expect(() => normalizeProfile(withStep({ sensor: 'elbow' }))).toThrow(/steps\[0\]\.sensor/);
    expect(() => normalizeProfile(withStep({ exit: { type: 'weight', condition: 'over', value: 1 } }))).toThrow(
      /exit\.type/,
    );
    expect(() => normalizeProfile(withStep({ exit: { type: 'pressure', condition: 'above', value: 1 } }))).toThrow(
      /exit\.condition/,
    );
  });

  it('matches Decaid on beverage_type: case-insensitive, unknown becomes espresso', () => {
    expect(normalizeProfile({ ...clone(dflow), beverage_type: 'Pourover' }).beverage_type).toBe('pourover');
    expect(normalizeProfile({ ...clone(dflow), beverage_type: 'filter' }).beverage_type).toBe('espresso');
    expect(normalizeProfile({ ...clone(dflow), beverage_type: null }).beverage_type).toBe('espresso');
  });

  it('throws on an unparseable required number but nulls an unparseable optional one', () => {
    const raw = clone(dflow) as Record<string, unknown> & { steps: Record<string, unknown>[] };
    raw.steps[1]!['temperature'] = 'hot';
    expect(() => normalizeProfile(raw)).toThrow(/steps\[1\]\.temperature/);

    // Dart's parseOptionalDouble returns null for a string it cannot read.
    expect(normalizeProfile({ ...clone(dflow), target_weight: '' }).target_weight).toBeNull();
  });

  it('requires the active target, a string name, and complete exit and limiter objects', () => {
    const withStep = (patch: Record<string, unknown>, drop: string[] = []) => {
      const raw = clone(dflow) as { steps: Record<string, unknown>[] };
      const step = { ...raw.steps[0], ...patch };
      for (const key of drop) delete step[key];
      raw.steps[0] = step;
      return raw;
    };
    expect(() => normalizeProfile(withStep({}, ['pressure']))).toThrow(/steps\[0\]\.pressure/);
    expect(() => normalizeProfile(withStep({ name: 5 }))).toThrow(/steps\[0\]\.name/);
    expect(() => normalizeProfile(withStep({}, ['name']))).toThrow(/steps\[0\]\.name/);
    expect(() => normalizeProfile(withStep({ exit: { type: 'pressure', condition: 'over' } }))).toThrow(
      /exit\.value/,
    );
    expect(() => normalizeProfile(withStep({ limiter: { value: 1 } }))).toThrow(/limiter\.range/);
    expect(() => normalizeProfile(withStep({ volume: true }))).toThrow(/steps\[0\]\.volume/);
  });

  it('is idempotent and never shares objects with its input', () => {
    const once = normalizeProfile(londonium);
    expect(normalizeProfile(once)).toEqual(once);
    const raw = clone(londonium);
    const out = normalizeProfile(raw);
    out.steps[0]!.temperature = 1;
    expect(raw.steps[0]!.temperature).toBe('89.0');
  });
});
