import { describe, expect, it } from 'vitest';
import {
  BEAN_RATIO,
  beanGeometry,
  beanLight,
  beanLook,
  binTurn,
  emptyView,
  frameRoll,
  isTurnedFrame,
  ROLL_FRAMES,
  rollExtent,
  shadeBean,
  sourceFrame,
  SPIN_BINS,
  spriteSize,
  spriteView,
  type BeanGeometry,
} from './beanShape.ts';
import { ROASTS } from './roasts.ts';

const LENGTH = 80;

/** The rows the bean covers in a sprite's middle column, as half-widths from its axis: its extent across. */
function coveredRows(geometry: BeanGeometry): { low: number; high: number } {
  const col = Math.floor(geometry.width / 2);
  const perUnit = geometry.length / (2 * BEAN_RATIO);
  let first = -1;
  let last = -1;
  for (let row = 0; row < geometry.height; row += 1) {
    if (geometry.coverage[row * geometry.width + col]! > 127) {
      if (first < 0) first = row;
      last = row;
    }
  }
  return { low: (first - geometry.height / 2) / perUnit, high: (last + 1 - geometry.height / 2) / perUnit };
}

/** Rec. 709 luminance of a shaded pixel's bytes, 0-1, and its alpha. */
function pixel(out: Uint8ClampedArray, width: number, col: number, row: number): { light: number; alpha: number } {
  const at = (row * width + col) * 4;
  return { light: (0.2126 * out[at]! + 0.7152 * out[at + 1]! + 0.0722 * out[at + 2]!) / 255, alpha: out[at + 3]! };
}

function shaded(geometry: BeanGeometry, roast: number, turn = 0, turned = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(geometry.width * geometry.height * 4);
  shadeBean(geometry, beanLook(ROASTS[roast]!), beanLight(turn), out, turned);
  return out;
}

describe('rollExtent', () => {
  it('is the full width face on and from the back, and the thickness edge on', () => {
    const face = rollExtent(0);
    expect(face.low).toBeCloseTo(-1, 9);
    expect(face.high).toBeCloseTo(1, 9);
    const back = rollExtent(Math.PI);
    expect(back.high - back.low).toBeCloseTo(2, 9);
    const edge = rollExtent(Math.PI / 2);
    expect(edge.high - edge.low).toBeGreaterThan(1);
    expect(edge.high - edge.low).toBeLessThan(1.25);
  });

  it('changes smoothly as the bean rolls', () => {
    let last = rollExtent(0);
    for (let roll = 0.01; roll < 2 * Math.PI; roll += 0.01) {
      const next = rollExtent(roll);
      expect(Math.abs(next.high - last.high)).toBeLessThan(0.02);
      expect(Math.abs(next.low - last.low)).toBeLessThan(0.02);
      last = { ...next };
    }
  });

  it('is where the rays find the bean, at every roll', () => {
    const perUnit = LENGTH / (2 * BEAN_RATIO);
    for (let frame = 0; frame <= ROLL_FRAMES / 2; frame += 1) {
      const roll = frameRoll(frame);
      const found = coveredRows(beanGeometry(LENGTH, roll, 2));
      const reckoned = rollExtent(roll);
      expect(Math.abs(found.low - reckoned.low) * perUnit, `frame ${frame} low`).toBeLessThan(1.5);
      expect(Math.abs(found.high - reckoned.high) * perUnit, `frame ${frame} high`).toBeLessThan(1.5);
    }
  });
});

describe('beanGeometry', () => {
  it('is an oval face on, about as long as asked and BEAN_RATIO times as long as wide, edged smoothly', () => {
    const geometry = beanGeometry(LENGTH, 0, 3);
    expect(geometry.width).toBe(spriteSize(LENGTH).width);
    expect(geometry.height).toBe(spriteSize(LENGTH).height);
    let area = 0;
    let partial = 0;
    for (const covered of geometry.coverage) {
      area += covered / 255;
      if (covered > 0 && covered < 255) partial += 1;
    }
    const halfLength = LENGTH / 2;
    const halfWidth = halfLength / BEAN_RATIO;
    expect(area / (Math.PI * halfLength * halfWidth)).toBeCloseTo(1, 1);
    expect(partial).toBeGreaterThan(50);
    // Nothing in the sprite's outermost pixels: the bean never touches its edge.
    for (let col = 0; col < geometry.width; col += 1) {
      expect(geometry.coverage[col]).toBe(0);
      expect(geometry.coverage[(geometry.height - 1) * geometry.width + col]).toBe(0);
    }
  });

  it('has the cut down the flat side and none on the round back', () => {
    const face = beanGeometry(LENGTH, 0, 3);
    const back = beanGeometry(LENGTH, Math.PI, 3);
    const deepest = (geometry: BeanGeometry) => Math.min(...Array.from(geometry.open).filter((_, at) => geometry.coverage[at]! > 0));
    expect(deepest(face)).toBeLessThan(80);
    expect(deepest(back)).toBe(255);
    // The cut runs along the bean, through its middle: open skin above and below it.
    const middle = Math.floor(face.width / 2);
    const column = Array.from({ length: face.height }, (_, row) => {
      const at = row * face.width + middle;
      return face.coverage[at]! > 0 ? face.open[at]! : 255;
    });
    const dark = column.indexOf(Math.min(...column));
    expect(Math.abs(dark - face.height / 2)).toBeLessThan(face.height * 0.1);
    expect(column[dark - 8]).toBe(255);
    expect(column[dark + 8]).toBe(255);
  });

  it('gives normals that face the viewer in the middle and turn outward toward the edge', () => {
    const geometry = beanGeometry(LENGTH, Math.PI, 2);
    const at = (col: number, row: number) => row * geometry.width + col;
    const middle = at(Math.floor(geometry.width / 2), Math.floor(geometry.height / 2));
    expect(Math.hypot(geometry.normal[middle * 2]!, geometry.normal[middle * 2 + 1]!)).toBeLessThan(0.15);
    const nearRight = at(geometry.width - 6, Math.floor(geometry.height / 2));
    expect(geometry.normal[nearRight * 2]!).toBeGreaterThan(0.6);
  });
});

describe('shadeBean', () => {
  it('lights the side toward the key (the upper left) and leaves the far side darker, outside it nothing', () => {
    const geometry = beanGeometry(LENGTH, Math.PI, 2);
    const out = shaded(geometry, 3);
    const { width, height } = geometry;
    const upperLeft = pixel(out, width, Math.round(width * 0.3), Math.round(height * 0.3));
    const lowerRight = pixel(out, width, Math.round(width * 0.7), Math.round(height * 0.7));
    expect(upperLeft.alpha).toBe(255);
    expect(lowerRight.alpha).toBe(255);
    expect(upperLeft.light).toBeGreaterThan(lowerRight.light * 1.5);
    expect(pixel(out, width, 0, 0).alpha).toBe(0);
  });

  it('keeps the light on the screen\'s upper left whatever turn the sprite is shown at', () => {
    const geometry = beanGeometry(LENGTH, Math.PI, 2);
    const { width, height } = geometry;
    // Shown turned half round, the sprite's lower right is the screen's upper left.
    const out = shaded(geometry, 3, Math.PI);
    const spriteLowerRight = pixel(out, width, Math.round(width * 0.7), Math.round(height * 0.7));
    const spriteUpperLeft = pixel(out, width, Math.round(width * 0.3), Math.round(height * 0.3));
    expect(spriteLowerRight.light).toBeGreaterThan(spriteUpperLeft.light * 1.5);
  });

  it('glints on the oily dark roasts far more than on green coffee', () => {
    const geometry = beanGeometry(LENGTH, Math.PI, 2);
    /** How much brighter the brightest pixel is than the bean's median. */
    const glint = (roast: number) => {
      const out = shaded(geometry, roast);
      const lights: number[] = [];
      for (let at = 0; at < geometry.coverage.length; at += 1) {
        if (out[at * 4 + 3] === 255) lights.push((0.2126 * out[at * 4]! + 0.7152 * out[at * 4 + 1]! + 0.0722 * out[at * 4 + 2]!) / 255);
      }
      lights.sort((a, b) => a - b);
      return lights[lights.length - 1]! / lights[Math.floor(lights.length / 2)]!;
    };
    expect(glint(6)).toBeGreaterThan(2 * glint(0));
  });

  it('darkens the core of the cut', () => {
    const geometry = beanGeometry(LENGTH, 0, 3);
    const out = shaded(geometry, 2);
    const middle = Math.floor(geometry.width / 2);
    const column = Array.from({ length: geometry.height }, (_, row) => pixel(out, geometry.width, middle, row));
    const cutRow = column.findIndex((_, row) => geometry.coverage[row * geometry.width + middle]! > 0 && geometry.open[row * geometry.width + middle]! < 100);
    expect(cutRow).toBeGreaterThan(10);
    expect(column[cutRow - 10]!.alpha).toBe(255);
    expect(column[cutRow]!.light).toBeLessThan(column[cutRow - 10]!.light * 0.6);
  });

  it('shows the frame of the other half of the roll as its own frame turned half round', () => {
    const roll = frameRoll(5);
    const turned = shaded(beanGeometry(LENGTH, roll, 2), 4, 0.7, true);
    const own = shaded(beanGeometry(LENGTH, -roll, 2), 4, 0.7);
    let worst = 0;
    for (let i = 0; i < own.length; i += 1) worst = Math.max(worst, Math.abs(own[i]! - turned[i]!));
    expect(worst).toBeLessThanOrEqual(3);
  });
});

describe('the frames and bins', () => {
  it('make the second half of a roll from the first', () => {
    for (let frame = 0; frame < ROLL_FRAMES; frame += 1) {
      const source = sourceFrame(frame);
      expect(source).toBeGreaterThanOrEqual(0);
      expect(source).toBeLessThanOrEqual(ROLL_FRAMES / 2);
      if (isTurnedFrame(frame)) expect(frameRoll(source)).toBeCloseTo(2 * Math.PI - frameRoll(frame), 9);
      else expect(source).toBe(frame);
    }
  });
});

describe('spriteView', () => {
  it('picks the frame nearest the roll, lit for the turn nearest the spin, turned the rest of the way', () => {
    const view = emptyView();
    for (let spin = -7; spin < 7; spin += 0.13) {
      for (let roll = -7; roll < 7; roll += 0.29) {
        spriteView(spin, roll, view);
        expect(view.frame).toBeGreaterThanOrEqual(0);
        expect(view.frame).toBeLessThan(ROLL_FRAMES);
        expect(view.bin).toBeGreaterThanOrEqual(0);
        expect(view.bin).toBeLessThan(SPIN_BINS);
        // Within half a bin of the turn it was lit for, and within half a frame of the frame's roll.
        const rest = Math.atan2(Math.sin(view.turn - binTurn(view.bin)), Math.cos(view.turn - binTurn(view.bin)));
        expect(Math.abs(rest)).toBeLessThanOrEqual(Math.PI / SPIN_BINS / 2 + 1e-9);
        const off = Math.atan2(Math.sin(view.roll - frameRoll(view.frame)), Math.cos(view.roll - frameRoll(view.frame)));
        expect(Math.abs(off)).toBeLessThanOrEqual(Math.PI / ROLL_FRAMES + 1e-9);
        // The turn is the bean's own, or the bean's half round with the roll the other way.
        const sameWay = Math.cos(view.turn - spin) > 0;
        const expectedRoll = sameWay ? roll : -roll;
        expect(Math.cos(view.roll - expectedRoll)).toBeCloseTo(1, 9);
        expect(Math.abs(Math.sin(view.turn - spin))).toBeLessThan(1e-9);
      }
    }
  });
});
