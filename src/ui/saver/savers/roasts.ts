/**
 * The seven roasts of a coffee bean, green to French, and their colours: the
 * Bouncing Portafilter's badge steps along them (one roast a wall), and the
 * beans of Beanfield and of the portafilter's corner burst are drawn in them
 * (D227, D-BEAN-3). The colours are a roaster's stages, not a paint box:
 * green coffee's pale grey-green, the straw of the yellowing (never lemon),
 * then cinnamon, city, full city, Vienna and French, each a darker, redder
 * brown, the last two oily. Fixed whatever the tint, as a roast is a roast,
 * built with oklch() so they reach the canvas as plain #rrggbb.
 */
import { oklch } from '../../color.ts';

export interface Roast {
  /** As a roaster says it. */
  name: string;
  /** The badge's colour: light enough to read on the dark page, 3:1 at least (roasts.test.ts sweeps every tint). */
  badge: string;
  /** A bean of this roast: its side toward the light, its body, its side away from it. */
  highlight: string;
  body: string;
  shade: string;
  /** The rim light it catches along its edge, warm from behind: what shows even the darkest bean on the dark page, 3:1 at least. */
  rim: string;
  /** The dark core of the cut down its flat side. */
  crease: string;
  /** How oily its skin is, 0 to 1: the glint of the light on it. Oil comes through from full city on. */
  gloss: number;
}

/** Lightness and chroma in OKLCH, at the roast's hue. */
type Lc = readonly [lightness: number, chroma: number];

interface RoastSpec {
  name: string;
  hue: number;
  badge: Lc;
  body: Lc;
  rim: Lc;
  gloss: number;
}

// The badge has to stay light enough for 3:1 on the page, so its dark roasts
// are lighter than the beans' own; the beans keep their true darkness, and a
// rim light and the oil's glint show them on the page.
const SPECS: readonly RoastSpec[] = [
  { name: 'Green', hue: 122, badge: [0.8, 0.055], body: [0.66, 0.045], rim: [0.84, 0.05], gloss: 0.04 },
  { name: 'Yellow', hue: 82, badge: [0.84, 0.07], body: [0.73, 0.065], rim: [0.87, 0.06], gloss: 0.05 },
  { name: 'Cinnamon', hue: 60, badge: [0.76, 0.095], body: [0.58, 0.085], rim: [0.8, 0.09], gloss: 0.07 },
  { name: 'City', hue: 55, badge: [0.69, 0.095], body: [0.48, 0.075], rim: [0.74, 0.1], gloss: 0.12 },
  { name: 'Full City', hue: 50, badge: [0.62, 0.085], body: [0.4, 0.065], rim: [0.7, 0.1], gloss: 0.25 },
  { name: 'Vienna', hue: 46, badge: [0.56, 0.075], body: [0.33, 0.05], rim: [0.67, 0.1], gloss: 0.5 },
  { name: 'French', hue: 42, badge: [0.52, 0.06], body: [0.27, 0.036], rim: [0.64, 0.095], gloss: 0.8 },
];

export const ROASTS: readonly Roast[] = SPECS.map(({ name, hue, badge, body, rim, gloss }) => ({
  name,
  badge: oklch(badge[0], badge[1], hue),
  highlight: oklch(body[0] + 0.12, body[1] * 1.05, hue + 4),
  body: oklch(body[0], body[1], hue),
  shade: oklch(body[0] - 0.09, body[1] * 0.9, hue - 4),
  rim: oklch(rim[0], rim[1], 62),
  crease: oklch(Math.max(0.12, body[0] - 0.2), body[1] * 0.8, hue - 6),
  gloss,
}));

/** The roast after this one; French goes round to green. */
export function nextRoast(index: number): number {
  return (index + 1) % ROASTS.length;
}
