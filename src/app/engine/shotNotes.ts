/**
 * CafAI's line in a shot record's notes (D61), e.g.
 * "Taste: Sour / sharp. Kiambu AA v2 (CafAI)".
 *
 * Decaid replaces `annotations.espressoNotes` wholesale on a shot update, so
 * CafAI never writes over notes a person wrote: it replaces only its own
 * line (remembered in `annotations.extras.cafai.notes`) and otherwise
 * appends it on a new line.
 */
import { reportDrift } from '../../api/drift.ts';
import { describeValue } from '../../api/frames.ts';
import type { ShotAnnotations } from '../../api/types.ts';
import { OTHER_OPTION } from '../../coach/contract.ts';
import { redactKeyLike } from '../../storage/redact.ts';

/** CafAI's key in Decaid's extras maps (workflow context and shot annotations). */
export const EXTRAS_KEY = 'cafai';

/** The taste words kept in the notes line; the full reply goes to extras. */
const MAX_TASTE_CHARS = 120;

const TASTE_WORD = /\btast(?:e|es|ed|ing)\b/i;

/**
 * True when a question asks how the shot tasted: its text mentions taste
 * ("How did it taste?"). Only its answer is the shot's taste (the iteration's
 * feedback, this notes line, History); the coach is told to word it so. Any
 * other question (the puck, a preference) stays in the chat.
 */
export function isTasteQuestion(question: string): boolean {
  return TASTE_WORD.test(question);
}

/** The taste in words: the options picked (Other replaced by what was typed), or the typed reply. */
export function tasteWords(selected: readonly string[], text: string | null): string {
  const typed = text?.trim() || null;
  return [...selected.filter((option) => !(typed && option === OTHER_OPTION)), ...(typed ? [typed] : [])].join(', ');
}

/** One short line: the taste and the version, never a key (D37). */
export function cafaiNotesLine(taste: string, versionTitle: string): string {
  let words = redactKeyLike(taste).replace(/\s+/g, ' ').trim();
  const cut = words.length > MAX_TASTE_CHARS;
  words = cut ? `${words.slice(0, MAX_TASTE_CHARS - 1).trimEnd()}…` : words.replace(/[.\s]+$/, '');
  return redactKeyLike(`Taste: ${words}${cut ? ' ' : '. '}${versionTitle} (CafAI)`);
}

/** The notes line CafAI wrote last time, from the record's extras. */
export function lastCafaiNotes(annotations: ShotAnnotations | undefined): string | null {
  const own = annotations?.extras?.[EXTRAS_KEY];
  if (typeof own !== 'object' || own === null) return null;
  const notes = (own as Record<string, unknown>).notes;
  return typeof notes === 'string' && notes !== '' ? notes : null;
}

/**
 * The record's notes with CafAI's line in: empty notes or exactly CafAI's
 * last line are replaced; CafAI's own last line under a person's notes is
 * swapped for the new one (so a repeated write stays one line); anything
 * else gets the line appended on a new line. Notes that are not text read
 * as empty and are reported (5.11): failing on them would fail every retry.
 */
export function mergeNotes(current: unknown, lastOwn: string | null, line: string): string {
  if (current !== undefined && typeof current !== 'string') {
    reportDrift('GET /api/v1/shots/{id}', `annotations.espressoNotes: ${describeValue(current, 'string')}`);
  }
  const existing = typeof current === 'string' ? current : '';
  if (existing.trim() === '') return line;
  if (lastOwn) {
    if (existing === lastOwn) return line;
    if (existing.endsWith(`\n${lastOwn}`)) return `${existing.slice(0, existing.length - lastOwn.length)}${line}`;
  }
  return `${existing.replace(/\s+$/, '')}\n${line}`;
}
