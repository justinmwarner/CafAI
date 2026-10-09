import { describe, expect, it } from 'vitest';
import { createStatsCardState, statsCardFor, statsCardShown } from './statsCard.ts';

describe('the stats card state', () => {
  it('shows after the newest message once the chat first opens', () => {
    const state = createStatsCardState();
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm2')).toBe(false);
    state.open('bag-1', 'm2');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm2')).toBe(true);
  });

  it('opens once a session', () => {
    const state = createStatsCardState();
    state.open('bag-1', 'm2');
    state.hide();
    state.open('bag-1', 'm2');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm2')).toBe(false);
  });

  it('goes away as soon as anything new lands', () => {
    const state = createStatsCardState();
    state.open('bag-1', 'm2');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm3')).toBe(false);
  });

  it('comes back after the newest message on Stats', () => {
    const state = createStatsCardState();
    state.open('bag-1', 'm2');
    state.show('bag-1', 'm5');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm5')).toBe(true);
  });

  it('shows in an empty chat until the first message', () => {
    const state = createStatsCardState();
    state.open(null, null);
    expect(statsCardShown(state.getSnapshot(), null, null)).toBe(true);
    expect(statsCardShown(state.getSnapshot(), null, 'm1')).toBe(false);
  });

  it('belongs to one bag', () => {
    const state = createStatsCardState();
    state.open('bag-1', 'm2');
    expect(statsCardShown(state.getSnapshot(), 'bag-2', 'm2')).toBe(false);
  });

  it('tells its listeners', () => {
    const state = createStatsCardState();
    let calls = 0;
    const stop = state.subscribe(() => {
      calls += 1;
    });
    state.open('bag-1', 'm2');
    state.show('bag-1', 'm3');
    state.hide();
    stop();
    state.show('bag-1', 'm4');
    expect(calls).toBe(3);
  });

  it('keeps its snapshot until something changes', () => {
    const state = createStatsCardState();
    let calls = 0;
    state.subscribe(() => {
      calls += 1;
    });
    state.hide();
    state.show('bag-1', 'm2');
    const shown = state.getSnapshot();
    // Stats again while the card already follows the newest message: it is where it should be.
    state.show('bag-1', 'm2');
    state.open('bag-1', 'm2');
    expect(state.getSnapshot()).toBe(shown);
    expect(calls).toBe(1);
  });
});

describe('statsCardFor', () => {
  it('keeps one state per key, so the card outlives a visit to another screen', () => {
    const coach = {};
    const state = statsCardFor(coach);
    state.open('bag-1', 'm2');
    expect(statsCardFor(coach)).toBe(state);
    expect(statsCardShown(statsCardFor(coach).getSnapshot(), 'bag-1', 'm2')).toBe(true);
  });

  it('starts afresh for another services instance, as after a reload', () => {
    statsCardFor({}).open('bag-1', 'm2');
    const fresh = statsCardFor({}).getSnapshot();
    expect(fresh).toEqual({ at: null, opened: false });
  });
});
