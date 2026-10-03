import { describe, expect, it } from 'vitest';

import { clone } from '../util/clone.ts';
import { diffProfiles } from './diff.ts';
import { applyLever } from './levers.ts';
import { profileId } from './profileId.ts';
import { getTemplate } from './templates/index.ts';
import { checkStructure } from './validator.ts';
import { buildVersionProfile, MAX_TITLE_LENGTH, versionTitle } from './version.ts';

const bloomingT = getTemplate('blooming-espresso')!;

describe('versionTitle', () => {
  it('names a version after the bag', () => {
    expect(versionTitle('Kiambu AA', 2)).toBe('Kiambu AA v2');
    expect(versionTitle('  Guji   Hambela ', 1)).toBe('Guji Hambela v1');
  });

  it('shortens the bag name, never the version, to fit 40 characters', () => {
    const title = versionTitle('Finca La Esmeralda Geisha Natural Lot 7 Special', 12);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title).toBe('Finca La Esmeralda Geisha Natural v12');
    // One long word has no boundary to cut at: it is cut hard, still 40 characters.
    expect(versionTitle('Supercalifragilisticexpialidocious-espresso-lot', 3)).toBe(
      'Supercalifragilisticexpialidocious-es v3',
    );
  });

  it('refuses an empty name or a version that is not a positive whole number', () => {
    expect(() => versionTitle('  ', 1)).toThrow(/name/);
    expect(() => versionTitle('Kiambu', 0)).toThrow(/version/);
    expect(() => versionTitle('Kiambu', 1.5)).toThrow(/version/);
  });
});

describe('buildVersionProfile', () => {
  const base = applyLever(bloomingT, bloomingT.profile, 'temp', 93);

  it('sets title, notes and author and keeps the execution content', () => {
    const profile = buildVersionProfile(bloomingT, base, 'Kiambu AA v2', 'Kiambu AA');
    expect(profile.title).toBe('Kiambu AA v2');
    expect(profile.author).toBe('CafAI');
    expect(profile.notes.startsWith('CafAI dial-in for Kiambu AA, from Blooming Espresso.')).toBe(true);
    expect(profileId(profile)).toBe(profileId(base));
    expect(diffProfiles(base, profile)).toEqual([]);
    expect(checkStructure(bloomingT, bloomingT.profile, profile)).toEqual([]);
  });

  it("keeps the template's credit in the notes", () => {
    const notes = buildVersionProfile(bloomingT, base, 'Kiambu AA v2', 'Kiambu AA').notes;
    expect(notes).toContain('Template "Blooming Espresso" by Decent');
    expect(notes).toContain('Rao');
  });

  it('does not touch its input', () => {
    const before = clone(base);
    buildVersionProfile(bloomingT, base, 'Kiambu AA v2', 'Kiambu AA');
    expect(base).toEqual(before);
  });

  it('refuses an empty or over-long title', () => {
    expect(() => buildVersionProfile(bloomingT, base, ' ', 'Kiambu AA')).toThrow(/title/);
    expect(() => buildVersionProfile(bloomingT, base, 'x'.repeat(41), 'Kiambu AA')).toThrow(/40/);
  });
});
