import { describe, expect, it } from 'vitest';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
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

// Telemetry derives tS from the machine timestamp, so these frames carry
// timestamps that agree with their tS (t = 0 is 08:15:00).
const T0 = new Date(2026, 9, 3, 8, 15, 0).getTime();
const stampAt = (tS: number) => formatLocalTimestamp(T0 + tS * 1000);

function frame(tS: number, substate: string, values: Partial<MachineSnapshot> = {}): LiveSample {
  const state = substate === 'idle' ? 'idle' : 'espresso';
  return sample(tS, substate, { timestamp: stampAt(tS), state: { state, substate }, ...values });
}

function pouring(...times: number[]) {
  const buffer = createShotBuffer();
  buffer.push(frame(0, 'preparingForShot'));
  for (const tS of times) buffer.push(frame(tS, tS === times[0] ? 'preinfusion' : 'pouring'));
  return buffer;
}

const lastX = (buffer: ReturnType<typeof createShotBuffer>) => buffer.data[0].at(-1);

describe('shot buffer', () => {
  it('starts empty', () => {
    const buffer = createShotBuffer();
    expect(buffer.length).toBe(0);
    expect(buffer.data).toHaveLength(SERIES_KEYS.length + 1);
    expect(buffer.elapsedS()).toBeNull();
    expect(buffer.pourEndS()).toBeNull();
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

describe('shot buffer: the clock stops when the pour ends', () => {
  it('at the first pouringDone frame, while later frames are still plotted', () => {
    // Decaid 0.8.7's simulator: preinfusion to pouringDone took 61.6 s, then
    // about 5 s of its stopping phase followed.
    const buffer = pouring(2, 30);
    expect(buffer.push(frame(63.6, 'pouringDone'))).toBe(true);
    expect(buffer.pourEndS()).toBe(63.6);
    expect(buffer.elapsedS()).toBeCloseTo(61.6, 6);

    expect(buffer.push(frame(63.7, 'pouringDone'))).toBe(true);
    for (let tS = 64; tS <= 68.6; tS += 0.5) expect(buffer.push(frame(tS, 'idle'))).toBe(true);
    expect(lastX(buffer)).toBeCloseTo(66.5, 6);
    expect(buffer.pourEndS()).toBe(63.6);
    expect(buffer.elapsedS()).toBeCloseTo(61.6, 6);
  });

  it('endPour: at the frame Decaid stopped on, found by its timestamp', () => {
    const buffer = pouring(2, 20, 20.2);
    // The stopping frame came in after two more machine frames.
    buffer.push(frame(20.4, 'idle'));
    buffer.push(frame(20.6, 'idle'));
    expect(buffer.endPour(stampAt(20.2))).toBe(true);
    expect(buffer.pourEndS()).toBeCloseTo(20.2, 6);
    expect(buffer.elapsedS()).toBeCloseTo(18.2, 6);
    buffer.push(frame(24.6, 'idle'));
    expect(buffer.elapsedS()).toBeCloseTo(18.2, 6);
  });

  it('endPour: a frame ahead of the plot when the stop frame is still on its way', () => {
    const buffer = pouring(2, 20);
    expect(buffer.endPour(stampAt(20.2))).toBe(true);
    expect(buffer.elapsedS()).toBeCloseTo(18.2, 6);
    expect(buffer.push(frame(20.2, 'pouring'))).toBe(true);
    expect(lastX(buffer)).toBeCloseTo(18.2, 6);
    expect(buffer.elapsedS()).toBeCloseTo(18.2, 6);
  });

  it('whichever end comes first wins, whatever order the sockets deliver them in', () => {
    // Stop at weight: Decaid stops on a pouring frame; the machine reports
    // pouringDone a frame later and Decaid says finished about 4 s after that.
    const byWeight = pouring(2, 20);
    expect(byWeight.endPour(stampAt(20))).toBe(true);
    byWeight.push(frame(20.2, 'pouringDone'));
    expect(byWeight.endPour(stampAt(24.2))).toBe(false);
    expect(byWeight.elapsedS()).toBeCloseTo(18, 6);

    // The same, with the stopping frame arriving after the pouringDone frame.
    const late = pouring(2, 20);
    late.push(frame(20.2, 'pouringDone'));
    expect(late.elapsedS()).toBeCloseTo(18.2, 6);
    expect(late.endPour(stampAt(20))).toBe(true);
    expect(late.elapsedS()).toBeCloseTo(18, 6);
  });

  it('endPour without a timestamp that fits this pour stops the clock at the latest frame', () => {
    const unusable = [undefined, null, '', 'yesterday', stampAt(1), stampAt(30), '2026-10-04T08:15:21.000000'];
    for (const timestamp of unusable) {
      const buffer = pouring(2, 20, 21);
      expect(buffer.endPour(timestamp), String(timestamp)).toBe(true);
      expect(buffer.elapsedS(), String(timestamp)).toBe(19);
    }
  });

  it('endPour before the pour starts does nothing, and reset() lets the next shot run', () => {
    const buffer = createShotBuffer();
    buffer.push(frame(0, 'preparingForShot'));
    expect(buffer.endPour(stampAt(0))).toBe(false);
    expect(buffer.pourEndS()).toBeNull();

    buffer.push(frame(2, 'preinfusion'));
    buffer.push(frame(3, 'pouringDone'));
    expect(buffer.elapsedS()).toBe(1);
    buffer.reset();
    expect(buffer.pourEndS()).toBeNull();
    buffer.push(frame(10, 'preinfusion'));
    buffer.push(frame(14, 'pouring'));
    expect(buffer.elapsedS()).toBe(4);
  });
});
