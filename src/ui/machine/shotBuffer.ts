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
 *
 * The clock stops when the pour ends: at the first pouringDone frame or at
 * the frame Decaid stopped the shot on, whichever is earlier. Decaid then
 * stays in its stopping state for 4-5 s while the cup weight settles and it
 * stores the shot; those frames are still plotted, but they are not pour time.
 */
import { parseDecaidTimestamp } from '../../api/time.ts';
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
  /** The sample time at which the pour ended, or null while it runs. */
  pourEndS(): number | null;
  /**
   * The pour is over: Decaid stopped the shot. `timestamp` is the machine
   * frame it stopped on, as shotState frames carry it; one that does not fit
   * this pour stops the clock at the latest frame instead. True when the
   * clock stopped, or stopped earlier than before.
   */
  endPour(timestamp?: string | null): boolean;
  /** Seconds of pour: up to the latest plotted sample, and fixed once the pour ends. */
  elapsedS(): number | null;
  latest(): ShotValues | null;
}

const PREHEAT_SUBSTATE = 'preparingForShot';
const POUR_DONE_SUBSTATE = 'pouringDone';
/**
 * Decaid sends the frame it stopped on before the stopping frame, on another
 * socket, so a stop can at most run a frame or so ahead of the plot. A time
 * further ahead (or before the pour) is not on this shot's clock.
 */
const MAX_STOP_LEAD_S = 1;

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
  /** Machine time (epoch ms) of the pour's first frame, to place a timestamp on the tS axis. */
  let pourStartMs = Number.NaN;
  let pourEnd: number | null = null;
  let lastTime = Number.NEGATIVE_INFINITY;
  let latest: ShotValues | null = null;

  // Whichever end comes first counts, in whatever order the frames arrive.
  function stopClock(time: number): boolean {
    if (pourEnd !== null && pourEnd <= time) return false;
    pourEnd = time;
    return true;
  }

  return {
    data,
    get length() {
      return xs.length;
    },
    push(sample) {
      const time = finiteOrNull(sample.tS);
      if (time === null) return false;
      const substate = sample.machine?.state?.substate;
      if (pourStart === null) {
        if (substate === PREHEAT_SUBSTATE) return false;
        pourStart = time;
        pourStartMs = parseDecaidTimestamp(sample.machine?.timestamp ?? '');
      }
      // uPlot needs x ascending; a late frame is dropped rather than drawn backwards.
      if (time <= lastTime) return false;
      lastTime = time;
      const values = valuesOf(sample);
      xs.push(time - pourStart);
      SERIES_KEYS.forEach((key, index) => columns[index]!.push(values[key]));
      latest = values;
      if (substate === POUR_DONE_SUBSTATE) stopClock(time);
      return true;
    },
    endPour(timestamp) {
      if (pourStart === null) return false;
      // tS is machine time since the shot's first frame (telemetry.ts), so a
      // frame's timestamp lands on the same axis.
      const stoppedOn = pourStart + (parseDecaidTimestamp(timestamp ?? '') - pourStartMs) / 1000;
      const fits = Number.isFinite(stoppedOn) && stoppedOn >= pourStart && stoppedOn <= lastTime + MAX_STOP_LEAD_S;
      return stopClock(fits ? stoppedOn : lastTime);
    },
    reset() {
      xs.length = 0;
      for (const column of columns) column.length = 0;
      pourStart = null;
      pourStartMs = Number.NaN;
      pourEnd = null;
      lastTime = Number.NEGATIVE_INFINITY;
      latest = null;
    },
    pourStartS: () => pourStart,
    pourEndS: () => pourEnd,
    elapsedS: () => (pourStart === null ? null : (pourEnd ?? lastTime) - pourStart),
    latest: () => latest,
  };
}
