import { describe, expect, it, vi } from 'vitest';
import { driftLog } from '../../api/drift.ts';
import { asksInstead, cafaiNotesLine, isTasteQuestion, lastCafaiNotes, mergeNotes, tasteWords } from './shotNotes.ts';

describe('isTasteQuestion', () => {
  it('is true when the question mentions taste, in any case', () => {
    for (const question of [
      'How did it taste?',
      'How does it TASTE now?',
      'What tastes come through?',
      'Tasted better than the last one?',
      'Tasting it again, what stands out?',
    ]) {
      expect(isTasteQuestion(question), question).toBe(true);
    }
  });

  it('is false for any other question', () => {
    for (const question of ['What does the puck look like?', 'How was the shot?', 'Which grinder do you use?', 'Any aftertaste?']) {
      expect(isTasteQuestion(question), question).toBe(false);
    }
  });
});

describe('asksInstead (D275)', () => {
  it('is false for the taste, however it is put', () => {
    for (const words of [
      'Sour',
      'a bit sour, sharp at the end',
      'It was quite thin and watery',
      'I found it harsh',
      'Too strong for me',
      'Balanced, I like it',
      'Better than the last one',
      'Not bad, still a little sharp',
      'Flat and a bit dull, the fruit is hiding',
      'was fine',
      'Really good now',
      'And a bit sour',
      'Hmm, sharp',
      'OK so, balanced',
    ]) {
      expect(asksInstead(words), words).toBe(false);
    }
  });

  it('is true for a question, with or without its question mark', () => {
    for (const words of [
      'Why did it do that?',
      'why did you lower the temperature',
      'What does the bloom do',
      'How come the pressure dipped?',
      'Sour? Is that the grind',
      'can you explain the last change',
      'Could we try a longer preinfusion',
      'Should I grind finer',
      'Did the scale drop out',
      "Isn't 94 too hot for a light roast",
      'And what would a longer bloom do',
      'OK, so why the dip',
      'But can we try the Allongé',
    ]) {
      expect(asksInstead(words), words).toBe(true);
    }
  });

  it('is true for a request or an idea, and for putting the taste off', () => {
    for (const words of [
      'Change the temperature to 92',
      'Show me the pressure curve',
      'Compare this with the last shot',
      "Let's try the Allongé for the rest of the bag",
      'I want something different for the last third',
      "I'd like to see the history",
      'Try a lower pressure',
      'Not now',
      'Later',
      'Skip the taste for now',
      'Tell me about this profile',
      'You said it would run slower',
    ]) {
      expect(asksInstead(words), words).toBe(true);
    }
  });

  it('is false for nothing', () => {
    expect(asksInstead('')).toBe(false);
    expect(asksInstead('   ')).toBe(false);
  });
});

describe('tasteWords', () => {
  it('lists the options picked, with what was typed in place of Other', () => {
    expect(tasteWords(['Sour / sharp'], null)).toBe('Sour / sharp');
    expect(tasteWords(['Sour / sharp', 'Other'], 'thin')).toBe('Sour / sharp, thin');
    expect(tasteWords(['Other'], 'Sweet but hollow')).toBe('Sweet but hollow');
  });

  it('takes a typed reply as it is', () => {
    expect(tasteWords([], 'Quite sour and thin')).toBe('Quite sour and thin');
  });
});

describe('cafaiNotesLine', () => {
  it('says the taste and the version in one short line', () => {
    expect(cafaiNotesLine('Sour / sharp', 'Kiambu AA v2')).toBe('Taste: Sour / sharp. Kiambu AA v2 (CafAI)');
  });

  it('keeps it to one line and drops a trailing full stop', () => {
    expect(cafaiNotesLine('Quite sour.\nAnd thin.  ', 'Kiambu AA v2')).toBe('Taste: Quite sour. And thin. Kiambu AA v2 (CafAI)');
  });

  it('shortens a long typed reply', () => {
    const line = cafaiNotesLine('a'.repeat(300), 'Kiambu AA v2');
    expect(line).toBe(`Taste: ${'a'.repeat(119)}… Kiambu AA v2 (CafAI)`);
  });

  it('never carries an API key to Decaid', () => {
    const line = cafaiNotesLine('sour, my key is sk-ant-api03-abcdefgh1234', 'Kiambu AA v2');
    expect(line).not.toContain('sk-ant-');
    expect(line).toBe('Taste: sour, my key is [redacted]. Kiambu AA v2 (CafAI)');
  });
});

describe('mergeNotes', () => {
  const line = 'Taste: Bitter / harsh. Kiambu AA v3 (CafAI)';

  it('writes the line into empty notes', () => {
    expect(mergeNotes(undefined, null, line)).toBe(line);
    expect(mergeNotes('', null, line)).toBe(line);
    expect(mergeNotes('  \n', null, line)).toBe(line);
  });

  it("replaces what CafAI wrote last time", () => {
    expect(mergeNotes('Taste: Sour / sharp. Kiambu AA v3 (CafAI)', 'Taste: Sour / sharp. Kiambu AA v3 (CafAI)', line)).toBe(line);
  });

  it('never clobbers notes a person wrote: it appends on a new line', () => {
    expect(mergeNotes('Lovely crema', null, line)).toBe(`Lovely crema\n${line}`);
    expect(mergeNotes('Lovely crema\n', 'Taste: Sour. Other bag v1 (CafAI)', line)).toBe(`Lovely crema\n${line}`);
  });

  it("replaces only its own line under a person's notes, so a repeated write stays one line", () => {
    const own = 'Taste: Sour / sharp. Kiambu AA v3 (CafAI)';
    expect(mergeNotes(`Lovely crema\n${own}`, own, line)).toBe(`Lovely crema\n${line}`);
    expect(mergeNotes(`Lovely crema\n${line}`, line, line)).toBe(`Lovely crema\n${line}`);
  });

  it('keeps what a person added after CafAI\'s line', () => {
    const own = 'Taste: Sour / sharp. Kiambu AA v3 (CafAI)';
    expect(mergeNotes(`${own}\nActually fine`, own, line)).toBe(`${own}\nActually fine\n${line}`);
  });

  it('reads notes that are not text as empty and reports them, instead of failing every retry (5.11)', () => {
    driftLog.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mergeNotes(42, null, line)).toBe(line);
    expect(mergeNotes({ text: 'Lovely crema' }, null, line)).toBe(line);
    expect(mergeNotes(undefined, null, line)).toBe(line);
    expect(driftLog.list().map(({ source, problem }) => [source, problem])).toEqual([
      ['GET /api/v1/shots/{id}', 'annotations.espressoNotes: expected string, got number'],
      ['GET /api/v1/shots/{id}', 'annotations.espressoNotes: expected string, got object'],
    ]);
    driftLog.clear();
  });
});

describe('lastCafaiNotes', () => {
  it("reads the line CafAI wrote from the record's extras", () => {
    expect(lastCafaiNotes({ extras: { cafai: { notes: 'Taste: Sour. X v1 (CafAI)' } } })).toBe('Taste: Sour. X v1 (CafAI)');
    expect(lastCafaiNotes({ extras: { cafai: { verdict: 'better' } } })).toBeNull();
    expect(lastCafaiNotes({ extras: { other: true } })).toBeNull();
    expect(lastCafaiNotes(undefined)).toBeNull();
  });
});
