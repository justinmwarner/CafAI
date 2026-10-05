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
  startingYieldText,
  withoutTransient,
  type StartingDose,
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

describe("where v1 stops (D57)", () => {
  const dose = (decaidG: number | null, knownG: number | null): StartingDose => ({
    decaidG,
    knownG,
    assumedG: 18,
    range: { min: 12, max: 25 },
  });

  it('names the dose in Decaid that v1 was worked out from', () => {
    expect(startingYieldText('Kiambu AA v1', 50, dose(18, 18))).toBe('Kiambu AA v1 stops at 50 g: 2.8 x the 18.0 g dose in Decaid.');
    expect(startingYieldText('Kiambu AA v1', 45, dose(16, 16))).toBe('Kiambu AA v1 stops at 45 g: 2.8 x the 16.0 g dose in Decaid.');
    expect(startingYieldText('Sumatra v1', 37, dose(18.5, 18.5))).toBe('Sumatra v1 stops at 37 g: 2.0 x the 18.5 g dose in Decaid.');
  });

  it("gives the ratio of the stop itself when the lever's bounds moved it", () => {
    // Londonium at 12 g: 2.0 x 12 = 24 g sits under its 25 g minimum, so v1 stops at 25 g.
    expect(startingYieldText('Sumatra v1', 25, dose(12, 12))).toBe('Sumatra v1 stops at 25 g: 2.1 x the 12.0 g dose in Decaid.');
  });

  it('says v1 assumes 18 g when Decaid has no dose, and how to change that', () => {
    expect(startingYieldText('Kiambu AA v1', 50, dose(null, null))).toBe(
      'Kiambu AA v1 stops at 50 g: 2.8 x 18 g. CafAI found no dose in Decaid, so v1 assumes 18 g. Set your real dose in Decaid and CafAI will use it.',
    );
  });

  it("says v1 assumes 18 g when Decaid's dose is outside 12-25 g", () => {
    expect(startingYieldText('Kiambu AA v1', 50, dose(7, null))).toBe(
      'Kiambu AA v1 stops at 50 g: 2.8 x 18 g. The 7.0 g dose in Decaid is outside 12-25 g, so v1 assumes 18 g. Set your real dose in Decaid and CafAI will use it.',
    );
    expect(startingYieldText('Kiambu AA v1', 90, dose(30, null))).toContain('The 30.0 g dose in Decaid is outside 12-25 g');
  });
});
