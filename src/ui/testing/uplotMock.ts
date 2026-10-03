/**
 * A stand-in for uPlot in jsdom (which has no canvas). Use from a test with
 *
 *   vi.mock('uplot', () => import('../testing/uplotMock.ts'));
 *
 * and inspect `fakePlots` for what the component asked the chart to do.
 */
export interface FakePlot {
  opts: unknown;
  target: HTMLElement | undefined;
  /** Snapshot of the x column at each setData call. */
  setDataCalls: number[][];
  sizes: { width: number; height: number }[];
  destroyed: boolean;
}

export const fakePlots: FakePlot[] = [];

export function resetFakePlots(): void {
  fakePlots.length = 0;
}

export default class FakeUplot implements FakePlot {
  opts: unknown;
  target: HTMLElement | undefined;
  setDataCalls: number[][] = [];
  sizes: { width: number; height: number }[] = [];
  destroyed = false;

  constructor(opts: unknown, _data?: unknown, target?: HTMLElement) {
    this.opts = opts;
    this.target = target;
    fakePlots.push(this);
  }

  setData(data: ArrayLike<number>[]): void {
    this.setDataCalls.push(Array.from(data[0] ?? []));
  }

  setSize(size: { width: number; height: number }): void {
    this.sizes.push(size);
  }

  destroy(): void {
    this.destroyed = true;
  }
}
