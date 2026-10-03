import { describe, expect, it } from 'vitest';

import bestPractice from './__fixtures__/best_practice.json';
import default1 from './__fixtures__/Default1.json';
import blooming from './templates/source/Blooming_espresso.json';
import dflow from './templates/source/D-Flow____default.json';
import londonium from './templates/source/Londonium.json';
import createRequest from '../../docs/verified/examples/profile-create-request.json';
import profileRecord from '../../docs/verified/examples/profile-record.json';
import profilesList from '../../docs/verified/examples/profiles-list.json';
import { normalizeProfile } from './profile.ts';
import {
  dartDouble,
  encodeProfileContent,
  profileCompoundHash,
  profileHashes,
  profileId,
  profileMetadataHash,
} from './profileId.ts';
import { clone } from '../util/clone.ts';

describe('profileId (Decaid ProfileHash port)', () => {
  it('reproduces the verified ids of bundled profiles', () => {
    expect(profileId(default1)).toBe('profile:a582ef47a76f99f56912');
    expect(profileId(blooming)).toBe('profile:7438cb7266f60558b48f');
    expect(profileId(bestPractice)).toBe('profile:b73ce54592d667d00b31');
    expect(profileId(dflow)).toBe('profile:59036f8846b1ed3b4255');
    expect(profileId(londonium)).toBe('profile:729d284747718d27c93a');
  });

  it('reproduces the id of a CafAI-built profile in the verified examples', () => {
    expect(profileId(createRequest.profile)).toBe('profile:fbff9b37ed390c6a8110');
    expect(profileId(profileRecord.profile)).toBe(profileRecord.id);
  });

  it('gives the same id for the raw file and its normalized form', () => {
    expect(profileId(normalizeProfile(blooming))).toBe(profileId(blooming));
  });

  it('reproduces metadata and compound hashes', () => {
    expect(profileMetadataHash(profileRecord.profile)).toBe(profileRecord.metadataHash);
    expect(profileCompoundHash(profileRecord.id, profileRecord.metadataHash)).toBe(profileRecord.compoundHash);
    for (const record of profilesList) {
      expect(profileHashes(record.profile)).toEqual({
        profileHash: record.id,
        metadataHash: record.metadataHash,
        compoundHash: record.compoundHash,
      });
    }
  });

  it('ignores title, notes and author, but not step names, version or target_weight', () => {
    const base = profileId(dflow);
    expect(profileId({ ...clone(dflow), title: 'Kiambu AA v1', notes: 'x', author: 'CafAI' })).toBe(base);

    const renamed = clone(dflow);
    renamed.steps[0]!.name = 'Fill';
    expect(profileId(renamed)).not.toBe(base);

    const noVersion: Record<string, unknown> = clone(dflow);
    delete noVersion['version'];
    expect(profileId(noVersion)).not.toBe(base);

    expect(profileId({ ...clone(dflow), target_weight: '51' })).not.toBe(base);
  });

  it('treats an absent exit like an explicit null, but 0 and null weights differently', () => {
    const base = profileId(londonium);
    const explicit = clone(londonium) as { steps: Record<string, unknown>[] };
    explicit.steps[0]!['exit'] = null;
    expect(profileId(explicit)).toBe(base);

    const noWeight = clone(londonium) as { steps: Record<string, unknown>[] };
    delete noWeight.steps[0]!['weight'];
    expect(profileId(noWeight)).not.toBe(base);
  });

  it('accepts a profile whose version is null, as Decaid does', () => {
    const raw: Record<string, unknown> = { ...clone(dflow), version: null };
    expect(profileId(raw)).toMatch(/^profile:[0-9a-f]{20}$/);
  });
});

describe('Dart encoding', () => {
  it('formats doubles like Dart jsonEncode', () => {
    expect(dartDouble(90)).toBe('90.0');
    expect(dartDouble(0)).toBe('0.0');
    expect(dartDouble(-0)).toBe('-0.0');
    expect(dartDouble(97.5)).toBe('97.5');
    expect(dartDouble(2.2)).toBe('2.2');
    expect(dartDouble(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(dartDouble(1e21)).toBe('1e+21');
    expect(dartDouble(1.5e-7)).toBe('1.5e-7');
    expect(dartDouble(123456789012)).toBe('123456789012.0');
    expect(() => dartDouble(Number.NaN)).toThrow();
  });

  it('sorts keys, writes ints bare and doubles with .0, and has no whitespace', () => {
    const text = encodeProfileContent(normalizeProfile(dflow));
    expect(text.startsWith('{"beverage_type":"espresso","steps":[{"exit":{"condition":"over","type":"pressure","value":1.5}')).toBe(
      true,
    );
    expect(text).toContain('"target_volume_count_start":2,');
    expect(text).toContain('"tank_temperature":0.0,');
    expect(text).toContain('"target_weight":50.0,');
    expect(text.endsWith('"version":"2"}')).toBe(true);
    expect(text).not.toMatch(/\s(?=["{[])/);
  });

  it('escapes strings exactly as Dart does', () => {
    const raw = clone(dflow);
    raw.steps[0]!.name = 'a"b\\c\n\u0001/é☕';
    expect(encodeProfileContent(normalizeProfile(raw))).toContain('"name":"a\\"b\\\\c\\n\\u0001/é☕"');
  });
});
