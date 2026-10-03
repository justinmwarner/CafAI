import { describe, expect, it } from 'vitest';

import type { ShotRecord } from '../../api/types.ts';
import shot01 from '../__fixtures__/decaid-mcp/shot-01.json';
import shot06 from '../__fixtures__/decaid-mcp/shot-06.json';
import shot07 from '../__fixtures__/decaid-mcp/shot-07.json';
import shot09 from '../__fixtures__/decaid-mcp/shot-09.json';
import example from '../../../docs/verified/examples/shot-record.json';
import { analyseShot, shotRows } from './analysis.ts';
import { syntheticShotRecord, type SyntheticShotOptions } from '../__fixtures__/syntheticShot.ts';

const asRecord = (value: unknown) => value as ShotRecord;

/**
 * Golden values from decaid-mcp test/golden/shot-NN.json (@ aecef96), which
 * that project generates with its Python reference implementation. Times and
 * pressures are rounded to 0.1 there, flows to 0.01, trends to 0.001.
 */
describe('analyseShot: parity with decaid-mcp on real Decaid shots', () => {
  it('shot-01 (Default, resistance falling steeply)', () => {
    const { metrics, resistance, channeling } = analyseShot(shotRows(asRecord(shot01)));
    expect(metrics.rowCount).toBe(183);
    expect(metrics.durationS).toBeCloseTo(45.5, 1);
    expect(metrics.timeToFirstDropS).toBeCloseTo(13.8, 1);
    expect(metrics.preinfusionEndS).toBeCloseTo(10, 1);
    expect(metrics.preinfusionEndSource).toBe('substate');
    expect(metrics.infusionPeakBar).toBeCloseTo(7.7, 1);
    expect(metrics.infusionPeakAtS).toBeCloseTo(11.7, 1);
    expect(metrics.peakPressureBar).toBeCloseTo(9, 1);
    expect(metrics.peakPressureAtS).toBeCloseTo(18.3, 1);
    expect(metrics.pressureDipAfterPeakBar).toBeCloseTo(0, 1);
    expect(metrics.meanPourWeightFlowGs).toBeCloseTo(0.94, 2);
    expect(metrics.pourFlowStability).toBeCloseTo(0.494, 3);
    expect(metrics.meanPourTempC).toBeCloseTo(88.7, 1);
    expect(metrics.warnings).toEqual([]);

    expect(resistance).toMatchObject({ band: 'very_high', trend: 'steep_decline', points: 119 });
    expect(resistance!.median).toBeCloseTo(10.36, 2);
    expect(resistance!.trendPerS).toBeCloseTo(-0.81, 3);
    expect(resistance!.fromS).toBeCloseTo(16, 1);
    expect(resistance!.toS).toBeCloseTo(45.5, 1);

    expect(channeling.risk).toBe('elevated');
    expect(channeling.fired).toEqual(['resistance_falling']);
    const values = Object.fromEntries(channeling.indicators.map((i) => [i.id, i.value]));
    expect(values['pressure_dip_after_peak']).toBeCloseTo(0, 1);
    expect(values['flow_instability']).toBeCloseTo(0.018, 3);
    expect(values['pump_scale_divergence']).toBeCloseTo(-0.27, 3);
    expect(values['early_first_drops']).toBeCloseTo(-3.8, 1);
    expect(values['resistance_falling']).toBeCloseTo(-0.81, 3);
  });

  it('shot-06 (Adaptive v3, pressure dip after the peak)', () => {
    const { metrics, resistance, channeling } = analyseShot(shotRows(asRecord(shot06)));
    expect(metrics.timeToFirstDropS).toBeCloseTo(7.2, 1);
    expect(metrics.preinfusionEndS).toBeCloseTo(8, 1);
    expect(metrics.infusionPeakBar).toBeCloseTo(3.8, 1);
    expect(metrics.pressureDipAfterPeakBar).toBeCloseTo(2.5, 1);
    expect(metrics.peakPressureBar).toBeCloseTo(9.2, 1);
    expect(metrics.meanPourWeightFlowGs).toBeCloseTo(1.17, 2);
    expect(resistance).toMatchObject({ band: 'moderate', trend: 'steady', points: 81 });
    expect(resistance!.median).toBeCloseTo(4.6, 2);
    expect(channeling.fired).toEqual(['pressure_dip_after_peak']);
    const values = Object.fromEntries(channeling.indicators.map((i) => [i.id, i.value]));
    expect(values['flow_instability']).toBeCloseTo(0.031, 3);
    expect(values['pump_scale_divergence']).toBeCloseTo(-0.198, 3);
    expect(values['early_first_drops']).toBeCloseTo(0.8, 1);
  });

  it('shot-07 (Blooming): no settled pressure, so no channeling verdict', () => {
    const { metrics, resistance, channeling } = analyseShot(shotRows(asRecord(shot07)));
    expect(metrics.timeToFirstDropS).toBeCloseTo(11.5, 1);
    expect(metrics.preinfusionEndS).toBeCloseTo(11, 1);
    expect(metrics.pressureDipAfterPeakBar).toBeCloseTo(3.7, 1);
    expect(metrics.peakPressureBar).toBeCloseTo(7.5, 1);
    expect(metrics.peakPressureAtS).toBeCloseTo(60.3, 1);
    expect(resistance).toBeNull();
    expect(channeling).toMatchObject({ risk: null, fired: [], indicators: [] });
  });

  it('shot-09 (aborted at one second): degenerate, with scale warnings', () => {
    const { metrics, channeling } = analyseShot(shotRows(asRecord(shot09)));
    expect(metrics.rowCount).toBe(5);
    expect(metrics.timeToFirstDropS).toBeNull();
    expect(metrics.preinfusionEndS).toBe(0);
    expect(metrics.preinfusionEndSource).toBe('heuristic');
    expect(metrics.scaleUnreliable).toBe(true);
    expect(metrics.warnings.join(' ')).toMatch(/never exceeds 0\.3 g/);
    expect(channeling.risk).toBeNull();
  });
});

describe('shotRows', () => {
  it('times samples by machine timestamp from the first sample', () => {
    const rows = shotRows(asRecord(example));
    expect(rows.map((r) => r.t)).toEqual([0, 4.62, 9.851, 12.083, 19.589, 29.31, 34.962]);
    expect(rows[0]).toMatchObject({ substate: 'preparingForShot', frame: 5, weight: 0 });
    expect(rows[3]).toMatchObject({ substate: 'pouring', frame: 2, weight: 0.4 });
  });

  it('skips samples without a readable time and duplicates of a time', () => {
    const record = asRecord(example);
    const broken = {
      ...record,
      measurements: [record.measurements[0]!, record.measurements[0]!, { ...record.measurements[1]!, machine: { ...record.measurements[1]!.machine, timestamp: 'x' } }],
    };
    expect(shotRows(broken)).toHaveLength(1);
  });
});

describe('analyseShot: the example shot record', () => {
  it('reads first drops and preinfusion end from sparse samples', () => {
    const { metrics, resistance, channeling } = analyseShot(shotRows(asRecord(example)));
    expect(metrics.durationS).toBeCloseTo(34.962, 3);
    expect(metrics.timeToFirstDropS).toBeCloseTo(12.083, 3);
    expect(metrics.preinfusionEndS).toBeCloseTo(12.083, 3);
    expect(metrics.peakPressureBar).toBeCloseTo(8.41, 2);
    expect(metrics.peakPressureAtS).toBeCloseTo(19.589, 3);
    expect(resistance).toBeNull();
    expect(channeling.risk).toBeNull();
  });
});

describe('analyseShot: channeling indicators on synthetic shots', () => {
  const analyse = (options: SyntheticShotOptions = {}) => analyseShot(shotRows(syntheticShotRecord(options)));

  it('a clean pressure-profiled shot fires nothing', () => {
    const { channeling, resistance } = analyse();
    expect(channeling.risk).toBe('low');
    expect(channeling.fired).toEqual([]);
    expect(channeling.indicators.map((i) => i.id)).toEqual([
      'pressure_dip_after_peak',
      'flow_instability',
      'pump_scale_divergence',
      'early_first_drops',
      'resistance_falling',
    ]);
    expect(resistance?.trend).toBe('steady');
  });

  it('fires early first drops when drips arrive well before preinfusion ends', () => {
    const { channeling, metrics } = analyse({ firstDropS: 3 });
    // The first ~4 Hz sample at or after 3 s.
    expect(metrics.timeToFirstDropS).toBeGreaterThanOrEqual(3);
    expect(metrics.timeToFirstDropS).toBeLessThan(3.3);
    expect(channeling.fired).toContain('early_first_drops');
  });

  it('fires a pressure dip after the infusion peak', () => {
    const { channeling, metrics } = analyse({ dipBar: 1.5 });
    expect(metrics.pressureDipAfterPeakBar).toBeGreaterThanOrEqual(1.4);
    expect(channeling.fired).toContain('pressure_dip_after_peak');
  });

  it('fires flow instability when the pump flow jitters under a steady target', () => {
    expect(analyse({ jitter: 0.4 }).channeling.fired).toContain('flow_instability');
  });

  it('fires pump/scale divergence when water goes in faster than coffee comes out', () => {
    expect(analyse({ cupLossMlS: 0.6 }).channeling.fired).toContain('pump_scale_divergence');
  });

  it('fires falling resistance when the puck gives way during the pour', () => {
    const { channeling, resistance } = analyse({ resistanceDropPerS: 0.5, endS: 28 });
    expect(resistance?.trend).toBe('steep_decline');
    expect(channeling.fired).toContain('resistance_falling');
  });

  it('two or more indicators make the risk high', () => {
    expect(analyse({ firstDropS: 3, cupLossMlS: 0.6 }).channeling.risk).toBe('high');
  });

  it('drops the scale indicators when the scale was not tared', () => {
    const { metrics, channeling } = analyse({ tareOffsetG: 2 });
    expect(metrics.timeToFirstDropS).toBeNull();
    expect(metrics.scaleUnreliable).toBe(true);
    expect(channeling.indicators.map((i) => i.id)).not.toContain('pump_scale_divergence');
    expect(channeling.note).toMatch(/scale/);
  });
});
