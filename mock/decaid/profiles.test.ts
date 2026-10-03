import { describe, expect, it } from 'vitest';
import blooming from '../../src/coach/templates/source/Blooming_espresso.json';
import dflow from '../../src/coach/templates/source/D-Flow____default.json';
import londonium from '../../src/coach/templates/source/Londonium.json';
import { fixtures } from '../fixtures/index.ts';
import { DartError } from './errors.ts';
import { compoundHash, metadataHash, normalizeProfile, profileHash } from './profiles.ts';

describe('normalizeProfile (Profile.fromJson -> toJson)', () => {
  it('turns a bundled de1app-style profile into numbers, active axis only, explicit nulls', () => {
    const profile = normalizeProfile(blooming);
    expect(Object.keys(profile)).toEqual([
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
    expect(profile).toMatchObject({
      version: '2',
      title: 'Blooming Espresso',
      beverage_type: 'espresso',
      target_volume: 0,
      target_weight: 60,
      target_volume_count_start: 2,
      tank_temperature: 0,
    });
    const [first, second] = profile.steps;
    expect(Object.keys(first!)).toEqual([
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
    expect(first).toEqual({
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
    expect(second!.exit).toEqual({ type: 'pressure', condition: 'over', value: 4 });
    expect(second!.limiter).toBeNull();
    expect('pressure' in first!).toBe(false);
    expect('type' in profile).toBe(false);
  });

  it('keeps a pressure step pressure-only', () => {
    const step = normalizeProfile(londonium).steps[0]!;
    expect(step.pump).toBe('pressure');
    expect(step.pressure).toBe(2);
    expect('flow' in step).toBe(false);
  });

  it('defaults notes, author, beverage type and the optional numbers like Decaid', () => {
    const profile = normalizeProfile({
      title: 'Bare',
      steps: [cremaLikeStep()],
      tank_temperature: 0,
      target_volume_count_start: '2',
      beverage_type: 'Unknown-Drink',
    });
    expect(profile).toMatchObject({
      version: null,
      notes: '',
      author: '',
      beverage_type: 'espresso',
      target_volume: null,
      target_weight: null,
      target_volume_count_start: 2,
    });
  });

  it('rejects what Decaid rejects, with the same kind of error', () => {
    const base = { title: 'X', steps: [cremaLikeStep()], tank_temperature: 0, target_volume_count_start: 0 };
    expectDartError(() => normalizeProfile({ ...base, title: '' }), 'ArgumentError', 'Invalid argument(s): Profile must have a non-empty "title"');
    expectDartError(() => normalizeProfile({ ...base, steps: [] }), 'ArgumentError', 'Invalid argument(s): Profile must have a non-empty "steps" array');
    expectDartError(() => normalizeProfile({ ...base, tank_temperature: null }), 'ArgumentError', 'Invalid argument(s): Profile must have "tank_temperature"');
    expectDartError(
      () => normalizeProfile({ ...base, target_volume_count_start: undefined }),
      'ArgumentError',
      'Invalid argument(s): Profile must have "target_volume_count_start"',
    );
    expectDartError(() => normalizeProfile({ ...base, target_volume_count_start: '2.0' }), 'FormatException');
    expectDartError(() => normalizeProfile({ ...base, tank_temperature: 'hot' }), 'FormatException');
    expectDartError(
      () => normalizeProfile({ ...base, steps: [{ ...cremaLikeStep(), transition: 'linear' }] }),
      'ArgumentError',
      'Invalid argument (name): No enum value with that name: "linear"',
    );
    expectDartError(() => normalizeProfile({ ...base, steps: [{ ...cremaLikeStep(), name: undefined }] }), 'TypeError');
    expectDartError(() => normalizeProfile({ ...base, steps: [{ ...cremaLikeStep(), volume: undefined }] }), 'TypeError');
    expectDartError(() => normalizeProfile({ ...base, steps: [{ ...cremaLikeStep(), pump: 'magic' }] }), 'Exception');
    expectDartError(() => normalizeProfile('profile'), 'TypeError');
  });
});

describe('profile hashes (ProfileHash)', () => {
  it('gives the bundled templates their real Decaid ids', () => {
    expect(profileHash(normalizeProfile(blooming))).toBe('profile:7438cb7266f60558b48f');
    expect(profileHash(normalizeProfile(dflow))).toBe('profile:59036f8846b1ed3b4255');
    expect(profileHash(normalizeProfile(londonium))).toBe('profile:729d284747718d27c93a');
  });

  it('reproduces the example record hashes exactly', () => {
    const record = fixtures.profileRecord();
    const profile = normalizeProfile(fixtures.profileCreateRequest().profile);
    const id = profileHash(profile);
    expect(id).toBe('profile:fbff9b37ed390c6a8110');
    expect(id).toBe(record.id);
    expect(metadataHash(profile)).toBe(record.metadataHash);
    expect(compoundHash(id, record.metadataHash)).toBe(record.compoundHash);

    const defaultRecord = fixtures.profilesList()[1]!;
    expect(profileHash(normalizeProfile(defaultRecord.profile))).toBe('profile:a582ef47a76f99f56912');
    expect(metadataHash(normalizeProfile(defaultRecord.profile))).toBe(defaultRecord.metadataHash);
  });

  it('ignores title, notes and author but not step names or version', () => {
    const profile = normalizeProfile(dflow);
    const id = profileHash(profile);
    expect(profileHash({ ...profile, title: 'Other', notes: 'n', author: 'a' })).toBe(id);
    expect(profileHash({ ...profile, steps: profile.steps.map((s, i) => (i === 0 ? { ...s, name: 'Fill' } : s)) })).not.toBe(id);
    expect(profileHash({ ...profile, version: null })).not.toBe(id);
    expect(profileHash({ ...profile, target_volume: null })).not.toBe(id);
  });
});

function cremaLikeStep(): Record<string, unknown> {
  return {
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
}

function expectDartError(run: () => unknown, kind: DartError['kind'], message?: string) {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected a DartError').toBeInstanceOf(DartError);
  expect((caught as DartError).kind).toBe(kind);
  if (message) expect((caught as DartError).message).toBe(message);
}
