/**
 * A stand-in 2D context for the scenes' tests (jsdom has no canvas): every
 * call is recorded and does nothing, gradients take their stops, and the
 * drawing state keeps what it is given. It throws where a browser would
 * (a negative radius) and where Chromium 91 has no method (roundRect), and on
 * any number that is not finite, which a browser would quietly ignore.
 */
import { buildPalette, namedTint } from '../../../palette.ts';
import { paletteColorSource, sceneColors } from '../colors.ts';
import type { SceneFrame } from '../types.ts';

export interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

export type StubContext = CanvasRenderingContext2D & { readonly calls: Call[] };

const RADIUS_ARGS: Readonly<Record<string, readonly number[]>> = { arc: [2], ellipse: [2, 3], createRadialGradient: [2, 5] };

export function stubContext(): StubContext {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineDashOffset: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };
  const record = (name: string, args: readonly unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'number' && !Number.isFinite(arg)) throw new Error(`${name} was given ${arg}: ${JSON.stringify(args)}`);
    }
    for (const index of RADIUS_ARGS[name] ?? []) {
      const radius = args[index];
      if (typeof radius === 'number' && radius < 0) throw new Error(`${name} was given a negative radius: ${JSON.stringify(args)}`);
    }
    calls.push({ name, args });
  };
  const gradient = () => ({ addColorStop: (...args: unknown[]) => record('addColorStop', args) });
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    createRadialGradient: (...args) => (record('createRadialGradient', args), gradient()),
    createLinearGradient: (...args) => (record('createLinearGradient', args), gradient()),
    getLineDash: () => [],
    roundRect: () => {
      throw new Error('roundRect is Chromium 99+: draw arcs instead');
    },
  };
  return new Proxy({} as StubContext, {
    get(_target, prop) {
      if (prop === 'calls') return calls;
      if (typeof prop !== 'string') return undefined;
      if (prop in state) return state[prop];
      if (prop === 'canvas') return { width: 544, height: 544 };
      return methods[prop] ?? ((...args: unknown[]) => record(prop, args));
    },
    set(_target, prop, value) {
      if (typeof prop === 'string') {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${prop} was set to ${value}`);
        state[prop] = value;
        calls.push({ name: `set ${prop}`, args: [value] });
      }
      return true;
    },
  });
}

export interface StubFrame extends SceneFrame {
  readonly ctx: StubContext;
  /** The one offscreen layer every layer() call hands out. */
  readonly layerCtx: StubContext;
  /** What cutFigures was asked for, in order. */
  readonly cuts: number[];
}

/** A frame over stub contexts, Crema's colours in the mode given. */
export function stubFrame(options: { mode?: 'dark' | 'light'; still?: boolean; done?: boolean } = {}): StubFrame {
  const mode = options.mode ?? 'dark';
  const ctx = stubContext();
  const layerCtx = stubContext();
  const cuts: number[] = [];
  return {
    ctx,
    layerCtx,
    cuts,
    colors: sceneColors(paletteColorSource(buildPalette(mode, namedTint('crema')))),
    mode,
    still: options.still ?? false,
    done: options.done ?? false,
    layer: () => layerCtx,
    cutFigures: (amount) => void cuts.push(amount),
    blit: () => void ctx.calls.push({ name: 'blit', args: [] }),
  };
}

/** How many drawing calls a context took: a scene's particles stay within bounds if this does. */
export function drawCalls(ctx: StubContext): number {
  return ctx.calls.filter((call) => !call.name.startsWith('set ')).length;
}
