import { describe, expect, it } from 'vitest';
import type { CoachUiMessage, CoachUiPart } from '../../app/types.ts';
import type { ShotSeries, ShotSummary } from '../../coach/types.ts';
import { sampleSeries, sampleSummary } from '../chat/testing/fixtures.ts';
import {
  chatShotSummary,
  comparisonTarget,
  describeShot,
  hasCurve,
  keyFacts,
  newestShotId,
  PREVIOUS_SHOT,
  pourCurve,
  sameTarget,
  shotCardOf,
  underThem,
} from './comparison.ts';

function series(tS: number[], pressure: (number | null)[], flow: (number | null)[]): ShotSeries {
  const blank = tS.map(() => null);
  return { tS, pressure, flow, weight: blank, weightFlow: blank, temperature: blank, targetPressure: blank, targetFlow: blank };
}

function card(shotId: string, summary: ShotSummary = sampleSummary({ shotId }), extra: Partial<Extract<CoachUiPart, { kind: 'shot' }>> = {}): CoachUiMessage {
  return { id: `m-${shotId}`, role: 'system', parts: [{ kind: 'shot', shotId, summary, ...extra }], createdAt: '2026-10-15T08:00:00.000Z' };
}

const text = (id: string, said: string): CoachUiMessage => ({ id, role: 'assistant', parts: [{ kind: 'text', text: said }], createdAt: '2026-10-15T08:00:00.000Z' });

describe('the shot drawn under another (D-CURVE-1)', () => {
  it("is the one the card's question names: the previous shot, or another coffee's last shot", () => {
    expect(comparisonTarget({ kind: 'previous', shotId: 's-1' })).toEqual({ shotId: 's-1', name: 'Previous shot' });
    expect(comparisonTarget({ kind: 'otherCoffee', shotId: 's-r', coffee: 'Red Brick' })).toEqual({ shotId: 's-r', name: 'Last shot of Red Brick' });
    expect(comparisonTarget({ kind: 'otherCoffee', shotId: 's-r', coffee: null })).toEqual({ shotId: 's-r', name: 'Last shot' });
  });

  it('is none for the coffee usually enjoyed, or a card that names nothing (stars before D126)', () => {
    expect(comparisonTarget({ kind: 'usual' })).toBeNull();
    expect(comparisonTarget(null)).toBeNull();
    expect(comparisonTarget(undefined)).toBeNull();
  });

  it('is the same target when its shot and its name are', () => {
    const a = { shotId: 's-1', name: PREVIOUS_SHOT };
    expect(sameTarget(a, { ...a })).toBe(true);
    expect(sameTarget(a, { shotId: 's-2', name: PREVIOUS_SHOT })).toBe(false);
    expect(sameTarget(a, { shotId: 's-1', name: 'Last shot' })).toBe(false);
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget(a, null)).toBe(false);
  });
});

describe('pourCurve: a shot on the pour clock (D-CURVE-5)', () => {
  it("counts from the pour's start, keeping only the preheat's last point, at 0", () => {
    const summary = sampleSummary({
      pourStartS: 2.4,
      series: series([0, 1, 2, 3, 4, 4.6], [0, 0, 0.1, 1.5, 3, 4], [0, 0, 0.2, 4, 3.8, 3.5]),
    });
    const curve = pourCurve(summary);
    expect(curve.t.map((t) => Math.round(t * 10) / 10)).toEqual([0, 0.6, 1.6, 2.2]);
    expect(curve.pressure).toEqual([0.1, 1.5, 3, 4]);
    expect(curve.flow).toEqual([0.2, 4, 3.8, 3.5]);
    expect(curve.endS).toBeCloseTo(2.2);
  });

  it('starts at 0 without a lead-in when the pour starts on a whole second', () => {
    const curve = pourCurve(sampleSummary({ pourStartS: 2, series: series([0, 1, 2, 3], [0, 0, 1, 2], [0, 0, 3, 3]) }));
    expect(curve.t).toEqual([0, 1]);
    expect(curve.pressure).toEqual([1, 2]);
  });

  it('keeps the times of a summary saved before CafAI recorded the pour start, as its card always showed them', () => {
    const summary = sampleSummary();
    expect(summary.pourStartS).toBeUndefined();
    const curve = pourCurve(summary);
    expect(curve.t).toEqual(summary.series.tS);
    expect(curve.endS).toBe(28);
  });

  it('keeps a gap a gap, and skips a time that is not a number or goes backwards', () => {
    const curve = pourCurve(sampleSummary({ pourStartS: 0, series: series([0, 1, Number.NaN, 2, 1.5, 3], [1, null, 5, 2, 7, 3], [1, 1, 1, null, 1, 1]) }));
    expect(curve.t).toEqual([0, 1, 2, 3]);
    expect(curve.pressure).toEqual([1, null, 2, 3]);
    expect(curve.flow).toEqual([1, 1, null, 1]);
  });

  it('is worked out once per summary', () => {
    const summary = sampleSummary();
    expect(pourCurve(summary)).toBe(pourCurve(summary));
  });

  it('has a curve to draw only with two points and a reading', () => {
    expect(hasCurve(pourCurve(sampleSummary()))).toBe(true);
    expect(hasCurve(pourCurve(sampleSummary({ series: series([0], [3], [2]) })))).toBe(false);
    expect(hasCurve(pourCurve(sampleSummary({ series: series([0, 1, 2], [null, null, null], [null, null, null]) })))).toBe(false);
    expect(hasCurve(pourCurve(sampleSummary({ series: series([], [], []) })))).toBe(false);
  });
});

describe('the chat as the source of a curve (D-CURVE-4)', () => {
  const messages = [card('s-1'), text('t', 'Sour?'), card('s-2', sampleSummary({ shotId: 's-2', series: sampleSeries(30, 8) }))];

  it("finds a shot's card, and its summary while that keeps a curve", () => {
    expect(shotCardOf(messages, 's-2')?.shotId).toBe('s-2');
    expect(chatShotSummary(messages, 's-1')?.shotId).toBe('s-1');
    expect(chatShotSummary(messages, 's-9')).toBeNull();
  });

  it('gives no summary for a card whose curve did not come back (an empty series)', () => {
    const empty = [card('s-1', sampleSummary({ shotId: 's-1', series: series([], [], []) }))];
    expect(shotCardOf(empty, 's-1')).not.toBeNull();
    expect(chatShotSummary(empty, 's-1')).toBeNull();
  });

  it('names the newest shot card, leaving out the shot on screen', () => {
    expect(newestShotId(messages)).toBe('s-2');
    expect(newestShotId(messages, 's-2')).toBe('s-1');
    expect(newestShotId([text('t', 'Hello')])).toBeNull();
    expect(newestShotId([])).toBeNull();
  });
});

describe('the words for the shot under', () => {
  const previous = { shotId: 's-1', name: PREVIOUS_SHOT };

  it('adds it to the name of the curves', () => {
    expect(underThem(previous)).toBe('with the pressure and flow of your previous shot under them');
    expect(underThem({ shotId: 's-r', name: 'Last shot of Red Brick' })).toBe('with the pressure and flow of your last shot of Red Brick under them');
  });

  it('describes it with its time and peak, for a screen reader', () => {
    expect(describeShot(previous, sampleSummary())).toBe('Previous shot: 27.8 s, peak pressure 8.9 bar.');
    expect(describeShot(previous, sampleSummary({ peakPressureBar: null }))).toBe('Previous shot: 27.8 s.');
  });

  it("gives the Shot view's key its time and yield, without a yield it does not have", () => {
    expect(keyFacts(sampleSummary())).toBe('27.8 s · 36.4 g');
    expect(keyFacts(sampleSummary({ yieldG: null }))).toBe('27.8 s');
  });
});
