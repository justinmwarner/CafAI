import { expect, it } from 'vitest';

import { last } from './last.ts';

it('returns the last element, or undefined for an empty array', () => {
  expect(last([1, 2, 3])).toBe(3);
  expect(last(['only'])).toBe('only');
  expect(last([])).toBeUndefined();
});
