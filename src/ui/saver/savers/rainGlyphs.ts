/**
 * Brew Rain's coffee glyphs (D252), drawn as vector paths rather than
 * taken from a font: a bean with its crease, a drop, a small cup on its
 * saucer, coffee cherries on their stem, a leaf, wisps of steam and a
 * latte-art heart.
 * Each lives in a unit box centred on the origin (y down), so a glyph of 19
 * px is its path scaled by 19. Built once, as Path2D, which Chromium 91 and
 * WebKit both have; plain moves, lines, curves and ellipses, nothing newer.
 */
import type { RainSymbol } from './rainModel.ts';

/** One glyph: what is filled, what is stroked in the same colour, and the fine lines drawn darker over it. */
export interface GlyphShape {
  /** Filled in the glyph's colour. */
  body: Path2D;
  /** Stroked in the glyph's colour, this wide (a unit is the glyph's size): a stem, a handle, a wisp. */
  line?: { path: Path2D; width: number };
  /** Stroked darker over the body: the bean's crease, the leaf's veins, the heart's pour. */
  detail?: { path: Path2D; width: number };
}

type Point = readonly [number, number];

/** A point turned by `angle` about the origin. */
function turn([x, y]: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** A path builder whose points are turned by an angle first. */
function turned(path: Path2D, angle: number) {
  return {
    move: (p: Point) => path.moveTo(...turn(p, angle)),
    line: (p: Point) => path.lineTo(...turn(p, angle)),
    curve: (c1: Point, c2: Point, p: Point) => {
      const [x1, y1] = turn(c1, angle);
      const [x2, y2] = turn(c2, angle);
      const [x, y] = turn(p, angle);
      path.bezierCurveTo(x1, y1, x2, y2, x, y);
    },
  };
}

/** A coffee bean, its long axis leaning right, with the S of its crease from tip to tip. */
function bean(): GlyphShape {
  const lean = 0.55;
  const body = new Path2D();
  body.ellipse(0, 0, 0.3, 0.43, lean, 0, Math.PI * 2);
  const crease = new Path2D();
  const s = turned(crease, lean);
  s.move([0.05, -0.34]);
  s.curve([-0.1, -0.24], [-0.07, -0.07], [0, 0]);
  s.curve([0.07, 0.07], [0.1, 0.24], [-0.05, 0.34]);
  return { body, detail: { path: crease, width: 0.075 } };
}

/** A drop of water: a point at the top, round below. */
function drop(): GlyphShape {
  const body = new Path2D();
  body.moveTo(0, -0.44);
  body.bezierCurveTo(0.07, -0.3, 0.28, -0.1, 0.28, 0.12);
  body.arc(0, 0.12, 0.28, 0, Math.PI);
  body.bezierCurveTo(-0.28, -0.1, -0.07, -0.3, 0, -0.44);
  body.closePath();
  return { body };
}

/** A small cup from the side, its handle to the right, on a saucer. */
function cup(): GlyphShape {
  const body = new Path2D();
  body.moveTo(-0.4, -0.22);
  body.lineTo(0.24, -0.22);
  body.bezierCurveTo(0.24, 0.05, 0.14, 0.21, -0.08, 0.21);
  body.bezierCurveTo(-0.3, 0.21, -0.4, 0.05, -0.4, -0.22);
  body.closePath();
  // The saucer: a flat lens under the cup.
  body.moveTo(-0.48, 0.27);
  body.bezierCurveTo(-0.3, 0.38, 0.14, 0.38, 0.32, 0.27);
  body.bezierCurveTo(0.14, 0.31, -0.3, 0.31, -0.48, 0.27);
  body.closePath();
  const handle = new Path2D();
  handle.ellipse(0.25, -0.07, 0.14, 0.12, 0, -Math.PI / 2 - 0.25, Math.PI / 2 + 0.15);
  return { body, line: { path: handle, width: 0.085 } };
}

/** Coffee cherries: two ripe berries side by side on a forked stem, as they grow on the branch. */
function cherry(): GlyphShape {
  const body = new Path2D();
  body.arc(-0.19, 0.18, 0.225, 0, Math.PI * 2);
  body.closePath();
  body.arc(0.19, 0.12, 0.225, 0, Math.PI * 2);
  body.closePath();
  const stem = new Path2D();
  stem.moveTo(-0.17, -0.04);
  stem.bezierCurveTo(-0.15, -0.2, -0.06, -0.33, 0.04, -0.42);
  stem.moveTo(0.17, -0.1);
  stem.bezierCurveTo(0.15, -0.22, 0.1, -0.33, 0.04, -0.42);
  // Where the front berry overlaps the one behind it.
  const edge = new Path2D();
  edge.arc(0.19, 0.12, 0.225, Math.PI * 0.74, Math.PI * 1.18);
  return { body, line: { path: stem, width: 0.075 }, detail: { path: edge, width: 0.06 } };
}

/** A coffee leaf: long and pointed, its midrib drawn in. */
function leaf(): GlyphShape {
  const lean = 0.62;
  const body = new Path2D();
  const outline = turned(body, lean);
  outline.move([0, -0.47]);
  outline.curve([0.26, -0.3], [0.25, 0.16], [0, 0.38]);
  outline.curve([-0.25, 0.16], [-0.24, -0.3], [0, -0.47]);
  body.closePath();
  const stem = new Path2D();
  const stalk = turned(stem, lean);
  stalk.move([0, 0.34]);
  stalk.line([-0.02, 0.48]);
  const midrib = new Path2D();
  const vein = turned(midrib, lean);
  vein.move([0, -0.34]);
  vein.curve([0.04, -0.12], [0.04, 0.12], [0, 0.3]);
  return { body, line: { path: stem, width: 0.08 }, detail: { path: midrib, width: 0.065 } };
}

/** Two wisps of steam rising. */
function steam(): GlyphShape {
  const wisps = new Path2D();
  wisps.moveTo(-0.08, 0.44);
  wisps.bezierCurveTo(-0.34, 0.2, 0.14, 0.04, -0.06, -0.18);
  wisps.bezierCurveTo(-0.18, -0.31, -0.06, -0.41, 0.0, -0.45);
  wisps.moveTo(0.18, 0.34);
  wisps.bezierCurveTo(0.0, 0.16, 0.34, 0.04, 0.2, -0.16);
  return { body: new Path2D(), line: { path: wisps, width: 0.1 } };
}

/** A latte-art heart: the poured heart, its inner layer and the pull-through to its point. */
function heart(): GlyphShape {
  const body = new Path2D();
  body.moveTo(0, -0.18);
  body.bezierCurveTo(-0.05, -0.39, -0.45, -0.37, -0.44, -0.08);
  body.bezierCurveTo(-0.43, 0.14, -0.16, 0.26, 0, 0.42);
  body.bezierCurveTo(0.16, 0.26, 0.43, 0.14, 0.44, -0.08);
  body.bezierCurveTo(0.45, -0.37, 0.05, -0.39, 0, -0.18);
  body.closePath();
  const pour = new Path2D();
  pour.moveTo(0, -0.04);
  pour.bezierCurveTo(-0.02, -0.2, -0.24, -0.2, -0.24, -0.06);
  pour.bezierCurveTo(-0.24, 0.06, -0.08, 0.14, 0, 0.3);
  pour.bezierCurveTo(0.08, 0.14, 0.24, 0.06, 0.24, -0.06);
  pour.bezierCurveTo(0.24, -0.2, 0.02, -0.2, 0, -0.04);
  return { body, detail: { path: pour, width: 0.07 } };
}

const MAKERS: Record<RainSymbol, () => GlyphShape> = { bean, drop, cup, cherry, leaf, steam, heart };

/** Every glyph's shape, built on first use (Path2D needs a browser; the model's tests never ask). */
let built: Map<RainSymbol, GlyphShape> | null = null;

export function glyphShape(symbol: RainSymbol): GlyphShape {
  if (!built) built = new Map();
  let shape = built.get(symbol);
  if (!shape) {
    shape = MAKERS[symbol]();
    built.set(symbol, shape);
  }
  return shape;
}

/**
 * Paints a glyph centred on the context's origin, `size` px a unit, the
 * context's transform already at the glyph's place. `detail` is the colour of
 * its fine lines, a darker shade of `colour`.
 */
export function paintGlyph(ctx: CanvasRenderingContext2D, symbol: RainSymbol, colour: string, detail: string): void {
  const shape = glyphShape(symbol);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = colour;
  ctx.fill(shape.body);
  if (shape.line) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = shape.line.width;
    ctx.stroke(shape.line.path);
  }
  if (shape.detail) {
    ctx.strokeStyle = detail;
    ctx.lineWidth = shape.detail.width;
    ctx.stroke(shape.detail.path);
  }
}
