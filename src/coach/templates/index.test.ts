import { describe, expect, it } from 'vitest';

import { ROAST_LEVELS, TEMPLATE_IDS } from '../contract.ts';
import { applyLever, readLeverValues, snapToGranularity } from '../levers.ts';
import { profileId } from '../profileId.ts';
import { getTemplate, TEMPLATES } from './index.ts';

/** docs/verified/03-profiles.md section 9: template value, min, max, granularity, max change. */
const LEVER_TABLE: Record<string, Record<string, [number, number, number, number, number]>> = {
  'blooming-espresso': {
    temp: [92, 86, 94, 0.5, 2],
    yield: [60, 30, 80, 1, 4],
    bloom: [30, 10, 40, 1, 5],
    piExit: [4, 2, 6, 0.5, 1],
    flow: [2.2, 1.5, 3.5, 0.1, 0.4],
  },
  'd-flow': {
    temp: [88, 84, 94, 0.5, 2],
    yield: [50, 30, 70, 1, 4],
    soak: [3, 2, 6, 0.5, 1],
    soakWeight: [4, 2, 8, 1, 2],
    pourFlow: [1.7, 1, 3, 0.1, 0.3],
    pourPmax: [8.5, 6, 10, 0.5, 1],
  },
  londonium: {
    temp: [88, 84, 92, 0.5, 2],
    yield: [42, 25, 60, 1, 4],
    soak: [12, 4, 24, 1, 4],
    peak: [9, 6, 10, 0.5, 1],
    declineEnd: [3, 2, 6, 0.5, 1],
  },
};

describe('TEMPLATES', () => {
  it('has the three protocol templates in order', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
  });

  it('declares exactly the protocol lever ids, in order', () => {
    expect(getTemplate('blooming-espresso')?.levers.map((l) => l.id)).toEqual(['temp', 'yield', 'bloom', 'piExit', 'flow']);
    expect(getTemplate('d-flow')?.levers.map((l) => l.id)).toEqual([
      'temp',
      'yield',
      'soak',
      'soakWeight',
      'pourFlow',
      'pourPmax',
    ]);
    expect(getTemplate('londonium')?.levers.map((l) => l.id)).toEqual(['temp', 'yield', 'soak', 'peak', 'declineEnd']);
  });

  it('hashes every template to its bundled Decaid id', () => {
    expect(TEMPLATES.map((t) => [t.id, t.decaidDefaultId])).toEqual([
      ['blooming-espresso', 'profile:7438cb7266f60558b48f'],
      ['d-flow', 'profile:59036f8846b1ed3b4255'],
      ['londonium', 'profile:729d284747718d27c93a'],
    ]);
    for (const template of TEMPLATES) expect(profileId(template.profile)).toBe(template.decaidDefaultId);
  });

  it('keeps the id when every lever is written back at its template value', () => {
    for (const template of TEMPLATES) {
      let profile = template.profile;
      for (const [leverId, value] of Object.entries(readLeverValues(template, profile))) {
        profile = applyLever(template, profile, leverId, value);
      }
      expect(profile).toEqual(template.profile);
      expect(profileId(profile)).toBe(template.decaidDefaultId);
    }
  });

  it('matches the lever tables of 03-profiles section 9', () => {
    for (const template of TEMPLATES) {
      const values = readLeverValues(template, template.profile);
      const table = LEVER_TABLE[template.id]!;
      expect(Object.keys(values)).toEqual(Object.keys(table));
      for (const lever of template.levers) {
        const [value, min, max, granularity, maxDelta] = table[lever.id]!;
        expect([values[lever.id], lever.min, lever.max, lever.granularity, lever.maxDelta], `${template.id}.${lever.id}`).toEqual([
          value,
          min,
          max,
          granularity,
          maxDelta,
        ]);
        expect(snapToGranularity(value, granularity)).toBe(value);
        expect(lever.label.length).toBeGreaterThan(0);
        expect(lever.description.length).toBeGreaterThan(20);
      }
    }
  });

  it('marks yield levers for the workflow context and scales their bounds with the dose', () => {
    const ratios = { 'blooming-espresso': [2.0, 3.5], 'd-flow': [1.8, 3.0], londonium: [1.5, 2.8] } as const;
    for (const template of TEMPLATES) {
      const yieldLever = template.levers.find((l) => l.id === 'yield')!;
      expect(yieldLever.workflowContextKey).toBe('targetYield');
      expect(yieldLever.paths).toEqual(['target_weight']);
      const [min, max] = ratios[template.id as keyof typeof ratios];
      expect(yieldLever.doseRatio).toEqual({ min, max });
      expect(template.levers.filter((l) => l.workflowContextKey).map((l) => l.id)).toEqual(['yield']);
    }
  });

  it('shifts temperature uniformly from the documented anchor step', () => {
    const anchors = { 'blooming-espresso': 'steps[4].temperature', 'd-flow': 'steps[2].temperature', londonium: 'steps[4].temperature' };
    for (const template of TEMPLATES) {
      const temp = template.levers.find((l) => l.id === 'temp')!;
      expect(temp.mode).toBe('uniformShift');
      expect(temp.paths).toEqual(['steps[*].temperature']);
      expect(temp.anchor).toBe(anchors[template.id as keyof typeof anchors]);
    }
  });

  it('links the paths that must move together', () => {
    const linked = TEMPLATES.flatMap((t) => t.levers.filter((l) => l.paths.length > 1).map((l) => `${t.id}.${l.id}`));
    expect(linked).toEqual(['blooming-espresso.flow', 'd-flow.soak', 'londonium.declineEnd']);
    expect(getTemplate('blooming-espresso')?.levers.find((l) => l.id === 'flow')?.paths).toEqual(['steps[3].flow', 'steps[4].flow']);
    expect(getTemplate('d-flow')?.levers.find((l) => l.id === 'soak')?.paths).toEqual(['steps[0].pressure', 'steps[1].pressure']);
    expect(getTemplate('londonium')?.levers.find((l) => l.id === 'declineEnd')?.paths).toEqual([
      'steps[4].pressure',
      'steps[5].pressure',
    ]);
  });

  it('needs a scale only for the D-Flow soak weight', () => {
    const scaled = TEMPLATES.flatMap((t) => t.levers.filter((l) => l.requiresScale).map((l) => `${t.id}.${l.id}`));
    expect(scaled).toEqual(['d-flow.soakWeight']);
    expect(getTemplate('d-flow')?.levers.find((l) => l.id === 'soakWeight')?.paths).toEqual(['steps[1].weight']);
  });

  it('keeps the Londonium peak at least 1 bar above the decline end', () => {
    expect(getTemplate('londonium')?.constraints).toEqual([
      expect.objectContaining({ kind: 'minGap', higher: 'peak', lower: 'declineEnd', minGap: 1 }),
    ]);
    expect(getTemplate('blooming-espresso')?.constraints).toEqual([]);
    expect(getTemplate('d-flow')?.constraints).toEqual([]);
  });

  it('describes each template for the cards and the model', () => {
    expect(TEMPLATES.map((t) => [t.name, t.style, t.roastFit])).toEqual([
      ['Blooming Espresso', 'Blooming', ['light', 'medium-light']],
      ['D-Flow', 'D-Flow', ['medium-light', 'medium']],
      ['Londonium', 'Lever', ['medium', 'medium-dark', 'dark']],
    ]);
    for (const template of TEMPLATES) {
      expect(template.roastFit.every((r) => (ROAST_LEVELS as readonly string[]).includes(r))).toBe(true);
      expect(template.shape.length).toBeGreaterThan(10);
      expect(template.shape.length).toBeLessThanOrEqual(80);
      expect(template.description.length).toBeGreaterThan(40);
      expect(template.source.repo).toBe('decentespresso/decaid');
      expect(template.source.commit).toBe('a45961b323831d2170b3e7f3fef7c72fdd341642');
    }
    expect(TEMPLATES.map((t) => t.source.file)).toEqual([
      'assets/defaultProfiles/Blooming_espresso.json',
      'assets/defaultProfiles/D-Flow____default.json',
      'assets/defaultProfiles/Londonium.json',
    ]);
  });

  it('states the template values in each shape line', () => {
    expect(getTemplate('blooming-espresso')?.shape).toMatch(/30 s bloom.*2\.2 ml\/s/);
    expect(getTemplate('d-flow')?.shape).toMatch(/3 bar.*4 g.*1\.7 ml\/s.*8\.5 bar/);
    expect(getTemplate('londonium')?.shape).toMatch(/12 s.*9 bar.*3 bar/);
  });

  it('keeps the bundled titles and is frozen against accidental edits', () => {
    expect(TEMPLATES.map((t) => t.profile.title)).toEqual(['Blooming Espresso', 'D-Flow / default', 'Londonium']);
    const template = getTemplate('d-flow')!;
    expect(() => {
      template.profile.steps[0]!.temperature = 99;
    }).toThrow();
    expect(() => {
      template.levers[0]!.max = 99;
    }).toThrow();
  });

  it('returns undefined for an unknown id', () => {
    expect(getTemplate('adaptive')).toBeUndefined();
  });
});
