/**
 * Colour maths for the palette: OKLCH to sRGB hex (with gamut mapping),
 * blending, and WCAG contrast. Pure functions, no DOM.
 *
 * The palette is designed in OKLCH, where equal lightness steps look equal
 * across hues, so a green CafAI is as legible as the brown one. Every colour
 * leaves this module as plain #rrggbb: the Chromium 91 WebView of the oldest
 * Decent tablets understands neither oklch() nor color-mix().
 */

/** Linear sRGB, 0-1 per channel, before gamma encoding and before clamping to a byte. */
type LinearRgb = readonly [number, number, number];

/** OKLCH (L 0-1, C 0 and up, h in degrees) to linear sRGB, unclamped. */
function oklchToLinearSrgb(l: number, c: number, h: number): LinearRgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  return [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
}

// The matrices above are only 10 digits, so an exact sRGB primary lands a
// hair outside 0-1 (pure blue's red channel comes out at -1.3e-7). With no
// slack the search below sands chroma off colours already in gamut: it maps
// pure blue to #0031e5. 1e-4 linear is under half a byte, so it never hides
// a real out-of-gamut colour.
const EPSILON = 1e-4;
const inGamut = (rgb: LinearRgb) => rgb.every((v) => v >= -EPSILON && v <= 1 + EPSILON);

function linearToByte(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/**
 * The sRGB hex for an OKLCH colour. A colour outside sRGB keeps its
 * lightness and hue and loses chroma until it fits, so a strong accent at an
 * awkward hue gets duller, never lighter or darker (which would break the
 * palette's contrast).
 */
export function oklch(l: number, c: number, h: number): string {
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) {
    throw new Error(`Not a colour: oklch(${l}, ${c}, ${h})`);
  }
  let rgb = oklchToLinearSrgb(l, c, h);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    // 24 halvings take the chroma search's error far below one byte, well
    // past the point where another iteration could change the rounded hex.
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearSrgb(l, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinearSrgb(l, lo, h);
  }
  return `#${rgb.map((v) => hex2(linearToByte(v))).join('')}`;
}

/** "#rrggbb" to [r, g, b] bytes. */
export function parseHex(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `top` at `alpha` (0-1) over an opaque `under`, as an opaque hex. */
export function blend(top: string, under: string, alpha: number): string {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`Blend alpha must be 0-1: ${alpha}`);
  }
  const a = parseHex(top);
  const b = parseHex(under);
  return `#${a.map((v, i) => hex2(Math.round(v * alpha + b[i]! * (1 - alpha)))).join('')}`;
}

function byteToLinear(byte: number): number {
  const c = byte / 255;
  // The sRGB standard's own breakpoint. WCAG's text prints 0.03928, a
  // leftover from an older sRGB draft, but no 8-bit channel value falls
  // between the two, so every hex colour decodes the same either way.
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * byteToLinear(r) + 0.7152 * byteToLinear(g) + 0.0722 * byteToLinear(b);
}

/** WCAG 2 contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
