import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUP_IDS } from './groupIds.ts';
import { MAX_RESULTS, searchSettings, SETTINGS_INDEX, type SettingsIndexEntry } from './settingsIndex.ts';

const first = (query: string) => searchSettings(query)[0]?.id;
const ids = (query: string) => searchSettings(query).map((entry) => entry.id);

describe('the settings index (D236)', () => {
  it('names every setting once, in a group Settings has, its words in sentence case and without em dashes', () => {
    const seen = new Set<string>();
    for (const entry of SETTINGS_INDEX) {
      expect(seen.has(entry.id), entry.id).toBe(false);
      seen.add(entry.id);
      expect(SETTINGS_GROUP_IDS).toContain(entry.group);
      expect(entry.name[0], entry.id).toBe(entry.name[0]!.toUpperCase());
      expect(entry.name.endsWith('.'), entry.id).toBe(false);
      for (const text of [entry.name, entry.card, ...entry.words]) expect(text, entry.id).not.toMatch(/—/);
      expect('testId' in entry.control || 'label' in entry.control, entry.id).toBe(true);
    }
  });

  it('lists the groups in the order Settings shows them, each setting in the order of its page', () => {
    const order = SETTINGS_INDEX.map((entry) => SETTINGS_GROUP_IDS.indexOf(entry.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const group of SETTINGS_GROUP_IDS) expect(SETTINGS_INDEX.some((entry) => entry.group === group), group).toBe(true);
  });
});

describe('searchSettings', () => {
  it('finds a setting by the words it is shown with', () => {
    expect(first('tint')).toBe('tint');
    expect(first('Tint')).toBe('tint');
    expect(first('  tint  ')).toBe('tint');
    expect(first('model')).toBe('model');
    expect(first('steam time')).toBe('steam-time');
    expect(first('hot water volume')).toBe('hot-water-volume');
    expect(first('sleep when idle')).toBe('sleep-when-idle');
  });

  it('finds a setting by the words people use for it', () => {
    expect(first('dark mode')).toBe('mode');
    expect(ids('theme').slice(0, 2)).toEqual(['mode', 'tint']);
    expect(first('colour')).toBe('tint');
    expect(first('fahrenheit')).toBe('temperatures');
    expect(first('Celsius')).toBe('temperatures');
    expect(first('°F')).toBe('temperatures');
    expect(first('12-hour')).toBe('clock');
    expect(first('12 hour')).toBe('clock');
    expect(first('alarm')).toBe('wake-times');
    expect(first('wake')).toBe('wake-times');
    expect(first('brightness')).toBe('screensaver-dims');
    expect(first('dim')).toBe('screensaver-dims');
    expect(first('bridge')).toBe('coach-computer');
    expect(first('computer')).toBe('coach-computer');
    expect(first('Claude')).toBeDefined();
    expect(ids('key').slice(0, 2)).toEqual(['api-key', 'key-in-decaid']);
    expect(first('tokens')).toBe('coach-usage');
    expect(first('cost')).toBe('coach-usage');
    expect(ids('budget').slice(0, 3)).toEqual(['coach-budget', 'coach-budget-pause', 'coach-usage']);
    expect(first('effort')).toBe('coach-effort');
    expect(first('thinking')).toBe('coach-effort');
    expect(first('finer')).toBe('grinder-finer');
    expect(first('coarser')).toBe('grinder-finer');
    expect(first('direction')).toBe('grinder-finer');
    expect(first('TDS')).toBe('show-tds');
    expect(first('refractometer')).toBe('show-tds');
    // Each drink's card lists its temperature first, as the index does.
    expect(ids('rinse').slice(0, 3)).toEqual(['flush-temperature', 'flush-time', 'flush-flow']);
    expect(first('animation')).toBe('steam-animation');
    expect(first('descale')).toBe('cleaning-guide');
    expect(first('filter')).toBe('care-filter');
    expect(first('export')).toBe('export');
    expect(first('backup')).toBe('backup');
    expect(first('log')).toBe('log');
    expect(first('version')).toBe('versions');
    expect(first('bug')).toBe('report-problem');
    expect(first('report')).toBe('report-problem');
  });

  it("reads an apostrophe, a curly one too, and an accent as people type them", () => {
    expect(first("what's new")).toBe('whats-new');
    expect(first('what’s new')).toBe('whats-new');
    expect(first('whats new')).toBe('whats-new');
    expect(first('Fahrénheit')).toBe('temperatures');
  });

  it('takes the words in any order, each where it starts a word or anywhere', () => {
    expect(first('volume water')).toBe('hot-water-volume');
    expect(first('water hot temperature')).toBe('hot-water-temperature');
  });

  it('ranks a name that starts with the words, then a word of the name, then the words people use, then anywhere', () => {
    const entry = (id: string, name: string, words: string[] = []): SettingsIndexEntry => ({
      id,
      name,
      group: 'display',
      card: 'Card',
      control: { testId: id },
      words,
    });
    const index = [entry('anywhere', 'Overtime'), entry('alias', 'Clock', ['time format']), entry('word', 'Steam time'), entry('start', 'Time zone')];
    expect(searchSettings('time', index).map((each) => each.id)).toEqual(['start', 'word', 'alias', 'anywhere']);
    // Within a rank, the order of the pages.
    expect(searchSettings('t', [entry('b', 'Tea'), entry('a', 'Tint')]).map((each) => each.id)).toEqual(['b', 'a']);
  });

  it('shows at most eight, and nothing for nothing found or no words', () => {
    expect(searchSettings('e').length).toBe(MAX_RESULTS);
    expect(MAX_RESULTS).toBe(8);
    expect(searchSettings('zzz')).toEqual([]);
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });
});
