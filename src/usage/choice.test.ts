import { describe, expect, it } from 'vitest';
import { CHOICE_KEY, readChoice, WORDING, writeChoice, type UsageChoice } from './choice.ts';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map };
}

const YES: UsageChoice = { choice: 'yes', at: '2026-10-22T08:00:00.000Z', wording: WORDING, rule: 'ask' };

describe('the device choice (D212)', () => {
  it('reads back what was written, under cafai.usage.choice', () => {
    const storage = memory();
    writeChoice(storage, YES);
    expect(JSON.parse(storage.map.get(CHOICE_KEY)!)).toEqual(YES);
    expect(readChoice(storage)).toEqual(YES);
  });

  it('reads nothing chosen from no storage, nothing stored, junk or a record of another shape', () => {
    expect(readChoice(null)).toBeNull();
    expect(readChoice(memory())).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: '{not json' }))).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: JSON.stringify({ ...YES, choice: 'maybe' }) }))).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: JSON.stringify({ ...YES, rule: 'other' }) }))).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: JSON.stringify({ ...YES, at: 7 }) }))).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: '"yes"' }))).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readChoice(broken)).toBeNull();
    expect(() => writeChoice(broken, YES)).not.toThrow();
  });
});
