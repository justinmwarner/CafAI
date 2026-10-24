/**
 * Espresso Pipes' shapes (D262) as pure code: the pieces a pipe is
 * built of, in cell units (a cell is 1 across), and the buffers they are
 * built into as the pipes grow. No WebGL here, so it can be tested in Node;
 * pipes.ts uploads what this builds and draws it.
 *
 * Every vertex is nine floats: its place, its normal (smooth, so a pipe
 * reads round), a texture coordinate (the gauge's dial; the crema's
 * distance from the middle of the cup) and a material, a number into the
 * shader's table. Material 0 stands for the pipe's own metal, filled in when
 * a piece is placed. Triangles turn counter-clockwise seen from outside.
 */

/** The pipe's radius, a cell being 1: a ball joint is a little wider. */
export const PIPE_RADIUS = 0.22;
export const BALL_RADIUS = 0.32;
const PIPE_SIDES = 16;
const BALL_SIDES = 16;
const BALL_RINGS = 10;

/** The shader's materials by number. */
export const MATERIAL = {
  /** The pipe's own metal, filled in when the piece is placed. */
  pipe: 0,
  copper: 1,
  brass: 2,
  chrome: 3,
  anodised: 4,
  porcelain: 5,
  crema: 6,
  dial: 7,
} as const;
export const MATERIAL_COUNT = 8;

/** Place, normal, texture coordinate, material. */
export const FLOATS_PER_VERTEX = 9;

export interface Mesh {
  /** Interleaved, FLOATS_PER_VERTEX a vertex. */
  vertices: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
}

type Vec3 = readonly [number, number, number];

/** Collects vertices and triangles. */
class Builder {
  private readonly data: number[] = [];
  private readonly triangles: number[] = [];
  private count = 0;

  vertex(position: Vec3, normal: Vec3, u: number, v: number, material: number): number {
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    this.data.push(position[0], position[1], position[2], normal[0] / length, normal[1] / length, normal[2] / length, u, v, material);
    this.count += 1;
    return this.count - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.triangles.push(a, b, c);
  }

  /** a, b, c, d counter-clockwise from outside. */
  quad(a: number, b: number, c: number, d: number): void {
    this.triangles.push(a, b, c, a, c, d);
  }

  /** The number the next vertex will have. */
  next(): number {
    return this.count;
  }

  build(): Mesh {
    return { vertices: new Float32Array(this.data), indices: new Uint16Array(this.triangles), vertexCount: this.count };
  }
}

/** A frame for a shape: where its local x, y and z go, and where its origin is. */
interface Frame {
  x: Vec3;
  y: Vec3;
  z: Vec3;
  origin: Vec3;
}

const IDENTITY: Frame = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [0, 0, 0] };

function apply(frame: Frame, p: Vec3): Vec3 {
  return [
    frame.origin[0] + frame.x[0] * p[0] + frame.y[0] * p[1] + frame.z[0] * p[2],
    frame.origin[1] + frame.x[1] * p[0] + frame.y[1] * p[1] + frame.z[1] * p[2],
    frame.origin[2] + frame.x[2] * p[0] + frame.y[2] * p[1] + frame.z[2] * p[2],
  ];
}

function turn(frame: Frame, n: Vec3): Vec3 {
  return [
    frame.x[0] * n[0] + frame.y[0] * n[1] + frame.z[0] * n[2],
    frame.x[1] * n[0] + frame.y[1] * n[1] + frame.z[1] * n[2],
    frame.x[2] * n[0] + frame.y[2] * n[1] + frame.z[2] * n[2],
  ];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalized(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

/** A right-handed frame whose z runs along `axis`, its origin at `origin`. */
function frameAlong(axis: Vec3, origin: Vec3 = [0, 0, 0]): Frame {
  const z = normalized(axis);
  const helper: Vec3 = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x = normalized(cross(helper, z));
  const y = cross(z, x);
  return { x, y, z, origin };
}

/** A tube round local z from z0 to z1, open at both ends. */
function tube(b: Builder, frame: Frame, radius: number, z0: number, z1: number, sides: number, material: number): void {
  const first = b.next();
  for (const z of [z0, z1]) {
    for (let j = 0; j <= sides; j += 1) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      b.vertex(apply(frame, [radius * c, radius * s, z]), turn(frame, [c, s, 0]), j / sides, z, material);
    }
  }
  const ring = sides + 1;
  for (let j = 0; j < sides; j += 1) b.quad(first + j, first + j + 1, first + ring + j + 1, first + ring + j);
}

/** A flat disc round local z at height z, facing +z (or -z, `back`); u, v span its square, v down from the top. */
function disc(b: Builder, frame: Frame, radius: number, z: number, sides: number, material: number, back = false): void {
  const normal: Vec3 = turn(frame, [0, 0, back ? -1 : 1]);
  const centre = b.vertex(apply(frame, [0, 0, z]), normal, 0.5, 0.5, material);
  for (let j = 0; j <= sides; j += 1) {
    const a = (j / sides) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    b.vertex(apply(frame, [radius * c, radius * s, z]), normal, 0.5 + c / 2, 0.5 - s / 2, material);
  }
  for (let j = 0; j < sides; j += 1) {
    if (back) b.triangle(centre, centre + 2 + j, centre + 1 + j);
    else b.triangle(centre, centre + 1 + j, centre + 2 + j);
  }
}

/** A ball at the frame's origin. */
function ball(b: Builder, frame: Frame, radius: number, sides: number, rings: number, material: number): void {
  const first = b.next();
  for (let i = 0; i <= rings; i += 1) {
    const latitude = -Math.PI / 2 + (i / rings) * Math.PI;
    const y = Math.sin(latitude);
    const r = Math.cos(latitude);
    for (let j = 0; j <= sides; j += 1) {
      const a = (j / sides) * Math.PI * 2;
      const n: Vec3 = [r * Math.cos(a), y, -r * Math.sin(a)];
      b.vertex(apply(frame, [n[0] * radius, n[1] * radius, n[2] * radius]), turn(frame, n), j / sides, i / rings, material);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < sides; j += 1) {
      const a = first + i * row + j;
      const c = a + row + 1;
      if (i > 0) b.triangle(a, a + 1, c);
      if (i < rings - 1) b.triangle(a, c, a + row);
    }
  }
}

/** A ring (a torus) round local z at height z: `major` to the middle of its tube, `minor` the tube's radius. */
function torus(b: Builder, frame: Frame, major: number, minor: number, z: number, sides: number, tubeSides: number, material: number): void {
  const first = b.next();
  for (let i = 0; i <= sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let j = 0; j <= tubeSides; j += 1) {
      const t = (j / tubeSides) * Math.PI * 2;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const n: Vec3 = [ct * ca, ct * sa, st];
      b.vertex(apply(frame, [(major + minor * ct) * ca, (major + minor * ct) * sa, z + minor * st]), turn(frame, n), i / sides, j / tubeSides, material);
    }
  }
  const row = tubeSides + 1;
  for (let i = 0; i < sides; i += 1) {
    for (let j = 0; j < tubeSides; j += 1) {
      const a = first + i * row + j;
      b.quad(a, a + row, a + row + 1, a + 1);
    }
  }
}

/**
 * A shape turned on a lathe round local y: `profile` from the bottom of the
 * axis up and round its outside, each point (radius, height). Its normals
 * are smooth along the profile except at the points listed in `creases`.
 */
function lathe(b: Builder, frame: Frame, profile: readonly (readonly [number, number])[], sides: number, material: number, creases: readonly number[] = []): void {
  // The normal of each span, pointing out of the shape (to the right of the profile as it climbs).
  const spans = profile.slice(0, -1).map(([r0, y0], i) => {
    const [r1, y1] = profile[i + 1]!;
    const length = Math.hypot(r1 - r0, y1 - y0) || 1;
    return [(y1 - y0) / length, -(r1 - r0) / length] as const;
  });
  // A point on a crease is two points, one for the span below and one for the span above.
  const points: { r: number; y: number; nr: number; ny: number }[] = [];
  profile.forEach(([r, y], i) => {
    const below = spans[i - 1];
    const above = spans[i];
    if (below && above && creases.includes(i)) {
      points.push({ r, y, nr: below[0], ny: below[1] });
      points.push({ r, y, nr: above[0], ny: above[1] });
    } else {
      const nr = (below?.[0] ?? 0) + (above?.[0] ?? 0);
      const ny = (below?.[1] ?? 0) + (above?.[1] ?? 0);
      points.push({ r, y, nr, ny });
    }
  });
  const first = b.next();
  for (const point of points) {
    for (let j = 0; j <= sides; j += 1) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = -Math.sin(a);
      b.vertex(apply(frame, [point.r * c, point.y, point.r * s]), turn(frame, [point.nr * c, point.ny, point.nr * s]), j / sides, point.r, material);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < points.length - 1; i += 1) {
    const here = points[i]!;
    const next = points[i + 1]!;
    // A crease's two points are at one place: no band between them.
    if (here.r === next.r && here.y === next.y) continue;
    for (let j = 0; j < sides; j += 1) {
      const a = first + i * row + j;
      b.quad(a, a + 1, a + row + 1, a + row);
    }
  }
}

/** A straight run, local z from 0 to 1 (stretched to its length when placed), open at both ends: its ends are inside joints. */
export function runMesh(): Mesh {
  const b = new Builder();
  tube(b, IDENTITY, PIPE_RADIUS, 0, 1, PIPE_SIDES, MATERIAL.pipe);
  return b.build();
}

/** The run a pipe is growing: a run with its two ends closed, the far one its growing tip. */
export function tipMesh(): Mesh {
  const b = new Builder();
  tube(b, IDENTITY, PIPE_RADIUS, 0, 1, PIPE_SIDES, MATERIAL.pipe);
  disc(b, IDENTITY, PIPE_RADIUS, 1, PIPE_SIDES, MATERIAL.pipe);
  disc(b, IDENTITY, PIPE_RADIUS, 0, PIPE_SIDES, MATERIAL.pipe, true);
  return b.build();
}

/** A ball joint at the origin. */
export function ballMesh(): Mesh {
  const b = new Builder();
  ball(b, IDENTITY, BALL_RADIUS, BALL_SIDES, BALL_RINGS, MATERIAL.pipe);
  return b.build();
}

/** The gauge's sizes, local z toward its face: a short drum, wider than the ball it is set into, its dial face in front of the ball under a bright bezel. */
export const GAUGE = { back: 0.2, front: 0.34, radius: 0.42, bezel: 0.042 } as const;

/** A pressure gauge, without its ball: local z is the way its dial faces (its back, inside the ball or turned from the camera, is never seen). */
export function gaugeMesh(): Mesh {
  const b = new Builder();
  tube(b, IDENTITY, GAUGE.radius, GAUGE.back, GAUGE.front, 32, MATERIAL.chrome);
  torus(b, IDENTITY, GAUGE.radius - GAUGE.bezel * 0.4, GAUGE.bezel, GAUGE.front, 36, 8, MATERIAL.chrome);
  disc(b, IDENTITY, GAUGE.radius - GAUGE.bezel * 0.9, GAUGE.front - 0.006, 40, MATERIAL.dial);
  return b.build();
}

/** The valve wheel's sizes, local z the way it faces: its hub on the front of the ball. */
export const WHEEL = { at: 0.37, radius: 0.31, rim: 0.04, spokes: 5, spokeRadius: 0.027, hubRadius: 0.09 } as const;

/** A valve wheel, without its ball: a ring with spokes round a hub. */
export function wheelMesh(): Mesh {
  const b = new Builder();
  tube(b, IDENTITY, WHEEL.hubRadius, WHEEL.at - 0.05, WHEEL.at + 0.05, 16, MATERIAL.chrome);
  disc(b, IDENTITY, WHEEL.hubRadius, WHEEL.at + 0.05, 16, MATERIAL.chrome);
  torus(b, IDENTITY, WHEEL.radius, WHEEL.rim, WHEEL.at, 36, 8, MATERIAL.chrome);
  for (let k = 0; k < WHEEL.spokes; k += 1) {
    const a = Math.PI / 2 + (k / WHEEL.spokes) * Math.PI * 2;
    const out: Vec3 = [Math.cos(a), Math.sin(a), 0];
    tube(b, frameAlong(out, [0, 0, WHEEL.at]), WHEEL.spokeRadius, WHEEL.hubRadius * 0.6, WHEEL.radius - WHEEL.rim * 0.5, 8, MATERIAL.chrome);
  }
  return b.build();
}

/** The cup's sizes, local y up, its handle toward local x: a saucer resting on the ball, the cup standing in it. */
export const CUP = { saucerBottom: BALL_RADIUS - 0.015, size: 1.45 } as const;

/** A small espresso cup on its saucer, without its ball: porcelain, the crema showing at the top. */
export function cupMesh(): Mesh {
  const b = new Builder();
  const k = CUP.size;
  const s = CUP.saucerBottom;
  const at = (points: readonly (readonly [number, number])[], base: number) => points.map(([r, y]) => [r * k, base + y * k] as const);
  // The saucer: its foot, its underside, the rim, and the well the cup stands in.
  lathe(
    b,
    IDENTITY,
    at(
      [
        [0, 0],
        [0.12, 0],
        [0.14, 0.012],
        [0.3, 0.04],
        [0.34, 0.066],
        [0.333, 0.078],
        [0.3, 0.066],
        [0.16, 0.04],
        [0, 0.036],
      ],
      s,
    ),
    32,
    MATERIAL.porcelain,
    [1, 2],
  );
  const c = s + 0.036 * k;
  // The cup: thick-walled, round-bottomed, a little wider at the rim; inside, down to the coffee.
  lathe(
    b,
    IDENTITY,
    at(
      [
        [0, 0],
        [0.08, 0],
        [0.1, 0.012],
        [0.145, 0.05],
        [0.178, 0.11],
        [0.194, 0.18],
        [0.2, 0.256],
        [0.194, 0.27],
        [0.178, 0.262],
        [0.17, 0.205],
      ],
      c,
    ),
    32,
    MATERIAL.porcelain,
    [1, 9],
  );
  // The coffee, its crema darker toward the wall (the texture coordinate's u is the distance from the middle).
  const coffeeY = c + 0.205 * k;
  const coffeeRadius = 0.17 * k;
  const top = b.vertex([0, coffeeY, 0], [0, 1, 0], 0, 0, MATERIAL.crema);
  for (let j = 0; j <= 32; j += 1) {
    const a = (j / 32) * Math.PI * 2;
    b.vertex([coffeeRadius * Math.cos(a), coffeeY, -coffeeRadius * Math.sin(a)], [0, 1, 0], 1, 0, MATERIAL.crema);
  }
  for (let j = 0; j < 32; j += 1) b.triangle(top, top + 1 + j, top + 2 + j);
  // The handle: a ring standing upright on the cup's side, its inner half inside the wall.
  torus(b, { ...IDENTITY, origin: [0.235 * k, c + 0.157 * k, 0] }, 0.07 * k, 0.022 * k, 0, 24, 10, MATERIAL.porcelain);
  return b.build();
}

/** The meshes pipes.ts draws with, made once. */
export interface PipeMeshes {
  run: Mesh;
  tip: Mesh;
  ball: Mesh;
  gauge: Mesh;
  wheel: Mesh;
  cup: Mesh;
}

export function buildMeshes(): PipeMeshes {
  return { run: runMesh(), tip: tipMesh(), ball: ballMesh(), gauge: gaugeMesh(), wheel: wheelMesh(), cup: cupMesh() };
}

/**
 * Where a piece goes: its local x, y and z as world directions (a turn,
 * right-handed), then a stretch along its own axes, then a move. A stretch
 * that is not even only ever lengthens a run along its own axis, which
 * leaves its normals as they were.
 */
export interface Placement {
  x: Vec3;
  y: Vec3;
  z: Vec3;
  scale: Vec3;
  origin: Vec3;
}

/** The 16 numbers of a placement as a WebGL matrix (columns first), and its turn alone as a 3 by 3, for the normals. */
export function placementMatrix(placement: Placement, model: Float32Array, normal: Float32Array): void {
  const { x, y, z, scale, origin } = placement;
  model.set([x[0] * scale[0], x[1] * scale[0], x[2] * scale[0], 0, y[0] * scale[1], y[1] * scale[1], y[2] * scale[1], 0, z[0] * scale[2], z[1] * scale[2], z[2] * scale[2], 0, origin[0], origin[1], origin[2], 1]);
  normal.set([x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]]);
}

/** A placement whose local z runs along `axis` from `origin`, stretched `length` along it and `size` across. */
export function placeAlong(axis: Vec3, origin: Vec3, length = 1, size = 1): Placement {
  const frame = frameAlong(axis, origin);
  return { x: frame.x, y: frame.y, z: frame.z, scale: [size, size, length], origin };
}

/** A placement keeping the local axes, or turned so local x goes along `xAxis` (y staying up), scaled evenly. */
export function placeAt(origin: Vec3, size = 1, xAxis: Vec3 = [1, 0, 0]): Placement {
  const x = normalized(xAxis);
  const y: Vec3 = [0, 1, 0];
  return { x, y, z: cross(x, y), scale: [size, size, size], origin };
}

/**
 * The finished parts of a layout, built into buffers a piece at a time: one
 * chunk as long as it holds fewer than `maxVertices` vertices (65,535 where
 * the indices are 16-bit, many more with OES_element_index_uint), then the
 * next. A chunk's arrays grow by doubling; what pipes.ts has uploaded of each
 * it keeps itself.
 */
export interface Chunk {
  vertices: Float32Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export interface ChunkedGeometry {
  readonly chunks: Chunk[];
  readonly maxVertices: number;
  readonly wide: boolean;
  /** Vertices and triangles in all. */
  vertexCount(): number;
  triangleCount(): number;
  /** Places a copy of `mesh`, its material 0 made `metal`. */
  add(mesh: Mesh, placement: Placement, metal: number): void;
  /** Empty again, the arrays kept for the next layout. */
  clear(): void;
}

/** The first size of a chunk's arrays, in vertices. */
const FIRST_CAPACITY = 8192;

export function createChunkedGeometry(wide: boolean, maxVertices = wide ? 1 << 20 : 65_535): ChunkedGeometry {
  const chunks: Chunk[] = [];
  /** Chunks kept from an earlier layout, to fill again. */
  let used = 0;

  const newChunk = (): Chunk => {
    const capacity = Math.min(FIRST_CAPACITY, maxVertices);
    return {
      vertices: new Float32Array(capacity * FLOATS_PER_VERTEX),
      indices: wide ? new Uint32Array(capacity * 6) : new Uint16Array(capacity * 6),
      vertexCount: 0,
      indexCount: 0,
    };
  };

  const room = (chunk: Chunk, vertices: number, indices: number) => {
    const needVertices = (chunk.vertexCount + vertices) * FLOATS_PER_VERTEX;
    if (needVertices > chunk.vertices.length) {
      let size = chunk.vertices.length;
      while (size < needVertices) size *= 2;
      const grown = new Float32Array(Math.min(size, maxVertices * FLOATS_PER_VERTEX));
      grown.set(chunk.vertices.subarray(0, chunk.vertexCount * FLOATS_PER_VERTEX));
      chunk.vertices = grown;
    }
    const needIndices = chunk.indexCount + indices;
    if (needIndices > chunk.indices.length) {
      let size = chunk.indices.length;
      while (size < needIndices) size *= 2;
      const grown = wide ? new Uint32Array(size) : new Uint16Array(size);
      grown.set(chunk.indices.subarray(0, chunk.indexCount));
      chunk.indices = grown;
    }
  };

  const geometry: ChunkedGeometry = {
    get chunks() {
      return chunks.slice(0, used);
    },
    maxVertices,
    wide,
    vertexCount: () => chunks.slice(0, used).reduce((sum, chunk) => sum + chunk.vertexCount, 0),
    triangleCount: () => chunks.slice(0, used).reduce((sum, chunk) => sum + chunk.indexCount / 3, 0),
    add(mesh, placement, metal) {
      if (mesh.vertexCount > maxVertices) throw new Error('A piece larger than a chunk.');
      let chunk = used > 0 ? chunks[used - 1]! : undefined;
      if (!chunk || chunk.vertexCount + mesh.vertexCount > maxVertices) {
        if (used === chunks.length) chunks.push(newChunk());
        chunk = chunks[used]!;
        used += 1;
      }
      room(chunk, mesh.vertexCount, mesh.indices.length);
      const { x, y, z, scale, origin } = placement;
      const source = mesh.vertices;
      const target = chunk.vertices;
      let o = chunk.vertexCount * FLOATS_PER_VERTEX;
      for (let i = 0; i < mesh.vertexCount; i += 1) {
        const s = i * FLOATS_PER_VERTEX;
        const px = source[s]! * scale[0];
        const py = source[s + 1]! * scale[1];
        const pz = source[s + 2]! * scale[2];
        const nx = source[s + 3]!;
        const ny = source[s + 4]!;
        const nz = source[s + 5]!;
        target[o] = origin[0] + x[0] * px + y[0] * py + z[0] * pz;
        target[o + 1] = origin[1] + x[1] * px + y[1] * py + z[1] * pz;
        target[o + 2] = origin[2] + x[2] * px + y[2] * py + z[2] * pz;
        target[o + 3] = x[0] * nx + y[0] * ny + z[0] * nz;
        target[o + 4] = x[1] * nx + y[1] * ny + z[1] * nz;
        target[o + 5] = x[2] * nx + y[2] * ny + z[2] * nz;
        target[o + 6] = source[s + 6]!;
        target[o + 7] = source[s + 7]!;
        target[o + 8] = source[s + 8] === MATERIAL.pipe ? metal : source[s + 8]!;
        o += FLOATS_PER_VERTEX;
      }
      const base = chunk.vertexCount;
      const indices = chunk.indices;
      let k = chunk.indexCount;
      for (let i = 0; i < mesh.indices.length; i += 1) {
        indices[k] = base + mesh.indices[i]!;
        k += 1;
      }
      chunk.vertexCount += mesh.vertexCount;
      chunk.indexCount = k;
    },
    clear() {
      for (const chunk of chunks) {
        chunk.vertexCount = 0;
        chunk.indexCount = 0;
      }
      used = 0;
    },
  };
  return geometry;
}
