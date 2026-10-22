import { describe, expect, it } from 'vitest';

import type { ShotRecord, ShotSnapshot } from '../../api/types.ts';
import { syntheticShotRecord } from '../__fixtures__/syntheticShot.ts';
import shot01 from '../__fixtures__/decaid-mcp/shot-01.json';
import shot07 from '../__fixtures__/decaid-mcp/shot-07.json';
import shot09 from '../__fixtures__/decaid-mcp/shot-09.json';
import blooming from '../templates/source/Blooming_espresso.json';
import example from '../../../docs/verified/examples/shot-record.json';
import { normalizeProfile } from '../../../mock/decaid/profiles.ts';
import { createShotSimulation } from '../../../mock/decaid/shotPlayer.ts';
import {
  MIN_SHOT_POUR_S,
  pourSeconds,
  pourStartSeconds,
  recordPourSeconds,
  resampleSeries,
  shotPhases,
  summarizeShot,
  summaryForModel,
} from './summarize.ts';
import { shotRows } from './analysis.ts';
import { elapsedSeconds, parseTimestampMicros } from './time.ts';

const asRecord = (value: unknown) => value as ShotRecord;
const oneDecimal = (value: number) => Number(value.toFixed(1));

/** A Blooming Espresso shot as the mock Decaid records it: its preheat, then the profile's steps up to the stop. */
function mockShotRecord(): ShotRecord {
  const profile = normalizeProfile(blooming);
  const simulation = createShotSimulation({
    profile,
    targetYield: 50,
    doseG: 18,
    scaleConnected: true,
    startMs: Date.UTC(2026, 9, 6, 9, 0, 0),
    shotId: 'mock-shot',
    staleFrame: 5,
    seed: 1,
  });
  const measurements: ShotSnapshot[] = [];
  for (let frame = simulation.next(); frame; frame = simulation.next()) {
    if (frame.recorded) measurements.push({ machine: frame.machine, scale: frame.scale, volume: frame.volume });
  }
  return {
    id: 'mock-shot',
    timestamp: measurements[0]!.machine.timestamp,
    createdAt: '2026-10-06T09:01:10.000000Z',
    updatedAt: '2026-10-06T09:01:10.000000Z',
    workflow: { profile, context: { targetYield: 50, targetDoseWeight: 18 } },
    annotations: { actualDoseWeight: 18 },
    stopReason: 'machineEnded',
    measurements,
  } as unknown as ShotRecord;
}

/** Seconds from a record's first sample to its first one after preheat, to 0.1 s. */
function preheatSeconds(record: ShotRecord): number {
  const first = record.measurements[0]!.machine.timestamp;
  const pour = record.measurements.find((m) => m.machine.state.substate !== 'preparingForShot')!.machine.timestamp;
  return oneDecimal(elapsedSeconds(first, pour)!);
}

/** A zone-less Decaid timestamp for microseconds read as UTC, as parseTimestampMicros reads them. */
function stampMicros(micros: number): string {
  const date = new Date(Math.floor(micros / 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(micros % 1_000_000, 6)}`
  );
}

/**
 * The record as if Decaid had kept recording through its stopping phase:
 * a pouringDone frame, then idle frames for 4 s while the cup drips, and
 * Decaid's settled weight as the yield. (Decaid itself stops recording at
 * its stop decision, so its own records never carry this tail.)
 */
function withStoppingTail(record: ShotRecord): { record: ShotRecord; finalWeight: number } {
  const last = record.measurements[record.measurements.length - 1]!;
  const lastMicros = parseTimestampMicros(last.machine.timestamp)!;
  let weight = last.scale!.weight;
  const tail: ShotSnapshot[] = [];
  for (let i = 1; i <= 16; i += 1) {
    const drip = 0.5 * Math.exp(-i / 4);
    weight += drip;
    const timestamp = stampMicros(lastMicros + i * 250_000);
    const state = i === 1 ? { state: 'espresso', substate: 'pouringDone' } : { state: 'idle', substate: 'idle' };
    tail.push({
      machine: { ...last.machine, timestamp, state, pressure: 0, flow: 0 },
      scale: { ...last.scale!, timestamp, weight: Number(weight.toFixed(2)), weightFlow: drip * 4 },
      volume: last.volume,
    });
  }
  const finalWeight = oneDecimal(weight);
  return {
    record: {
      ...record,
      measurements: [...record.measurements, ...tail],
      annotations: { ...record.annotations, actualYield: finalWeight },
    },
    finalWeight,
  };
}

describe('summarizeShot: the verified example record', () => {
  const summary = summarizeShot(asRecord(example));

  it('reports dose, yield and ratio from the annotations and the target from the workflow', () => {
    expect(summary).toMatchObject({
      shotId: '3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17',
      timestamp: '2026-10-03T08:15:02.731455',
      profileTitle: 'Guji Hambela v1',
      // The pour, 4.62 s to 34.96 s on the shot clock: preheat is not shot time.
      durationS: 30.3,
      doseG: 18,
      yieldG: 36.3,
      ratio: 2.02,
      targetYieldG: 36,
      stopReason: 'targetWeight',
    });
  });

  it('has no TDS or EY when the record has no reading', () => {
    expect(summary).not.toHaveProperty('tdsPct');
    expect(summary).not.toHaveProperty('eyPct');
  });

  it("reads Decaid's drinkTds, and works the EY out from the summary's own dose and yield, not Decaid's drinkEy (D166)", () => {
    const record = asRecord(example);
    const read = summarizeShot({ ...record, annotations: { ...record.annotations, drinkTds: 9.254, drinkEy: 12 } });
    // 9.25 x 36.3 / 18 = 18.65: the card's own numbers, so EY = TDS x ratio.
    expect(read).toMatchObject({ doseG: 18, yieldG: 36.3, tdsPct: 9.25, eyPct: 18.7 });
    const noYield = summarizeShot({
      ...record,
      measurements: record.measurements.map((m) => ({ ...m, scale: null })),
      annotations: { actualDoseWeight: 18, drinkTds: 9.25 },
    });
    expect(noYield).toMatchObject({ yieldG: null, tdsPct: 9.25, eyPct: null });
    // A TDS CafAI does not take (an import's 0, a number out of range) is no reading.
    for (const drinkTds of [0, 31, Number.NaN]) {
      expect(summarizeShot({ ...record, annotations: { ...record.annotations, drinkTds } })).not.toHaveProperty('tdsPct');
    }
  });

  it('times first drops and the end of preinfusion from shot start', () => {
    expect(summary.timeToFirstDropS).toBe(12.1);
    expect(summary.preinfusionEndS).toBe(12.1);
    expect(summary.peakPressureBar).toBe(8.4);
    expect(summary.peakPressureAtS).toBe(19.6);
  });

  it('averages flow and temperature over the pour', () => {
    expect(summary.meanPourFlowMlS).toBe(2.12);
    expect(summary.meanPourWeightFlowGs).toBe(1.37);
    expect(summary.meanTempC).toBe(88.6);
    expect(summary.tempDeviationC).toBe(0.4);
    expect(summary.resistanceTrend).toBeNull();
    expect(summary.channelingFlags).toEqual([]);
  });

  it('names phases after the profile steps, starting with preheat', () => {
    expect(summary.phases).toEqual([
      { name: 'preheat', startS: 0, endS: 4.6 },
      { name: 'preinfusion temp boost', startS: 4.6, endS: 9.9 },
      { name: 'preinfusion', startS: 9.9, endS: 12.1 },
      { name: 'forced rise without limit', startS: 12.1, endS: 19.6 },
      { name: 'decline', startS: 19.6, endS: 35 },
    ]);
  });

  it('leaves seconds without a nearby sample empty instead of inventing values', () => {
    expect(summary.series.tS[0]).toBe(0);
    expect(summary.series.tS[summary.series.tS.length - 1]).toBe(35);
    expect(summary.series.pressure[0]).toBe(0);
    expect(summary.series.pressure[2]).toBeNull();
    expect(summary.series.pressure[20]).toBe(8.4);
  });
});

describe('summarizeShot: real Decaid shots', () => {
  it('Blooming: phases follow the steps through the bloom', () => {
    const summary = summarizeShot(asRecord(shot07));
    expect(summary.phases.map((p) => p.name)).toEqual([
      'preheat',
      'preinfusion start',
      'preinfusion',
      'pause',
      'ramp',
      'flat flow',
      'reset temperature',
    ]);
    expect(summary.preinfusionEndS).toBe(11);
    expect(summary).toMatchObject({ doseG: 18, yieldG: 58.8, targetYieldG: 60, ratio: 3.27 });
  });

  it('Default: a steeply falling resistance is flagged', () => {
    const summary = summarizeShot(asRecord(shot01));
    expect(summary.resistanceTrend).toBe('falling');
    expect(summary.channelingFlags).toEqual(['resistance_falling']);
    expect(summary.timeToFirstDropS).toBe(13.8);
    expect(summary.preinfusionEndS).toBe(10);
  });

  it('stays compact enough to send with every shot', () => {
    const { series: _series, ...aggregates } = summarizeShot(asRecord(shot07));
    expect(JSON.stringify(aggregates).length).toBeLessThan(1200);
    expect(JSON.stringify(summarizeShot(asRecord(shot07))).length).toBeLessThan(7000);
  });
});

describe('summarizeShot: the time is the pour, the yield what is in the cup', () => {
  it("times the pour from the first frame after preheat to the last frame Decaid recorded, as Decaid's Visualizer upload does", () => {
    // Decaid records from preheat and stops recording at its stop decision.
    // shot-01: preinfusion at 12:47:19.889141, last frame 12:47:58.859324,
    // after 6.5 s of preheat (45.5 s from the first frame).
    expect(summarizeShot(asRecord(shot01)).durationS).toBe(39);
    // Blooming: 11:22:30.098650 to 11:23:34.312355, after 2.8 s of preheat.
    expect(summarizeShot(asRecord(shot07)).durationS).toBe(64.2);
    // Aborted on the first preinfusion frame: no pour to time.
    expect(summarizeShot(asRecord(shot09)).durationS).toBe(0);
  });

  it('ends the time where the pour ends when a record carries the stopping tail', () => {
    const plain = syntheticShotRecord();
    const { record: tailed } = withStoppingTail(plain);
    const firstPour = plain.measurements.find((m) => m.machine.state.substate !== 'preparingForShot')!;
    const lastPour = plain.measurements[plain.measurements.length - 1]!;
    const poured = oneDecimal(elapsedSeconds(firstPour.machine.timestamp, lastPour.machine.timestamp)!);

    expect(summarizeShot(tailed).durationS).toBe(poured);
    expect(summarizeShot(plain).durationS).toBe(poured);
    // The other times stay on the shot clock, which runs on through preheat and the tail.
    expect(summarizeShot(tailed).series.tS.at(-1)).toBeGreaterThan(poured + 3 + 3.9);
  });

  it("takes the yield after the drips: Decaid's settled weight, else the record's final weight", () => {
    const plain = syntheticShotRecord();
    const { record: tailed, finalWeight } = withStoppingTail(plain);
    expect(summarizeShot(tailed).yieldG).toBe(finalWeight);

    const pouredWeight = plain.measurements[plain.measurements.length - 1]!.scale!.weight;
    expect(finalWeight).toBeGreaterThan(pouredWeight + 1);
    const unannotated: ShotRecord = { ...tailed, annotations: { actualDoseWeight: 18 } };
    expect(summarizeShot(unannotated).yieldG).toBe(finalWeight);
  });

  it('times a record without machine substates from its first sample to its last', () => {
    const record = syntheticShotRecord();
    const bare: ShotRecord = {
      ...record,
      measurements: record.measurements.map((m) => ({ ...m, machine: { ...m.machine, state: { state: 'espresso', substate: '' } } })),
    };
    const first = record.measurements[0]!.machine.timestamp;
    const last = record.measurements[record.measurements.length - 1]!.machine.timestamp;
    expect(summarizeShot(bare).durationS).toBe(oneDecimal(elapsedSeconds(first, last)!));
  });

  it('pourSeconds: a pour the machine reports done at once lasts no time, and preheat alone is no pour', () => {
    const rows = shotRows(syntheticShotRecord({ endS: 12 }));
    const preheat = rows.filter((row) => row.substate === 'preparingForShot');
    expect(pourSeconds(preheat)).toBeNull();
    expect(pourSeconds([])).toBeNull();
    const doneAtOnce = [...preheat, { ...rows[preheat.length]!, substate: 'pouringDone' }, { ...rows[preheat.length + 1]!, substate: 'idle' }];
    expect(pourSeconds(doneAtOnce)).toBe(0);
  });
});

describe('recordPourSeconds: how long a record poured; under 2 s it is no shot (D204)', () => {
  /** A record's preheat and its samples up to `seconds` into the pour, as Decaid keeps a run stopped then. */
  function stoppedAfter(record: ShotRecord, seconds: number): ShotRecord {
    const start = record.measurements.findIndex((m) => m.machine.state.substate !== 'preparingForShot');
    const pourBegan = record.measurements[start]!.machine.timestamp;
    const kept = record.measurements.filter((m, i) => i < start || elapsedSeconds(pourBegan, m.machine.timestamp)! <= seconds);
    return { ...record, measurements: kept };
  }
  /** A record's preheat and its first `samples` samples of pour. */
  function stoppedOnSample(record: ShotRecord, samples: number): ShotRecord {
    const start = record.measurements.findIndex((m) => m.machine.state.substate !== 'preparingForShot');
    return { ...record, measurements: record.measurements.slice(0, start + samples) };
  }
  const isShot = (record: Pick<ShotRecord, 'measurements'>) => (recordPourSeconds(record) ?? Number.NaN) >= MIN_SHOT_POUR_S;

  it('the line is 2 s of pour', () => {
    expect(MIN_SHOT_POUR_S).toBe(2);
  });

  it("a real DE1's run stopped with the pour's first frame has no pour (decaid-mcp's shot-09)", () => {
    const record = asRecord(shot09);
    // Four frames of preheat over a second, then one of preinfusion: Decaid kept it.
    expect(record.measurements.map((m) => m.machine.state.substate)).toEqual([
      'preparingForShot',
      'preparingForShot',
      'preparingForShot',
      'preparingForShot',
      'preinfusion',
    ]);
    expect(recordPourSeconds(record)).toBe(0);
    expect(summarizeShot(record).durationS).toBe(0);
  });

  it('a run stopped on its first frames of pour, or within 2 s of it, is no shot; 2 s and more of pour is one', () => {
    // Shots sampled as Decaid samples them (the verified example is trimmed to a few samples).
    for (const record of [asRecord(shot01), asRecord(shot07), syntheticShotRecord(), mockShotRecord()]) {
      expect(recordPourSeconds(stoppedOnSample(record, 1))).toBe(0);
      // A frame later, as a stop at about 0.65 s left it on the simulator: a fraction of a second of pour.
      const twoFrames = stoppedOnSample(record, 2);
      expect(recordPourSeconds(twoFrames)).toBeGreaterThan(0);
      expect(isShot(twoFrames)).toBe(false);
      expect(isShot(stoppedAfter(record, 1.9))).toBe(false);
      expect(isShot(stoppedAfter(record, 3))).toBe(true);
      expect(isShot(record)).toBe(true);
    }
  });

  it('preheat alone, or a pour the machine reports done at once, has no pour', () => {
    const record = syntheticShotRecord();
    const preheat = record.measurements.findIndex((m) => m.machine.state.substate !== 'preparingForShot');
    expect(recordPourSeconds({ measurements: record.measurements.slice(0, preheat) })).toBe(0);
    const doneAtOnce = record.measurements.slice(0, preheat + 2).map((m, i) =>
      i === preheat + 1 ? { ...m, machine: { ...m.machine, state: { state: 'espresso', substate: 'pouringDone' } } } : m,
    );
    expect(recordPourSeconds({ measurements: doneAtOnce })).toBe(0);
  });

  it('a record with no sample CafAI can read has no reading at all, never a run that did not pour', () => {
    const record = syntheticShotRecord();
    expect(recordPourSeconds({ measurements: [] })).toBeNull();
    expect(recordPourSeconds({} as Pick<ShotRecord, 'measurements'>)).toBeNull();
    // Samples whose time a renamed or reformatted field hides.
    const timeless = record.measurements.map((m) => ({ ...m, machine: { ...m.machine, timestamp: 'later' } }));
    expect(recordPourSeconds({ measurements: timeless })).toBeNull();
  });

  it('a record without machine substates is timed from its first sample to its last', () => {
    const record = syntheticShotRecord();
    const bare = record.measurements.map((m) => ({ ...m, machine: { ...m.machine, state: { state: 'espresso', substate: '' } } }));
    expect(recordPourSeconds({ measurements: bare.slice(0, 1) })).toBe(0);
    expect(isShot({ measurements: bare })).toBe(true);
  });
});

describe('summarizeShot: where the pour starts on the record clock (pourStartS)', () => {
  it('real Decaid shots: the first sample after preheat, the one durationS counts from', () => {
    // shot-01 preheats 6.5 s, Blooming (shot-07) 2.8 s, the verified example 4.62 s.
    expect(summarizeShot(asRecord(shot01)).pourStartS).toBe(6.5);
    expect(summarizeShot(asRecord(shot07)).pourStartS).toBe(2.8);
    expect(summarizeShot(asRecord(example)).pourStartS).toBe(4.6);
    for (const record of [shot01, shot07, example]) {
      expect(summarizeShot(asRecord(record)).pourStartS).toBe(preheatSeconds(asRecord(record)));
    }
  });

  it("a mock shot: the mock Decaid's preheat of about 2 s", () => {
    const record = mockShotRecord();
    const summary = summarizeShot(record);
    expect(summary.pourStartS).toBe(preheatSeconds(record));
    expect(summary.pourStartS).toBeCloseTo(2, 0);
    // The pour runs from there to the last frame Decaid recorded.
    const last = record.measurements[record.measurements.length - 1]!.machine.timestamp;
    expect(summary.durationS).toBe(oneDecimal(elapsedSeconds(record.measurements[0]!.machine.timestamp, last)! - summary.pourStartS!));
  });

  it('a synthetic shot with 3 s of preheat', () => {
    const record = syntheticShotRecord();
    expect(summarizeShot(record).pourStartS).toBe(preheatSeconds(record));
    expect(summarizeShot(record).pourStartS).toBeGreaterThanOrEqual(3);
  });

  it('is 0 without machine substates, with preheat alone, or with no samples: nothing to count from', () => {
    const record = syntheticShotRecord();
    const bare: ShotRecord = {
      ...record,
      measurements: record.measurements.map((m) => ({ ...m, machine: { ...m.machine, state: { state: 'espresso', substate: '' } } })),
    };
    expect(summarizeShot(bare).pourStartS).toBe(0);
    const rows = shotRows(record);
    expect(pourStartSeconds(rows.filter((row) => row.substate === 'preparingForShot'))).toBe(0);
    expect(pourStartSeconds([])).toBe(0);
  });

  it("leaves the summary's other times and its series on the record clock, where the coach's heuristics read them", () => {
    const summary = summarizeShot(asRecord(example));
    expect(summary).toMatchObject({ pourStartS: 4.6, timeToFirstDropS: 12.1, preinfusionEndS: 12.1, peakPressureAtS: 19.6 });
    expect(summary.phases[0]).toEqual({ name: 'preheat', startS: 0, endS: 4.6 });
    expect(summary.series.tS[0]).toBe(0);
  });
});

describe('summarizeShot: synthetic shots', () => {
  it('resamples to one point per second, by timestamp', () => {
    const summary = summarizeShot(syntheticShotRecord());
    expect(summary.series.tS.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(summary.series.tS.every((t, i) => i === 0 || t > summary.series.tS[i - 1]!)).toBe(true);
    const at20 = summary.series.tS.indexOf(20);
    expect(summary.series.pressure[at20]).toBe(9);
    expect(summary.series.flow[at20]).toBe(1.5);
    expect(summary.series.targetPressure[at20]).toBe(9);
    expect(summary.series.temperature[at20]).toBe(87.5);
    expect(summary.series.pressure.every((v) => v !== null)).toBe(true);
  });

  it('gives the same series whatever the sampling rate', () => {
    const full = syntheticShotRecord();
    const half: ShotRecord = { ...full, measurements: full.measurements.filter((_, i) => i % 2 === 0) };
    const a = summarizeShot(full).series;
    const b = summarizeShot(half).series;
    expect(b.tS.slice(0, 30)).toEqual(a.tS.slice(0, 30));
    const pressureAt = (s: typeof a, t: number) => s.pressure[s.tS.indexOf(t)];
    for (const t of [5, 15, 25]) expect(pressureAt(b, t)).toBeCloseTo(pressureAt(a, t)!, 0);
  });

  it('blanks stale targets during preheat', () => {
    const summary = summarizeShot(syntheticShotRecord());
    expect(summary.series.targetFlow[1]).toBeNull();
    expect(summary.series.targetPressure[1]).toBeNull();
    expect(summary.phases[0]).toEqual({ name: 'preheat', startS: 0, endS: expect.any(Number) });
  });

  it('does not report scale numbers without a scale', () => {
    const summary = summarizeShot(syntheticShotRecord({ noScale: true }));
    expect(summary.yieldG).toBeNull();
    expect(summary.ratio).toBeNull();
    expect(summary.timeToFirstDropS).toBeNull();
    expect(summary.meanPourWeightFlowGs).toBeNull();
    expect(summary.series.weight.every((w) => w === null)).toBe(true);
  });

  it('turns channeling indicators into named flags', () => {
    expect(summarizeShot(syntheticShotRecord({ firstDropS: 3, cupLossMlS: 0.6 })).channelingFlags).toEqual([
      'pump_scale_divergence',
      'early_first_drops',
    ]);
  });

  it('treats a stop-at-weight of 0 as off', () => {
    const record = syntheticShotRecord();
    record.workflow.context = { ...record.workflow.context, targetYield: 0 };
    expect(summarizeShot(record).targetYieldG).toBeNull();
  });
});

describe('summaryForModel', () => {
  it('drops only the series, for the [event:shot_completed] payload', () => {
    const summary = summarizeShot(syntheticShotRecord());
    const forModel = summaryForModel(summary);
    expect(forModel).not.toHaveProperty('series');
    expect({ ...forModel, series: summary.series }).toEqual(summary);
  });

  it('tells the model where the pour starts, so it can count a time from there as the shot card does', () => {
    const summary = summarizeShot(asRecord(shot07));
    expect(summaryForModel(summary).pourStartS).toBe(2.8);
    expect(JSON.stringify(summaryForModel(summary))).toContain('"pourStartS":2.8');
  });
});

describe('helpers', () => {
  it('resampleSeries and shotPhases work on rows', () => {
    const rows = shotRows(syntheticShotRecord({ endS: 12 }));
    const tS = resampleSeries(rows).tS;
    expect(tS.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(tS[tS.length - 1]).toBeGreaterThanOrEqual(11.5);
    expect(shotPhases(rows, null).map((p) => p.name)).toEqual(['preheat', 'preinfusion', 'pouring']);
    expect(resampleSeries([]).tS).toEqual([]);
    expect(shotPhases([], null)).toEqual([]);
  });
});
