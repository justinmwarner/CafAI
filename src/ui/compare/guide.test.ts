import { describe, expect, it } from 'vitest';
import type { PourCurve } from './comparison.ts';
import { drawGuide, GUIDE_WIDTH_PX, type GuideCanvas } from './guide.ts';

/** A canvas that writes down what is drawn on it, with a plot 10 px per second wide and 10 px per bar tall. */
function recordingCanvas() {
  const calls: string[] = [];
  const strokes: { colour: string; width: number; path: string }[] = [];
  let path = '';
  const ctx = {
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    lineCap: 'butt' as CanvasLineCap,
    strokeStyle: '' as string | CanvasGradient | CanvasPattern,
    save: () => void calls.push('save'),
    restore: () => void calls.push('restore'),
    beginPath: () => {
      path = '';
    },
    rect: (x: number, y: number, w: number, h: number) => void calls.push(`rect ${x},${y},${w},${h}`),
    clip: () => void calls.push('clip'),
    setLineDash: (dash: number[]) => void calls.push(`dash ${dash.join('/')}`),
    moveTo: (x: number, y: number) => {
      path += `M${x},${y}`;
    },
    lineTo: (x: number, y: number) => {
      path += `L${x},${y}`;
    },
    stroke: () => {
      strokes.push({ colour: String(ctx.strokeStyle), width: ctx.lineWidth, path });
    },
  };
  const canvas: GuideCanvas = {
    ctx,
    bbox: { left: 30, top: 10, width: 600, height: 120 },
    valToPos: (value, scale) => (scale === 'x' ? 30 + value * 10 : 130 - value * 10),
  };
  return { canvas, ctx, calls, strokes };
}

const COLOURS = { pressureGuide: '#35694c', flowGuide: '#385871' };

describe('the shot under, on the Shot view (D180)', () => {
  it('draws its flow, then its pressure, as wide bands with round ends, clipped to the plot', () => {
    const { canvas, ctx, calls, strokes } = recordingCanvas();
    const curve: PourCurve = { t: [0, 1, 2], pressure: [0, 3, 9], flow: [4, 2, 2], endS: 2 };
    drawGuide(canvas, curve, COLOURS, 2);
    expect(calls).toEqual(['save', 'rect 30,10,600,120', 'clip', 'dash ', 'restore']);
    expect(strokes).toEqual([
      { colour: '#385871', width: GUIDE_WIDTH_PX * 2, path: 'M30,90L40,110L50,110' },
      { colour: '#35694c', width: GUIDE_WIDTH_PX * 2, path: 'M30,130L40,100L50,40' },
    ]);
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.lineCap).toBe('round');
  });

  it('lifts the pen over a missing reading', () => {
    const { canvas, strokes } = recordingCanvas();
    drawGuide(canvas, { t: [0, 1, 2, 3], pressure: [1, null, 2, 3], flow: [null, null, null, null], endS: 3 }, COLOURS, 1);
    expect(strokes[1]!.path).toBe('M30,120M50,110L60,100');
    expect(strokes[0]!.path).toBe('');
  });

  it('draws nothing for a curve of one point', () => {
    const { canvas, calls, strokes } = recordingCanvas();
    drawGuide(canvas, { t: [0], pressure: [2], flow: [2], endS: 0 }, COLOURS, 1);
    expect(calls).toEqual([]);
    expect(strokes).toEqual([]);
  });
});
