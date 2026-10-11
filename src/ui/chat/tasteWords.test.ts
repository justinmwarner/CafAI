import { describe, expect, it } from 'vitest';
import type { CoachUiMessage, CoachUiPart } from '../../app/types.ts';
import { hasTasteWord, TASTE_GROUPS, tasteQuestionOpen, toggleTasteWord, type TasteWord } from './tasteWords.ts';

const word = (label: string): TasteWord => {
  const found = TASTE_GROUPS.flatMap((group) => group.words).find((w) => w.label === label);
  if (!found) throw new Error(`No taste word "${label}"`);
  return found;
};

describe('the taste words (D127)', () => {
  it('group what to notice: acidity, sweetness, bitterness, body and the finish, each with a question', () => {
    expect(TASTE_GROUPS.map((group) => group.label)).toEqual(['Acidity', 'Sweetness', 'Bitterness', 'Body', 'Finish']);
    for (const group of TASTE_GROUPS) {
      expect(group.notice, group.id).toMatch(/\?$/);
      expect(group.words.length, group.id).toBeGreaterThanOrEqual(4);
      expect(group.words.length, group.id).toBeLessThanOrEqual(5);
    }
  });

  it('are neutral: no word says good or bad, and none is there twice', () => {
    const labels = TASTE_GROUPS.flatMap((group) => group.words.map((w) => w.label));
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).not.toMatch(/\b(good|bad|great|nice|perfect|pleasant|unpleasant|delicious|awful|wrong|right|correct|balanced|better|worse|ideal)\b/i);
    }
  });

  it('say what a finish word describes, so it reads on its own in a message', () => {
    expect(word('short').text).toBe('short finish');
    expect(word('lingering').text).toBe('lingering finish');
    expect(word('mild').text).toBe('mild acidity');
    expect(word('sharp').text).toBe('sharp');
  });
});

describe('toggleTasteWord and hasTasteWord', () => {
  it('starts the draft, then adds each word after a comma', () => {
    let draft = toggleTasteWord('', word('sharp'));
    expect(draft).toBe('sharp');
    draft = toggleTasteWord(draft, word('thin'));
    draft = toggleTasteWord(draft, word('short'));
    expect(draft).toBe('sharp, thin, short finish');
    expect(hasTasteWord(draft, word('thin'))).toBe(true);
    expect(hasTasteWord(draft, word('sweet'))).toBe(false);
  });

  it('adds after what the barista typed, without a second comma or trailing spaces', () => {
    expect(toggleTasteWord('It was a bit', word('sharp'))).toBe('It was a bit, sharp');
    expect(toggleTasteWord('Quite sharp,  ', word('thin'))).toBe('Quite sharp, thin');
    expect(toggleTasteWord('Notes:', word('ashy'))).toBe('Notes: ashy');
  });

  it('takes a word out again, and leaves the rest as typed', () => {
    expect(toggleTasteWord('sharp, thin, short finish', word('thin'))).toBe('sharp, short finish');
    expect(toggleTasteWord('sharp, thin', word('sharp'))).toBe('thin');
    expect(toggleTasteWord('sharp', word('sharp'))).toBe('');
    expect(toggleTasteWord('It was quite sharp, Thin', word('thin'))).toBe('It was quite sharp');
  });

  it('holds a word only on its own between commas: one inside a sentence stays the barista’s', () => {
    expect(hasTasteWord('not thin at all', word('thin'))).toBe(false);
    expect(hasTasteWord('Sharp , THIN', word('thin'))).toBe(true);
    expect(toggleTasteWord('not thin at all', word('thin'))).toBe('not thin at all, thin');
  });
});

describe('tasteQuestionOpen', () => {
  const ask = (overrides: Partial<Extract<CoachUiPart, { kind: 'options' }>> = {}): CoachUiMessage => ({
    id: 'm-ask',
    role: 'assistant',
    createdAt: '2026-10-03T08:00:00.000Z',
    parts: [
      {
        kind: 'options',
        requestId: 'tu-ask',
        question: 'How did it taste?',
        options: ['Sour / sharp', 'Other'],
        multiSelect: false,
        answer: null,
        taste: true,
        ...overrides,
      },
    ],
  });

  it('is true while the taste question waits for its answer', () => {
    expect(tasteQuestionOpen([ask()])).toBe(true);
    // Stored before CafAI marked taste questions: counted as one.
    expect(tasteQuestionOpen([ask({ taste: undefined })])).toBe(true);
  });

  it('is false once it is answered or set aside, for another question, and with no question', () => {
    expect(tasteQuestionOpen([ask({ answer: { selected: ['Sour / sharp'], otherText: null } })])).toBe(false);
    expect(tasteQuestionOpen([ask({ expired: true })])).toBe(false);
    expect(tasteQuestionOpen([ask({ question: 'What does the puck look like?', taste: false })])).toBe(false);
    expect(tasteQuestionOpen([])).toBe(false);
  });
});
