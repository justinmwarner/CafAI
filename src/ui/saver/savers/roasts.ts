/**
 * The seven roasts of a coffee bean, green to French, and their colours: the
 * Bouncing Portafilter's badge steps along them (one roast a wall), and the
 * beans of Beanfield and of the portafilter's corner burst are drawn in them
 * (D227). Fixed colours whatever the tint, as a roast is a roast, built
 * with oklch() so they reach the canvas as plain #rrggbb.
 */
import { oklch } from '../../color.ts';

export interface Roast {
  /** As a roaster says it. */
  name: string;
  /** The badge's colour: light enough to read on the dark page, 3:1 at least (roasts.test.ts sweeps every tint). */
  badge: string;
  /** A bean of this roast: the lit side of its body, the body, the shaded edge. */
  highlight: string;
  body: string;
  shade: string;
  /** The lighter rim that shows even the darkest bean on the dark page. */
  rim: string;
  /** The crease down the bean. */
  crease: string;
}

/** Lightness and chroma in OKLCH, at the roast's hue. */
type Lc = readonly [lightness: number, chroma: number];

interface RoastSpec {
  name: string;
  hue: number;
  badge: Lc;
  body: Lc;
  rim: Lc;
}

// The badge has to stay light enough for 3:1 on the page, so its dark roasts
// are lighter than the beans' own; the beans keep their true darkness and a rim.
const SPECS: readonly RoastSpec[] = [
  { name: 'Green', hue: 128, badge: [0.8, 0.1], body: [0.66, 0.08], rim: [0.84, 0.09] },
  { name: 'Yellow', hue: 98, badge: [0.88, 0.13], body: [0.76, 0.12], rim: [0.9, 0.1] },
  { name: 'Cinnamon', hue: 66, badge: [0.77, 0.11], body: [0.62, 0.11], rim: [0.8, 0.1] },
  { name: 'City', hue: 58, badge: [0.69, 0.105], body: [0.52, 0.1], rim: [0.72, 0.1] },
  { name: 'Full City', hue: 52, badge: [0.62, 0.095], body: [0.42, 0.09], rim: [0.66, 0.09] },
  { name: 'Vienna', hue: 48, badge: [0.56, 0.085], body: [0.34, 0.07], rim: [0.6, 0.08] },
  { name: 'French', hue: 45, badge: [0.52, 0.075], body: [0.27, 0.05], rim: [0.56, 0.07] },
];

export const ROASTS: readonly Roast[] = SPECS.map(({ name, hue, badge, body, rim }) => ({
  name,
  badge: oklch(badge[0], badge[1], hue),
  highlight: oklch(body[0] + 0.1, body[1], hue),
  body: oklch(body[0], body[1], hue),
  shade: oklch(body[0] - 0.07, body[1], hue),
  rim: oklch(rim[0], rim[1], hue),
  crease: oklch(Math.max(0.1, body[0] - 0.15), body[1] * 0.9, hue),
}));

/** The roast after this one; French goes round to green. */
export function nextRoast(index: number): number {
  return (index + 1) % ROASTS.length;
}
