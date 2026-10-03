import { describe, expect, it } from 'vitest';
import type { LiveSample, MachineSnapshot } from '../../api/types.ts';
import { createShotBuffer, SERIES_KEYS } from './shotBuffer.ts';

function sample(
  tS: number,
  substate: string,
  values: Partial<MachineSnapshot> = {},
  scale: { weight: number; weightFlow: number } | null = null,
): LiveSample {
  return {
    tS,
    machine: {
      timestamp: '2026-10-03T08:00:00.000000',
      state: { state: 'espresso', substate },
      flow: 0,
      pressure: 0,
      targetFlow: 0,
      targetPressure: 0,
      mixTemperature: 92,
      groupTemperature: 92,
      targetMixTemperature: 92,
      targetGroupTemperature: 92,
      profileFrame: 0,
      steamTemperature: 140,
      ...values,
    },
    scale: scale ? { timestamp: '2026-10-03T08:00:00.000000', battery: null, timerValue: null, ...scale } : null,
  };
}

const column = (buffer: ReturnType<typeof createShotBuffer>, key: (typeof SERIES_KEYS)[number]) =>
  buffer.data[SERIES_KEYS.indexOf(key) + 1];

describe('shot buffer', () => {
  it('starts empty', () => {
    const buffer = createShotBuffer();
    expect(buffer.length).toBe(0);
    expect(buffer.data).toHaveLength(SERIES_KEYS.length + 1);
    expect(buffer.elapsedS()).toBeNull();
    expect(buffer.latest()).toBeNull();
  });

  it('keeps preheat off the graph and starts the clock at the first pour frame', () => {
    const buffer = createShotBuffer();
    expect(buffer.push(sample(0, 'preparingForShot'))).toBe(false);
    expect(buffer.push(sample(1.5, 'preparingForShot'))).toBe(false);
    expect(buffer.pourStartS()).toBeNull();

    expect(buffer.push(sample(2.5, 'preinfusion', { pressure: 1.2, flow: 4 }))).toBe(true);
    expect(buffer.push(sample(3, 'preinfusion', { pressure: 2.4, flow: 3.8 }))).toBe(true);
    expect(buffer.pourStartS()).toBe(2.5);
    expect(buffer.data[0]).toEqual([0, 0.5]);
    expect(column(buffer, 'pressure')).toEqual([1.2, 2.4]);
    expect(column(buffer, 'flow')).toEqual([4, 3.8]);
    expect(buffer.elapsedS()).toBe(0.5);
  });

  it('treats an unknown substate as pouring, so the graph never stays blank', () => {
    const buffer = createShotBuffer();
    buffer.push(sample(0, 'mysteryPhase', { pressure: 3 }));
    expect(buffer.length).toBe(1);
  });

  it('draws only the target that is in charge', () => {
    // Decaid sends 0 for the target of the pump mode that is not active.
    const buffer = createShotBuffer();
    buffer.push(sample(0, 'preinfusion', { targetFlow: 4, targetPressure: 0 }));
    buffer.push(sample(1, 'pouring', { targetFlow: 0, targetPressure: 9 }));
    expect(column(buffer, 'targetFlow')).toEqual([4, null]);
    expect(column(buffer, 'targetPressure')).toEqual([null, 9]);
  });

  it('records weight and weight flow when a scale is attached', () => {
    const buffer = createShotBuffer();
    buffer.push(sample(0, 'pouring', {}, null));
    buffer.push(sample(1, 'pouring', {}, { weight: 1.5, weightFlow: 1.1 }));
    expect(column(buffer, 'weight')).toEqual([null, 1.5]);
    expect(column(buffer, 'weightFlow')).toEqual([null, 1.1]);
    expect(buffer.latest()).toMatchObject({ weight: 1.5, weightFlow: 1.1 });
  });

  it('drops frames that arrive out of order', () => {
    const buffer = createShotBuffer();
    buffer.push(sample(1, 'pouring'));
    expect(buffer.push(sample(1, 'pouring'))).toBe(false);
    expect(buffer.push(sample(0.5, 'pouring'))).toBe(false);
    expect(buffer.push(sample(1.2, 'pouring'))).toBe(true);
    expect(buffer.data[0]).toEqual([0, expect.closeTo(0.2, 6)]);
  });

  it('turns garbage numbers into gaps instead of throwing', () => {
    const buffer = createShotBuffer();
    buffer.push(sample(0, 'pouring', { pressure: Number.NaN, flow: Number.POSITIVE_INFINITY }));
    expect(column(buffer, 'pressure')).toEqual([null]);
    expect(column(buffer, 'flow')).toEqual([null]);
    expect(buffer.push({ ...sample(Number.NaN, 'pouring') })).toBe(false);
  });

  it('reset() empties everything for the next shot', () => {
    const buffer = createShotBuffer();
    const arrays = buffer.data;
    buffer.push(sample(0, 'pouring', { pressure: 9 }));
    buffer.reset();
    expect(buffer.length).toBe(0);
    expect(buffer.pourStartS()).toBeNull();
    expect(buffer.data.every((values) => values.length === 0)).toBe(true);
    // The same arrays are reused, so the chart can keep its reference.
    expect(buffer.data).toBe(arrays);
  });
});
