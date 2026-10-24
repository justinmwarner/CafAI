/**
 * Espresso Pipes, after Windows' 3D Pipes (D-PIPES-1): copper, brass,
 * chrome and dark anodised pipes growing through a grid seen from a fixed
 * camera, ball joints at the turns, and now and then a coffee fitting: a
 * pressure gauge reading 9 bar, a valve wheel, a small espresso cup. WebGL1,
 * written by hand (D-PIPES-2): no library and no extension needed.
 *
 * The growth is pipesModel.ts and the shapes pipesMesh.ts; this file builds
 * the finished parts into buffers as they come (appended, never rebuilt; in
 * chunks of under 65,536 vertices where 32-bit indices are not to be had),
 * draws each growing run and each joint still growing in with a matrix of its
 * own, and lights it all: a made-up studio for the metals to reflect (a warm
 * key light high on the left, a cool fill on the right, a light strip behind,
 * a dark floor) with Blinn-Phong highlights from the same lights, and fog
 * toward the page's colour, so the far pipes sink into the dark.
 *
 * Should the context be lost, the next step or draw throws and the host shows
 * Nightstand instead, as for any screensaver that throws.
 */
import { oklch, parseHex } from '../../color.ts';
import type { CanvasSaver, SaverInstance } from '../types.ts';
import {
  buildMeshes,
  BALL_RADIUS,
  createChunkedGeometry,
  FLOATS_PER_VERTEX,
  MATERIAL,
  MATERIAL_COUNT,
  PIPE_RADIUS,
  placeAlong,
  placeAt,
  placementMatrix,
  type ChunkedGeometry,
  type Mesh,
  type Placement,
} from './pipesMesh.ts';
import {
  createPipesModel,
  FITTING_GROW_MS,
  growForStill,
  JOINT_GROW_MS,
  jointGrowth,
  STEPS,
  type Cell,
  type JointPart,
  type Metal,
  type PipesModel,
} from './pipesModel.ts';

const LOST = 'Espresso Pipes lost its WebGL context.';

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
attribute float aMaterial;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;
uniform float uMetal;
uniform vec3 uBase[${MATERIAL_COUNT}];
uniform vec4 uSurface[${MATERIAL_COUNT}];
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vBase;
varying vec4 vSurface;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = uNormalMatrix * aNormal;
  vUv = aUv;
  int material = int((aMaterial < 0.5 ? uMetal : aMaterial) + 0.5);
  vBase = uBase[material];
  vSurface = uSurface[material];
  gl_Position = uViewProjection * world;
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uCamera;
uniform vec3 uPage;
uniform float uFade;
uniform vec3 uFog;
uniform vec3 uKey;
uniform vec3 uFill;
uniform vec3 uRim;
uniform sampler2D uDial;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vBase;
varying vec4 vSurface;

const vec3 KEY_COLOR = vec3(1.0, 0.84, 0.64);
const vec3 FILL_COLOR = vec3(0.6, 0.73, 1.0);
const vec3 TOP_COLOR = vec3(1.0, 0.96, 0.9);
const vec3 RIM_COLOR = vec3(0.95, 0.93, 0.9);

// 1 between lo and hi, 0 outside, with soft edges.
float within(float x, float lo, float hi, float soft) {
  return smoothstep(lo - soft, lo + soft, x) * (1.0 - smoothstep(hi - soft, hi + soft, x));
}

// The studio the metals reflect, by direction: warm grey walls lighter toward
// the horizon, a dark floor, a darker ceiling; a tall warm softbox standing
// in front on the left, a cool one on the right, a strip overhead and a low
// one behind the pipes for their rims.
vec3 studio(vec3 r) {
  float e = r.y;
  // 0 toward the camera, negative to the left, plus or minus pi behind the pipes.
  float a = atan(r.x, r.z);
  // The horizon sits a little below level, softly: seen from a little above, a pipe's front reflects the walls, its underside the floor.
  float h = e + 0.24;
  vec3 wall = mix(vec3(0.22, 0.205, 0.18), vec3(0.09, 0.088, 0.095), smoothstep(0.0, 1.0, h));
  vec3 ground = mix(vec3(0.06, 0.05, 0.044), vec3(0.008, 0.007, 0.006), smoothstep(0.0, 0.3, -h));
  vec3 c = mix(ground, wall, smoothstep(-0.06, 0.06, h));
  c += KEY_COLOR * 2.8 * within(a, -1.32, -0.82, 0.06) * within(e, -0.5, 0.85, 0.08);
  c += KEY_COLOR * 1.3 * within(a, -0.62, -0.5, 0.04) * within(e, -0.45, 0.8, 0.08);
  c += FILL_COLOR * 1.1 * within(a, 0.78, 1.36, 0.07) * within(e, -0.4, 0.6, 0.08);
  c += TOP_COLOR * 1.4 * smoothstep(0.74, 0.84, e) * (1.0 - smoothstep(0.3, 0.38, abs(r.z)));
  c += KEY_COLOR * 0.35 * within(a, -0.3, 0.3, 0.15) * within(e, -0.3, 0.22, 0.1);
  c += RIM_COLOR * 1.4 * smoothstep(2.45, 2.58, abs(a)) * within(e, -0.12, 0.38, 0.06);
  return c;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 toEye = uCamera - vWorld;
  float distance = length(toEye);
  vec3 v = toEye / distance;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  vec3 r = reflect(-v, n);
  vec3 env = studio(r);
  float shininess = vSurface.y;
  float highKey = pow(max(dot(n, normalize(uKey + v)), 0.0), shininess);
  float highFill = pow(max(dot(n, normalize(uFill + v)), 0.0), shininess);
  float highRim = pow(max(dot(n, normalize(uRim + v)), 0.0), shininess);
  vec3 highlight = KEY_COLOR * highKey * 1.8 + FILL_COLOR * highFill * 0.7 + RIM_COLOR * highRim * 0.9;
  float fresnel = pow(1.0 - ndv, 5.0);

  vec3 base = vBase;
  vec3 dial = texture2D(uDial, vUv).rgb;
  float kind = vSurface.w;
  if (kind > 0.5 && kind < 1.5) base *= dial * dial;
  if (kind > 1.5) base *= mix(1.0, 0.42, vUv.x * vUv.x);

  // Metal: the studio and the lights, coloured by the metal, white at a grazing angle.
  vec3 reflectance = base + (1.0 - base) * fresnel;
  float lit = max(dot(n, uKey), 0.0);
  vec3 metal = reflectance * (env * vSurface.z + highlight) + base * 0.07 * lit;
  // Glaze, glass and crema: their own colour lit by the key and the fill, under a clear coat.
  float coat = (0.04 + 0.96 * fresnel) * vSurface.z;
  vec3 diffuse = base * (0.08 + KEY_COLOR * lit * 0.85 + FILL_COLOR * max(dot(n, uFill), 0.0) * 0.3);
  vec3 dielectric = diffuse * (1.0 - coat) + env * coat + highlight * 0.55;
  vec3 color = mix(dielectric, metal, vSurface.x);

  color = vec3(1.0) - exp(-color * 1.35);
  color = pow(color, vec3(1.0 / 2.2));
  color = mix(color, uPage, smoothstep(uFog.x, uFog.y, distance) * uFog.z);
  color = mix(color, uPage, uFade);
  gl_FragColor = vec4(color, 1.0);
}
`;

interface Surface {
  /** A metal's reflectance, or a glaze's colour (linear). */
  base: readonly [number, number, number];
  /** 1 a metal, 0 not. */
  metal: number;
  /** How tight its highlights are. */
  shininess: number;
  /** How much of the studio it reflects. */
  reflect: number;
  /** 0 plain, 1 the dial's texture, 2 the crema, darker toward the cup's wall. */
  kind: number;
}

/** The shader's materials, in MATERIAL's order (0, the pipe's own metal, is never drawn as itself). */
const SURFACES: readonly Surface[] = [
  { base: [0.5, 0.5, 0.5], metal: 1, shininess: 80, reflect: 1, kind: 0 },
  // Polished copper, brass, chrome, and a dark anodised one.
  { base: [0.97, 0.47, 0.25], metal: 1, shininess: 90, reflect: 1, kind: 0 },
  { base: [0.94, 0.73, 0.33], metal: 1, shininess: 80, reflect: 1, kind: 0 },
  { base: [0.66, 0.67, 0.7], metal: 1, shininess: 160, reflect: 1.1, kind: 0 },
  { base: [0.25, 0.25, 0.28], metal: 1, shininess: 60, reflect: 1, kind: 0 },
  // Porcelain, the crema, the gauge's face under its glass.
  { base: [0.78, 0.76, 0.72], metal: 0, shininess: 120, reflect: 0.9, kind: 0 },
  { base: [0.5, 0.27, 0.11], metal: 0, shininess: 40, reflect: 0.35, kind: 2 },
  { base: [0.95, 0.95, 0.95], metal: 0, shininess: 220, reflect: 1, kind: 1 },
];

const METAL_MATERIAL: Record<Metal, number> = {
  copper: MATERIAL.copper,
  brass: MATERIAL.brass,
  chrome: MATERIAL.chrome,
  anodised: MATERIAL.anodised,
};

/** The lights' hot spots, toward them: the key in front on the left and up, the fill on the right, the rim behind and low; the studio's softboxes are round them. */
const KEY_DIR = unit([-0.74, 0.36, 0.58]);
const FILL_DIR = unit([0.86, 0.15, 0.49]);
const RIM_DIR = unit([0.1, 0.18, -0.98]);

/** The camera: in front of the grid's middle and a little above, looking a little down. */
const EYE: Vec3 = [0, 3.4, 19];
const TARGET: Vec3 = [0, -0.5, 0];
/** How much of the grid's middle plane the screen shows, at most, across its shorter fit. */
const COVER = 0.92;
/** Fog: none in front, most of the way to the page at the back. */
const FOG_MOST = 0.9;

/** The dial's texture: square, a power of two for its mipmaps. */
const DIAL_SIZE = 256;
const FAMILY = '"Figtree", system-ui, sans-serif';

type Vec3 = [number, number, number];

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Column-major 4 by 4: a perspective projection. */
function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** Column-major 4 by 4: the view from `eye` toward `target`, y up. */
function lookAt(eye: Vec3, target: Vec3): Float32Array {
  const z = unit([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = unit([z[2], 0, -z[0]]);
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const dot = (a: Vec3) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** The gauge's face, drawn once: 0 to 16 bar, the espresso band in the pressure green, the needle near 9. */
export function paintDial(dial: HTMLCanvasElement): void {
  const ctx = dial.getContext('2d');
  if (!ctx) return;
  const size = dial.width;
  const c = size / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Outside the face, seen only at its very edge: the bezel's shadow.
  ctx.fillStyle = '#25211d';
  ctx.fillRect(0, 0, size, size);
  const face = ctx.createRadialGradient(c, c * 0.8, size * 0.04, c, c, c);
  face.addColorStop(0, '#f3ecdf');
  face.addColorStop(0.72, '#e6dccb');
  face.addColorStop(0.93, '#cfc4b0');
  face.addColorStop(1, '#968c7b');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.99, 0, Math.PI * 2);
  ctx.fill();

  // 0 bar at the lower left, round over the top to 16 at the lower right; canvas angles run clockwise.
  const angle = (bar: number) => -((225 - (270 * bar) / 16) * Math.PI) / 180;
  const point = (bar: number, radius: number): [number, number] => [c + radius * Math.cos(angle(bar)), c + radius * Math.sin(angle(bar))];

  ctx.lineCap = 'butt';
  ctx.strokeStyle = oklch(0.56, 0.14, 160);
  ctx.lineWidth = size * 0.055;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.71, angle(8), angle(10));
  ctx.stroke();
  ctx.strokeStyle = oklch(0.55, 0.17, 27);
  ctx.beginPath();
  ctx.arc(c, c, c * 0.71, angle(13), angle(16));
  ctx.stroke();

  ctx.strokeStyle = '#2b2622';
  for (let bar = 0; bar <= 16; bar += 0.5) {
    const whole = bar % 1 === 0;
    const major = bar % 2 === 0;
    ctx.lineWidth = size * (major ? 0.016 : whole ? 0.01 : 0.006);
    const [x0, y0] = point(bar, c * (major ? 0.68 : whole ? 0.73 : 0.76));
    const [x1, y1] = point(bar, c * 0.82);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.fillStyle = '#2b2622';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(size * 0.11)}px ${FAMILY}`;
  for (const bar of [0, 4, 8, 12, 16]) {
    const [x, y] = point(bar, c * 0.52);
    ctx.fillText(String(bar), x, y);
  }
  ctx.font = `600 ${Math.round(size * 0.075)}px ${FAMILY}`;
  ctx.fillStyle = '#5a5249';
  ctx.fillText('BAR', c, c + c * 0.42);

  // The needle, just past 9 bar, and its hub.
  const needle = angle(9.1);
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(needle);
  ctx.fillStyle = '#c1352a';
  ctx.beginPath();
  ctx.moveTo(-c * 0.16, -size * 0.022);
  ctx.lineTo(c * 0.8, -size * 0.005);
  ctx.lineTo(c * 0.8, size * 0.005);
  ctx.lineTo(-c * 0.16, size * 0.022);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#1f1b18';
  ctx.beginPath();
  ctx.arc(c, c, size * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8f8a83';
  ctx.beginPath();
  ctx.arc(c, c, size * 0.018, 0, Math.PI * 2);
  ctx.fill();

  // The glass over it: a soft crescent of light high on the left, where the key light is (every dial faces the camera).
  const glint = ctx.createLinearGradient(c * 0.3, c * 0.3, c * 0.9, c * 0.9);
  glint.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glint;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.94, Math.PI * 0.98, Math.PI * 1.6);
  ctx.arc(c * 1.16, c * 1.18, c * 0.98, Math.PI * 1.52, Math.PI * 1.06, true);
  ctx.closePath();
  ctx.fill();
}

function webgl(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  const attributes: WebGLContextAttributes = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  };
  try {
    const gl = canvas.getContext('webgl', attributes) ?? (canvas.getContext('experimental-webgl', attributes) as WebGLRenderingContext | null);
    return gl && !gl.isContextLost() ? gl : null;
  } catch {
    return null;
  }
}

/** The program everything is drawn with; one that will not build lets go of what it made, and throws. */
function buildProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  try {
    if (!program || !vertexShader || !fragmentShader) throw new Error(LOST);
    for (const [shader, source] of [
      [vertexShader, VERTEX_SHADER],
      [fragmentShader, FRAGMENT_SHADER],
    ] as const) {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Espresso Pipes' shader did not compile: ${gl.getShaderInfoLog(shader) ?? ''}`);
      }
      gl.attachShader(program, shader);
    }
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.bindAttribLocation(program, 1, 'aNormal');
    gl.bindAttribLocation(program, 2, 'aUv');
    gl.bindAttribLocation(program, 3, 'aMaterial');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Espresso Pipes' shaders did not link: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    // Linked (or not), the shaders are not needed on their own.
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }
}

/** A chunk's buffers, and how much of it is on the GPU. */
interface GpuChunk {
  vertexBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  /** The buffers' sizes, in floats and indices, and how many vertices and indices are uploaded. */
  vertexRoom: number;
  indexRoom: number;
  vertices: number;
  indices: number;
}

/** The meshes drawn one at a time with a matrix of their own: their place in one shared buffer. */
interface Piece {
  first: number;
  count: number;
}

export const pipes: CanvasSaver = {
  id: 'pipes',
  label: 'Espresso Pipes',
  context: 'webgl',
  create(canvas, env) {
    const found = webgl(canvas);
    if (!found) return null;
    const gl: WebGLRenderingContext = found;
    // Built first: should it fail, there is nothing else to let go of.
    const program = buildProgram(gl);
    let lost = false;
    let disposed = false;
    const onLost = () => {
      lost = true;
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const wide = gl.getExtension('OES_element_index_uint') !== null;
    const geometry: ChunkedGeometry = createChunkedGeometry(wide);
    const meshes = buildMeshes();
    const page = parseHex(env.palette.background).map((byte) => byte / 255) as Vec3;

    const where = (name: string) => gl.getUniformLocation(program, name);
    const uniforms = {
      viewProjection: where('uViewProjection'),
      model: where('uModel'),
      normalMatrix: where('uNormalMatrix'),
      metal: where('uMetal'),
      camera: where('uCamera'),
      page: where('uPage'),
      fade: where('uFade'),
      fog: where('uFog'),
      dial: where('uDial'),
    };
    gl.useProgram(program);
    gl.uniform3fv(where('uBase'), new Float32Array(SURFACES.flatMap((surface) => [...surface.base])));
    gl.uniform4fv(where('uSurface'), new Float32Array(SURFACES.flatMap((surface) => [surface.metal, surface.shininess, surface.reflect, surface.kind])));
    gl.uniform3fv(where('uKey'), new Float32Array(KEY_DIR));
    gl.uniform3fv(where('uFill'), new Float32Array(FILL_DIR));
    gl.uniform3fv(where('uRim'), new Float32Array(RIM_DIR));
    gl.uniform3fv(uniforms.camera, new Float32Array(EYE));
    gl.uniform3fv(uniforms.page, new Float32Array(page));
    gl.uniform1i(uniforms.dial, 0);

    // The meshes drawn with a matrix each, in one buffer.
    const pieceVertices = Object.values(meshes).reduce((sum, mesh) => sum + mesh.vertexCount, 0);
    const pieceData = new Float32Array(pieceVertices * FLOATS_PER_VERTEX);
    const pieceIndices = new Uint16Array(Object.values(meshes).reduce((sum, mesh) => sum + mesh.indices.length, 0));
    let vertexAt = 0;
    let indexAt = 0;
    const place = (mesh: Mesh): Piece => {
      pieceData.set(mesh.vertices, vertexAt * FLOATS_PER_VERTEX);
      for (let i = 0; i < mesh.indices.length; i += 1) pieceIndices[indexAt + i] = vertexAt + mesh.indices[i]!;
      const piece = { first: indexAt, count: mesh.indices.length };
      vertexAt += mesh.vertexCount;
      indexAt += mesh.indices.length;
      return piece;
    };
    const pieces = { tip: place(meshes.tip), ball: place(meshes.ball), gauge: place(meshes.gauge), wheel: place(meshes.wheel), cup: place(meshes.cup) };
    const pieceVertexBuffer = gl.createBuffer();
    const pieceIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pieceVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, pieceData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pieceIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pieceIndices, gl.STATIC_DRAW);

    // The dial, drawn on a canvas once and again when Figtree is in.
    const dialCanvas = canvas.ownerDocument.createElement('canvas');
    dialCanvas.width = DIAL_SIZE;
    dialCanvas.height = DIAL_SIZE;
    const dialTexture = gl.createTexture();
    const uploadDial = () => {
      paintDial(dialCanvas);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dialTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dialCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
    };
    uploadDial();
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts
        .load(`700 28px ${FAMILY}`, '0123456789 BAR')
        .then(() => {
          if (!disposed && !lost && !gl.isContextLost()) uploadDial();
        })
        .catch(() => undefined);
    }

    let model: PipesModel = createPipesModel(env.seed);
    let width = 0;
    let height = 0;
    let viewProjection: Float32Array = new Float32Array(16);
    const gpuChunks: GpuChunk[] = [];
    /** The layout built so far, the parts of it built, and its joints still growing in. */
    let builtLayout = -1;
    let builtModel: PipesModel | null = null;
    let builtParts = 0;
    let growingJoints: JointPart[] = [];
    const matrix = new Float32Array(16);
    const normalMatrix = new Float32Array(9);
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const identity3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    const centre: Vec3 = [(model.grid.x - 1) / 2, (model.grid.y - 1) / 2, (model.grid.z - 1) / 2];
    const world = (cell: Cell): Vec3 => [cell[0] - centre[0], cell[1] - centre[1], cell[2] - centre[2]];
    const eyeDistance = Math.hypot(EYE[0] - TARGET[0], EYE[1] - TARGET[1], EYE[2] - TARGET[2]);
    gl.uniform3fv(uniforms.fog, new Float32Array([eyeDistance - model.grid.z * 0.45, eyeDistance + model.grid.z * 0.5, FOG_MOST]));

    /** The joint's ball and its fitting, as big as they have grown. */
    const jointPlacements = (joint: JointPart, age: number): { ball: Placement; fitting: Placement | null } => {
      const at = world(joint.at);
      const from = joint.start ? 0 : (PIPE_RADIUS / BALL_RADIUS) * 1.04;
      const ball = placeAt(at, from + (1 - from) * jointGrowth(age));
      if (joint.fitting === 'ball') return { ball, fitting: null };
      const grown = jointGrowth(age, FITTING_GROW_MS);
      const handle = STEPS[joint.handle]!;
      return { ball, fitting: placeAt(at, grown, joint.fitting === 'cup' ? [handle[0], handle[1], handle[2]] : [1, 0, 0]) };
    };

    const fittingMesh = (joint: JointPart): Mesh | null =>
      joint.fitting === 'gauge' ? meshes.gauge : joint.fitting === 'wheel' ? meshes.wheel : joint.fitting === 'cup' ? meshes.cup : null;
    const fittingPiece = (joint: JointPart): Piece | null =>
      joint.fitting === 'gauge' ? pieces.gauge : joint.fitting === 'wheel' ? pieces.wheel : joint.fitting === 'cup' ? pieces.cup : null;
    const grownAfter = (joint: JointPart) => (joint.fitting === 'ball' ? JOINT_GROW_MS : Math.max(JOINT_GROW_MS, FITTING_GROW_MS));

    /** Builds what the model has finished since the last frame; a new layout (or a new model) starts the buffers over. */
    const build = () => {
      if (builtModel !== model || builtLayout !== model.layout) {
        geometry.clear();
        for (const gpu of gpuChunks) {
          gpu.vertices = 0;
          gpu.indices = 0;
        }
        builtModel = model;
        builtLayout = model.layout;
        builtParts = 0;
        growingJoints = [];
      }
      const parts = model.parts;
      for (; builtParts < parts.length; builtParts += 1) {
        const part = parts[builtParts]!;
        if (part.kind === 'run') {
          const step = STEPS[part.direction]!;
          geometry.add(meshes.run, placeAlong([step[0], step[1], step[2]], world(part.from), part.length), METAL_MATERIAL[part.metal]);
        } else {
          growingJoints.push(part);
        }
      }
      // A joint grown to its size joins the buffers.
      growingJoints = growingJoints.filter((joint) => {
        const age = model.layoutTime - joint.born;
        if (age < grownAfter(joint)) return true;
        const placed = jointPlacements(joint, age);
        geometry.add(meshes.ball, placed.ball, METAL_MATERIAL[joint.metal]);
        const mesh = fittingMesh(joint);
        if (mesh && placed.fitting) geometry.add(mesh, placed.fitting, METAL_MATERIAL[joint.metal]);
        return false;
      });
    };

    /** Sends the GPU what it does not have yet: the new part of each chunk, or the whole chunk where it outgrew its buffer. */
    const upload = () => {
      const chunks = geometry.chunks;
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]!;
        let gpu = gpuChunks[i];
        if (!gpu) {
          const vertexBuffer = gl.createBuffer();
          const indexBuffer = gl.createBuffer();
          if (!vertexBuffer || !indexBuffer) throw new Error(LOST);
          gpu = { vertexBuffer, indexBuffer, vertexRoom: 0, indexRoom: 0, vertices: 0, indices: 0 };
          gpuChunks.push(gpu);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vertexBuffer);
        if (chunk.vertices.length > gpu.vertexRoom) {
          gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.DYNAMIC_DRAW);
          gpu.vertexRoom = chunk.vertices.length;
          gpu.vertices = chunk.vertexCount;
        } else if (chunk.vertexCount > gpu.vertices) {
          gl.bufferSubData(gl.ARRAY_BUFFER, gpu.vertices * FLOATS_PER_VERTEX * 4, chunk.vertices.subarray(gpu.vertices * FLOATS_PER_VERTEX, chunk.vertexCount * FLOATS_PER_VERTEX));
          gpu.vertices = chunk.vertexCount;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indexBuffer);
        if (chunk.indices.length > gpu.indexRoom) {
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.indices, gl.DYNAMIC_DRAW);
          gpu.indexRoom = chunk.indices.length;
          gpu.indices = chunk.indexCount;
        } else if (chunk.indexCount > gpu.indices) {
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, gpu.indices * chunk.indices.BYTES_PER_ELEMENT, chunk.indices.subarray(gpu.indices, chunk.indexCount));
          gpu.indices = chunk.indexCount;
        }
      }
    };

    const bindVertices = (buffer: WebGLBuffer | null) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = FLOATS_PER_VERTEX * 4;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
    };

    const drawPiece = (piece: Piece, placement: Placement, metal: number) => {
      placementMatrix(placement, matrix, normalMatrix);
      gl.uniformMatrix4fv(uniforms.model, false, matrix);
      gl.uniformMatrix3fv(uniforms.normalMatrix, false, normalMatrix);
      gl.uniform1f(uniforms.metal, metal);
      gl.drawElements(gl.TRIANGLES, piece.count, gl.UNSIGNED_SHORT, piece.first * 2);
    };

    const check = () => {
      if (lost || gl.isContextLost()) {
        lost = true;
        throw new Error(LOST);
      }
    };

    const draw = () => {
      check();
      if (width <= 0 || height <= 0) return;
      build();
      upload();
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(page[0], page[1], page[2], 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (model.fade >= 1) return;
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.viewProjection, false, viewProjection);
      gl.uniform1f(uniforms.fade, model.fade);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dialTexture);
      for (let i = 0; i < 4; i += 1) gl.enableVertexAttribArray(i);

      // The finished parts, already in place.
      gl.uniformMatrix4fv(uniforms.model, false, identity);
      gl.uniformMatrix3fv(uniforms.normalMatrix, false, identity3);
      gl.uniform1f(uniforms.metal, 0);
      const chunks = geometry.chunks;
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]!;
        const gpu = gpuChunks[i]!;
        if (chunk.indexCount === 0) continue;
        bindVertices(gpu.vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indexBuffer);
        gl.drawElements(gl.TRIANGLES, chunk.indexCount, wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      }

      // The runs growing now, and the joints growing in.
      bindVertices(pieceVertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pieceIndexBuffer);
      for (const run of model.growing) {
        const step = STEPS[run.direction]!;
        drawPiece(pieces.tip, placeAlong([step[0], step[1], step[2]], world(run.from), run.length), METAL_MATERIAL[run.metal]);
      }
      for (const joint of growingJoints) {
        const placed = jointPlacements(joint, model.layoutTime - joint.born);
        drawPiece(pieces.ball, placed.ball, METAL_MATERIAL[joint.metal]);
        const piece = fittingPiece(joint);
        if (piece && placed.fitting) drawPiece(piece, placed.fitting, METAL_MATERIAL[joint.metal]);
      }
    };

    const instance: SaverInstance = {
      step(dtMs) {
        check();
        model.step(dtMs);
      },
      draw,
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        if (width <= 0 || height <= 0) return;
        const aspect = width / height;
        // The grid's middle plane covers the screen: as much of it as the screen's shape allows.
        const halfHeight = Math.min(model.grid.y / 2, model.grid.x / 2 / aspect) * COVER;
        const fovY = 2 * Math.atan(halfHeight / eyeDistance);
        // Near and far well clear of the grid (nothing comes nearer than its front), for the depth's precision where it has only 16 bits.
        viewProjection = multiply(perspective(fovY, aspect, Math.max(1, eyeDistance - model.grid.z), eyeDistance + model.grid.z * 2), lookAt(EYE, TARGET));
      },
      still() {
        check();
        model = growForStill(env.seed);
        draw();
      },
      dispose() {
        disposed = true;
        canvas.removeEventListener('webglcontextlost', onLost);
        for (const gpu of gpuChunks) {
          gl.deleteBuffer(gpu.vertexBuffer);
          gl.deleteBuffer(gpu.indexBuffer);
        }
        gpuChunks.length = 0;
        gl.deleteBuffer(pieceVertexBuffer);
        gl.deleteBuffer(pieceIndexBuffer);
        gl.deleteTexture(dialTexture);
        gl.deleteProgram(program);
        geometry.clear();
        growingJoints = [];
        dialCanvas.width = 0;
        dialCanvas.height = 0;
      },
    };
    return instance;
  },
};
