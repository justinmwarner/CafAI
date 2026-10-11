import { describe, expect, it } from 'vitest';
import type { ShotSummary } from '../../coach/types.ts';
import type { LlmMessage } from '../../llm/types.ts';
import type { CoachUiMessage, CoachUiPart, ShotBaseline, ShotRating } from '../types.ts';
import { shotRatedBlock } from './protocol.ts';
import {
  MIDDLE_SCORE,
  baselineFor,
  enjoymentFromScore,
  fillBaselines,
  isShotVerdict,
  needsBaseline,
  runningScore,
  untoldRatings,
  verdictWord,
  type CreditedShot,
} from './shotRating.ts';
import { message } from './uiMessages.ts';

const summary = { shotId: 'x' } as unknown as ShotSummary;

interface CardSpec {
  shotId: string;
  at?: string;
  baseline?: ShotBaseline;
  rating?: ShotRating;
  stars?: number;
}

/** A chat of shot cards (with a coach line between them), each posted a minute after the one before. */
function chat(...cards: CardSpec[]): CoachUiMessage[] {
  return cards.flatMap((card, i) => {
    const part: CoachUiPart = {
      kind: 'shot',
      shotId: card.shotId,
      summary,
      ...(card.baseline ? { baseline: card.baseline } : {}),
      ...(card.rating ? { rating: card.rating } : {}),
      ...(card.stars !== undefined ? { stars: card.stars } : {}),
    };
    const at = card.at ?? `2026-10-11T08:0${i}:00.000Z`;
    return [message(`m-${card.shotId}`, 'system', [part], at), message(`c-${card.shotId}`, 'assistant', [{ kind: 'text', text: 'Got it.' }], at)];
  });
}

const rated = (verdict: ShotRating['verdict'], score: number): ShotRating => ({ verdict, score });
const previous = (shotId: string): ShotBaseline => ({ kind: 'previous', shotId });

describe('the words', () => {
  it('knows the five verdicts and says them as the card does, in lower case', () => {
    expect(['muchWorse', 'worse', 'same', 'better', 'muchBetter'].every(isShotVerdict)).toBe(true);
    expect([4, 'great', null, 'Better'].some(isShotVerdict)).toBe(false);
    expect(verdictWord('muchWorse')).toBe('much worse');
    expect(verdictWord('same')).toBe('about the same');
  });
});

describe('the running score (D126)', () => {
  it("starts a bag's first rated shot at the middle, whatever the word", () => {
    const messages = chat({ shotId: 's1' });
    expect(runningScore(messages, 's1', 'muchWorse')).toBe(MIDDLE_SCORE);
    expect(runningScore(messages, 's1', 'muchBetter')).toBe(5);
  });

  it('moves one step per word from the shot before, two for "much"', () => {
    const messages = chat({ shotId: 's1', rating: rated('better', 6) }, { shotId: 's2', baseline: previous('s1') });
    expect(['muchWorse', 'worse', 'same', 'better', 'muchBetter'].map((v) => runningScore(messages, 's2', v as ShotRating['verdict']))).toEqual([
      4, 5, 6, 7, 8,
    ]);
  });

  it('carries the score over shots nobody rated, and counts old stars as twice their number', () => {
    const unrated = chat({ shotId: 's1', rating: rated('same', 3) }, { shotId: 's2' }, { shotId: 's3' }, { shotId: 's4' });
    expect(runningScore(unrated, 's4', 'better')).toBe(4);
    const starred = chat({ shotId: 's1', stars: 4 }, { shotId: 's2' });
    expect(runningScore(starred, 's2', 'better')).toBe(9);
    expect(runningScore(starred, 's2', 'muchWorse')).toBe(6);
  });

  it('passes over a stored score that is not a number, as over a shot nobody rated', () => {
    const edited = chat({ shotId: 's1', rating: rated('better', 6) }, { shotId: 's2', rating: rated('better', Number.NaN) }, { shotId: 's3' });
    expect(runningScore(edited, 's3', 'better')).toBe(7);
  });

  it('stays within 0-10, and has no score for a shot not in the chat', () => {
    expect(runningScore(chat({ shotId: 's1', stars: 5 }, { shotId: 's2' }), 's2', 'muchBetter')).toBe(10);
    expect(runningScore(chat({ shotId: 's1', rating: rated('worse', 1) }, { shotId: 's2' }), 's2', 'muchWorse')).toBe(0);
    expect(runningScore(chat({ shotId: 's1' }), 'elsewhere', 'better')).toBeNull();
  });

  it("goes to Decaid as it is out of 10, and ten times it out of 100 (D101)", () => {
    expect([0, 5, 7, 10].map((score) => enjoymentFromScore(score, 10))).toEqual([0, 5, 7, 10]);
    expect([0, 5, 7, 10].map((score) => enjoymentFromScore(score, 100))).toEqual([0, 50, 70, 100]);
  });
});

describe('what a shot is compared with (D126)', () => {
  const others: CreditedShot[] = [
    { shotId: 'rb-1', coffee: 'Red Brick', at: '2026-10-10T07:00:00.000Z' },
    { shotId: 'rb-2', coffee: 'Red Brick', at: '2026-10-10T07:30:00.000Z' },
    { shotId: 'later', coffee: 'Santos', at: '2026-10-12T07:00:00.000Z' },
  ];

  it('is the shot card before it in the chat', () => {
    expect(baselineFor(chat({ shotId: 's1' }, { shotId: 's2' }), 's2', others)).toEqual(previous('s1'));
  });

  it("is, for a bag's first shot, the last shot of another coffee credited by then", () => {
    expect(baselineFor(chat({ shotId: 's1' }), 's1', others)).toEqual({ kind: 'otherCoffee', shotId: 'rb-2', coffee: 'Red Brick' });
    // A card posted at the same moment as another bag's shot (a clock that stood still) still counts it.
    expect(baselineFor(chat({ shotId: 's1', at: '2026-10-10T07:00:00.000Z' }), 's1', others)).toMatchObject({ shotId: 'rb-1' });
  });

  it('is the coffee the barista usually enjoys before any other shot, and the last shot of all when the card has no readable time', () => {
    expect(baselineFor(chat({ shotId: 's1', at: '2026-10-01T07:00:00.000Z' }), 's1', others)).toEqual({ kind: 'usual' });
    expect(baselineFor(chat({ shotId: 's1' }), 's1', [])).toEqual({ kind: 'usual' });
    expect(baselineFor(chat({ shotId: 's1', at: 'whenever' }), 's1', others)).toMatchObject({ shotId: 'later' });
    expect(baselineFor(chat({ shotId: 's1' }), 'elsewhere', others)).toBeNull();
  });

  it('is filled in on the cards that need it, never on rated or starred ones, keeping the rest as they were', () => {
    const messages = chat(
      { shotId: 's1', stars: 3 },
      { shotId: 's2' },
      { shotId: 's3', baseline: previous('s2'), rating: rated('better', 7) },
      { shotId: 's4' },
    );
    const filled = fillBaselines(messages, others);
    const cards = filled.flatMap((m) => m.parts).filter((p) => p.kind === 'shot');
    expect(cards.map((card) => card.baseline ?? null)).toEqual([null, previous('s1'), previous('s2'), previous('s3')]);
    expect(filled[0]).toBe(messages[0]);
    expect(filled[1]).toBe(messages[1]);
    expect(filled[4]).toBe(messages[4]);
    expect(filled.some((m) => m.parts.some(needsBaseline))).toBe(false);
    expect(fillBaselines(filled, others)).toBe(filled);
  });
});

describe('the verdicts the coach has not heard (D126)', () => {
  const ratedChat = chat(
    { shotId: 's1', baseline: { kind: 'usual' }, rating: rated('better', 5) },
    { shotId: 's2', baseline: previous('s1'), rating: rated('muchWorse', 3) },
    { shotId: 's3', baseline: previous('s2') },
    { shotId: 's4', stars: 4 },
  );
  const told = (...blocks: string[]): LlmMessage[] => [{ role: 'user', content: blocks.map((text) => ({ type: 'text' as const, text })) }];

  it('are every rated card, in order, until the transcript tells them', () => {
    expect(untoldRatings([], ratedChat)).toEqual([
      { shotId: 's1', verdict: 'better', comparedWith: { kind: 'usual' } },
      { shotId: 's2', verdict: 'much worse', comparedWith: previous('s1') },
    ]);
    const heard = told(shotRatedBlock({ shotId: 's1', verdict: 'better', comparedWith: { kind: 'usual' } }).text);
    expect(untoldRatings(heard, ratedChat).map((payload) => payload.shotId)).toEqual(['s2']);
  });

  it('include a verdict changed since it was told, and go by the last one told', () => {
    const before = shotRatedBlock({ shotId: 's2', verdict: 'worse', comparedWith: previous('s1') }).text;
    const after = shotRatedBlock({ shotId: 's2', verdict: 'much worse', comparedWith: previous('s1') }).text;
    expect(untoldRatings(told(before), ratedChat).map((payload) => payload.shotId)).toEqual(['s1', 's2']);
    expect(untoldRatings([...told(before), ...told(after)], ratedChat).map((payload) => payload.shotId)).toEqual(['s1']);
  });

  it("read only the engine's own blocks in user turns", () => {
    const block = shotRatedBlock({ shotId: 's1', verdict: 'better', comparedWith: { kind: 'usual' } }).text;
    const notHeard: LlmMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: block }] },
      ...told('[event:shot_rated]\nnot json', '[event:shot_rated]\n{"shotId":7}', `I said ${block}`),
    ];
    expect(untoldRatings(notHeard, ratedChat).map((payload) => payload.shotId)).toEqual(['s1', 's2']);
  });
});
