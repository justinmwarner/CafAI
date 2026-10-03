/**
 * SVG path for the shot card's tiny pressure / flow lines. Pure, so the
 * card stays a plain inline <svg> (no chart library inside the chat).
 */
export interface SparklineBox {
  width: number;
  height: number;
  /** Seconds at the right edge. */
  tMax: number;
  /** Value at the top edge; values are clamped to [0, yMax]. */
  yMax: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "M x,y L x,y ..." with a new move-to after every missing reading. */
export function sparklinePath(tS: readonly number[], values: readonly (number | null)[], box: SparklineBox): string {
  if (box.tMax <= 0 || box.yMax <= 0) return '';
  let path = '';
  let penDown = false;
  const count = Math.min(tS.length, values.length);
  for (let i = 0; i < count; i += 1) {
    const t = tS[i];
    const value = values[i];
    if (t === undefined || value === null || value === undefined || !Number.isFinite(value)) {
      penDown = false;
      continue;
    }
    const x = round1((Math.min(Math.max(t, 0), box.tMax) / box.tMax) * box.width);
    const y = round1(box.height - (Math.min(Math.max(value, 0), box.yMax) / box.yMax) * box.height);
    path += `${penDown ? 'L' : 'M'}${x},${y}`;
    penDown = true;
  }
  return path;
}
