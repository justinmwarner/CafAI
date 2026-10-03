/**
 * Building and updating the chat's display messages (CoachUiMessage).
 * Immutable updates only: the UI subscribes with Object.is selectors.
 */
import type { CoachUiMessage, CoachUiPart, DiffStatus, TemplateCardItem, UiRole } from '../types.ts';
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

export function optionsPart(requestId: string, question: string, options: string[], multiSelect: boolean): CoachUiPart {
  return { kind: 'options', requestId, question, options, multiSelect, answer: null };
}

export function diffPart(fields: {
  requestId: string;
  summary: string;
  lines: string[];
  manualSteps: string[];
  rationale: string;
  expectedEffect: string;
  versionLabel: string | null;
}): CoachUiPart {
  return { kind: 'diff', ...fields, status: 'pending', error: null };
}

export function shotPart(shotId: string, summary: ShotSummary): CoachUiPart {
  return { kind: 'shot', shotId, summary };
}

export function noticePart(tone: 'info' | 'success' | 'warning' | 'error', text: string): CoachUiPart {
  return { kind: 'notice', tone, text };
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
