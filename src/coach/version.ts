/**
 * Titles and presentation fields of a bag's profile versions ("Kiambu AA v2").
 *
 * Title, notes and author are not part of Decaid's profile id, so they never
 * change what the machine does; only levers do.
 */
import { clone } from '../util/clone.ts';
import type { ProfileJson, Template } from './types.ts';

/** Longest profile title CafAI writes (it has to fit a tablet row). */
export const MAX_TITLE_LENGTH = 40;

const collapse = (text: string) => text.trim().replace(/\s+/g, ' ');

/** "<Bag> v<n>", shortening the bag name (never the version) to fit 40 characters. */
export function versionTitle(bagName: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`A version number must be a whole number from 1 (got ${n}).`);
  const name = collapse(bagName);
  if (name === '') throw new Error('A version title needs the bag name.');
  const suffix = ` v${n}`;
  const budget = MAX_TITLE_LENGTH - suffix.length;
  if (name.length <= budget) return `${name}${suffix}`;
  // Cut at a word boundary when there is one, so no half word is left behind.
  const cut = name.slice(0, budget);
  const space = cut.lastIndexOf(' ');
  const short = name[budget] !== ' ' && space > 0 ? cut.slice(0, space) : cut;
  return `${short.trimEnd()}${suffix}`;
}

/**
 * A copy of `base` presented as one of CafAI's versions: the title, CafAI as
 * author, and notes naming the bag and the template (with the template's own
 * credit kept). Execution content is untouched.
 */
export function buildVersionProfile(template: Template, base: ProfileJson, title: string, bagName: string): ProfileJson {
  const cleanTitle = collapse(title);
  if (cleanTitle === '') throw new Error('A profile version needs a title.');
  if (cleanTitle.length > MAX_TITLE_LENGTH) {
    throw new Error(`A profile title must be at most ${MAX_TITLE_LENGTH} characters (got ${cleanTitle.length}).`);
  }
  const original = template.profile;
  const credit = `Template "${original.title}" by ${original.author}${original.notes ? `: ${original.notes}` : '.'}`;
  return {
    ...clone(base),
    title: cleanTitle,
    author: 'CafAI',
    notes: `CafAI dial-in for ${collapse(bagName)}, from ${template.name}.\n\n${credit}`,
  };
}
