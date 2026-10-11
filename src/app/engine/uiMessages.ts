/**
 * Building and updating the chat's display messages (CoachUiMessage).
 * Immutable updates only: the UI subscribes with Object.is selectors.
 */
import type {
  BeanPickerOption,
  CoachUiMessage,
  CoachUiPart,
  DiffStatus,
  NoticeProgress,
  SetAsideReason,
  TemplateCardItem,
  UiRole,
} from '../types.ts';
import type { SaveBagDetails } from '../../coach/contract.ts';
import type { ShotSummary } from '../../coach/types.ts';

export const NEW_BAG_PROMPT =
  'New bag! Tell me about it: origin, roast level, process, and the tasting notes on the label. ' +
  'Type it the way it reads on the bag; I will take it from there.';

export function message(id: string, role: UiRole, parts: CoachUiPart[], createdAt: string): CoachUiMessage {
  return { id, role, parts, createdAt };
}

export function templatesPart(requestId: string, items: TemplateCardItem[]): CoachUiPart {
  return { kind: 'templates', requestId, items, pickedTemplateId: null };
}

/** `taste`: the question asks how the shot tasted (shotNotes.ts isTasteQuestion). */
export function optionsPart(requestId: string, question: string, options: string[], multiSelect: boolean, taste: boolean): CoachUiPart {
  return { kind: 'options', requestId, question, options, multiSelect, answer: null, taste };
}

/** `keep`: the proposal keeps the recipe (variable "none"); only such a card carries the mark. */
export function diffPart({
  keep = false,
  ...fields
}: {
  requestId: string;
  summary: string;
  lines: string[];
  manualSteps: string[];
  rationale: string;
  expectedEffect: string;
  versionLabel: string | null;
  keep?: boolean;
}): CoachUiPart {
  return { kind: 'diff', ...fields, ...(keep ? { keep } : {}), status: 'pending', error: null };
}

/** "Which coffee is it?" (6.1), open: the batches of Decaid's bean library to pick from. */
export function beanPickerPart(options: BeanPickerOption[]): CoachUiPart {
  return { kind: 'beanPicker', options, choice: null };
}

/** "Which coffee is it?" (6.1) before Decaid's batches are read: up at once, its rows to come. */
export function loadingBeanPickerPart(): CoachUiPart {
  return { kind: 'beanPicker', options: [], choice: null, loading: true };
}

/** The bean card that still waits for Decaid's batches, answered or not. */
export function isLoadingBeanCard(part: CoachUiPart): boolean {
  return part.kind === 'beanPicker' && part.loading === true;
}

/** The bean card once Decaid's batches are read: its rows, and no longer loading. */
export function filledBeanCard(part: CoachUiPart, options: BeanPickerOption[]): CoachUiPart {
  if (part.kind !== 'beanPicker') return part;
  const { loading: _loading, ...rest } = part;
  return { ...rest, options };
}

/** The details read from a photo of the bag, for the barista to check and confirm (6.8). */
export function bagConfirmPart(details: SaveBagDetails): CoachUiPart {
  return { kind: 'bagConfirm', details, confirmed: false };
}

/** The bean card while it waits for an answer. */
export function isOpenBeanCard(part: CoachUiPart): boolean {
  return part.kind === 'beanPicker' && part.choice === null && !part.expired;
}

/** The photo's details while they wait for Confirm. */
export function isOpenBagConfirm(part: CoachUiPart): boolean {
  return part.kind === 'bagConfirm' && !part.confirmed && !part.expired;
}

/**
 * A card the conversation went past unanswered, closed with the reason, so it
 * can say why. A change that was already decided, an answered bean card,
 * confirmed details, and every other part, stay as they are.
 */
export function setAside(part: CoachUiPart, reason: SetAsideReason): CoachUiPart {
  if (part.kind === 'templates' || part.kind === 'options') return { ...part, expired: true, setAsideReason: reason };
  if (part.kind === 'diff' && part.status === 'pending') return { ...part, status: 'expired', setAsideReason: reason };
  if ((part.kind === 'beanPicker' || part.kind === 'bagConfirm') && (isOpenBeanCard(part) || isOpenBagConfirm(part))) {
    return { ...part, expired: true, setAsideReason: reason };
  }
  return part;
}

export function shotPart(shotId: string, summary: ShotSummary): CoachUiPart {
  return { kind: 'shot', shotId, summary };
}

export function noticePart(tone: 'info' | 'success' | 'warning' | 'error', text: string): CoachUiPart {
  return { kind: 'notice', tone, text };
}

/** The dose behind v1's yield (D57). */
export interface StartingDose {
  /** Decaid's dose as read at the pick; null when there was none to read. */
  decaidG: number | null;
  /** That dose when CafAI coaches from it, else null. */
  knownG: number | null;
  /** What v1 assumes otherwise (Decent's stock 18 g basket). */
  assumedG: number;
  /** The doses CafAI coaches from. */
  range: { min: number; max: number };
}

const grams = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * Where v1 stops and why, in CafAI's own words after a template pick (D57).
 * The ratio is the stop's own, so the numbers always add up, even where the
 * yield lever's bounds moved the stop off the author's ratio (Londonium at
 * 12 g). Without a dose CafAI can use, it says so and what fixes it.
 */
export function startingYieldText(title: string, yieldG: number, dose: StartingDose): string {
  if (dose.knownG !== null) {
    return `${title} stops at ${grams(yieldG)} g: ${(yieldG / dose.knownG).toFixed(1)} x the ${dose.knownG.toFixed(1)} g dose in Decaid.`;
  }
  const assumed = `${grams(dose.assumedG)} g`;
  const why =
    dose.decaidG === null
      ? 'CafAI found no dose in Decaid'
      : `The ${dose.decaidG.toFixed(1)} g dose in Decaid is outside ${dose.range.min}-${dose.range.max} g`;
  return (
    `${title} stops at ${grams(yieldG)} g: ${(yieldG / dose.assumedG).toFixed(1)} x ${assumed}. ` +
    `${why}, so v1 assumes ${assumed}. Set your real dose in Decaid and CafAI will use it.`
  );
}

/** A notice with a progress bar while CafAI works; transient, never stored. */
export function progressNoticePart(text: string, progress: NoticeProgress): CoachUiPart {
  return { kind: 'notice', tone: 'info', text, progress };
}

export function isTransient(part: CoachUiPart): boolean {
  return part.kind === 'notice' && part.progress !== undefined;
}

/**
 * The messages without transient notices (and without messages left empty):
 * what is stored, and how a stored conversation is read back. Unchanged
 * messages keep their identity.
 */
export function withoutTransient(messages: CoachUiMessage[]): CoachUiMessage[] {
  if (!messages.some((m) => m.parts.some(isTransient))) return messages;
  return messages.flatMap((m) => {
    if (!m.parts.some(isTransient)) return [m];
    const parts = m.parts.filter((part) => !isTransient(part));
    return parts.length > 0 ? [{ ...m, parts }] : [];
  });
}

/** Swap the parts of one message (e.g. a progress notice updated in place). */
export function replaceParts(messages: readonly CoachUiMessage[], messageId: string, parts: CoachUiPart[]): CoachUiMessage[] {
  return messages.map((m) => (m.id === messageId ? { ...m, parts } : m));
}

export function removeMessage(messages: readonly CoachUiMessage[], messageId: string): CoachUiMessage[] {
  return messages.filter((m) => m.id !== messageId);
}

/** The barista's star rating on a shot's card. */
export function setShotStars(messages: readonly CoachUiMessage[], shotId: string, stars: number): CoachUiMessage[] {
  return updatePart(
    messages,
    (part) => part.kind === 'shot' && part.shotId === shotId,
    (part) => (part.kind === 'shot' ? { ...part, stars } : part),
  );
}

/** The link to a shot's page on Visualizer, on its card (6.4). */
export function setVisualizerLink(messages: readonly CoachUiMessage[], shotId: string, url: string): CoachUiMessage[] {
  return updatePart(
    messages,
    (part) => part.kind === 'shot' && part.shotId === shotId,
    (part) => (part.kind === 'shot' ? { ...part, visualizerUrl: url } : part),
  );
}

/** Replace the first part matching `match`, across all messages. */
export function updatePart(
  messages: readonly CoachUiMessage[],
  match: (part: CoachUiPart) => boolean,
  update: (part: CoachUiPart) => CoachUiPart,
): CoachUiMessage[] {
  let done = false;
  return messages.map((m) => {
    if (done) return m;
    const index = m.parts.findIndex(match);
    if (index < 0) return m;
    done = true;
    const parts = m.parts.slice();
    parts[index] = update(parts[index]!);
    return { ...m, parts };
  });
}

export function byRequestId(requestId: string) {
  return (part: CoachUiPart) => 'requestId' in part && part.requestId === requestId;
}

export function setDiffStatus(
  messages: readonly CoachUiMessage[],
  requestId: string,
  status: DiffStatus,
  error: string | null = null,
): CoachUiMessage[] {
  return updatePart(messages, byRequestId(requestId), (part) =>
    part.kind === 'diff' ? { ...part, status, error } : part,
  );
}

/** Append text to a message's (single) streaming text part, creating it if needed. */
export function appendText(messages: readonly CoachUiMessage[], messageId: string, delta: string): CoachUiMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    const index = m.parts.findIndex((p) => p.kind === 'text');
    if (index < 0) return { ...m, parts: [{ kind: 'text', text: delta, streaming: true }, ...m.parts] };
    const parts = m.parts.slice();
    const part = parts[index]!;
    if (part.kind === 'text') parts[index] = { ...part, text: part.text + delta, streaming: true };
    return { ...m, parts };
  });
}

/** Mark every streaming text part as finished; drop assistant messages left empty. */
export function finishStreaming(messages: readonly CoachUiMessage[]): CoachUiMessage[] {
  return messages
    .map((m) =>
      m.parts.some((p) => p.kind === 'text' && p.streaming)
        ? {
            ...m,
            parts: m.parts.map((p) => (p.kind === 'text' && p.streaming ? { kind: 'text' as const, text: p.text.trim() } : p)),
          }
        : m,
    )
    .filter((m) => !(m.role === 'assistant' && m.parts.every((p) => p.kind === 'text' && p.text.trim() === '')));
}
