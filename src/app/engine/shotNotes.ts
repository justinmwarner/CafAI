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

/**
 * How a question or a request opens, lower-cased: an asking word, a verb
 * that asks for something, the coach addressed, or a put-off. A taste opens
 * with the cup ("sour", "a bit thin", "it was", "too strong", "I found it
 * sharp"), so "I", "it", "was" and the like are not here.
 */
const ASKS_INSTEAD =
  /^(?:why|what|whats|what's|how|when|where|which|who|whose|can|can't|cant|could|would|should|will|won't|wont|isn't|aren't|do|does|did|don't|dont|doesn't|didn't|explain|tell|show|compare|remind|help|teach|walk|talk|let's|lets|let|give|suggest|recommend|propose|change|try|use|set|make|go|switch|load|undo|keep|raise|lower|bump|drop|increase|decrease|grind|skip|later|wait|hold|instead|you|you're|your|we|we're|we'd|we'll|please)\b|^(?:i want|i'd like|i would like|i don't want|i dont want|i'm not|im not|not now|no thanks|hang on|hold on|one sec|just a sec)\b/;

/** Words a follow-up opens with before saying anything, with their punctuation. */
const LEAD_IN = /^(?:(?:and|but|so|also|ok|okay|hmm|hm|well|oh|yes|yeah|no|nope)\b[\s,.:;-]*)+/;

/**
 * True when text typed under the taste question is not the taste (D275): a
 * question (a question mark anywhere, or an asking word first), a request
 * ("change the temperature", "show me the curve") or a put-off ("not now",
 * "later"). Such text goes to the coach as a message, and the taste question
 * stays open. Anything else is the taste, as the same words under Other.
 */
export function asksInstead(text: string): boolean {
  const words = text.trim().toLowerCase();
  if (words === '') return false;
  if (words.includes('?')) return true;
  // A follow-up's lead-in ("And what would…", "OK, so why…", "Hmm, sour") says nothing itself.
  return ASKS_INSTEAD.test(words.replace(LEAD_IN, ''));
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
