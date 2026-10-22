import { describe, expect, it } from 'vitest';
import { coachKey, coachLabel, createToldList, TOLD_CAP, TOLD_KEY, type ToldEntry } from './told.ts';

/** The device's storage as a map; `items` shows what it holds. */
function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

const entry = (key: string, at = '2026-10-16T08:00:00.000Z', bagId = 'bag-1'): ToldEntry => ({ key, bagId, at });

describe('createToldList (D200)', () => {
  it("keeps every fact told in the device's own storage, under its own key, and reads it back", () => {
    const storage = memoryStorage();
    const told = createToldList(storage);
    expect(told.entries()).toEqual([]);
    told.add(entry('kenya-sl28'));
    told.add(entry('coach:onyx coffee lab', '2026-10-16T09:00:00.000Z', 'bag-2'));
    expect(TOLD_KEY).toBe('cafai.facts.told');
    expect(JSON.parse(storage.items.get(TOLD_KEY)!)).toEqual([entry('kenya-sl28'), entry('coach:onyx coffee lab', '2026-10-16T09:00:00.000Z', 'bag-2')]);
    // The next page reads it, oldest first.
    expect(createToldList(storage).entries().map((e) => e.key)).toEqual(['kenya-sl28', 'coach:onyx coffee lab']);
  });

  it('keeps the newest 1,000', () => {
    const storage = memoryStorage();
    const told = createToldList(storage);
    for (let i = 0; i < TOLD_CAP + 5; i += 1) told.add(entry(`fact-${i}`));
    expect(TOLD_CAP).toBe(1000);
    expect(told.entries()).toHaveLength(TOLD_CAP);
    expect(told.entries()[0]!.key).toBe('fact-5');
    expect(told.entries()[TOLD_CAP - 1]!.key).toBe(`fact-${TOLD_CAP + 4}`);
    expect(JSON.parse(storage.items.get(TOLD_KEY)!)).toHaveLength(TOLD_CAP);
    // A longer list from another build is cut to the newest too.
    const long = Array.from({ length: TOLD_CAP + 2 }, (_, i) => entry(`old-${i}`));
    expect(createToldList(memoryStorage({ [TOLD_KEY]: JSON.stringify(long) })).entries()[0]!.key).toBe('old-2');
  });

  it('reads anything else as no fact told, and keeps the entries it can read', () => {
    for (const held of ['not json', '{"key":"x"}', '42', 'null']) {
      expect(createToldList(memoryStorage({ [TOLD_KEY]: held })).entries(), held).toEqual([]);
    }
    const mixed = [entry('good'), { key: 3, bagId: 'bag-1', at: 'x' }, { key: 'no-bag' }, 'loose', entry('also-good')];
    expect(createToldList(memoryStorage({ [TOLD_KEY]: JSON.stringify(mixed) })).entries().map((e) => e.key)).toEqual(['good', 'also-good']);
  });

  it('lives in memory without storage, or with storage that throws: losing it only means a fact can come back', () => {
    const none = createToldList(null);
    none.add(entry('kenya-sl28'));
    expect(none.entries().map((e) => e.key)).toEqual(['kenya-sl28']);

    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const told = createToldList(blocked);
    expect(told.entries()).toEqual([]);
    told.add(entry('kenya-sl28'));
    told.add(entry('gesha-panama'));
    expect(told.entries().map((e) => e.key)).toEqual(['kenya-sl28', 'gesha-panama']);
  });

  it('never changes a list it already handed out', () => {
    const told = createToldList(null);
    told.add(entry('first'));
    const before = told.entries();
    told.add(entry('second'));
    expect(before.map((e) => e.key)).toEqual(['first']);
  });
});

describe('coachKey', () => {
  it("is the coach's label, trimmed, in lower case, its spaces collapsed", () => {
    expect(coachKey('  Onyx Coffee   Lab\n founding ')).toBe('coach:onyx coffee lab founding');
    expect(coachKey("Kenya's SL28")).toBe("coach:kenya's sl28");
  });

  it('gives back the label it was told under, and none for a fact of the list', () => {
    expect(coachLabel(coachKey('Onyx Coffee Lab'))).toBe('onyx coffee lab');
    expect(coachLabel('kenya-sl28')).toBeNull();
  });
});
