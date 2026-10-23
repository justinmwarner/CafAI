// @vitest-environment jsdom
import '../../chat/testing/setup.ts';
import { useMemo, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act } from '@testing-library/react';
import { formatLocalTimestamp } from '../../../../mock/decaid/clock.ts';
import type { MachineFrame } from '../../../api/types.ts';
import { useServices } from '../../../app/services.tsx';
import { renderWithServices } from '../../chat/testing/render.tsx';
import { createFakeServices, IDLE_TELEMETRY } from '../../testing/fakeServices.ts';
import { drinkTraceFor } from '../drinkTrace.ts';
import { BOX, C, INSIDE } from './canvas.ts';
import { createScene } from './registry.ts';
import { SceneCanvas } from './SceneCanvas.tsx';
import { stubContext, type StubContext } from './testing/stubContext.ts';
import type { Scene, SceneFrame, SceneInput, SceneSets } from './types.ts';

vi.mock('./registry.ts', () => ({ createScene: vi.fn() }));

interface SpyScene extends Scene {
  update: Mock<(dt: number, input: SceneInput) => void>;
  draw: Mock<(frame: SceneFrame, input: SceneInput) => void>;
  settling: Mock<() => boolean>;
}

const SETS: SceneSets = { flow: 0.8, temperature: 150 };
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Every scene made, in order; each settles for as long as `settles` says. */
let made: SpyScene[] = [];
let settles = false;
/** The 2D context each canvas handed out: the dial's, its layer's and its two masks'. */
let contexts = new Map<HTMLCanvasElement, StubContext>();
/** The animation frames asked for and not yet run, and the clock they run on (ms). */
let frames = new Map<number, FrameRequestCallback>();
let lastFrame = 0;
let clock = 0;
let reducedMotion = false;
const motionListeners = new Set<() => void>();
const originalMatchMedia = window.matchMedia;

/** Runs the frames asked for so far, stamped `at` ms. */
function runFrames(at: number) {
  clock = Math.max(clock, at);
  const due = [...frames.values()];
  frames = new Map();
  for (const callback of due) callback(at);
}

/** Frames every 16 ms until `ms` have passed, or none are asked for. */
function runFor(ms: number) {
  const until = clock + ms;
  while (frames.size > 0 && clock < until) runFrames(clock + 16);
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}

beforeEach(() => {
  made = [];
  settles = false;
  contexts = new Map();
  frames = new Map();
  clock = 1000;
  reducedMotion = false;
  vi.mocked(createScene).mockImplementation(() => {
    const scene: SpyScene = { update: vi.fn(), draw: vi.fn(), settling: vi.fn(() => settles) };
    made.push(scene);
    return scene;
  });
  vi.stubGlobal('CanvasRenderingContext2D', function CanvasRenderingContext2D() {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx = contexts.get(this) ?? stubContext();
    contexts.set(this, ctx);
    return ctx;
  } as unknown as HTMLCanvasElement['getContext']);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    lastFrame += 1;
    frames.set(lastFrame, callback);
    return lastFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  window.matchMedia = ((query: string) => ({
    matches: query === REDUCED_MOTION && reducedMotion,
    media: query,
    addEventListener: (_type: string, listener: () => void) => void motionListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void motionListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.matchMedia = originalMatchMedia;
  motionListeners.clear();
  Reflect.deleteProperty(document, 'visibilityState');
});

let seconds = 0;
const frame = (state: string, substate = 'pouring', values: Partial<MachineFrame> = {}): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  timestamp: formatLocalTimestamp(new Date(2026, 9, 22, 8).getTime() + (seconds += 0.5) * 1000),
  state: { state, substate },
  flow: 0.8,
  pressure: 1.8,
  ...values,
});

/** Steam's dial as the view draws it: the drink's run from the recording, re-rendered when a run starts or ends. */
function SteamScene({ scene = 'spray', size = 272 }: { scene?: string; size?: number }) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  useSyncExternalStore(trace.subscribe, trace.getState);
  return <SceneCanvas kind="steam" scene={scene} run={trace.runOf('steam')} target={50} sets={SETS} size={size} />;
}

function mount(props: { scene?: string; size?: number } = {}) {
  const services = createFakeServices();
  drinkTraceFor(services.telemetry);
  const view = renderWithServices(<SteamScene {...props} />, services);
  const send = (f: MachineFrame) => act(() => services.telemetry.setState({ machine: f }));
  const canvas = view.container.querySelector('canvas')!;
  return { ...view, services, send, canvas, rerenderWith: (next: { scene?: string; size?: number }) => view.rerender(<SteamScene {...next} />) };
}

const lastDraw = (scene: SpyScene) => scene.draw.mock.calls.at(-1)!;

describe('SceneCanvas', () => {
  it('lays one canvas over the whole dial, hidden from a screen reader, its backing store at up to twice the pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const { canvas, rerenderWith } = mount({ size: 212 });
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas.width).toBe(424);
    expect(canvas.height).toBe(424);
    expect(canvas.style.position).toBe('absolute');
    vi.stubGlobal('devicePixelRatio', 1.5);
    rerenderWith({ size: 184 });
    expect(canvas.width).toBe(276);
  });

  it('draws nothing and runs no loop without a 2D context, as in jsdom', () => {
    vi.stubGlobal('CanvasRenderingContext2D', undefined);
    const { send } = mount();
    send(frame('steam'));
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(made).toEqual([]);
    expect(frames.size).toBe(0);
  });

  it('with no run, draws one idle frame and stops', () => {
    mount();
    expect(made).toHaveLength(1);
    expect(made[0]!.draw).toHaveBeenCalledTimes(1);
    expect(lastDraw(made[0]!)[1].phase).toBe('idle');
    expect(frames.size).toBe(0);
  });

  it('moves a live run’s scene on every frame and draws it, clipped to the inside of the ring', () => {
    const { send, canvas } = mount();
    send(frame('steam'));
    const scene = made.at(-1)!;
    expect(frames.size).toBe(1);
    runFrames(clock + 16);
    expect(scene.update).toHaveBeenLastCalledWith(0.016, expect.objectContaining({ kind: 'steam', phase: 'working', live: true }));
    const [drawn, input] = lastDraw(scene);
    expect(input.phase).toBe('working');
    expect(drawn).toMatchObject({ mode: 'dark', still: false, done: false });
    const ctx = drawn.ctx as StubContext;
    const k = canvas.width / BOX;
    expect(ctx.calls).toContainEqual({ name: 'setTransform', args: [k, 0, 0, k, 0, 0] });
    expect(ctx.calls).toContainEqual({ name: 'arc', args: [C, C, INSIDE, 0, Math.PI * 2] });
    expect(ctx.calls.map((call) => call.name)).toContain('clip');
    expect(frames.size, 'the next frame is asked for').toBe(1);
  });

  it('never runs a scene backwards, nor more than 50 ms on in one frame', () => {
    const { send } = mount();
    send(frame('steam'));
    const scene = made.at(-1)!;
    // requestAnimationFrame's stamp can be earlier than the clock read before the loop began.
    runFrames(clock - 5);
    expect(scene.update).toHaveBeenLastCalledWith(0, expect.anything());
    runFrames(clock + 400);
    expect(scene.update).toHaveBeenLastCalledWith(0.05, expect.anything());
  });

  it('stops once a finished run’s scene has settled', () => {
    const { send } = mount();
    send(frame('steam'));
    runFor(100);
    send(frame('idle', 'idle'));
    runFor(100);
    expect(frames.size).toBe(0);
    const scene = made.at(-1)!;
    const [drawn, input] = lastDraw(scene);
    expect(input.phase).toBe('done');
    expect(drawn.done).toBe(true);
  });

  it('keeps a finished run’s scene moving while it settles, for at most 3 s', () => {
    settles = true;
    const { send } = mount();
    send(frame('steam'));
    runFor(100);
    const ended = clock;
    send(frame('idle', 'idle'));
    const scene = made.at(-1)!;
    runFor(2900);
    expect(frames.size, 'still settling').toBe(1);
    runFor(1000);
    expect(frames.size).toBe(0);
    expect(clock - ended).toBeLessThanOrEqual(3016);
    const updates = scene.update.mock.calls.length;
    runFor(1000);
    expect(scene.update.mock.calls.length).toBe(updates);
  });

  it('cuts the figures out of the layer, and the check’s circle too once the run is done', () => {
    const { send } = mount();
    send(frame('steam'));
    const scene = made.at(-1)!;
    const masks = () => [...contexts.entries()].filter(([, ctx]) => ctx.calls.some((call) => call.name === 'createRadialGradient'));
    const doneMask = () => masks().find(([, ctx]) => ctx.calls.filter((call) => call.name === 'fill').length === 2)![0];
    const liveMask = () => masks().find(([, ctx]) => ctx.calls.filter((call) => call.name === 'fill').length === 1)![0];
    scene.draw.mockImplementation((drawn) => {
      const layer = drawn.layer() as StubContext;
      layer.calls.length = 0;
      drawn.cutFigures(0.9);
      drawn.blit();
    });
    runFrames(clock + 16);
    const layer = [...contexts.values()].find((ctx) => ctx.calls.some((call) => call.name === 'drawImage' && call.args[0] === liveMask()));
    expect(layer, 'the live mask laid over the layer').toBeDefined();
    expect(layer!.calls).toContainEqual({ name: 'set globalCompositeOperation', args: ['destination-out'] });
    expect(layer!.calls).toContainEqual({ name: 'set globalAlpha', args: [0.9] });
    send(frame('idle', 'idle'));
    // By identity: two blank canvases of a size are equal nodes.
    expect(layer!.calls.some((call) => call.name === 'drawImage' && call.args[0] === doneMask())).toBe(true);
  });

  it('cuts out no check for a run the machine going away cut short', () => {
    const { send, services } = mount();
    send(frame('steam'));
    act(() => services.telemetry.setState({ machineConnected: false }));
    const [drawn, input] = lastDraw(made.at(-1)!);
    expect(input.phase).toBe('lost');
    expect(drawn.done).toBe(false);
  });

  it('makes a fresh scene for each run, and for another choice of scene', () => {
    const { send, rerenderWith } = mount();
    send(frame('steam'));
    const first = made.at(-1)!;
    send(frame('steam'));
    expect(made.at(-1)).toBe(first);
    send(frame('idle', 'idle'));
    send(frame('steam'));
    expect(made.at(-1)).not.toBe(first);
    rerenderWith({ scene: 'whirlpool' });
    expect(createScene).toHaveBeenLastCalledWith('steam', 'whirlpool');
  });

  it('opened on a finished run, brings its scene to rest at once and draws it, with no loop', () => {
    const services = createFakeServices();
    drinkTraceFor(services.telemetry);
    act(() => services.telemetry.setState({ machine: frame('steam') }));
    act(() => services.telemetry.setState({ machine: frame('idle', 'idle') }));
    renderWithServices(<SteamScene />, services);
    const scene = made.at(-1)!;
    expect(scene.update.mock.calls.length).toBeGreaterThan(0);
    expect(scene.update.mock.calls.every(([dt, input]) => dt > 0 && dt <= 0.05 && input.phase === 'done')).toBe(true);
    expect(scene.draw).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('under reduced motion, never moves the scene on: draws it still on every reading and when the run ends', () => {
    reducedMotion = true;
    const { send } = mount();
    send(frame('steam'));
    const scene = made.at(-1)!;
    expect(scene.draw).toHaveBeenCalledTimes(1);
    send(frame('steam'));
    send(frame('steam'));
    expect(scene.draw).toHaveBeenCalledTimes(3);
    send(frame('idle', 'idle'));
    expect(scene.draw).toHaveBeenCalledTimes(4);
    expect(lastDraw(scene)[1].phase).toBe('done');
    expect(scene.draw.mock.calls.every(([drawn]) => drawn.still)).toBe(true);
    expect(scene.update).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('stops its loop when the barista asks for reduced motion, and starts it again when they no longer do', () => {
    const { send } = mount();
    send(frame('steam'));
    expect(frames.size).toBe(1);
    reducedMotion = true;
    act(() => motionListeners.forEach((listener) => listener()));
    expect(frames.size).toBe(0);
    expect(lastDraw(made.at(-1)!)[0].still).toBe(true);
    reducedMotion = false;
    act(() => motionListeners.forEach((listener) => listener()));
    expect(frames.size).toBe(1);
  });

  it('brings a scene only ever drawn still to rest at once, when motion comes back after its run', () => {
    reducedMotion = true;
    const { send } = mount();
    send(frame('steam'));
    send(frame('idle', 'idle'));
    const scene = made.at(-1)!;
    expect(scene.update).not.toHaveBeenCalled();
    reducedMotion = false;
    act(() => motionListeners.forEach((listener) => listener()));
    expect(scene.update.mock.calls.length).toBeGreaterThan(0);
    expect(scene.update.mock.calls.every(([, input]) => input.phase === 'done')).toBe(true);
    expect(lastDraw(scene)[0].still).toBe(false);
  });

  it('pauses while the page is hidden, and goes on once it is shown', () => {
    const { send } = mount();
    send(frame('steam'));
    expect(frames.size).toBe(1);
    setVisibility('hidden');
    expect(frames.size).toBe(0);
    setVisibility('visible');
    expect(frames.size).toBe(1);
  });

  it('brings a scene to rest when the page shows again past its settling, its run having ended while the page was hidden', () => {
    settles = true;
    const { send } = mount();
    send(frame('steam'));
    runFor(100);
    const scene = made.at(-1)!;
    setVisibility('hidden');
    send(frame('idle', 'idle'));
    clock += 5000;
    const before = scene.update.mock.calls.length;
    setVisibility('visible');
    expect(scene.update.mock.calls.length - before).toBe(60);
    expect(lastDraw(scene)[1].phase).toBe('done');
    expect(frames.size, 'no loop: it is past its settling').toBe(0);
  });

  it('cancels its frame when it goes', () => {
    const { send, unmount } = mount();
    send(frame('steam'));
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });

  it('stops drawing a scene that throws, rather than take the view down with it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { send } = mount();
    const broken = () => {
      throw new Error('IndexSizeError');
    };
    vi.mocked(createScene).mockImplementation(() => {
      const scene: SpyScene = { update: vi.fn(), draw: vi.fn(broken), settling: vi.fn(() => false) };
      made.push(scene);
      return scene;
    });
    expect(() => send(frame('steam'))).not.toThrow();
    const scene = made.at(-1)!;
    runFor(100);
    expect(scene.draw).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
