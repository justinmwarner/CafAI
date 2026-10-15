import { describe, expect, it } from 'vitest';
import { CARE_VIDEO, CARE_VIDEO_MINUTES, embedUrl, formatMoment, routineOf, ROUTINES, watchUrl } from './careGuide.ts';
import { ROUTINE_IDS } from './routines.ts';

const STEPS = ROUTINES.flatMap((routine) => routine.steps);

describe('the guide', () => {
  it("has the four routines, in the segments' order, each with steps", () => {
    expect(ROUTINES.map((routine) => routine.id)).toEqual(ROUTINE_IDS);
    for (const routine of ROUTINES) expect(routine.steps.length).toBeGreaterThan(0);
  });

  it('gives every step a unique id, apart from the routines, a title and a how', () => {
    const ids = STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ROUTINE_IDS) expect(ids).not.toContain(id);
    for (const step of STEPS) {
      expect(step.title.trim()).not.toBe('');
      expect(step.how.trim()).not.toBe('');
    }
  });

  it('keeps every moment inside the video, in whole seconds', () => {
    const moments = ROUTINES.flatMap((routine) => [routine.moment, ...routine.steps.map((step) => step.moment)]).filter(
      (moment): moment is number => moment !== undefined,
    );
    // The description's key moments, and 6:52, 15:04 and 21:36 from the captions (D155).
    expect([...moments].sort((a, b) => a - b)).toEqual([20, 108, 310, 412, 460, 473, 671, 904, 996, 1016, 1296]);
    for (const moment of moments) {
      expect(Number.isInteger(moment)).toBe(true);
      expect(moment).toBeGreaterThanOrEqual(0);
      expect(moment).toBeLessThan(CARE_VIDEO.seconds);
    }
  });

  it("links only to Decent's own pages, over https", () => {
    const links = STEPS.flatMap((step) => (step.link ? [step.link] : []));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.url).toMatch(/^https:\/\/decentespresso\.com\//);
  });

  it('writes plain words: no em dashes, and every how ends a sentence', () => {
    for (const step of STEPS) {
      for (const text of [step.title, step.when, step.how, step.where, step.note]) {
        if (text !== undefined) expect(text).not.toMatch(/—/);
      }
      expect(step.how).toMatch(/\.$/);
    }
  });

  it('finds a routine by id', () => {
    expect(routineOf('weekly').label).toBe('Weekly');
    expect(routineOf('asNeeded').label).toBe('As needed');
  });
});

describe('formatMoment', () => {
  it('is minutes and two-digit seconds', () => {
    expect(formatMoment(0)).toBe('0:00');
    expect(formatMoment(20)).toBe('0:20');
    expect(formatMoment(108)).toBe('1:48');
    expect(formatMoment(1016)).toBe('16:56');
    expect(formatMoment(1296.9)).toBe('21:36');
  });
});

describe("the video's addresses", () => {
  it('embeds from youtube-nocookie at the moment, playing', () => {
    expect(embedUrl(108)).toBe('https://www.youtube-nocookie.com/embed/0cm1JxB_6bI?start=108&autoplay=1&rel=0&playsinline=1');
    expect(embedUrl(0)).toBe('https://www.youtube-nocookie.com/embed/0cm1JxB_6bI?start=0&autoplay=1&rel=0&playsinline=1');
  });

  it('links to YouTube at the moment, or at the start', () => {
    expect(watchUrl(1016)).toBe('https://www.youtube.com/watch?v=0cm1JxB_6bI&t=1016s');
    expect(watchUrl()).toBe('https://www.youtube.com/watch?v=0cm1JxB_6bI');
    expect(watchUrl(0)).toBe('https://www.youtube.com/watch?v=0cm1JxB_6bI');
  });

  it("says the video's length in whole minutes", () => {
    expect(CARE_VIDEO_MINUTES).toBe('22 min');
  });
});
