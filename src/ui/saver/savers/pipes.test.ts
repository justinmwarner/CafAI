import { describe, expect, it } from 'vitest';
import { paletteFor } from '../../appearance.ts';
import { stepFor } from '../runner.ts';
import type { SaverEnv } from '../types.ts';
import { pipes } from './pipes.ts';
import { BLANK_MS, FADE_MS, LAYOUT_MS } from './pipesModel.ts';

/**
 * A stand-in for WebGL (Node has none): every call recorded, every object it
 * makes and deletes counted, its constants their own names, so a test can
 * read which index type a draw used.
 */
function fakeWebgl(options: { wideIndices?: boolean; compiles?: boolean } = {}) {
  const made = new Set<object>();
  const deleted = new Set<object>();
  const draws: { count: number; type: unknown }[] = [];
  const indexUploads: unknown[] = [];
  const sources: string[] = [];
  let lost = false;
  let boundIndexTarget = false;
  const make = (kind: string) => {
    const object = { kind };
    made.add(object);
    return object;
  };
  const known: Record<string, unknown> = {
    drawingBufferWidth: 1280,
    drawingBufferHeight: 800,
    isContextLost: () => lost,
    getExtension: (name: string) => (name === 'OES_element_index_uint' && options.wideIndices !== false ? {} : null),
    createBuffer: () => make('buffer'),
    createTexture: () => make('texture'),
    createProgram: () => make('program'),
    createShader: () => make('shader'),
    deleteBuffer: (object: object) => deleted.add(object),
    deleteTexture: (object: object) => deleted.add(object),
    deleteProgram: (object: object) => deleted.add(object),
    deleteShader: (object: object) => deleted.add(object),
    shaderSource: (_shader: object, source: string) => sources.push(source),
    getShaderParameter: () => options.compiles !== false,
    getShaderInfoLog: () => 'ERROR: 0:1: oops',
    getProgramParameter: () => true,
    getUniformLocation: (_program: object, name: string) => ({ name }),
    bindBuffer: (target: string) => {
      boundIndexTarget = target === 'ELEMENT_ARRAY_BUFFER';
    },
    bufferData: (_target: string, data: unknown) => {
      if (boundIndexTarget) indexUploads.push(data);
    },
    drawElements: (_mode: unknown, count: number, type: unknown) => draws.push({ count, type }),
  };
  const gl = new Proxy(known, {
    get(target, property) {
      if (typeof property === 'string' && property in target) return target[property];
      // The constants are their own names; any other call does nothing.
      if (typeof property === 'string' && /^[A-Z0-9_]+$/.test(property)) return property;
      return () => undefined;
    },
  });
  return {
    gl,
    made,
    deleted,
    draws,
    indexUploads,
    sources,
    lose() {
      lost = true;
    },
  };
}

function fakeCanvas(gl: unknown) {
  const canvas = new EventTarget() as EventTarget & { getContext(kind: string): unknown; ownerDocument: unknown; width: number; height: number };
  canvas.getContext = (kind: string) => (kind === 'webgl' ? gl : null);
  // The dial's canvas: no 2D context in Node, so the dial is left blank.
  canvas.ownerDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  canvas.width = 1280;
  canvas.height = 800;
  return canvas as unknown as HTMLCanvasElement;
}

const env: SaverEnv = { palette: paletteFor({ mode: 'dark', tint: 'crema' }, true), seed: 1, numbers: [] };

function start(options: { wideIndices?: boolean } = {}) {
  const fake = fakeWebgl(options);
  const canvas = fakeCanvas(fake.gl);
  const instance = pipes.create(canvas, env);
  if (!instance) throw new Error('no instance');
  instance.resize(962, 602, 1.33);
  return { ...fake, canvas, instance };
}

describe('Espresso Pipes', () => {
  it('needs WebGL: none on the canvas, no screensaver (the host shows Nightstand)', () => {
    expect(pipes.context).toBe('webgl');
    expect(pipes.create(fakeCanvas(null), env)).toBeNull();
  });

  it('writes its shaders in GLSL ES 1.00 alone: its own characters, comments included, and no extension', () => {
    const { sources } = start();
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      // The language's character set (section 3.1): no quotes, apostrophes, backticks or backslashes, even in a comment.
      expect(source.match(/[^A-Za-z0-9_ \t\n.+\-/*%<>[\](){}^|&~=!:;,?#]/g) ?? []).toEqual([]);
      expect(source).not.toMatch(/#extension|#version/);
    }
  });

  it('draws the finished parts a chunk at a time, and each growing run and joint on its own', () => {
    const { instance, draws } = start();
    stepFor(instance, 6000);
    instance.draw();
    // One chunk of finished parts with 32-bit indices, then the growing ones with the shared 16-bit pieces.
    expect(draws[0]!.type).toBe('UNSIGNED_INT');
    expect(draws.length).toBeGreaterThan(3);
    expect(draws.slice(1).every((draw) => draw.type === 'UNSIGNED_SHORT')).toBe(true);
  });

  it('splits a full picture into 16-bit chunks where 32-bit indices are not to be had', () => {
    const narrow = start({ wideIndices: false });
    narrow.instance.still();
    expect(narrow.draws.every((draw) => draw.type === 'UNSIGNED_SHORT')).toBe(true);
    expect(narrow.indexUploads.every((data) => data instanceof Uint16Array)).toBe(true);
    // More than one chunk: the still holds more than 65,535 vertices.
    const big = narrow.draws.filter((draw) => draw.count > 10_000);
    expect(big.length).toBeGreaterThan(1);

    const wide = start({ wideIndices: true });
    wide.instance.still();
    expect(wide.draws.filter((draw) => draw.count > 10_000)).toHaveLength(1);
    expect(wide.indexUploads.some((data) => data instanceof Uint32Array)).toBe(true);
  });

  it('starts its buffers over with each new layout, and draws only the page while faded out', () => {
    const { instance, draws } = start();
    stepFor(instance, 20_000);
    instance.draw();
    const grown = draws[0]!.count;
    expect(grown).toBeGreaterThan(10_000);
    // On to the fade, at 60 % full or at the 4 minutes at the latest: faded out, before the next layout, nothing is drawn.
    let faded = false;
    for (let t = 0; t < LAYOUT_MS && !faded; t += 200) {
      stepFor(instance, 200);
      draws.length = 0;
      instance.draw();
      faded = draws.length === 0;
    }
    expect(faded).toBe(true);
    stepFor(instance, FADE_MS + BLANK_MS + 2000);
    draws.length = 0;
    instance.draw();
    expect(draws[0]!.count).toBeLessThan(grown);
  });

  it('throws on the next step or draw once its context is lost, for the host to show Nightstand', () => {
    const { instance, canvas } = start();
    stepFor(instance, 1000);
    instance.draw();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(() => instance.step(33)).toThrow(/lost its WebGL context/);
    expect(() => instance.draw()).toThrow(/lost its WebGL context/);
    expect(() => instance.still()).toThrow(/lost its WebGL context/);
  });

  it('throws on a draw when the context is lost before the event comes', () => {
    const { instance, lose } = start();
    instance.draw();
    lose();
    expect(() => instance.draw()).toThrow(/lost its WebGL context/);
  });

  it('throws where its shaders will not compile (the host shows Nightstand), having let go of what it made', () => {
    const fake = fakeWebgl({ compiles: false });
    expect(() => pipes.create(fakeCanvas(fake.gl), env)).toThrow(/did not compile: ERROR: 0:1: oops/);
    expect(fake.made.size).toBeGreaterThan(0);
    expect([...fake.made].filter((object) => !fake.deleted.has(object))).toEqual([]);
  });

  it('lets go of every GL object it made when disposed', () => {
    const { instance, made, deleted } = start({ wideIndices: false });
    instance.still();
    stepFor(instance, 2000);
    instance.draw();
    instance.dispose();
    expect(made.size).toBeGreaterThan(5);
    expect([...made].filter((object) => !deleted.has(object))).toEqual([]);
  });
});
