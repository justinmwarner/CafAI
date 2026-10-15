import { describe, expect, it, vi } from 'vitest';
import type { CoachUiMessage, ShotBaseline } from '../../app/types.ts';
import { sampleSummary } from '../chat/testing/fixtures.ts';
import { createFakeCoach } from '../testing/fakeServices.ts';
import type { ShotTraceState } from '../machine/shotTrace.ts';
import { createShotViewComparison, shotViewComparisonFor } from './shotViewComparison.ts';

function fakeTrace(initial: ShotTraceState = { phase: 'empty', finishedShotId: null }) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next: ShotTraceState) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function card(shotId: string, baseline?: ShotBaseline): CoachUiMessage {
  return {
    id: `m-${shotId}`,
    role: 'system',
    parts: [{ kind: 'shot', shotId, summary: sampleSummary({ shotId }), ...(baseline ? { baseline } : {}) }],
    createdAt: '2026-10-15T08:00:00.000Z',
  };
}

describe("the Shot view's shot under (D-CURVE-1, D-CURVE-2)", () => {
  it('draws nothing before any shot', () => {
    const coach = createFakeCoach({ messages: [card('s-1')] });
    const store = createShotViewComparison(fakeTrace(), coach);
    expect(store.getTarget()).toBeNull();
  });

  it("while a shot pulls, is the bag's newest card, the one its card will be compared with", () => {
    const trace = fakeTrace();
    const coach = createFakeCoach({ messages: [card('s-1'), card('s-2', { kind: 'previous', shotId: 's-1' })] });
    const store = createShotViewComparison(trace, coach);
    const listener = vi.fn();
    store.subscribe(listener);
    trace.set({ phase: 'live', finishedShotId: null });
    expect(store.getTarget()).toEqual({ shotId: 's-2', name: 'Previous shot' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is none while a bag's first shot pulls; once its card is in, the shot that card asks about", () => {
    const trace = fakeTrace({ phase: 'live', finishedShotId: null });
    const coach = createFakeCoach({ messages: [] });
    const store = createShotViewComparison(trace, coach);
    expect(store.getTarget()).toBeNull();
    trace.set({ phase: 'done', finishedShotId: 's-new' });
    expect(store.getTarget()).toBeNull();
    coach.setState({ messages: [card('s-new', { kind: 'otherCoffee', shotId: 's-r', coffee: 'Red Brick' })] });
    expect(store.getTarget()).toEqual({ shotId: 's-r', name: 'Last shot of Red Brick' });
  });

  it('once done and before its card lands, keeps to the newest other card; then takes the card, unchanged when it says the same', () => {
    const trace = fakeTrace({ phase: 'live', finishedShotId: null });
    const coach = createFakeCoach({ messages: [card('s-1')] });
    const store = createShotViewComparison(trace, coach);
    const whilePulling = store.getTarget();
    trace.set({ phase: 'done', finishedShotId: 's-2' });
    expect(store.getTarget()).toBe(whilePulling);
    coach.setState({ messages: [card('s-1'), card('s-2', { kind: 'previous', shotId: 's-1' })] });
    // The same shot under, the same object: nothing to redraw.
    expect(store.getTarget()).toBe(whilePulling);
  });

  it('keeps what the shot\'s card asked about after the chat moves to another bag', () => {
    const trace = fakeTrace({ phase: 'done', finishedShotId: 's-2' });
    const coach = createFakeCoach({ messages: [card('s-1'), card('s-2', { kind: 'previous', shotId: 's-1' })] });
    const store = createShotViewComparison(trace, coach);
    expect(store.getTarget()).toEqual({ shotId: 's-1', name: 'Previous shot' });
    coach.setState({ messages: [card('other-9')] });
    expect(store.getTarget()).toEqual({ shotId: 's-1', name: 'Previous shot' });
  });

  it("draws nothing under a shot whose card names nothing (the coffee usually enjoyed)", () => {
    const trace = fakeTrace({ phase: 'done', finishedShotId: 's-1' });
    const coach = createFakeCoach({ messages: [card('s-1', { kind: 'usual' })] });
    expect(createShotViewComparison(trace, coach).getTarget()).toBeNull();
  });

  it('keeps the guide it pulled with for a shot Decaid gave no id, never its own card', () => {
    const trace = fakeTrace({ phase: 'live', finishedShotId: null });
    const coach = createFakeCoach({ messages: [card('s-1')] });
    const store = createShotViewComparison(trace, coach);
    trace.set({ phase: 'done', finishedShotId: null });
    coach.setState({ messages: [card('s-1'), card('s-2', { kind: 'previous', shotId: 's-1' })] });
    expect(store.getTarget()).toEqual({ shotId: 's-1', name: 'Previous shot' });
  });

  it('starts over with the next shot', () => {
    const trace = fakeTrace({ phase: 'done', finishedShotId: 's-2' });
    const coach = createFakeCoach({ messages: [card('s-1'), card('s-2', { kind: 'previous', shotId: 's-1' })] });
    const store = createShotViewComparison(trace, coach);
    trace.set({ phase: 'live', finishedShotId: null });
    expect(store.getTarget()).toEqual({ shotId: 's-2', name: 'Previous shot' });
  });

  it('is one store for a trace and a coach', () => {
    const trace = fakeTrace();
    const coach = createFakeCoach();
    expect(shotViewComparisonFor(trace, coach)).toBe(shotViewComparisonFor(trace, coach));
    expect(shotViewComparisonFor(trace, coach)).not.toBe(shotViewComparisonFor(trace, createFakeCoach()));
  });
});
