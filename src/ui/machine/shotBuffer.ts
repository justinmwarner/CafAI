/**
 * The live shot as column arrays, ready for uPlot.
 *
 * Kept outside React on purpose: samples arrive several times a second during
 * a shot, and putting them in state would re-render on every frame. The graph
 * pushes into this buffer and hands the same arrays to uPlot at most once per
 * animation frame.
 *
 * Time zero is the first pour frame (preinfusion or later), which is when a
 * barista starts counting. The preheat frames before it are flat zeros, so
 * they are left off the chart instead of shifting it by a few seconds.
 */
import type { LiveSample } from '../../api/types.ts';

/** Series in draw order (later ones paint on top). Index i is data[i + 1]. */
export const SERIES_KEYS = ['targetPressure', 'targetFlow', 'weight', 'weightFlow', 'flow', 'pressure'] as const;

export type SeriesKey = (typeof SERIES_KEYS)[number];

/** x (seconds since pour start), then one column per SERIES_KEYS entry. */
export type ShotData = [number[], ...(number | null)[][]];

export type ShotValues = Record<SeriesKey, number | null>;

export interface ShotBuffer {
  /** The live arrays; mutated in place, so the same reference stays valid. */
  readonly data: ShotData;
  readonly length: number;
  /** Adds a sample; false when it is preheat, out of order or has no time. */
  push(sample: LiveSample): boolean;
  reset(): void;
  /** The sample time (LiveSample.tS) at which the pour started, or null before it. */
  pourStartS(): number | null;
  /** Seconds since the pour started, as of the latest plotted sample. */
  elapsedS(): number | null;
  latest(): ShotValues | null;
}

const PREHEAT_SUBSTATE = 'preparingForShot';

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// The DE1 reports 0 for the target of whichever pump mode is not in charge.
const activeTarget = (value: unknown): number | null => {
  const n = finiteOrNull(value);
  return n !== null && n > 0 ? n : null;
};

function valuesOf(sample: LiveSample): ShotValues {
  const machine = sample.machine;
  return {
    targetPressure: activeTarget(machine.targetPressure),
    targetFlow: activeTarget(machine.targetFlow),
    weight: finiteOrNull(sample.scale?.weight),
    weightFlow: finiteOrNull(sample.scale?.weightFlow),
    flow: finiteOrNull(machine.flow),
    pressure: finiteOrNull(machine.pressure),
  };
}

export function createShotBuffer(): ShotBuffer {
  const xs: number[] = [];
  const columns = SERIES_KEYS.map(() => [] as (number | null)[]);
  const data = [xs, ...columns] as ShotData;
  let pourStart: number | null = null;
  let lastTime = Number.NEGATIVE_INFINITY;
  let latest: ShotValues | null = null;

  return {
    data,
    get length() {
      return xs.length;
    },
    push(sample) {
      const time = finiteOrNull(sample.tS);
      if (time === null) return false;
      if (pourStart === null) {
        if (sample.machine?.state?.substate === PREHEAT_SUBSTATE) return false;
        pourStart = time;
      }
      // uPlot needs x ascending; a late frame is dropped rather than drawn backwards.
      if (time <= lastTime) return false;
      lastTime = time;
      const values = valuesOf(sample);
      xs.push(time - pourStart);
      SERIES_KEYS.forEach((key, index) => columns[index]!.push(values[key]));
      latest = values;
      return true;
    },
    reset() {
      xs.length = 0;
      for (const column of columns) column.length = 0;
      pourStart = null;
      lastTime = Number.NEGATIVE_INFINITY;
      latest = null;
    },
    pourStartS: () => pourStart,
    elapsedS: () => (xs.length > 0 ? xs[xs.length - 1]! : null),
    latest: () => latest,
  };
}
