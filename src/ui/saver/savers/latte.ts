/**
 * Latte Art (D228, D-LATTE-1 to D-LATTE-4): a cup from straight above, on
 * its saucer, lit from the upper left, and an unseen pitcher pouring a heart,
 * a tulip, a rosetta and a swan in turn, each admired for a while before the
 * cup clears for the next. The pour and the surface are latteModel.ts; this
 * file draws them.
 *
 * The porcelain (the saucer and its shadow, the handle, the cup's lip and
 * inner wall, the rim's shadow on the coffee, the sheen) is drawn once a
 * size into two layers, one under the coffee and one over its edge, and the
 * names under the cup once each. A frame lays the crema (its tone through a
 * smooth ramp, darker at the wall) and the foam (ivory, a thin brown line
 * where it meets the crema) on two small canvases, scaled up smoothly to the
 * cup, and the stream's small disturbance where it lands. The whole picture
 * drifts a few pixels a minute, so nothing bright sits still for long.
 */
import { hexToOklab, mixOklab, oklabToRgb, oklch, type Oklab } from '../../color.ts';
import type { Palette } from '../../palette.ts';
import type { CanvasSaver, SaverEnv, SaverInstance } from '../types.ts';
import { CHOREOGRAPHIES, type PitcherState, type PourId } from './latteChoreo.ts';
import { createLatteModel, GRID, lowness, pourWhole, TONE_GRID, type LatteModel, type LattePhase, type LatteSurface } from './latteModel.ts';

/**
 * The still is this pour, finished (D228's first, and the one that reads at a
 * glance), poured in steps of a fifth of a second: the same heart for a third
 * of the work, which a slow tablet does in one go before it paints.
 */
const STILL_POUR: PourId = 'heart';
const STILL_HZ = 5;

/** The light comes from the upper left: the way toward it, on the screen. */
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;

/** The drift (D-LATTE-3): how far the picture wanders (design px) and how slowly (seconds a sway). */
const DRIFT_X = 12;
const DRIFT_Y = 8;
const DRIFT_X_S = 900;
const DRIFT_Y_S = 1160;

/** The name fades in over this long as a pour starts (seconds). */
const NAME_IN_S = 1.6;

// Colours. The crema runs from its lightest to its darkest streaks; the wall's ring is darker still.
const CREMA_STOPS: ReadonlyArray<readonly [at: number, color: string]> = [
  [0, oklch(0.72, 0.1, 70)],
  [0.42, oklch(0.63, 0.11, 60)],
  [0.72, oklch(0.53, 0.1, 52)],
  [1, oklch(0.44, 0.085, 46)],
];
const CREMA_WALL = oklch(0.38, 0.07, 44);
/** The line where the foam meets the crema, and the foam, thin at its edge and thick inside. */
const FOAM_LINE = oklch(0.42, 0.075, 50);
const FOAM_THIN = oklch(0.86, 0.042, 80);
const FOAM_THICK = oklch(0.945, 0.022, 87);
/** The window's light falls a little brighter on the upper left of the cup than on the lower right: this much either way. */
const SURFACE_LIGHT = 0.05;
/** Porcelain, a warm white glaze: in the light, between, in shade, and deep in shade. */
const GLAZE_LIT = oklch(0.95, 0.012, 85);
const GLAZE_MID = oklch(0.8, 0.014, 78);
const GLAZE_SHADE = oklch(0.6, 0.016, 70);
const GLAZE_DEEP = oklch(0.4, 0.016, 62);

/** The foam is coloured twice as fine as its grid, so its edges come out smooth. */
const FOAM_FINE = GRID * 2;
/** The light on the foam (the window's, and its edges' bevel) in this many steps from LIFT_LOW to LIFT_HIGH: fine enough that no step shows. */
const LIFT_LEVELS = 64;
const LIFT_LOW = 0.78;
const LIFT_HIGH = 1.22;

/** How much the foam's edges are lit or shaded by the way they face, and the soft shadow it casts on the crema (how dark, how far in foam cells). */
const FOAM_BEVEL = 0.12;
const FOAM_SHADOW = 0.16;
const FOAM_SHADOW_REACH = 3;

/** Where the foam's value turns from crema to the line, and from the line to white. */
const LINE_FROM = 0.08;
const LINE_FULL = 0.28;
const WHITE_FROM = 0.4;
const WHITE_FULL = 0.58;

function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = oklabToRgb(hexToOklab(hex));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A ramp through colour stops, mixed in OKLab, as bytes: `size` entries of r, g, b. */
function ramp(stops: ReadonlyArray<readonly [number, string]>, size: number): Uint8ClampedArray {
  const labs: Array<readonly [number, Oklab]> = stops.map(([at, color]) => [at, hexToOklab(color)]);
  const out = new Uint8ClampedArray(size * 3);
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    let k = 1;
    while (k < labs.length - 1 && labs[k]![0] < t) k += 1;
    const [from, a] = labs[k - 1]!;
    const [to, b] = labs[k]!;
    const [red, green, blue] = oklabToRgb(mixOklab(a, b, (t - from) / Math.max(1e-6, to - from)));
    out[i * 3] = red;
    out[i * 3 + 1] = green;
    out[i * 3 + 2] = blue;
  }
  return out;
}

/** Where everything goes, in CSS px, before the drift. */
interface Layout {
  unit: number;
  cx: number;
  cy: number;
  /** The coffee's radius; the lip's inside and outside; the saucer's. */
  coffee: number;
  lipIn: number;
  lipOut: number;
  saucer: number;
  /** The handle's direction (radians from the right, clockwise) and its reach past the lip. */
  handleAngle: number;
  handleReach: number;
  /** The name's baseline and size. */
  nameY: number;
  nameSize: number;
}

function layoutFor(width: number, height: number): Layout {
  const unit = Math.max(0.1, Math.min(width / 962, height / 602));
  const coffee = 148 * unit;
  const lipIn = coffee * 1.06;
  const lipOut = lipIn + 16 * unit;
  const saucer = 250 * unit;
  const cy = height * 0.465;
  return {
    unit,
    cx: width / 2,
    cy,
    coffee,
    lipIn,
    lipOut,
    saucer,
    handleAngle: 0.32,
    handleReach: 58 * unit,
    nameY: Math.min(height - 16 * unit, cy + saucer + 38 * unit),
    nameSize: 17 * unit,
  };
}

/** What a frame shows: the surface (and which version of it), the moment, the pour and its phase, and the stream if it pours. */
interface Shown {
  surface: LatteSurface;
  version: number;
  time: number;
  phase: LattePhase;
  phaseTime: number;
  pour: PourId;
  foamShown: number;
  stream: PitcherState | null;
}

/** Lets a canvas's pixels go. */
function release(made: HTMLCanvasElement | null | undefined): void {
  if (!made) return;
  made.width = 0;
  made.height = 0;
}

/** A canvas of its own, `width` by `height` CSS px at `scale`, drawn in CSS px. */
function layer(doc: Document, width: number, height: number, scale: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const made = doc.createElement('canvas');
  made.width = Math.max(1, Math.ceil(width * scale));
  made.height = Math.max(1, Math.ceil(height * scale));
  const context = made.getContext('2d');
  if (!context) return null;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  return [made, context];
}

/** A light-to-shade gradient across a circle, along the light. */
function across(context: CanvasRenderingContext2D, x: number, y: number, radius: number, lit: string, shade: string): CanvasGradient {
  const gradient = context.createLinearGradient(x + LIGHT_X * radius, y + LIGHT_Y * radius, x - LIGHT_X * radius, y - LIGHT_Y * radius);
  gradient.addColorStop(0, lit);
  gradient.addColorStop(1, shade);
  return gradient;
}

/**
 * A highlight along an arc, centred on `angle`, fading out toward both ends
 * (a gradient along its chord: Chromium 91 has no conic gradients), and
 * softened by `blur` device pixels.
 */
function glint(context: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, spread: number, width: number, color: string, strength: number, blur: number): void {
  const gradient = context.createLinearGradient(
    x + radius * Math.cos(angle - spread),
    y + radius * Math.sin(angle - spread),
    x + radius * Math.cos(angle + spread),
    y + radius * Math.sin(angle + spread),
  );
  gradient.addColorStop(0, rgba(color, 0));
  gradient.addColorStop(0.5, rgba(color, strength));
  gradient.addColorStop(1, rgba(color, 0));
  context.save();
  if (blur > 0) {
    context.shadowColor = rgba(color, 1);
    context.shadowBlur = blur;
  }
  context.strokeStyle = gradient;
  context.lineWidth = width;
  context.lineCap = 'butt';
  context.beginPath();
  context.arc(x, y, radius, angle - spread, angle + spread);
  context.stroke();
  context.restore();
}

/** The handle's outline from above: the top of its loop, flaring into the cup's side and rounded at its end. */
function traceHandle(context: CanvasRenderingContext2D, at: Layout, x: number, y: number): void {
  const { unit, handleAngle: angle, lipOut, handleReach } = at;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = (d: number, side: number): [number, number] => [x + cos * d - sin * side, y + sin * d + cos * side];
  const root = lipOut - 8 * unit;
  const end = lipOut + handleReach;
  const flare = 19 * unit;
  const half = 11.5 * unit;
  context.moveTo(...along(root, -flare));
  context.quadraticCurveTo(...along(lipOut + 6 * unit, -half), ...along(lipOut + 18 * unit, -half));
  context.lineTo(...along(end - half, -half));
  context.arc(...along(end - half, 0), half, angle - Math.PI / 2, angle + Math.PI / 2);
  context.lineTo(...along(lipOut + 18 * unit, half));
  context.quadraticCurveTo(...along(lipOut + 6 * unit, half), ...along(root, flare));
  context.closePath();
}

/** Under the coffee: the saucer and its shadow on the table, the cup's shadow on the saucer, and the handle. */
function paintUnder(doc: Document, at: Layout, scale: number): HTMLCanvasElement | null {
  const margin = 70 * at.unit;
  const size = 2 * (at.saucer + margin);
  const made = layer(doc, size, size, scale);
  if (!made) return null;
  const [canvas, context] = made;
  const x = size / 2;
  const y = size / 2;
  const { unit, saucer } = at;
  const toLight = Math.atan2(LIGHT_Y, LIGHT_X);
  const disc = (radius: number) => {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
  };
  const ring = (outer: number, inner: number) => {
    context.beginPath();
    context.arc(x, y, outer, 0, Math.PI * 2);
    context.arc(x, y, inner, 0, Math.PI * 2, true);
  };

  // The saucer's shadow on the table, soft and to the lower right.
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.65)';
  context.shadowBlur = 36 * unit * scale;
  context.shadowOffsetX = 12 * unit * scale;
  context.shadowOffsetY = 16 * unit * scale;
  disc(saucer);
  context.fillStyle = GLAZE_DEEP;
  context.fill();
  context.restore();

  // The saucer's glaze, lit from the upper left and falling off toward the lower right.
  disc(saucer);
  context.fillStyle = across(context, x, y, saucer, GLAZE_LIT, GLAZE_SHADE);
  context.fill();
  // Its slope up from the well faces away from the light on the upper left, and on the lower right
  // toward it: the window's soft reflection lies there.
  const slopeAt = (at.lipOut * 1.15 + saucer * 0.88) / 2;
  const shade = context.createRadialGradient(x + LIGHT_X * slopeAt, y + LIGHT_Y * slopeAt, 0, x + LIGHT_X * slopeAt, y + LIGHT_Y * slopeAt, saucer * 0.55);
  shade.addColorStop(0, 'rgba(40, 26, 14, 0.22)');
  shade.addColorStop(1, 'rgba(40, 26, 14, 0)');
  ring(saucer * 0.88, at.lipOut);
  context.fillStyle = shade;
  context.fill();
  const reflection = context.createRadialGradient(x - LIGHT_X * slopeAt, y - LIGHT_Y * slopeAt, 0, x - LIGHT_X * slopeAt, y - LIGHT_Y * slopeAt, saucer * 0.5);
  reflection.addColorStop(0, 'rgba(255, 251, 244, 0.42)');
  reflection.addColorStop(0.5, 'rgba(255, 251, 244, 0.12)');
  reflection.addColorStop(1, 'rgba(255, 251, 244, 0)');
  ring(saucer * 0.88, at.lipOut);
  context.fillStyle = reflection;
  context.fill();
  // The rim rolling over at the edge: lit on the upper left, in shade on the lower right, darker at the very edge.
  ring(saucer, saucer * 0.88);
  context.fillStyle = across(context, x, y, saucer, 'rgba(255, 251, 244, 0.35)', 'rgba(30, 18, 8, 0.35)');
  context.fill();
  const roll = context.createRadialGradient(x, y, saucer * 0.88, x, y, saucer);
  roll.addColorStop(0, 'rgba(30, 18, 8, 0.12)');
  roll.addColorStop(0.45, 'rgba(255, 251, 244, 0.1)');
  roll.addColorStop(1, 'rgba(30, 18, 8, 0.45)');
  ring(saucer, saucer * 0.88);
  context.fillStyle = roll;
  context.fill();
  glint(context, x, y, saucer * 0.93, toLight, 0.85, 4.5 * unit, '#ffffff', 0.95, 5 * unit * scale);
  glint(context, x, y, saucer * 0.9, toLight + Math.PI, 0.6, 3 * unit, '#fffaf2', 0.4, 4 * unit * scale);
  // A cool rim light on the far edge.
  glint(context, x, y, saucer * 0.988, toLight + Math.PI, 0.55, 2 * unit, '#dfe8f2', 0.35, 3 * unit * scale);

  // The cup's shadow and the handle's, soft, to the lower right; and the dark where the cup meets the saucer.
  context.save();
  context.shadowColor = 'rgba(30, 18, 8, 0.6)';
  context.shadowBlur = 22 * unit * scale;
  context.shadowOffsetX = 10 * unit * scale;
  context.shadowOffsetY = 13 * unit * scale;
  context.fillStyle = GLAZE_SHADE;
  disc(at.lipOut);
  traceHandle(context, at, x, y);
  context.fill();
  context.restore();
  const contact = context.createRadialGradient(x, y, at.lipOut * 0.98, x, y, at.lipOut * 1.16);
  contact.addColorStop(0, 'rgba(30, 18, 8, 0.4)');
  contact.addColorStop(1, 'rgba(30, 18, 8, 0)');
  ring(at.lipOut * 1.16, at.lipOut * 0.98);
  context.fillStyle = contact;
  context.fill();

  // The handle: round across, lit along its upper side, the glaze catching the light on top.
  const cos = Math.cos(at.handleAngle);
  const sin = Math.sin(at.handleAngle);
  const half = 12 * unit;
  context.beginPath();
  traceHandle(context, at, x, y);
  const middleX = x + cos * (at.lipOut + at.handleReach * 0.5);
  const middleY = y + sin * (at.lipOut + at.handleReach * 0.5);
  const handle = context.createLinearGradient(middleX + sin * half, middleY - cos * half, middleX - sin * half, middleY + cos * half);
  handle.addColorStop(0, GLAZE_MID);
  handle.addColorStop(0.3, GLAZE_LIT);
  handle.addColorStop(0.75, GLAZE_MID);
  handle.addColorStop(1, GLAZE_SHADE);
  context.fillStyle = handle;
  context.fill();
  // The loop's far end turns down, away from the light.
  const turn = context.createLinearGradient(
    x + cos * (at.lipOut + at.handleReach * 0.6),
    y + sin * (at.lipOut + at.handleReach * 0.6),
    x + cos * (at.lipOut + at.handleReach),
    y + sin * (at.lipOut + at.handleReach),
  );
  turn.addColorStop(0, 'rgba(30, 18, 8, 0)');
  turn.addColorStop(1, 'rgba(30, 18, 8, 0.3)');
  context.fillStyle = turn;
  context.fill();
  context.save();
  context.shadowColor = 'rgba(255, 255, 255, 0.9)';
  context.shadowBlur = 3 * unit * scale;
  context.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  context.lineWidth = 2.2 * unit;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(x + cos * (at.lipOut + 12 * unit) + sin * 5 * unit, y + sin * (at.lipOut + 12 * unit) - cos * 5 * unit);
  context.lineTo(x + cos * (at.lipOut + at.handleReach - 16 * unit) + sin * 5 * unit, y + sin * (at.lipOut + at.handleReach - 16 * unit) - cos * 5 * unit);
  context.stroke();
  context.restore();
  return canvas;
}

/** Over the coffee's edge: the inner wall, the lip, the rim's shadow on the coffee and the sheen; clear over the coffee. */
function paintOver(doc: Document, at: Layout, scale: number): HTMLCanvasElement | null {
  const margin = 6 * at.unit;
  const size = 2 * (at.lipOut + margin);
  const made = layer(doc, size, size, scale);
  if (!made) return null;
  const [canvas, context] = made;
  const x = size / 2;
  const y = size / 2;
  const { unit } = at;
  const ring = (outer: number, inner: number) => {
    context.beginPath();
    context.arc(x, y, outer, 0, Math.PI * 2);
    context.arc(x, y, inner, 0, Math.PI * 2, true);
  };

  // The rim's shadow on the coffee, along the upper left (inside the coffee only).
  context.save();
  context.beginPath();
  context.arc(x, y, at.coffee + 1, 0, Math.PI * 2);
  context.clip();
  context.shadowColor = 'rgba(25, 14, 6, 0.55)';
  context.shadowBlur = 12 * unit * scale;
  context.shadowOffsetX = 5 * unit * scale;
  context.shadowOffsetY = 7 * unit * scale;
  ring(at.coffee + 60 * unit, at.coffee + 1);
  context.fillStyle = '#000';
  context.fill();
  context.restore();

  // The sheen: the window's light, soft, on the upper left of the surface.
  context.save();
  context.translate(x - at.coffee * 0.34, y - at.coffee * 0.42);
  context.rotate(-0.65);
  context.scale(1, 0.55);
  const sheen = context.createRadialGradient(0, 0, 0, 0, 0, at.coffee * 0.62);
  sheen.addColorStop(0, 'rgba(255, 250, 240, 0.13)');
  sheen.addColorStop(0.6, 'rgba(255, 250, 240, 0.05)');
  sheen.addColorStop(1, 'rgba(255, 250, 240, 0)');
  context.fillStyle = sheen;
  context.beginPath();
  context.arc(0, 0, at.coffee * 0.62, 0, Math.PI * 2);
  context.fill();
  context.restore();

  // The inner wall, a thin band down to the coffee: in shade on the upper left, lit on the lower right.
  ring(at.lipIn, at.coffee);
  context.fillStyle = across(context, x, y, at.lipIn, GLAZE_DEEP, GLAZE_LIT);
  context.fill();
  // The meniscus, where the coffee meets the wall.
  context.lineWidth = 1.4 * unit;
  context.strokeStyle = rgba(CREMA_WALL, 0.6);
  context.beginPath();
  context.arc(x, y, at.coffee + 0.6 * unit, 0, Math.PI * 2);
  context.stroke();

  // The lip: lit from the upper left, rounded over on both sides.
  ring(at.lipOut, at.lipIn);
  context.fillStyle = across(context, x, y, at.lipOut, GLAZE_LIT, GLAZE_SHADE);
  context.fill();
  const round = context.createRadialGradient(x, y, at.lipIn, x, y, at.lipOut);
  round.addColorStop(0, rgba(GLAZE_DEEP, 0.4));
  round.addColorStop(0.3, rgba(GLAZE_DEEP, 0));
  round.addColorStop(0.65, rgba(GLAZE_DEEP, 0));
  round.addColorStop(1, rgba(GLAZE_DEEP, 0.55));
  ring(at.lipOut, at.lipIn);
  context.fillStyle = round;
  context.fill();
  // Its glaze catches the light: on the outside of the lip on the upper left, on its inside on the lower
  // right; and a cool rim light along the far edge.
  const toLight = Math.atan2(LIGHT_Y, LIGHT_X);
  const lipMiddle = (at.lipIn + at.lipOut) / 2;
  const lip = at.lipOut - at.lipIn;
  glint(context, x, y, lipMiddle + lip * 0.12, toLight, 0.95, lip * 0.32, '#ffffff', 0.95, 4 * unit * scale);
  glint(context, x, y, lipMiddle - lip * 0.18, toLight + Math.PI, 0.75, lip * 0.2, '#ffffff', 0.5, 3 * unit * scale);
  glint(context, x, y, at.lipOut - lip * 0.08, toLight + Math.PI, 0.6, lip * 0.12, '#dfe8f2', 0.35, 2 * unit * scale);
  context.lineWidth = 0.8 * unit;
  context.strokeStyle = rgba(GLAZE_DEEP, 0.55);
  context.beginPath();
  context.arc(x, y, at.lipOut - 0.4 * unit, 0, Math.PI * 2);
  context.stroke();
  return canvas;
}

/** A pour's name, small, in Figtree, in the page's muted ink. */
function paintName(doc: Document, text: string, palette: Palette, at: Layout, scale: number): HTMLCanvasElement | null {
  const width = 240 * at.unit;
  const height = at.nameSize * 2;
  const made = layer(doc, width, height, scale);
  if (!made) return null;
  const [canvas, context] = made;
  context.font = `500 ${at.nameSize}px Figtree, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = palette.inkMuted;
  context.fillText(text, width / 2, at.nameSize * 1.35);
  return canvas;
}

export const latte: CanvasSaver = {
  id: 'latte',
  label: 'Latte Art',
  context: '2d',
  create(canvas: HTMLCanvasElement, env: SaverEnv): SaverInstance | null {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    const doc = canvas.ownerDocument;
    const cremaLayer = layer(doc, TONE_GRID, TONE_GRID, 1);
    const foamLayer = layer(doc, FOAM_FINE, FOAM_FINE, 1);
    if (!cremaLayer || !foamLayer) return null;
    let [cremaCanvas, cremaContext]: [HTMLCanvasElement | null, CanvasRenderingContext2D | null] = cremaLayer;
    let [foamCanvas, foamContext]: [HTMLCanvasElement | null, CanvasRenderingContext2D | null] = foamLayer;
    let cremaImage: ImageData | null = cremaContext.createImageData(TONE_GRID, TONE_GRID);
    let foamImage: ImageData | null = foamContext.createImageData(FOAM_FINE, FOAM_FINE);
    let cremaPixels: Uint32Array | null = new Uint32Array(cremaImage.data.buffer);
    let foamPixels: Uint32Array | null = new Uint32Array(foamImage.data.buffer);

    // The crema's colours by tone, and how much of the wall's darker ring and the rim's shade each cell takes.
    const cremaRamp = ramp(CREMA_STOPS, 256);
    const [wallRed, wallGreen, wallBlue] = oklabToRgb(hexToOklab(CREMA_WALL));
    const toWall = new Float32Array(TONE_GRID * TONE_GRID);
    const cremaLight = new Float32Array(TONE_GRID * TONE_GRID);
    const cremaAlpha = new Uint8ClampedArray(TONE_GRID * TONE_GRID);
    for (let row = 0; row < TONE_GRID; row += 1) {
      for (let col = 0; col < TONE_GRID; col += 1) {
        const x = -1 + ((col + 0.5) * 2) / TONE_GRID;
        const y = -1 + ((row + 0.5) * 2) / TONE_GRID;
        const r = Math.hypot(x, y);
        toWall[row * TONE_GRID + col] = 0.75 * smooth(0.72, 1, r);
        cremaLight[row * TONE_GRID + col] = 1 + SURFACE_LIGHT * (x * LIGHT_X + y * LIGHT_Y);
        cremaAlpha[row * TONE_GRID + col] = r < 1.06 ? 255 : 0;
      }
    }
    // Pixels are written whole, as 32-bit words in the canvas's byte order (red first in memory).
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    const pack = (red: number, green: number, blue: number, alpha: number) =>
      (littleEndian ? (alpha << 24) | (blue << 16) | (green << 8) | red : (red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0;
    // The foam's colour and opacity by its value (the brown line, then the white, thin to thick), at each of
    // LIFT_LEVELS lights from LIFT_LOW to LIFT_HIGH: a pixel is one look-up.
    const foamPacked = new Uint32Array(LIFT_LEVELS * 256);
    {
      const line = hexToOklab(FOAM_LINE);
      const thin = hexToOklab(FOAM_THIN);
      const thick = hexToOklab(FOAM_THICK);
      for (let i = 0; i < 256; i += 1) {
        const f = i / 255;
        const white = smooth(WHITE_FROM, WHITE_FULL, f);
        const edge = smooth(LINE_FROM, LINE_FULL, f) * 0.78 * (1 - white);
        const alpha = white + edge;
        const milk = mixOklab(thin, thick, smooth(WHITE_FULL, 0.95, f));
        const [red, green, blue] = oklabToRgb(alpha > 0 ? mixOklab(line, milk, white / alpha) : line);
        for (let level = 0; level < LIFT_LEVELS; level += 1) {
          const lift = LIFT_LOW + ((LIFT_HIGH - LIFT_LOW) * level) / (LIFT_LEVELS - 1);
          const byte = (value: number) => Math.min(255, Math.round(value * lift));
          foamPacked[level * 256 + i] = alpha > 0 ? pack(byte(red), byte(green), byte(blue), Math.round(alpha * 255)) : 0;
        }
      }
    }
    const liftScale = (LIFT_LEVELS - 1) / (LIFT_HIGH - LIFT_LOW);
    const foamInside = new Uint8Array(GRID * GRID);
    const foamLight = new Float32Array(GRID * GRID);
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        const x = -1 + ((col + 0.5) * 2) / GRID;
        const y = -1 + ((row + 0.5) * 2) / GRID;
        foamInside[row * GRID + col] = Math.hypot(x, y) < 1.02 ? 1 : 0;
        foamLight[row * GRID + col] = 1 + SURFACE_LIGHT * (x * LIGHT_X + y * LIGHT_Y);
      }
    }

    let model: LatteModel | null = createLatteModel(env.seed);
    // The still's surface, poured once: the same each time it is painted.
    let finished: LatteSurface | null = null;
    let width = 0;
    let height = 0;
    let scale = 1;
    let at: Layout | null = null;
    let under: HTMLCanvasElement | null = null;
    let over: HTMLCanvasElement | null = null;
    const names = new Map<PourId, HTMLCanvasElement>();
    // What the two small canvases show now, so an unchanged surface is not coloured again.
    let shownSurface: LatteSurface | null = null;
    let shownVersion = -1;
    // Where the cup was last painted whole: the table, the saucer and the handle stay on the canvas until it moves.
    let paintedX = Number.NaN;
    let paintedY = Number.NaN;

    // The foam stands a little proud of the crema: where it is, toward the light, from each crema cell (in foam cells).
    const shadowRow = Math.round(LIGHT_Y * FOAM_SHADOW_REACH);
    const shadowCol = Math.round(LIGHT_X * FOAM_SHADOW_REACH);

    /** Colours the crema's canvas from its tone, shaded where the foam stands between it and the light. */
    const colourCrema = (surface: LatteSurface) => {
      if (!cremaImage || !cremaContext || !cremaPixels) return;
      const { tone, foam } = surface;
      for (let row = 0; row < TONE_GRID; row += 1) {
        const foamRow = Math.min(GRID - 1, Math.max(0, 2 * row + 1 + shadowRow));
        for (let col = 0; col < TONE_GRID; col += 1) {
          const i = row * TONE_GRID + col;
          const level = tone[i]!;
          const k = (level <= 0 ? 0 : level >= 1 ? 255 : (level * 255) | 0) * 3;
          const wall = toWall[i]!;
          const above = foam[foamRow * GRID + Math.min(GRID - 1, Math.max(0, 2 * col + 1 + shadowCol))]!;
          const lit = cremaLight[i]! - FOAM_SHADOW * (above <= 0.3 ? 0 : above >= 0.7 ? 1 : smooth(0.3, 0.7, above));
          cremaPixels[i] = pack(
            ((cremaRamp[k]! + (wallRed - cremaRamp[k]!) * wall) * lit) | 0,
            ((cremaRamp[k + 1]! + (wallGreen - cremaRamp[k + 1]!) * wall) * lit) | 0,
            ((cremaRamp[k + 2]! + (wallBlue - cremaRamp[k + 2]!) * wall) * lit) | 0,
            cremaAlpha[i]!,
          );
        }
      }
      cremaContext.putImageData(cremaImage, 0, 0);
    };

    // The cells the foam's canvas last showed foam in (none yet): outside them its pixels are clear already.
    let boxTop = GRID;
    let boxBottom = -1;
    let boxLeft = GRID;
    let boxRight = -1;

    /**
     * Colours the foam's canvas from its value, twice as fine as its grid (each
     * pixel from the four nearest cells, so the edge is smooth before it is
     * coloured, not stepped), its edges a little lit where they face the light
     * and shaded where they face away. Only the box the foam is in now, and the
     * one it was in, are gone over.
     */
    const colourFoam = (surface: LatteSurface) => {
      if (!foamImage || !foamContext || !foamPixels) return;
      const foam = surface.foam;
      let top = GRID;
      let bottom = -1;
      let left = GRID;
      let right = -1;
      for (let row = 0; row < GRID; row += 1) {
        const start = row * GRID;
        for (let col = 0; col < GRID; col += 1) {
          if (foam[start + col]! > 0) {
            if (row < top) top = row;
            bottom = row;
            if (col < left) left = col;
            if (col > right) right = col;
          }
        }
      }
      // A cell more all round: a pixel takes from its neighbours.
      const fromRow = Math.max(1, Math.min(top, boxTop) - 1);
      const toRow = Math.min(GRID - 2, Math.max(bottom, boxBottom) + 1);
      const fromCol = Math.max(1, Math.min(left, boxLeft) - 1);
      const toCol = Math.min(GRID - 2, Math.max(right, boxRight) + 1);
      boxTop = top;
      boxBottom = bottom;
      boxLeft = left;
      boxRight = right;
      // A cell at a time: its four pixels each take from it and the three cells nearest them.
      const shade = (value: number, base: number) => (value <= 0 ? 0 : foamPacked[base + (value >= 1 ? 255 : (value * 255) | 0)]!);
      for (let cellRow = fromRow; cellRow <= toRow; cellRow += 1) {
        const upper = 2 * cellRow * FOAM_FINE;
        const lower = upper + FOAM_FINE;
        for (let cellCol = fromCol; cellCol <= toCol; cellCol += 1) {
          const cell = cellRow * GRID + cellCol;
          const c = foam[cell]!;
          const n = foam[cell - GRID]!;
          const s = foam[cell + GRID]!;
          const w = foam[cell - 1]!;
          const e = foam[cell + 1]!;
          const nw = foam[cell - GRID - 1]!;
          const ne = foam[cell - GRID + 1]!;
          const sw = foam[cell + GRID - 1]!;
          const se = foam[cell + GRID + 1]!;
          const x = 2 * cellCol;
          if (c + n + s + w + e + nw + ne + sw + se <= 0 || foamInside[cell] === 0) {
            foamPixels[upper + x] = 0;
            foamPixels[upper + x + 1] = 0;
            foamPixels[lower + x] = 0;
            foamPixels[lower + x + 1] = 0;
            continue;
          }
          const facing = -((e - w) * LIGHT_X + (s - n) * LIGHT_Y);
          const level = ((foamLight[cell]! + FOAM_BEVEL * facing - LIFT_LOW) * liftScale + 0.5) | 0;
          const base = (level < 0 ? 0 : level >= LIFT_LEVELS ? LIFT_LEVELS - 1 : level) * 256;
          const middle = 0.5625 * c;
          foamPixels[upper + x] = shade(middle + 0.1875 * (w + n) + 0.0625 * nw, base);
          foamPixels[upper + x + 1] = shade(middle + 0.1875 * (e + n) + 0.0625 * ne, base);
          foamPixels[lower + x] = shade(middle + 0.1875 * (w + s) + 0.0625 * sw, base);
          foamPixels[lower + x + 1] = shade(middle + 0.1875 * (e + s) + 0.0625 * se, base);
        }
      }
      foamContext.putImageData(foamImage, 0, 0);
    };

    const paint = (shown: Shown) => {
      if (!at || !under || !over || !cremaCanvas || !foamCanvas) return;
      const { surface, time, phase, phaseTime, pour, foamShown, stream } = shown;
      // The fields change only with a step of the model, and not at all while a pour is admired.
      if (surface !== shownSurface || shown.version !== shownVersion) {
        colourCrema(surface);
        colourFoam(surface);
        shownSurface = surface;
        shownVersion = shown.version;
      }

      // The drift, in whole device pixels.
      const driftX = Math.round(DRIFT_X * at.unit * Math.sin((2 * Math.PI * time) / DRIFT_X_S + env.seed) * scale) / scale;
      const driftY = Math.round(DRIFT_Y * at.unit * Math.sin((2 * Math.PI * time) / DRIFT_Y_S + env.seed * 1.7) * scale) / scale;
      const cx = at.cx + driftX;
      const cy = at.cy + driftY;

      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.globalAlpha = 1;
      if (cx !== paintedX || cy !== paintedY) {
        context.fillStyle = env.palette.background;
        context.fillRect(0, 0, width, height);
        const underSize = under.width / scale;
        context.drawImage(under, cx - underSize / 2, cy - underSize / 2, underSize, underSize);
        paintedX = cx;
        paintedY = cy;
      }

      // The coffee: the crema, then the foam over it, both scaled up smoothly to the cup. The
      // crema's canvas is opaque over all the coffee, so it covers the last frame's.
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'low';
      const side = at.coffee * 2;
      context.drawImage(cremaCanvas, cx - at.coffee, cy - at.coffee, side, side);
      if (foamShown > 0) {
        context.globalAlpha = foamShown;
        context.drawImage(foamCanvas, cx - at.coffee, cy - at.coffee, side, side);
        context.globalAlpha = 1;
      }

      // Where the stream lands: a small disturbance, the milk's thread seen end on.
      if (stream && stream.flow > 0.02) {
        const low = lowness(stream.height);
        const sx = cx + stream.x * at.coffee;
        const sy = cy + stream.y * at.coffee;
        const thread = (1.6 + 2.2 * stream.flow) * at.unit * (0.7 + 0.3 * low);
        const ripple = (time * 1.6) % 1;
        context.lineWidth = 1.2 * at.unit;
        for (let i = 0; i < 2; i += 1) {
          const k = (ripple + i * 0.5) % 1;
          context.strokeStyle = `rgba(250, 238, 220, ${(0.22 * (1 - k) * stream.flow).toFixed(3)})`;
          context.beginPath();
          context.arc(sx, sy, thread + (4 + 14 * k) * at.unit, 0, Math.PI * 2);
          context.stroke();
        }
        context.fillStyle = `rgba(70, 40, 20, ${(0.28 * (1 - low) * stream.flow).toFixed(3)})`;
        context.beginPath();
        context.arc(sx, sy, thread * 2.1, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = `rgba(252, 246, 236, ${(0.65 + 0.3 * stream.flow).toFixed(3)})`;
        context.beginPath();
        context.arc(sx, sy, thread, 0, Math.PI * 2);
        context.fill();
      }

      const overSize = over.width / scale;
      context.drawImage(over, cx - overSize / 2, cy - overSize / 2, overSize, overSize);

      // The pour's name under the cup, coming in as it starts and going as the cup clears.
      const name = names.get(pour);
      if (name) {
        const nameWidth = name.width / scale;
        const nameHeight = name.height / scale;
        const nameX = cx - nameWidth / 2;
        const nameY = at.nameY + driftY - nameHeight * 0.68;
        // What is under the name (the table, the edge of the saucer's shadow), painted again under it.
        context.save();
        context.beginPath();
        context.rect(nameX, nameY, nameWidth, nameHeight);
        context.clip();
        context.fillStyle = env.palette.background;
        context.fillRect(nameX, nameY, nameWidth, nameHeight);
        const underSize = under.width / scale;
        context.drawImage(under, cx - underSize / 2, cy - underSize / 2, underSize, underSize);
        context.restore();
        const shown = phase === 'pour' ? smooth(0, NAME_IN_S, phaseTime) : phase === 'clear' ? 1 - smooth(0, 1.2, phaseTime) : 1;
        if (shown > 0) {
          context.globalAlpha = shown;
          context.drawImage(name, nameX, nameY, nameWidth, nameHeight);
          context.globalAlpha = 1;
        }
      }
    };

    return {
      step(dtMs) {
        model?.step(dtMs);
      },
      draw() {
        if (!model) return;
        paint({
          surface: model.surface,
          version: model.version,
          time: model.time,
          phase: model.phase,
          phaseTime: model.phaseTime,
          pour: model.choreo.id,
          foamShown: model.foamShown,
          stream: model.phase === 'pour' ? model.pitcher : null,
        });
      },
      resize(nextWidth, nextHeight, nextScale) {
        width = nextWidth;
        height = nextHeight;
        scale = nextScale;
        paintedX = Number.NaN;
        paintedY = Number.NaN;
        for (const made of [under, over, ...names.values()]) release(made);
        at = width > 0 && height > 0 ? layoutFor(width, height) : null;
        under = at ? paintUnder(doc, at, scale) : null;
        over = at ? paintOver(doc, at, scale) : null;
        names.clear();
        if (at) {
          for (const choreo of Object.values(CHOREOGRAPHIES)) {
            const name = paintName(doc, choreo.name, env.palette, at, scale);
            if (name) names.set(choreo.id, name);
          }
        }
      },
      still() {
        finished ??= pourWhole(CHOREOGRAPHIES[STILL_POUR], env.seed, STILL_HZ);
        paintedX = Number.NaN;
        paint({ surface: finished, version: -1, time: 0, phase: 'admire', phaseTime: 0, pour: STILL_POUR, foamShown: 1, stream: null });
      },
      dispose() {
        for (const made of [cremaCanvas, foamCanvas, under, over, ...names.values()]) release(made);
        names.clear();
        cremaCanvas = null;
        cremaContext = null;
        foamCanvas = null;
        foamContext = null;
        cremaImage = null;
        foamImage = null;
        cremaPixels = null;
        foamPixels = null;
        under = null;
        over = null;
        model = null;
        finished = null;
      },
    };
  },
};
