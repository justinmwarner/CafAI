import { describe, expect, it } from 'vitest';
import { mockOptionsFromUrl } from './decaid/urlOptions.ts';
import { DEMO_COACH_OPTIONS, MOCK_DECAID_PARAM, demoIgnoredNote, demoRequested, mockPlanFromUrl } from './plan.ts';

describe('mockPlanFromUrl', () => {
  it('starts the mock Decaid and the scripted coach by default, as before', () => {
    expect(mockPlanFromUrl('')).toEqual({ decaid: true, coachSpeed: 1, demo: false, coachOptions: {} });
    expect(mockPlanFromUrl('?mockPersist=1&mockGrinders=0')).toEqual({ decaid: true, coachSpeed: 1, demo: false, coachOptions: {} });
  });

  it('?mockDecaid=0 starts the scripted coach alone, so Decaid calls reach a real Decaid', () => {
    expect(MOCK_DECAID_PARAM).toBe('mockDecaid');
    expect(mockPlanFromUrl('?mockDecaid=0')).toEqual({ decaid: false, coachSpeed: 1, demo: false, coachOptions: {} });
    expect(mockPlanFromUrl('?mockPersist=1&mockDecaid=0').decaid).toBe(false);
  });

  it('only exactly 0 turns the mock Decaid off, like the other switches', () => {
    for (const value of ['1', '', 'false', 'no', ' 0', '00']) {
      expect(mockPlanFromUrl(`?mockDecaid=${value}`).decaid, value).toBe(true);
    }
    expect(mockPlanFromUrl('?mockdecaid=0').decaid).toBe(true);
  });

  it('reads ?mockSpeed for the coach the way main.tsx always did', () => {
    expect(mockPlanFromUrl('?mockSpeed=25').coachSpeed).toBe(25);
    expect(mockPlanFromUrl('?mockSpeed=0.5').coachSpeed).toBe(0.5);
    // Unreadable or 0 is normal speed; Infinity plays the coach with no delays.
    for (const value of ['fast', '0', '']) expect(mockPlanFromUrl(`?mockSpeed=${value}`).coachSpeed, value).toBe(1);
    expect(mockPlanFromUrl('?mockSpeed=Infinity').coachSpeed).toBe(Infinity);
    expect(mockPlanFromUrl('?mockDecaid=0&mockSpeed=4')).toEqual({ decaid: false, coachSpeed: 4, demo: false, coachOptions: {} });
  });

  it('is not one of the mock Decaid options', () => {
    expect(mockOptionsFromUrl('?mockDecaid=0')).toEqual({});
  });
});

describe('the demo (?demo=1, D76)', () => {
  it('turns the demo on with the scripted coach in its demo timing and voice', () => {
    // The first text_delta is the 7th event of a reply: 1200 ms + 6 x 50 ms is about 1.5 s of "Thinking…".
    expect(DEMO_COACH_OPTIONS).toEqual({ firstEventDelayMs: 1200, eventDelayMs: 50, jitterMs: 20, sentencePauseMs: 150, voice: 'demo' });
    expect(mockPlanFromUrl('?demo=1')).toEqual({ decaid: true, coachSpeed: 1, demo: true, coachOptions: DEMO_COACH_OPTIONS });
  });

  it('keeps ?mockSpeed working in the demo, so a test can hurry the coach', () => {
    expect(mockPlanFromUrl('?demo=1&mockSpeed=25')).toEqual({ decaid: true, coachSpeed: 25, demo: true, coachOptions: DEMO_COACH_OPTIONS });
  });

  it('hands out a copy of the demo options, never the shared object', () => {
    const plan = mockPlanFromUrl('?demo=1');
    expect(plan.coachOptions).not.toBe(DEMO_COACH_OPTIONS);
    plan.coachOptions.voice = 'terse';
    expect(mockPlanFromUrl('?demo=1').coachOptions.voice).toBe('demo');
  });

  it('needs the built-in mock Decaid: with ?mockDecaid=0 the flag is ignored', () => {
    expect(mockPlanFromUrl('?demo=1&mockDecaid=0')).toEqual({ decaid: false, coachSpeed: 1, demo: false, coachOptions: {} });
  });

  it('says why when ?demo=1 is ignored, and only then', () => {
    expect(demoIgnoredNote('?demo=1&mockDecaid=0')).toMatch(/\?demo=1 is ignored.*mockDecaid=0.*npm run demo/);
    for (const search of ['', '?demo=1', '?mockDecaid=0', '?demo=0&mockDecaid=0']) expect(demoIgnoredNote(search), search).toBeNull();
  });

  it('only exactly demo=1 turns it on', () => {
    for (const value of ['0', '', 'true', 'yes', ' 1', '01']) {
      expect(mockPlanFromUrl(`?demo=${value}`).demo, value).toBe(false);
      expect(demoRequested(new URLSearchParams(`?demo=${value}`)), value).toBe(false);
    }
    expect(mockPlanFromUrl('?Demo=1').demo).toBe(false);
    expect(demoRequested(new URLSearchParams('?demo=1'))).toBe(true);
    expect(demoRequested(new URLSearchParams('?demo=1&mockDecaid=0'))).toBe(false);
  });

  it('leaves everything as it was without ?demo', () => {
    for (const search of ['', '?mockSpeed=4', '?mockPersist=1', '?mockExamples=0&mockUploadMs=3000']) {
      const plan = mockPlanFromUrl(search);
      expect(plan.demo, search).toBe(false);
      expect(plan.coachOptions, search).toEqual({});
    }
  });
});
