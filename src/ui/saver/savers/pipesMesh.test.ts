import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  buildMeshes,
  createChunkedGeometry,
  FLOATS_PER_VERTEX,
  MATERIAL,
  MATERIAL_COUNT,
  PIPE_RADIUS,
  placeAlong,
  placeAt,
  placementMatrix,
  type Mesh,
} from './pipesMesh.ts';
import { createPipesModel, STEPS } from './pipesModel.ts';

type Vec3 = [number, number, number];

const position = (mesh: Mesh | { vertices: Float32Array }, i: number): Vec3 => {
  const o = i * FLOATS_PER_VERTEX;
  return [mesh.vertices[o]!, mesh.vertices[o + 1]!, mesh.vertices[o + 2]!];
};
const normal = (mesh: Mesh | { vertices: Float32Array }, i: number): Vec3 => {
  const o = i * FLOATS_PER_VERTEX + 3;
  return [mesh.vertices[o]!, mesh.vertices[o + 1]!, mesh.vertices[o + 2]!];
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** The shortest distance from p to the segment from a to b. */
function toSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / dot(ab, ab)));
  return length(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

describe('the meshes', () => {
  const meshes = buildMeshes();

  it('turn every triangle to face out, with normals of unit length and indices in range', () => {
    for (const [name, mesh] of Object.entries(meshes)) {
      expect(mesh.vertices.length, name).toBe(mesh.vertexCount * FLOATS_PER_VERTEX);
      const wrong: string[] = [];
      for (let i = 0; i < mesh.vertexCount; i += 1) {
        if (Math.abs(length(normal(mesh, i)) - 1) > 1e-5) wrong.push(`normal ${i}`);
        const material = mesh.vertices[i * FLOATS_PER_VERTEX + 8]!;
        if (!Number.isInteger(material) || material < 0 || material >= MATERIAL_COUNT) wrong.push(`material ${i}`);
      }
      let facing = 0;
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
        if (Math.max(a, b, c) >= mesh.vertexCount) wrong.push(`index ${t}`);
        const face = cross(sub(position(mesh, b), position(mesh, a)), sub(position(mesh, c), position(mesh, a)));
        // A sliver with no area (a pole's) faces nowhere.
        if (length(face) < 1e-9) continue;
        const [na, nb, nc] = [normal(mesh, a), normal(mesh, b), normal(mesh, c)];
        const smooth: Vec3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
        if (dot(face, smooth) <= 0) wrong.push(`triangle ${t / 3} faces in`);
        facing += 1;
      }
      expect(wrong, name).toEqual([]);
      expect(facing, name).toBeGreaterThan(0);
    }
  });

  it('make a ball a little wider than its pipe, and a run a cell long along its own axis', () => {
    expect(BALL_RADIUS / PIPE_RADIUS).toBeGreaterThan(1.3);
    expect(BALL_RADIUS / PIPE_RADIUS).toBeLessThan(1.6);
    for (let i = 0; i < meshes.run.vertexCount; i += 1) {
      const [x, y, z] = position(meshes.run, i);
      expect(Math.hypot(x, y)).toBeCloseTo(PIPE_RADIUS, 6);
      expect(z === 0 || z === 1).toBe(true);
    }
    for (let i = 0; i < meshes.ball.vertexCount; i += 1) expect(length(position(meshes.ball, i))).toBeCloseTo(BALL_RADIUS, 6);
  });

  it('keep every fitting clear of what the neighbouring cells may hold: their balls, and pipes passing through them', () => {
    // A fitting's local frame is its joint's cell, a cell 1 across; its dial or wheel faces +z, a cup stands up +y.
    const neighbours: Vec3[] = [];
    for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) if (x || y || z) neighbours.push([x, y, z]);
    // Pipes run between neighbouring cells' centres; those through this cell's own centre are its own joint's.
    const segments: [Vec3, Vec3][] = [];
    for (const a of [...neighbours]) {
      for (const [dx, dy, dz] of STEPS) {
        const b: Vec3 = [a[0] + dx, a[1] + dy, a[2] + dz];
        if (b[0] === 0 && b[1] === 0 && b[2] === 0) continue;
        segments.push([a, b]);
      }
    }
    for (const name of ['gauge', 'wheel', 'cup'] as const) {
      const mesh = meshes[name];
      let nearest = Infinity;
      for (let i = 0; i < mesh.vertexCount; i += 1) {
        const p = position(mesh, i);
        for (const q of neighbours) nearest = Math.min(nearest, length(sub(p, q)) - BALL_RADIUS);
        for (const [a, b] of segments) nearest = Math.min(nearest, toSegment(p, a, b) - PIPE_RADIUS);
      }
      expect(nearest, name).toBeGreaterThan(0.02);
    }
  });

  it('put the pipe’s own metal where a mesh says so, and keep the others', () => {
    const geometry = createChunkedGeometry(true);
    // A gauge's joint: its ball in the pipe's metal, the gauge itself chrome round its dial.
    geometry.add(meshes.ball, placeAt([0, 0, 0]), MATERIAL.brass);
    geometry.add(meshes.gauge, placeAt([0, 0, 0]), MATERIAL.brass);
    const materials = new Set<number>();
    const chunk = geometry.chunks[0]!;
    for (let i = 0; i < chunk.vertexCount; i += 1) materials.add(chunk.vertices[i * FLOATS_PER_VERTEX + 8]!);
    expect([...materials].sort()).toEqual([MATERIAL.brass, MATERIAL.chrome, MATERIAL.dial].sort());
  });
});

describe('placements', () => {
  const meshes = buildMeshes();

  it('lay a run from a cell along each of the six directions, its normals across it', () => {
    for (const [dx, dy, dz] of STEPS) {
      const from: Vec3 = [2, -1, 3];
      const geometry = createChunkedGeometry(true);
      geometry.add(meshes.run, placeAlong([dx, dy, dz], from, 4), MATERIAL.copper);
      const chunk = geometry.chunks[0]!;
      let far = -Infinity;
      for (let i = 0; i < chunk.vertexCount; i += 1) {
        const p = position(chunk, i);
        const along = dot(sub(p, from), [dx, dy, dz]);
        far = Math.max(far, along);
        // Off its axis by the pipe's radius, the normal pointing straight out from the axis.
        const off = sub(sub(p, from), [dx * along, dy * along, dz * along]);
        expect(length(off)).toBeCloseTo(PIPE_RADIUS, 5);
        expect(dot(normal(chunk, i), [dx, dy, dz])).toBeCloseTo(0, 6);
        expect(dot(normal(chunk, i), off)).toBeGreaterThan(0);
      }
      expect(far).toBeCloseTo(4, 6);
    }
  });

  it('give WebGL the same placement as a matrix, its turn alone for the normals', () => {
    const placement = placeAlong([0, -1, 0], [1, 2, 3], 2.5);
    const model = new Float32Array(16);
    const turn = new Float32Array(9);
    placementMatrix(placement, model, turn);
    // The run's far end, (0, 0, 1) in its own frame, lands 2.5 cells down from (1, 2, 3).
    const at = (p: Vec3): Vec3 => [0, 1, 2].map((r) => model[r]! * p[0] + model[4 + r]! * p[1] + model[8 + r]! * p[2] + model[12 + r]!) as Vec3;
    const end = at([0, 0, 1]);
    expect(end[0]).toBeCloseTo(1, 6);
    expect(end[1]).toBeCloseTo(-0.5, 6);
    expect(end[2]).toBeCloseTo(3, 6);
    expect(model[15]).toBe(1);
    // The turn alone is orthonormal.
    for (let c = 0; c < 3; c += 1) expect(Math.hypot(turn[c * 3]!, turn[c * 3 + 1]!, turn[c * 3 + 2]!)).toBeCloseTo(1, 6);
  });

  it('turn a cup so its handle goes the way it is asked, still standing up', () => {
    const geometry = createChunkedGeometry(true);
    geometry.add(meshes.cup, placeAt([0, 0, 0], 1, [-1, 0, 0]), MATERIAL.chrome);
    const chunk = geometry.chunks[0]!;
    let mostX = -Infinity;
    let leastX = Infinity;
    let lowest = Infinity;
    for (let i = 0; i < chunk.vertexCount; i += 1) {
      const [x, y] = position(chunk, i);
      lowest = Math.min(lowest, y);
      // Above the saucer: the cup and its handle.
      if (y < BALL_RADIUS + 0.15) continue;
      mostX = Math.max(mostX, x);
      leastX = Math.min(leastX, x);
    }
    // The handle reaches out on its own side, now -x; the saucer rests on the ball.
    expect(-leastX).toBeGreaterThan(mostX + 0.05);
    expect(lowest).toBeGreaterThan(BALL_RADIUS - 0.05);
  });
});

describe('createChunkedGeometry', () => {
  const meshes = buildMeshes();

  it('splits into chunks of fewer than 65,536 vertices with 16-bit indices, each index inside its chunk', () => {
    const geometry = createChunkedGeometry(false);
    const count = 800;
    for (let i = 0; i < count; i += 1) geometry.add(meshes.ball, placeAt([i % 20, 0, 0]), MATERIAL.copper);
    expect(geometry.vertexCount()).toBe(count * meshes.ball.vertexCount);
    expect(geometry.triangleCount()).toBe((count * meshes.ball.indices.length) / 3);
    expect(geometry.chunks.length).toBeGreaterThan(1);
    for (const chunk of geometry.chunks) {
      expect(chunk.vertexCount).toBeLessThanOrEqual(65_535);
      expect(chunk.indices).toBeInstanceOf(Uint16Array);
      let highest = 0;
      for (let i = 0; i < chunk.indexCount; i += 1) highest = Math.max(highest, chunk.indices[i]!);
      expect(highest).toBe(chunk.vertexCount - 1);
    }
  });

  it('keeps it all in one chunk with 32-bit indices', () => {
    const geometry = createChunkedGeometry(true);
    for (let i = 0; i < 800; i += 1) geometry.add(meshes.ball, placeAt([0, i, 0]), MATERIAL.copper);
    expect(geometry.chunks).toHaveLength(1);
    expect(geometry.chunks[0]!.indices).toBeInstanceOf(Uint32Array);
    expect(geometry.chunks[0]!.vertexCount).toBe(800 * meshes.ball.vertexCount);
  });

  it('empties for the next layout, and fills its chunks again from the start', () => {
    const geometry = createChunkedGeometry(false);
    for (let i = 0; i < 500; i += 1) geometry.add(meshes.ball, placeAt([0, 0, 0]), MATERIAL.copper);
    const kept = geometry.chunks[0]!;
    geometry.clear();
    expect(geometry.chunks).toHaveLength(0);
    expect(geometry.vertexCount()).toBe(0);
    geometry.add(meshes.run, placeAlong([1, 0, 0], [0, 0, 0], 3), MATERIAL.brass);
    expect(geometry.chunks).toHaveLength(1);
    expect(geometry.chunks[0]).toBe(kept);
    expect(geometry.chunks[0]!.vertexCount).toBe(meshes.run.vertexCount);
  });

  it('builds a whole layout, at its fullest, into under 200,000 vertices: three 16-bit chunks at most', () => {
    for (const seed of [1, 2]) {
      const model = createPipesModel(seed);
      for (let t = 0; t < 300_000 && model.fade === 0; t += 100) model.step(100);
      const geometry = createChunkedGeometry(false);
      for (const part of model.parts) {
        if (part.kind === 'run') {
          const [dx, dy, dz] = STEPS[part.direction]!;
          geometry.add(meshes.run, placeAlong([dx, dy, dz], [0, 0, 0], part.length), MATERIAL.copper);
        } else {
          geometry.add(meshes.ball, placeAt([0, 0, 0]), MATERIAL.copper);
          if (part.fitting !== 'ball') geometry.add(meshes[part.fitting], placeAt([0, 0, 0]), MATERIAL.copper);
        }
      }
      expect(geometry.vertexCount()).toBeLessThan(200_000);
      expect(geometry.chunks.length).toBeLessThanOrEqual(3);
    }
  });
});
