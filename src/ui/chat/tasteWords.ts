/**
 * Words for what the barista tastes (D127): neutral descriptors, grouped by
 * what to notice, that help them put a shot into their own words. None says
 * good or bad, and none is what a coffee should taste like: the coach never
 * names a flavour first, so the words come from the barista. A tapped word
 * goes into the message being written; nothing is sent until they send.
 */
import type { CoachUiMessage } from '../../app/types.ts';

export interface TasteWord {
  /** On the chip. */
  label: string;
  /** Into the message: the label, or with what it describes when the label alone is unclear ("short" is "short finish"). */
  text: string;
}

export interface TasteGroup {
  id: 'acidity' | 'sweetness' | 'bitterness' | 'body' | 'finish';
  label: string;
  /** What to notice, as a question: how to taste, never what this coffee should taste like. */
  notice: string;
  /** From less to more, or from one end to the other. */
  words: readonly TasteWord[];
}

const word = (label: string, text = label): TasteWord => ({ label, text });

export const TASTE_GROUPS: readonly TasteGroup[] = [
  {
    id: 'acidity',
    label: 'Acidity',
    notice: 'Does it make your mouth water?',
    words: [word('mild', 'mild acidity'), word('bright'), word('tangy'), word('sharp'), word('sour')],
  },
  {
    id: 'sweetness',
    label: 'Sweetness',
    notice: 'Is there any sweetness, and how much?',
    words: [word('flat'), word('sweet'), word('syrupy'), word('caramel-like')],
  },
  {
    id: 'bitterness',
    label: 'Bitterness',
    notice: 'Is there bitterness, and does it linger?',
    words: [word('roasty'), word('bitter'), word('harsh'), word('ashy'), word('burnt')],
  },
  {
    id: 'body',
    label: 'Body',
    notice: 'How heavy does it feel on your tongue?',
    words: [word('watery'), word('thin'), word('round'), word('creamy'), word('heavy')],
  },
  {
    id: 'finish',
    label: 'Finish',
    notice: 'What stays after you swallow, and for how long?',
    words: [
      word('short', 'short finish'),
      word('clean', 'clean finish'),
      word('lingering', 'lingering finish'),
      word('dry', 'dry finish'),
      word('astringent'),
    ],
  },
];

/** What is between the draft's commas, trimmed and lower-cased. */
function itemsOf(draft: string): string[] {
  return draft.split(',').map((item) => item.trim().toLowerCase());
}

/** True when the draft holds the word on its own between commas: "sharp, thin" holds "thin", "not thin" does not. */
export function hasTasteWord(draft: string, taste: TasteWord): boolean {
  return itemsOf(draft).includes(taste.text.toLowerCase());
}

/**
 * The draft with the word added at its end ("sharp" becomes "sharp, thin"),
 * or taken out again when the draft holds it on its own. Everything else the
 * barista typed stays as they typed it.
 */
export function toggleTasteWord(draft: string, taste: TasteWord): string {
  const text = taste.text.toLowerCase();
  if (hasTasteWord(draft, taste)) {
    return draft
      .split(',')
      .filter((item) => item.trim().toLowerCase() !== text)
      .join(',')
      .replace(/^\s+/, '');
  }
  const kept = draft.replace(/\s+$/, '');
  if (kept === '') return taste.text;
  return /[,;:]$/.test(kept) ? `${kept} ${taste.text}` : `${kept}, ${taste.text}`;
}

/**
 * True while a question about the taste waits for its answer: when the words
 * are offered. A question stored before CafAI marked taste questions counts
 * as one, as the composer's hint does.
 */
export function tasteQuestionOpen(messages: readonly CoachUiMessage[]): boolean {
  return messages.some((message) =>
    message.parts.some((part) => part.kind === 'options' && part.answer === null && part.expired !== true && part.taste !== false),
  );
}
