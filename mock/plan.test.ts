import { describe, expect, it } from 'vitest';
import { mockOptionsFromUrl } from './decaid/urlOptions.ts';
import { MOCK_DECAID_PARAM, mockPlanFromUrl } from './plan.ts';

describe('mockPlanFromUrl', () => {
  it('starts the mock Decaid and the scripted coach by default, as before', () => {
    expect(mockPlanFromUrl('')).toEqual({ decaid: true, coachSpeed: 1 });
    expect(mockPlanFromUrl('?mockPersist=1&mockGrinders=0')).toEqual({ decaid: true, coachSpeed: 1 });
  });

  it('?mockDecaid=0 starts the scripted coach alone, so Decaid calls reach a real Decaid', () => {
    expect(MOCK_DECAID_PARAM).toBe('mockDecaid');
    expect(mockPlanFromUrl('?mockDecaid=0')).toEqual({ decaid: false, coachSpeed: 1 });
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
    expect(mockPlanFromUrl('?mockDecaid=0&mockSpeed=4')).toEqual({ decaid: false, coachSpeed: 4 });
  });

  it('is not one of the mock Decaid options', () => {
    expect(mockOptionsFromUrl('?mockDecaid=0')).toEqual({});
  });
});
