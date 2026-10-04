import { describe, expect, it } from 'vitest';
import type { CoachUiMessage, CoachUiPart } from '../types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import {
  isTransient,
  message,
  noticePart,
  progressNoticePart,
  removeMessage,
  replaceParts,
  setShotStars,
  shotPart,
  withoutTransient,
} from './uiMessages.ts';

const at = '2026-10-03T08:00:00.000Z';
const summary = { shotId: 'shot-1' } as ShotSummary;

describe('transient notices', () => {
  const loading = progressNoticePart('Loading Kiambu AA v2 on the machine…', { value: null, label: null });

  it('marks a notice with progress as transient', () => {
    expect(loading).toEqual({
      kind: 'notice',
      tone: 'info',
      text: 'Loading Kiambu AA v2 on the machine…',
      progress: { value: null, label: null },
    });
    expect(isTransient(loading)).toBe(true);
    expect(isTransient(noticePart('success', 'Loaded Kiambu AA v2 on the machine.'))).toBe(false);
    expect(isTransient(shotPart('shot-1', summary))).toBe(false);
  });

  it('drops transient notices and the messages left empty, keeping everything else as it was', () => {
    const kept = message('m-1', 'system', [noticePart('success', 'Loaded.')], at);
    const mixed = message('m-2', 'system', [noticePart('info', 'Saved.'), loading], at);
    const gone = message('m-3', 'system', [loading], at);
    const result = withoutTransient([kept, mixed, gone]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(kept);
    expect(result[1]).toEqual({ ...mixed, parts: [noticePart('info', 'Saved.')] });
  });

  it('returns the same array when nothing is transient', () => {
    const messages = [message('m-1', 'system', [noticePart('success', 'Loaded.')], at)];
    expect(withoutTransient(messages)).toBe(messages);
  });
});

describe('message updates', () => {
  const messages: CoachUiMessage[] = [
    message('m-1', 'system', [shotPart('shot-1', summary)], at),
    message('m-2', 'system', [noticePart('info', 'Looking…')], at),
  ];

  it('replaces the parts of one message in place', () => {
    const next: CoachUiPart[] = [noticePart('info', 'Still looking…')];
    const result = replaceParts(messages, 'm-2', next);
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toEqual({ ...messages[1], parts: next });
  });

  it('removes one message', () => {
    expect(removeMessage(messages, 'm-2').map((m) => m.id)).toEqual(['m-1']);
  });

  it("puts a rating on a shot's card", () => {
    const result = setShotStars(messages, 'shot-1', 4);
    expect(result[0]!.parts[0]).toEqual({ kind: 'shot', shotId: 'shot-1', summary, stars: 4 });
    expect(result[1]).toBe(messages[1]);
    expect(setShotStars(messages, 'shot-unknown', 4)).toEqual(messages);
  });
});
