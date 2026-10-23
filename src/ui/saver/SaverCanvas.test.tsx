// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { paletteFor } from '../appearance.ts';
import { TID } from '../testIds.ts';
import { SaverCanvas, STILL_EVERY_MS } from './SaverCanvas.tsx';
import type { CanvasSaver, SaverEnv, SaverInstance } from './types.ts';

const ENV: SaverEnv = { palette: paletteFor({ mode: 'dark', tint: 'crema' }, false), seed: 7, numbers: ['9.0'] };

interface Recorded {
  calls: string[];
  steps: number[];
  envs: SaverEnv[];
}

/** A screensaver that records what the host asks of it; `throwOn` makes that call throw. */
function fakeSaver(options: { none?: boolean; throwOn?: 'create' | 'draw' | 'still' | 'resize' } = {}): CanvasSaver & Recorded {
  const recorded: Recorded = { calls: [], steps: [], envs: [] };
  const maybeThrow = (name: string) => {
    if (options.throwOn === name) throw new Error(`${name} broke`);
  };
  return {
    ...recorded,
    id: 'beanfield',
    label: 'Beanfield',
    context: '2d',
    create(_canvas, env) {
      recorded.calls.push('create');
      recorded.envs.push(env);
      maybeThrow('create');
      if (options.none) return null;
      const instance: SaverInstance = {
        step(dtMs) {
          recorded.calls.push('step');
          recorded.steps.push(dtMs);
        },
        draw() {
          recorded.calls.push('draw');
          if (options.throwOn === 'draw' && recorded.calls.filter((call) => call === 'draw').length > 1) throw new Error('draw broke');
        },
        resize(width, height, scale) {
          recorded.calls.push(`resize ${width}x${height}@${scale}`);
          maybeThrow('resize');
        },
        still() {
          recorded.calls.push('still');
          maybeThrow('still');
        },
        dispose() {
          recorded.calls.push('dispose');
        },
      };
      return instance;
    },
  };
}

/** A ResizeObserver the test can fire. */
let resizers: Array<() => void> = [];
class FiringResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe() {
    resizers.push(this.callback);
  }
  unobserve() {}
  disconnect() {
    resizers = resizers.filter((callback) => callback !== this.callback);
  }
}

let visibility: DocumentVisibilityState = 'visible';
const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  resizers = [];
  globalThis.ResizeObserver = FiringResizeObserver as unknown as typeof ResizeObserver;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.ResizeObserver = originalResizeObserver;
});

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('SaverCanvas', () => {
  it('starts the screensaver at the canvas size, draws the first frame, then steps and draws at 30 a second', () => {
    const saver = fakeSaver();
    const onPainted = vi.fn();
    const { getByTestId } = render(<SaverCanvas saver={saver} env={ENV} still={false} at={null} onFail={vi.fn()} onPainted={onPainted} />);
    expect(saver.envs).toEqual([ENV]);
    expect(saver.calls[0]).toBe('create');
    expect(saver.calls[1]).toMatch(/^resize \d+x\d+@1$/);
    expect(getByTestId(TID.saverCanvas)).toHaveAttribute('data-motion', 'running');
    act(() => void vi.advanceTimersByTime(20));
    expect(saver.calls.filter((call) => call === 'draw')).toHaveLength(1);
    expect(onPainted).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(1000));
    const steps = saver.steps;
    expect(steps.length).toBeGreaterThanOrEqual(25);
    expect(steps.length).toBeLessThanOrEqual(31);
    for (const step of steps) expect(step).toBeLessThanOrEqual(100);
    expect(onPainted).toHaveBeenCalledTimes(1);
  });

  it('pauses while the page is hidden, and goes on when it shows again', () => {
    const saver = fakeSaver();
    render(<SaverCanvas saver={saver} env={ENV} still={false} at={null} onFail={vi.fn()} />);
    act(() => void vi.advanceTimersByTime(500));
    setVisibility('hidden');
    const before = saver.calls.length;
    act(() => void vi.advanceTimersByTime(5000));
    expect(saver.calls.length).toBe(before);
    setVisibility('visible');
    act(() => void vi.advanceTimersByTime(500));
    expect(saver.calls.length).toBeGreaterThan(before);
    // The time hidden is not stepped through: no step longer than a tenth of a second.
    expect(Math.max(...saver.steps)).toBeLessThanOrEqual(100);
  });

  it('under reduced motion paints the still, again each minute, and never steps', () => {
    const saver = fakeSaver();
    const onPainted = vi.fn();
    const { getByTestId } = render(<SaverCanvas saver={saver} env={ENV} still at={null} onFail={vi.fn()} onPainted={onPainted} />);
    expect(getByTestId(TID.saverCanvas)).toHaveAttribute('data-motion', 'still');
    const stills = () => saver.calls.filter((call) => call === 'still').length;
    const first = stills();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(onPainted).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(STILL_EVERY_MS));
    expect(stills()).toBe(first + 1);
    act(() => void vi.advanceTimersByTime(STILL_EVERY_MS * 2));
    expect(stills()).toBe(first + 3);
    expect(saver.steps).toEqual([]);
  });

  it('held at a moment: plays every frame there, each stepped and drawn as the loop would, and holds the last', () => {
    const saver = fakeSaver();
    const { getByTestId } = render(<SaverCanvas saver={saver} env={ENV} still={false} at={1000} onFail={vi.fn()} />);
    expect(getByTestId(TID.saverCanvas)).toHaveAttribute('data-motion', 'held');
    // Sized first, then the loop's first frame (a draw alone), then 30 frames of a step and a draw.
    expect(saver.calls.slice(0, 4)).toEqual(['create', expect.stringMatching(/^resize /), 'draw', 'step']);
    expect(saver.steps).toHaveLength(30);
    expect(saver.steps.reduce((sum, step) => sum + step, 0)).toBeCloseTo(1000, 6);
    const draws = saver.calls.filter((call) => call === 'draw').length;
    expect(draws).toBe(31);
    act(() => void vi.advanceTimersByTime(5000));
    expect(saver.calls.filter((call) => call === 'draw').length).toBe(draws);
    expect(saver.steps).toHaveLength(30);
  });

  it('sizes again when the canvas changes size, and repaints a still or a held frame', () => {
    const width = window.innerWidth;
    try {
      for (const mode of ['still', 'held'] as const) {
        const saver = fakeSaver();
        const { unmount } = render(<SaverCanvas saver={saver} env={ENV} still={mode === 'still'} at={mode === 'held' ? 500 : null} onFail={vi.fn()} />);
        const paints = () => saver.calls.filter((call) => call === (mode === 'still' ? 'still' : 'draw')).length;
        const before = paints();
        // The observer's first call, at the size just set: nothing changes, nothing is drawn again.
        act(() => {
          for (const resize of resizers) resize();
        });
        expect(paints(), mode).toBe(before);
        window.innerWidth = width - 100;
        act(() => {
          for (const resize of resizers) resize();
        });
        expect(saver.calls.filter((call) => call.startsWith('resize')), mode).toEqual([
          `resize ${width}x${window.innerHeight}@1`,
          `resize ${width - 100}x${window.innerHeight}@1`,
        ]);
        expect(paints(), mode).toBe(before + 1);
        window.innerWidth = width;
        unmount();
      }
    } finally {
      window.innerWidth = width;
    }
  });

  it("reports a screensaver that cannot get its context, or throws as it starts, and makes nothing", () => {
    for (const options of [{ none: true }, { throwOn: 'create' as const }, { throwOn: 'resize' as const }, { throwOn: 'still' as const }]) {
      const saver = fakeSaver(options);
      const onFail = vi.fn();
      const { unmount } = render(<SaverCanvas saver={saver} env={ENV} still at={null} onFail={onFail} />);
      expect(onFail, JSON.stringify(options)).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('stops and reports a screensaver that throws while it runs', () => {
    const saver = fakeSaver({ throwOn: 'draw' });
    const onFail = vi.fn();
    render(<SaverCanvas saver={saver} env={ENV} still={false} at={null} onFail={onFail} />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onFail).toHaveBeenCalledTimes(1);
    const after = saver.calls.length;
    act(() => void vi.advanceTimersByTime(1000));
    expect(saver.calls.length).toBe(after);
  });

  it('stops the frames and lets the screensaver go when it unmounts', () => {
    const saver = fakeSaver();
    const { unmount } = render(<SaverCanvas saver={saver} env={ENV} still={false} at={null} onFail={vi.fn()} />);
    act(() => void vi.advanceTimersByTime(200));
    unmount();
    expect(saver.calls.at(-1)).toBe('dispose');
    const after = saver.calls.length;
    act(() => void vi.advanceTimersByTime(1000));
    expect(saver.calls.length).toBe(after);
    expect(resizers).toEqual([]);
  });

  it('a new render with the same props does not start it over', () => {
    const saver = fakeSaver();
    const onFail = vi.fn();
    const { rerender, getByTestId } = render(<SaverCanvas saver={saver} env={ENV} still={false} at={null} onFail={onFail} />);
    const canvas = getByTestId(TID.saverCanvas);
    rerender(<SaverCanvas saver={saver} env={ENV} still={false} at={null} onFail={() => onFail()} />);
    expect(saver.calls.filter((call) => call === 'create')).toHaveLength(1);
    expect(getByTestId(TID.saverCanvas)).toBe(canvas);
  });

  it('starts every new screensaver, or the same one drawn another way, on a fresh canvas: a canvas keeps its first context', () => {
    const saver = fakeSaver();
    const other = fakeSaver();
    const { rerender, getByTestId } = render(<SaverCanvas saver={saver} env={ENV} still at={null} onFail={vi.fn()} />);
    const seen = [getByTestId(TID.saverCanvas)];
    rerender(<SaverCanvas saver={saver} env={ENV} still={false} at={null} onFail={vi.fn()} />);
    seen.push(getByTestId(TID.saverCanvas));
    rerender(<SaverCanvas saver={saver} env={{ ...ENV, seed: 8 }} still={false} at={null} onFail={vi.fn()} />);
    seen.push(getByTestId(TID.saverCanvas));
    rerender(<SaverCanvas saver={other} env={{ ...ENV, seed: 8 }} still={false} at={null} onFail={vi.fn()} />);
    seen.push(getByTestId(TID.saverCanvas));
    expect(new Set(seen).size).toBe(4);
    // Each start let go of the one before it.
    expect(saver.calls.filter((call) => call === 'create')).toHaveLength(3);
    expect(saver.calls.filter((call) => call === 'dispose')).toHaveLength(3);
    expect(other.calls.filter((call) => call === 'create')).toHaveLength(1);
  });
});
