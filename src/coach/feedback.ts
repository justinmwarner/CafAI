/**
 * Options for the ask_user chips. CafAI always offers "Other" last, where the
 * user can type, so the model is told never to include it; when it does
 * anyway, the duplicate is dropped here rather than shown twice.
 */
import { OTHER_OPTION } from './contract.ts';

/** Taste chips after a shot, matching what the scripted coach reacts to. */
export const DEFAULT_TASTE_OPTIONS: readonly string[] = [
  'Sour / sharp',
  'Bitter / harsh',
  'Balanced, sweet',
  'Weak / watery',
  'Strong / heavy',
];

const OTHER_LIKE = [
  /^others?$/,
  /^(something|anything) else$/,
  /^none of (these|the above)$/,
  /^(type|write) (my|your) own$/,
  /^else$/,
];

/** True for "Other", "Other (type it)", "Something else", "None of these" and the like. */
export function isOtherLike(option: string): boolean {
  const text = option
    .trim()
    .toLowerCase()
    .replace(/\(.*\)$/, '')
    .replace(/[.…:?!\s]+$/, '')
    .trim();
  return OTHER_LIKE.some((pattern) => pattern.test(text));
}

/** The chips to show: the model's options trimmed and de-duplicated, without any "other", then "Other" last. */
export function withOther(options: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of options) {
    const option = raw.trim();
    const key = option.toLowerCase();
    if (option === '' || isOtherLike(option) || seen.has(key)) continue;
    seen.add(key);
    kept.push(option);
  }
  return [...kept, OTHER_OPTION];
}
