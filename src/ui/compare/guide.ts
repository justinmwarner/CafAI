/**
 * The shot under this one on the Shot view's canvas (D-CURVE-3): its
 * pressure and flow as wide, pale bands with round ends and joins, in their
 * own hues washed toward the page, drawn in uPlot's drawAxes hook: after the
 * grid, before every series, so this shot's lines and the profile's dashed
 * targets lie on top. Clipped to the plot, as uPlot clips its series.
 *
 * The points are the shot's ~1 Hz curve, a few dozen a shot, so a repaint
 * during a live shot adds two short paths and no uPlot series: the trace's
 * arrays stay the live shot's alone.
 */
import type { GraphPalette } from '../palette.ts';
import type { PourCurve } from './comparison.ts';

/** The band's width in CSS px on the Shot view: nearly three times the 2.5 px of this shot's lines. */
export const GUIDE_WIDTH_PX = 7;

/** What the drawing needs of uPlot (or of a stand-in in a test). */
export interface GuideCanvas {
  ctx: Pick<
    CanvasRenderingContext2D,
    'save' | 'restore' | 'beginPath' | 'rect' | 'clip' | 'moveTo' | 'lineTo' | 'stroke' | 'setLineDash' | 'lineWidth' | 'lineJoin' | 'lineCap' | 'strokeStyle'
  >;
  /** The plotting area in canvas pixels. */
  bbox: { left: number; top: number; width: number; height: number };
  /** A value on a scale to its canvas pixel (uPlot's valToPos with canvasPixels true). */
  valToPos(value: number, scale: string, canvasPixels?: boolean): number;
}

function band(plot: GuideCanvas, t: readonly number[], values: readonly (number | null)[], colour: string): void {
  const { ctx } = plot;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i < t.length; i += 1) {
    const value = values[i];
    if (value === null || value === undefined) {
      penDown = false;
      continue;
    }
    const x = plot.valToPos(t[i]!, 'x', true);
    const y = plot.valToPos(value, 'y', true);
    if (penDown) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    penDown = true;
  }
  ctx.stroke();
}

/** Draws the curve's flow, then its pressure (on top, as the series are), as bands `pxRatio` canvas pixels per CSS pixel. */
export function drawGuide(plot: GuideCanvas, curve: PourCurve, colors: Pick<GraphPalette, 'pressureGuide' | 'flowGuide'>, pxRatio: number): void {
  if (curve.t.length < 2) return;
  const { ctx, bbox } = plot;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.setLineDash([]);
  ctx.lineWidth = GUIDE_WIDTH_PX * pxRatio;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  band(plot, curve.t, curve.flow, colors.flowGuide);
  band(plot, curve.t, curve.pressure, colors.pressureGuide);
  ctx.restore();
}
