/**
 * Pins the bundled Gentle and Sweet as Decaid's regenerated profile (D63).
 *
 * Our Gentle_and_sweet1.json is byte-identical to Decaid a45961b's bundled
 * file. An older Decaid record carried stale de1app frames: 78.5, 78.5 and
 * 67 °C on steps 2-4 and target_volume 0, with the same pressure and flow
 * frames, so a pressure curve cannot tell the two apart. The values are
 * embedded here because the reference clones are not in the repository.
 */
import { describe, expect, it } from 'vitest';

import { clone } from '../../util/clone.ts';
import { readLeverValues } from '../levers.ts';
import { profileId } from '../profileId.ts';
import { getTemplate } from './index.ts';
import gentleSource from './source/Gentle_and_sweet1.json';

const gentle = getTemplate('gentle-and-sweet')!;
const profile = gentle.profile;
const REGENERATED_ID = 'profile:1baa29bd9d9dc6d47f2a';

describe('Gentle and Sweet: the regenerated profile (D63)', () => {
  it('has five steps with the exact names, pumps, transitions and sensors', () => {
    expect(profile.steps.map((s) => s.name)).toEqual([
      'preinfusion temp boost',
      'preinfusion',
      'forced rise without limit',
      'rise and hold',
      'decline',
    ]);
    expect(profile.steps.map((s) => s.pump)).toEqual(['flow', 'flow', 'pressure', 'pressure', 'pressure']);
    expect(profile.steps.map((s) => s.transition)).toEqual(['fast', 'fast', 'fast', 'fast', 'smooth']);
    expect(profile.steps.map((s) => s.sensor)).toEqual(['coffee', 'coffee', 'coffee', 'coffee', 'coffee']);
  });

  it('fills at 8 ml/s, then holds 6, 6 and 4 bar, over 2, 18, 3, 13 and 30 s', () => {
    expect(profile.steps.map((s) => s.flow)).toEqual([8, 8, undefined, undefined, undefined]);
    expect(profile.steps.map((s) => s.pressure)).toEqual([undefined, undefined, 6, 6, 4]);
    expect(profile.steps.map((s) => s.seconds)).toEqual([2, 18, 3, 13, 30]);
    expect(profile.steps.reduce((sum, s) => sum + s.seconds, 0)).toBe(66);
  });

  it('leaves the fill when pressure passes 4 bar; the later steps have no exit', () => {
    const fillExit = { type: 'pressure', condition: 'over', value: 4 };
    expect(profile.steps.map((s) => s.exit)).toEqual([fillExit, fillExit, null, null, null]);
  });

  it('caps the flow at 4 ml/s (range 1) on the hold and the decline only', () => {
    const cap = { value: 4, range: 1 };
    expect(profile.steps.map((s) => s.limiter)).toEqual([null, null, null, cap, cap]);
  });

  it('has no stale de1app fingerprint: 88 °C everywhere, target_volume 36, the plain title', () => {
    const temperatures = profile.steps.map((s) => s.temperature);
    expect(temperatures).toEqual([88, 88, 88, 88, 88]);
    expect(new Set(temperatures).size).toBe(1);
    expect(temperatures.some((t) => t === 78.5 || t === 67)).toBe(false);
    expect(profile.target_volume).toBe(36);
    expect(profile.target_volume).not.toBe(0);
    expect(profile.title).toBe('Gentle and sweet');
    expect(profile.title).not.toBe('Gentle and sweet1');
  });

  it("keeps Decent's top-level values", () => {
    expect(profile).toMatchObject({
      target_weight: 36,
      target_volume_count_start: 2,
      tank_temperature: 0,
      beverage_type: 'espresso',
      version: '2',
      author: 'Decent',
    });
  });

  it('has the regenerated raw format: exactly 12 top-level keys and no de1app frame keys', () => {
    const raw = gentleSource as unknown as Record<string, unknown> & { steps: Array<Record<string, unknown>> };
    expect(Object.keys(raw).sort()).toEqual([
      'author',
      'beverage_type',
      'hidden',
      'notes',
      'steps',
      'tank_temperature',
      'target_volume',
      'target_volume_count_start',
      'target_weight',
      'title',
      'type',
      'version',
    ]);
    expect(raw['type']).toBe('pressure');
    expect(raw['hidden']).toBe('0');
    for (const key of ['legacy_profile_type', 'lang', 'reference_file', 'changes_since_last_espresso']) {
      expect(raw, key).not.toHaveProperty(key);
    }

    const allowed = ['name', 'pump', 'transition', 'temperature', 'sensor', 'seconds', 'volume', 'weight', 'flow', 'pressure', 'exit', 'limiter'];
    const tclFrameKeys = [
      'exit_if',
      'exit_type',
      'exit_pressure_over',
      'exit_pressure_under',
      'exit_flow_over',
      'exit_flow_under',
      'max_flow_or_pressure',
      'max_flow_or_pressure_range',
      'popup',
    ];
    raw.steps.forEach((step, i) => {
      for (const key of Object.keys(step)) expect(allowed, `steps[${i}].${key}`).toContain(key);
      for (const key of tclFrameKeys) expect(step, `steps[${i}]`).not.toHaveProperty(key);
    });
    expect(profile.steps.map((s) => [s.volume, s.weight])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('matches its notes: "rises to only 6 bar and then slowly descends to 4 bar"', () => {
    const match = /rises to only (\d+(?:\.\d+)?) bar and then slowly descends to (\d+(?:\.\d+)?) bar/.exec(profile.notes);
    expect(match).not.toBeNull();
    const levers = readLeverValues(gentle, profile);
    expect([Number(match![1]), Number(match![2])]).toEqual([levers['peak'], levers['declineEnd']]);
    expect([levers['peak'], levers['declineEnd']]).toEqual([6, 4]);
  });

  it('hashes to the bundled id, and a copy with the stale frames does not', () => {
    expect(profileId(gentleSource)).toBe(REGENERATED_ID);
    expect(gentle.decaidDefaultId).toBe(REGENERATED_ID);

    const stale = clone(gentleSource) as unknown as Record<string, unknown> & { steps: Array<Record<string, unknown>> };
    stale.steps[2]!['temperature'] = '78.5';
    stale.steps[3]!['temperature'] = '78.5';
    stale.steps[4]!['temperature'] = '67.0';
    stale['target_volume'] = '0.0';
    expect(profileId(stale)).not.toBe(REGENERATED_ID);

    // Either half of the fingerprint alone changes the id too.
    const staleTemperatures = clone(stale);
    staleTemperatures['target_volume'] = '36.0';
    const staleVolume = clone(gentleSource) as unknown as Record<string, unknown>;
    staleVolume['target_volume'] = '0.0';
    expect(new Set([REGENERATED_ID, profileId(stale), profileId(staleTemperatures), profileId(staleVolume)]).size).toBe(4);
  });
});
