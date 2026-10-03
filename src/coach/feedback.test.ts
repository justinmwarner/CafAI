import { describe, expect, it } from 'vitest';

import { OTHER_OPTION } from './contract.ts';
import { DEFAULT_TASTE_OPTIONS, isOtherLike, withOther } from './feedback.ts';

describe('withOther', () => {
  it('appends "Other" last', () => {
    expect(withOther(['Sour', 'Bitter'])).toEqual(['Sour', 'Bitter', OTHER_OPTION]);
  });

  it('drops any "other"-like option the model sent, wherever it was', () => {
    expect(withOther(['Other', 'Sour', 'other...', 'Other (type it)', 'Something else', 'None of these', 'Bitter'])).toEqual([
      'Sour',
      'Bitter',
      'Other',
    ]);
  });

  it('trims, drops empties and repeats, and keeps the order', () => {
    expect(withOther(['  Sour / sharp ', '', 'sour / sharp', 'Balanced'])).toEqual(['Sour / sharp', 'Balanced', 'Other']);
  });

  it('does not mistake real answers for "other"', () => {
    for (const option of ['Otherworldly fruit', 'Not sure', 'Bitter, other than that fine']) {
      expect(isOtherLike(option), option).toBe(false);
    }
    for (const option of ['Other', 'others', 'Other:', 'OTHER…', 'Something else', 'anything else?', 'None of the above']) {
      expect(isOtherLike(option), option).toBe(true);
    }
  });
});

describe('DEFAULT_TASTE_OPTIONS', () => {
  it('fits ask_user: 2-5 short options, none of them "Other"', () => {
    expect(DEFAULT_TASTE_OPTIONS.length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_TASTE_OPTIONS.length).toBeLessThanOrEqual(5);
    for (const option of DEFAULT_TASTE_OPTIONS) {
      expect(option.length).toBeLessThanOrEqual(60);
      expect(isOtherLike(option)).toBe(false);
    }
    expect(withOther(DEFAULT_TASTE_OPTIONS)).toEqual([...DEFAULT_TASTE_OPTIONS, 'Other']);
  });

  it('covers the answers the scripted coach reacts to', () => {
    const text = DEFAULT_TASTE_OPTIONS.join(' | ');
    for (const word of ['Sour', 'Bitter', 'Balanced', 'Weak', 'Strong']) expect(text).toContain(word);
  });
});
