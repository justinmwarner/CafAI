import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ROAST_LEVELS, TEMPLATE_IDS } from '../contract.ts';
import { applyLever, readLeverValues, snapToGranularity } from '../levers.ts';
import { profileId } from '../profileId.ts';
import { getTemplate, TEMPLATES } from './index.ts';
import bloomingSource from './source/Blooming_espresso.json';
import dflowSource from './source/D-Flow____default.json';
import gentleSource from './source/Gentle_and_sweet1.json';
import londoniumSource from './source/Londonium.json';
import allongeSource from './source/rao_allonge.json';

/** The bundled files as Decaid ships them (numbers as strings, extra keys). */
const RAW_SOURCES: Record<string, unknown> = {
  'Blooming_espresso.json': bloomingSource,
  'D-Flow____default.json': dflowSource,
  'Londonium.json': londoniumSource,
  'rao_allonge.json': allongeSource,
  'Gentle_and_sweet1.json': gentleSource,
};

/** Git blob ids at Decaid a45961b (source/SOURCES.md). */
const BLOB_IDS: Record<string, string> = {
  'Blooming_espresso.json': 'ad6bd97685fbf9c0aa81689e0e0003729a607c06',
  'D-Flow____default.json': '7983ae71dc6a19826ee2f17596a22711bb0f961b',
  'Londonium.json': '1daf983cefada0e60479a68318606c566a1b628e',
  'rao_allonge.json': 'cc0cfa219aa6814eb599f203ec53469cb305673c',
  'Gentle_and_sweet1.json': 'db86dcad62ce6277f934e703568f2df6a2c87a96',
};

const fileOf = (file: string) => file.replace('assets/defaultProfiles/', '');

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
  allonge: {
    temp: [92, 88, 96, 0.5, 2],
    yield: [135, 50, 135, 1, 10],
    flow: [4.5, 3.5, 5.5, 0.1, 0.5],
    maxPressure: [8.6, 6, 10, 0.1, 1],
  },
  'gentle-and-sweet': {
    temp: [88, 84, 92, 0.5, 2],
    yield: [36, 25, 60, 1, 4],
    peak: [6, 4, 8, 0.5, 1],
    declineEnd: [4, 2, 6, 0.5, 1],
    hold: [13, 5, 25, 1, 4],
  },
};

describe('TEMPLATES', () => {
  it('has the five protocol templates in order', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
    expect(TEMPLATE_IDS).toEqual(['blooming-espresso', 'd-flow', 'londonium', 'allonge', 'gentle-and-sweet']);
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
    expect(getTemplate('allonge')?.levers.map((l) => l.id)).toEqual(['temp', 'yield', 'flow', 'maxPressure']);
    expect(getTemplate('gentle-and-sweet')?.levers.map((l) => l.id)).toEqual(['temp', 'yield', 'peak', 'declineEnd', 'hold']);
  });

  it('hashes every template to its bundled Decaid id', () => {
    expect(TEMPLATES.map((t) => [t.id, t.decaidDefaultId])).toEqual([
      ['blooming-espresso', 'profile:7438cb7266f60558b48f'],
      ['d-flow', 'profile:59036f8846b1ed3b4255'],
      ['londonium', 'profile:729d284747718d27c93a'],
      ['allonge', 'profile:372f1be4c5e3641bbfe2'],
      ['gentle-and-sweet', 'profile:1baa29bd9d9dc6d47f2a'],
    ]);
    for (const template of TEMPLATES) expect(profileId(template.profile)).toBe(template.decaidDefaultId);
  });

  it('keeps each bundled file byte-for-byte, with LF line endings', () => {
    for (const template of TEMPLATES) {
      const file = fileOf(template.source.file);
      const bytes = readFileSync(join(import.meta.dirname, 'source', file));
      const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      expect(blob, file).toBe(BLOB_IDS[file]);
      expect(bytes.includes(13), `${file} has a CR byte`).toBe(false);
    }
  });

  it('hashes the raw bundled file, strings and extra keys included, to the same id', () => {
    for (const template of TEMPLATES) {
      const file = fileOf(template.source.file);
      expect(profileId(RAW_SOURCES[file]), file).toBe(template.decaidDefaultId);
    }
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
    // D57: the Allongé window is 4-6 x dose (was 4-7.5, only so its 135 g stop passed at 18 g);
    // Gentle and Sweet reaches 1:3 (was 1:2.5; Decent pulls it "1:2 or 1:3").
    const ratios = {
      'blooming-espresso': [2.0, 3.5],
      'd-flow': [1.8, 3.0],
      londonium: [1.5, 2.8],
      allonge: [4.0, 6.0],
      'gentle-and-sweet': [1.5, 3.0],
    } as const;
    for (const template of TEMPLATES) {
      const yieldLever = template.levers.find((l) => l.id === 'yield')!;
      expect(yieldLever.workflowContextKey).toBe('targetYield');
      expect(yieldLever.paths).toEqual(['target_weight']);
      const [min, max] = ratios[template.id as keyof typeof ratios];
      expect(yieldLever.doseRatio).toEqual({ min, max });
      expect(template.levers.filter((l) => l.workflowContextKey).map((l) => l.id)).toEqual(['yield']);
    }
  });

  it('keeps every bundled stop inside its own lever bounds, with the Allongé stop at its ceiling', () => {
    for (const template of TEMPLATES) {
      const yieldLever = template.levers.find((l) => l.id === 'yield')!;
      expect(template.profile.target_weight, template.id).toBeGreaterThanOrEqual(yieldLever.min);
      expect(template.profile.target_weight, template.id).toBeLessThanOrEqual(yieldLever.max);
    }
    expect(getTemplate('allonge')?.profile.target_weight).toBe(135);
    expect(getTemplate('allonge')?.levers.find((l) => l.id === 'yield')?.max).toBe(135);
  });

  it("gives every template its author's brew ratio for v1 (D57), inside its own dose window", () => {
    expect(TEMPLATES.map((t) => [t.id, t.startRatio])).toEqual([
      ['blooming-espresso', 2.8],
      ['d-flow', 2.8],
      ['londonium', 2.0],
      ['allonge', 5.0],
      ['gentle-and-sweet', 2.0],
    ]);
    for (const template of TEMPLATES) {
      const ratioWindow = template.levers.find((l) => l.id === 'yield')!.doseRatio!;
      expect(template.startRatio, template.id).toBeGreaterThanOrEqual(ratioWindow.min);
      expect(template.startRatio, template.id).toBeLessThanOrEqual(ratioWindow.max);
    }
  });

  it('no longer promises the Allongé a 135 g stop: it stops at about 5x the dose', () => {
    const allonge = getTemplate('allonge')!;
    expect(allonge.shape).not.toMatch(/135/);
    expect(allonge.description).not.toMatch(/135/);
    expect(allonge.shape).toMatch(/about 5x the dose/);
    expect(allonge.description).toMatch(/about 5x the dose \(90 g for 18 g\)/);
  });

  it('tells the coach where the Blooming pour tops out, so it does not propose yields it cannot reach', () => {
    const description = getTemplate('blooming-espresso')!.description;
    expect(description).toMatch(/stops 26 s after the bloom/);
    expect(description).toMatch(/22\.5 s x the flow \(about 57 g at 2\.2 ml\/s\)/);
    expect(description).toMatch(/more yield needs more flow/);
    // The pour after the bloom: a 5 s ramp from 0 to the flow, 20 s at it, and a 1 s pump-off tail.
    const steps = getTemplate('blooming-espresso')!.profile.steps;
    expect(steps.slice(3).map((s) => [s.name, s.seconds, s.transition])).toEqual([
      ['ramp', 5, 'smooth'],
      ['flat flow', 20, 'fast'],
      ['reset temperature', 1, 'fast'],
    ]);
    expect(steps[5]!.flow).toBe(0);
    expect(5 / 2 + 20).toBe(22.5);
  });

  it('shifts temperature uniformly from the documented anchor step', () => {
    const anchors = {
      'blooming-espresso': 'steps[4].temperature',
      'd-flow': 'steps[2].temperature',
      londonium: 'steps[4].temperature',
      allonge: 'steps[1].temperature',
      'gentle-and-sweet': 'steps[3].temperature',
    };
    for (const template of TEMPLATES) {
      const temp = template.levers.find((l) => l.id === 'temp')!;
      expect(temp.mode).toBe('uniformShift');
      expect(temp.paths).toEqual(['steps[*].temperature']);
      expect(temp.anchor).toBe(anchors[template.id as keyof typeof anchors]);
      expect([temp.granularity, temp.maxDelta], template.id).toEqual([0.5, 2]);
    }
  });

  it('keeps every step inside 80-100 °C across the whole temperature range', () => {
    for (const template of TEMPLATES) {
      const temp = template.levers.find((l) => l.id === 'temp')!;
      const anchor = Number(/\[(\d+)\]/.exec(temp.anchor!)![1]);
      const anchorValue = template.profile.steps[anchor]!.temperature;
      for (const step of template.profile.steps) {
        expect(step.temperature + (temp.min - anchorValue), `${template.id} ${step.name}`).toBeGreaterThanOrEqual(80);
        expect(step.temperature + (temp.max - anchorValue), `${template.id} ${step.name}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('links the paths that must move together', () => {
    const linked = TEMPLATES.flatMap((t) => t.levers.filter((l) => l.paths.length > 1).map((l) => `${t.id}.${l.id}`));
    expect(linked).toEqual(['blooming-espresso.flow', 'd-flow.soak', 'londonium.declineEnd', 'gentle-and-sweet.peak']);
    expect(getTemplate('blooming-espresso')?.levers.find((l) => l.id === 'flow')?.paths).toEqual(['steps[3].flow', 'steps[4].flow']);
    expect(getTemplate('d-flow')?.levers.find((l) => l.id === 'soak')?.paths).toEqual(['steps[0].pressure', 'steps[1].pressure']);
    expect(getTemplate('londonium')?.levers.find((l) => l.id === 'declineEnd')?.paths).toEqual([
      'steps[4].pressure',
      'steps[5].pressure',
    ]);
    expect(getTemplate('gentle-and-sweet')?.levers.find((l) => l.id === 'peak')?.paths).toEqual([
      'steps[2].pressure',
      'steps[3].pressure',
    ]);
  });

  it('moves only the Allongé pour (step 1), never its fixed 2 s start', () => {
    const allonge = getTemplate('allonge')!;
    expect(allonge.levers.filter((l) => l.mode === 'linked').map((l) => [l.id, l.paths])).toEqual([
      ['yield', ['target_weight']],
      ['flow', ['steps[1].flow']],
      ['maxPressure', ['steps[1].limiter.value']],
    ]);
    expect(allonge.profile.steps.map((s) => [s.name, s.flow, s.limiter])).toEqual([
      ['hold at 4.5 ml/s', 4.5, { value: 8.6, range: 0.6 }],
      ['hold at 4.5 ml/s', 4.5, { value: 8.6, range: 0.6 }],
    ]);
  });

  it('needs a scale for every yield (stop-at-weight) and for the D-Flow soak weight', () => {
    const scaled = TEMPLATES.flatMap((t) => t.levers.filter((l) => l.requiresScale).map((l) => `${t.id}.${l.id}`));
    expect(scaled).toEqual([
      'blooming-espresso.yield',
      'd-flow.yield',
      'd-flow.soakWeight',
      'londonium.yield',
      'allonge.yield',
      'gentle-and-sweet.yield',
    ]);
    expect(getTemplate('d-flow')?.levers.find((l) => l.id === 'soakWeight')?.paths).toEqual(['steps[1].weight']);
  });

  it('keeps the Londonium and Gentle and Sweet peaks at least 1 bar above the decline end', () => {
    const gap = expect.objectContaining({ kind: 'minGap', higher: 'peak', lower: 'declineEnd', minGap: 1 });
    expect(getTemplate('londonium')?.constraints).toEqual([gap]);
    expect(getTemplate('gentle-and-sweet')?.constraints).toEqual([gap]);
    expect(getTemplate('blooming-espresso')?.constraints).toEqual([]);
    expect(getTemplate('d-flow')?.constraints).toEqual([]);
    expect(getTemplate('allonge')?.constraints).toEqual([]);
    // Each constraint names levers of its own template, and the template values satisfy it.
    for (const template of TEMPLATES) {
      const values = readLeverValues(template, template.profile);
      for (const c of template.constraints) {
        expect(values[c.higher]! - values[c.lower]!, `${template.id}: ${c.message}`).toBeGreaterThanOrEqual(c.minGap);
      }
    }
  });

  it('describes each template for the cards and the model', () => {
    expect(TEMPLATES.map((t) => [t.name, t.style, t.roastFit])).toEqual([
      ['Blooming Espresso', 'Blooming', ['light', 'medium-light']],
      ['D-Flow', 'D-Flow', ['medium-light', 'medium']],
      ['Londonium', 'Lever', ['medium', 'medium-dark', 'dark']],
      ['Rao Allongé', 'Allongé', ['light']],
      ['Gentle and Sweet', 'Low pressure', ['medium', 'medium-dark', 'dark']],
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
      'assets/defaultProfiles/rao_allonge.json',
      'assets/defaultProfiles/Gentle_and_sweet1.json',
    ]);
  });

  it('states the template values in each shape line', () => {
    expect(getTemplate('blooming-espresso')?.shape).toMatch(/30 s bloom.*2\.2 ml\/s/);
    expect(getTemplate('d-flow')?.shape).toMatch(/3 bar.*4 g.*1\.7 ml\/s.*8\.5 bar/);
    expect(getTemplate('londonium')?.shape).toMatch(/12 s.*9 bar.*3 bar/);
    expect(getTemplate('allonge')?.shape).toMatch(/4\.5 ml\/s.*8\.6 bar.*5x the dose/);
    expect(getTemplate('gentle-and-sweet')?.shape).toMatch(/6 bar.*13 s.*4 bar/);
  });

  it('keeps the bundled titles and is frozen against accidental edits', () => {
    expect(TEMPLATES.map((t) => t.profile.title)).toEqual([
      'Blooming Espresso',
      'D-Flow / default',
      'Londonium',
      'Rao Allongé',
      'Gentle and sweet',
    ]);
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
