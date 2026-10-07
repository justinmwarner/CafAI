# UX stage 1: palette, theme, Figtree, visual cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CafAI's whole look comes from one palette built from a tint and a mode, rendered in Figtree with a tighter type scale and tonal surfaces, while the app still looks dark Crema and behaves exactly as today.

**Architecture:** `src/ui/color.ts` does the colour maths (OKLCH to hex, blending, contrast). `src/ui/palette.ts` turns a tint plus a mode into every colour the app uses, and a test sweeps every tint and hue for contrast. `src/ui/theme.ts` maps a palette onto MUI (custom typography variants, a `tonal` Button variant, `theme.palette.cafai` for the colours MUI has no slot for). Components read colours only through the theme. Stage 2 (Appearance settings) will hand `createCafaiTheme` other palettes; nothing in stage 1 changes at run time.

**Tech Stack:** React 19, TypeScript 5.9 (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`), MUI 9.4, @mui/x-chat alpha, uPlot, Vitest 5 (+ jsdom, Testing Library), Playwright, Fontsource.

**Spec:** `docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md` (sections 3, 4, 5, 9 stage 1).

## Ground rules for every task

- Repo: `E:\source\cafai` (Windows). Bash tool with POSIX paths (`/e/source/cafai`) or PowerShell. Branch `feat/ux-modes-theme` is checked out; stay on it.
- **No git commands that change state** (no add, commit, stash, checkout, reset). The controller commits after review.
- Import local files WITH the extension (`./color.ts`); `import type` for types. No enums, namespaces or constructor parameter properties.
- Chromium 91 floor: no `oklch()` or `color-mix()` in CSS, no `:has()`, container queries, `dvh`, `@layer`, native CSS nesting; no `structuredClone`, `crypto.randomUUID`; no dynamic `import()` in app code.
- Comments explain why, not what. User-facing text: short plain sentences, **no em dashes**.
- Tests sit next to the code (`foo.ts` + `foo.test.ts`). DOM tests start with `// @vitest-environment jsdom`.
- Editing files: use the Edit/Write tools. Python's `write_text` writes CRLF on Windows (the repo is LF); backslashes in Bash heredocs get unescaped once.
- Capture exit codes: `cmd > /tmp/x.log 2>&1; echo exit=$?` (a pipe into `tail` hides failures).
- Before reporting: `npx tsc -p tsconfig.json --noEmit` clean, `npx eslint <changed paths>` clean (no new warnings), `npx vitest run <related tests>` passing.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/ui/color.ts` | create | OKLCH to sRGB hex with gamut mapping, hex parsing, blending, WCAG contrast |
| `src/ui/color.test.ts` | create | Known conversions, gamut mapping, contrast values |
| `src/ui/palette.ts` | create | `Tint`, `TINTS`, `customTint`, `namedTint`, `Palette`, `buildPalette(mode, tint)` |
| `src/ui/palette.test.ts` | create | Shape of the palette and the contrast sweep (every tint and hue, both modes) |
| `src/ui/fonts.css` | create | Figtree latin faces (upright, italic) |
| `src/ui/fonts-symbols.css` | modify | Roboto's arrows as the `CafAI Symbols` family |
| `src/ui/fonts.ts` | modify | Imports the two CSS files only |
| `LICENSE-FIGTREE.txt` | create | Figtree's OFL text |
| `skin.config.json`, `NOTICE`, `README.md` | modify | Ship and credit the Figtree licence |
| `package.json`, `package-lock.json` | modify | `@fontsource-variable/figtree` 5.3.0, pinned |
| `src/ui/chat/preview/chatPreview.tsx` | modify | Uses `fonts.ts` instead of Roboto CSS |
| `src/ui/theme.ts` | rewrite | `createCafaiTheme(palette)`, type scale, `tonal` variant, `palette.cafai`, module augmentation |
| `src/ui/theme.test.ts` | rewrite | Theme follows the palette; touch targets; tonal; typography |
| `src/ui/chat/testing/previewTheme.ts` | rewrite | The real theme, so chat tests see the app's look |
| `src/main.tsx` | modify | Boot and failure screens take their colours and font from the palette |
| `src/ui/machine/LiveShotGraph.tsx` | modify | Graph colours and font from the theme |
| `src/ui/chat/parts/ShotCard.tsx` | modify | Sparkline from graph colours, drawn legend swatches, label variant |
| `src/ui/shell/AppShell.tsx` | modify | 56 px top bar, accentSoft selection, tonal Exit, "opens elsewhere" icon |
| `src/ui/machine/format.ts` (+ test) | modify | `splitUnit` |
| `src/ui/machine/MachineStatus.tsx` | modify | Sentence-case labels, readout variant, muted units |
| `src/ui/machine/LoadedProfile.tsx` | modify | Label variant |
| `src/ui/machine/MachineControls.tsx` | modify | Tonal buttons |
| `src/ui/chat/CoachScreen.tsx` (+ test) | modify | Bag as a title, quiet version text, tonal Undo / New bag |
| `src/ui/chat/ChatSurface.tsx` | modify | Lane and composer widths, quiet user bubble |
| `src/ui/chat/parts/DiffCard.tsx` | modify | Tonal Undo |
| `src/ui/history/HistoryScreen.tsx` | modify | Tonal Export / Import, iteration rows without the 2 px side rule |
| `src/ui/settings/SettingsScreen.tsx` | modify | Tonal Forget key |
| `DECISIONS.md` | modify | D80 palette, D81 Figtree |

---

### Task 1: Colour maths (`src/ui/color.ts`)

**Files:**
- Create: `src/ui/color.ts`
- Test: `src/ui/color.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/ui/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, oklch, parseHex, withAlpha } from './color.ts';

describe('oklch', () => {
  it('converts the achromatic ends and a mid grey exactly', () => {
    expect(oklch(0, 0, 0)).toBe('#000000');
    expect(oklch(1, 0, 0)).toBe('#ffffff');
    // L 0.5 is linear 0.125, which sRGB encodes as 99.
    expect(oklch(0.5, 0, 0)).toBe('#636363');
  });

  it('converts sRGB red from its OKLCH coordinates', () => {
    expect(oklch(0.627955, 0.257683, 29.2339)).toBe('#ff0000');
  });

  it('keeps the lightness and hue of a colour outside sRGB, with less chroma', () => {
    const [r, g, b] = parseHex(oklch(0.7, 0.4, 145));
    // Still clearly green, not clipped to grey or to a different hue.
    expect(g).toBeGreaterThan(r + 60);
    expect(g).toBeGreaterThan(b + 60);
    // The same lightness as an in-gamut green at that hue (within a byte of rounding).
    const inGamut = parseHex(oklch(0.7, 0.05, 145));
    expect(Math.abs(g - inGamut[1])).toBeLessThan(60);
  });

  it('always returns #rrggbb', () => {
    for (const [l, c, h] of [[0.2, 0.3, 260], [0.95, 0.2, 100], [0.5, 0.5, 330]] as const) {
      expect(oklch(l, c, h)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('parseHex', () => {
  it('reads #rrggbb in either case', () => {
    expect(parseHex('#C8a27A')).toEqual([200, 162, 122]);
  });

  it('refuses anything else', () => {
    expect(() => parseHex('red')).toThrow(/#rrggbb/);
    expect(() => parseHex('#abc')).toThrow(/#rrggbb/);
  });
});

describe('blend', () => {
  it('mixes a colour over another at the given opacity', () => {
    expect(blend('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(blend('#c8a27a', '#14100d', 1)).toBe('#c8a27a');
    expect(blend('#c8a27a', '#14100d', 0)).toBe('#14100d');
  });
});

describe('withAlpha', () => {
  it('writes an rgba() colour', () => {
    expect(withAlpha('#c8a27a', 0.14)).toBe('rgba(200, 162, 122, 0.14)');
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 is the classic lightest grey that passes 4.5:1 on white.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('does not depend on the order', () => {
    expect(contrastRatio('#14100d', '#c8a27a')).toBe(contrastRatio('#c8a27a', '#14100d'));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /e/source/cafai && npx vitest run src/ui/color.test.ts > /tmp/t1.log 2>&1; echo exit=$?; tail -20 /tmp/t1.log`
Expected: exit=1, "Failed to resolve import "./color.ts"" (or "Cannot find module").

- [ ] **Step 3: Write the implementation** — create `src/ui/color.ts`:

```ts
/**
 * Colour maths for the palette: OKLCH to sRGB hex (with gamut mapping),
 * blending, and WCAG contrast. Pure functions, no DOM.
 *
 * The palette is designed in OKLCH, where equal lightness steps look equal
 * across hues, so a green CafAI is as legible as the brown one. Every colour
 * leaves this module as plain #rrggbb: the Chromium 91 WebView of the oldest
 * Decent tablets understands neither oklch() nor color-mix().
 */

type Rgb = readonly [number, number, number];

/** OKLCH (L 0-1, C 0 and up, h in degrees) to linear sRGB, unclamped. */
function oklchToLinearSrgb(l: number, c: number, h: number): Rgb {
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

const EPSILON = 1e-4;
const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -EPSILON && v <= 1 + EPSILON);

function toByte(linear: number): number {
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
  let rgb = oklchToLinearSrgb(l, c, h);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearSrgb(l, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinearSrgb(l, lo, h);
  }
  return `#${rgb.map((v) => hex2(toByte(v))).join('')}`;
}

/** "#rrggbb" to [r, g, b] bytes. */
export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `top` at `alpha` (0-1) over an opaque `under`, as an opaque hex. */
export function blend(top: string, under: string, alpha: number): string {
  const a = parseHex(top);
  const b = parseHex(under);
  return `#${a.map((v, i) => hex2(Math.round(v * alpha + b[i]! * (1 - alpha)))).join('')}`;
}

/** A hex colour with an alpha, as rgba(), for the few places that need a see-through colour. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function channel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /e/source/cafai && npx vitest run src/ui/color.test.ts > /tmp/t1.log 2>&1; echo exit=$?; tail -8 /tmp/t1.log`
Expected: exit=0, all tests in `color.test.ts` pass. If the red case is off by one byte, check the matrix constants against the code above before touching the test.

- [ ] **Step 5: Typecheck and lint**

Run: `cd /e/source/cafai && npx tsc -p tsconfig.json --noEmit > /tmp/tc.log 2>&1; echo exit=$?; npx eslint src/ui/color.ts src/ui/color.test.ts; echo lint=$?`
Expected: `exit=0`, `lint=0`.

- [ ] **Step 6: Report back** (the controller commits: `feat: colour maths for a palette built in OKLCH, written out as hex`).

**As built (after review):** the gamut test pins `oklch(0.7, 0.4, 145) === '#00bf34'` and checks, through a test-local inverse, that mapped colours keep L within 0.005 and hue within 3 degrees and land on the sRGB edge; the blue and green primaries are pinned; contrast tests include red and blue on white (the luminance weights); `oklch` throws on non-finite input and `blend` on an alpha outside 0-1; `withAlpha` was dropped (no caller).

---

### Task 2: The palette (`src/ui/palette.ts`)

**Files:**
- Create: `src/ui/palette.ts`
- Test: `src/ui/palette.test.ts`

These lightness values were tuned so the sweep in step 1 passes (light-mode success and warning had to darken from the spec's starting numbers; the spec says the contrast table wins). Do not loosen a threshold to make a test pass; darken or lighten the colour instead and say so in the report.

- [ ] **Step 1: Write the failing test** — create `src/ui/palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color.ts';
import { buildPalette, customTint, DEFAULT_TINT_ID, namedTint, TINTS, type Palette, type ThemeMode, type Tint } from './palette.ts';

const MODES: readonly ThemeMode[] = ['dark', 'light'];

/** Every named tint, then every hue the custom slider can reach. */
const ALL_TINTS: readonly (readonly [string, Tint])[] = [
  ...TINTS.map((tint) => [tint.name, tint] as const),
  ...Array.from({ length: 360 }, (_, hue) => [`hue ${hue}`, customTint(hue)] as const),
];

function colours(palette: Palette): string[] {
  const { mode: _mode, graph, ...flat } = palette;
  return [...Object.values(flat), ...Object.values(graph)];
}

describe('the tints', () => {
  it('have unique ids, with Crema the default and first', () => {
    expect(new Set(TINTS.map((t) => t.id)).size).toBe(TINTS.length);
    expect(DEFAULT_TINT_ID).toBe('crema');
    expect(TINTS[0]!.id).toBe('crema');
    expect(TINTS.map((t) => t.name)).toEqual(['Crema', 'Matcha', 'Lagoon', 'Ocean', 'Plum', 'Cherry', 'Steel']);
  });

  it('look up by id', () => {
    expect(namedTint('matcha').hue).toBe(138);
  });

  it('wrap and round a custom hue into 0-359', () => {
    expect(customTint(370).hue).toBe(10);
    expect(customTint(-20).hue).toBe(340);
    expect(customTint(12.6).hue).toBe(13);
    expect(customTint(360).hue).toBe(0);
  });
});

describe('buildPalette', () => {
  it('writes every colour as #rrggbb', () => {
    for (const mode of MODES) {
      for (const tint of TINTS) {
        for (const colour of colours(buildPalette(mode, tint))) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('says which mode it is for', () => {
    expect(buildPalette('dark', namedTint('crema')).mode).toBe('dark');
    expect(buildPalette('light', namedTint('crema')).mode).toBe('light');
  });

  it('keeps the colours that carry meaning the same in every tint', () => {
    for (const mode of MODES) {
      const crema = buildPalette(mode, namedTint('crema'));
      for (const tint of TINTS) {
        const p = buildPalette(mode, tint);
        expect([p.success, p.warning, p.error, p.info, p.live]).toEqual([crema.success, crema.warning, crema.error, crema.info, crema.live]);
        expect([p.graph.pressure, p.graph.flow, p.graph.weightFlow, p.graph.weight]).toEqual([
          crema.graph.pressure,
          crema.graph.flow,
          crema.graph.weightFlow,
          crema.graph.weight,
        ]);
      }
    }
  });

  it('gives each tint its own accent and leans the neutrals toward it', () => {
    const accents = new Set(TINTS.map((t) => buildPalette('dark', t).accent));
    expect(accents.size).toBe(TINTS.length);
    expect(buildPalette('dark', namedTint('matcha')).background).not.toBe(buildPalette('dark', namedTint('cherry')).background);
  });

  it('is dark on dark and light on light', () => {
    const dark = buildPalette('dark', namedTint('crema'));
    const light = buildPalette('light', namedTint('crema'));
    expect(contrastRatio(dark.background, '#000000')).toBeLessThan(2);
    expect(contrastRatio(light.background, '#ffffff')).toBeLessThan(1.2);
  });
});

/** The pairs the UI draws (spec section 3, "Contrast, enforced by tests"). */
const PAIRS: readonly (readonly [string, number, (p: Palette) => readonly (readonly [string, string])[]])[] = [
  ['ink on background, surface, raised', 7, (p) => [[p.ink, p.background], [p.ink, p.surface], [p.ink, p.raised]]],
  ['inkMuted on background, surface, raised', 4.5, (p) => [[p.inkMuted, p.background], [p.inkMuted, p.surface], [p.inkMuted, p.raised]]],
  ['accent on background and surface', 4.5, (p) => [[p.accent, p.background], [p.accent, p.surface]]],
  ['accent on accentSoft', 4.5, (p) => [[p.accent, p.accentSoft]]],
  ['onAccent on accent', 4.5, (p) => [[p.onAccent, p.accent]]],
  [
    'status colours on background and surface',
    4.5,
    (p) => [p.success, p.warning, p.error, p.info].flatMap((c) => [[c, p.background], [c, p.surface]] as const),
  ],
  ['onError on error', 4.5, (p) => [[p.onError, p.error]]],
  [
    'graph series on background and surface',
    3,
    (p) =>
      [p.graph.pressure, p.graph.flow, p.graph.weightFlow, p.graph.weight].flatMap(
        (c) => [[c, p.background], [c, p.surface]] as const,
      ),
  ],
];

describe('contrast (WCAG AA) in every tint, at every hue, in both modes', () => {
  for (const [name, minimum, pairs] of PAIRS) {
    it(`${name}: at least ${minimum}:1`, () => {
      const failures: string[] = [];
      for (const mode of MODES) {
        for (const [tintName, tint] of ALL_TINTS) {
          for (const [fg, bg] of pairs(buildPalette(mode, tint))) {
            const ratio = contrastRatio(fg, bg);
            if (ratio < minimum) failures.push(`${mode} ${tintName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /e/source/cafai && npx vitest run src/ui/palette.test.ts > /tmp/t2.log 2>&1; echo exit=$?; tail -20 /tmp/t2.log`
Expected: exit=1, cannot resolve `./palette.ts`.

- [ ] **Step 3: Write the implementation** — create `src/ui/palette.ts`:

```ts
/**
 * CafAI's colours, built from one tint and a mode.
 *
 * A tint is a hue, how colourful the accent is, and how far the neutrals
 * (backgrounds, text, lines) lean toward that hue. Everything else follows
 * from it, so a green or a blue CafAI is as finished as the brown one. The
 * colours that carry meaning never follow the tint: success green, warning
 * amber, error red, and the shot graph's series (pressure green, flow blue,
 * as on Decent's own charts).
 *
 * The lightness values are chosen so every pair the UI draws passes WCAG AA
 * in both modes and at every hue; palette.test.ts sweeps them all.
 */
import { blend, oklch } from './color.ts';

export type ThemeMode = 'dark' | 'light';

export interface Tint {
  /** OKLCH hue, degrees. */
  hue: number;
  /** Chroma of the accent. */
  chroma: number;
  /** Chroma the neutrals lean toward the hue with. */
  neutral: number;
  /** Accent lightness per mode, for a tint whose accent would otherwise read like the muted text (a grey). */
  accentLightness?: { dark: number; light: number };
}

export type TintId = 'crema' | 'matcha' | 'lagoon' | 'ocean' | 'plum' | 'cherry' | 'steel';

export interface NamedTint extends Tint {
  id: TintId;
  name: string;
}

/** The named tints, in the order the Appearance settings list them. */
export const TINTS: readonly NamedTint[] = [
  { id: 'crema', name: 'Crema', hue: 68, chroma: 0.085, neutral: 0.014 },
  { id: 'matcha', name: 'Matcha', hue: 138, chroma: 0.11, neutral: 0.014 },
  { id: 'lagoon', name: 'Lagoon', hue: 200, chroma: 0.09, neutral: 0.014 },
  { id: 'ocean', name: 'Ocean', hue: 250, chroma: 0.12, neutral: 0.016 },
  { id: 'plum', name: 'Plum', hue: 320, chroma: 0.11, neutral: 0.014 },
  { id: 'cherry', name: 'Cherry', hue: 22, chroma: 0.13, neutral: 0.014 },
  { id: 'steel', name: 'Steel', hue: 250, chroma: 0.025, neutral: 0.006, accentLightness: { dark: 0.88, light: 0.36 } },
];

export const DEFAULT_TINT_ID: TintId = 'crema';

export function namedTint(id: TintId): NamedTint {
  return TINTS.find((tint) => tint.id === id) ?? TINTS[0]!;
}

/** The tint for a hue picked on the custom slider; any number comes back as a whole degree, 0-359. */
export function customTint(hue: number): Tint {
  return { hue: ((Math.round(hue) % 360) + 360) % 360, chroma: 0.11, neutral: 0.014 };
}

export interface GraphPalette {
  pressure: string;
  flow: string;
  weightFlow: string;
  weight: string;
  /** Grid lines. */
  grid: string;
  /** Axis labels. */
  axis: string;
}

export interface Palette {
  mode: ThemeMode;
  /** The page. */
  background: string;
  /** Cards, bars, panels. */
  surface: string;
  /** Tonal buttons and bubbles: a step above the surface. */
  raised: string;
  /** Body text. */
  ink: string;
  /** Secondary text. */
  inkMuted: string;
  /** Dividers and card borders. */
  line: string;
  /** Primary actions and the current selection. */
  accent: string;
  /** A wash of the accent, behind the current navigation item. */
  accentSoft: string;
  /** Text and icons on the accent. */
  onAccent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** Text on a filled error button (Stop while a shot runs). */
  onError: string;
  /** The pulsing dot of a live shot. */
  live: string;
  graph: GraphPalette;
}

type Lch = readonly [lightness: number, chroma: number, hue: number];

/** The colours that carry meaning: the same in every tint. */
const FIXED: Record<ThemeMode, Record<'success' | 'warning' | 'error' | 'info' | 'live' | 'pressure' | 'flow' | 'weightFlow' | 'weight', Lch>> = {
  dark: {
    success: [0.8, 0.14, 155],
    warning: [0.83, 0.13, 85],
    error: [0.72, 0.15, 25],
    info: [0.74, 0.12, 245],
    live: [0.68, 0.19, 25],
    pressure: [0.8, 0.14, 160],
    flow: [0.74, 0.12, 245],
    weightFlow: [0.78, 0.13, 55],
    weight: [0.82, 0.05, 70],
  },
  light: {
    success: [0.5, 0.13, 155],
    warning: [0.52, 0.12, 75],
    error: [0.55, 0.18, 25],
    info: [0.52, 0.15, 250],
    live: [0.58, 0.2, 25],
    pressure: [0.55, 0.14, 160],
    flow: [0.52, 0.15, 250],
    weightFlow: [0.62, 0.15, 55],
    weight: [0.55, 0.06, 65],
  },
};

type NeutralRole = 'background' | 'surface' | 'raised' | 'ink' | 'inkMuted';

/** Each neutral's lightness, and how much of the tint's neutral chroma it takes. */
const NEUTRALS: Record<ThemeMode, Record<NeutralRole, readonly [lightness: number, share: number]>> = {
  dark: {
    background: [0.17, 1],
    surface: [0.205, 1.15],
    raised: [0.25, 1.3],
    ink: [0.95, 0.9],
    inkMuted: [0.76, 1.2],
  },
  light: {
    background: [0.975, 0.5],
    surface: [0.995, 0.25],
    raised: [0.945, 0.8],
    ink: [0.24, 1.5],
    inkMuted: [0.47, 2],
  },
};

const ACCENT_LIGHTNESS: Record<ThemeMode, number> = { dark: 0.76, light: 0.5 };

export function buildPalette(mode: ThemeMode, tint: Tint): Palette {
  const dark = mode === 'dark';
  const neutral = (role: NeutralRole) => {
    const [lightness, share] = NEUTRALS[mode][role];
    return oklch(lightness, tint.neutral * share, tint.hue);
  };
  const fixed = (role: keyof (typeof FIXED)['dark']) => oklch(...FIXED[mode][role]);

  const background = neutral('background');
  const surface = neutral('surface');
  const ink = neutral('ink');
  const inkMuted = neutral('inkMuted');
  const accent = oklch(tint.accentLightness?.[mode] ?? ACCENT_LIGHTNESS[mode], tint.chroma, tint.hue);
  return {
    mode,
    background,
    surface,
    raised: neutral('raised'),
    ink,
    inkMuted,
    line: blend(ink, background, dark ? 0.12 : 0.14),
    accent,
    accentSoft: blend(accent, surface, dark ? 0.16 : 0.12),
    onAccent: dark ? oklch(0.2, tint.neutral * 2, tint.hue) : oklch(0.99, 0.005, tint.hue),
    success: fixed('success'),
    warning: fixed('warning'),
    error: fixed('error'),
    info: fixed('info'),
    onError: dark ? oklch(0.2, 0.02, 25) : oklch(0.99, 0.005, 25),
    live: fixed('live'),
    graph: {
      pressure: fixed('pressure'),
      flow: fixed('flow'),
      weightFlow: fixed('weightFlow'),
      weight: fixed('weight'),
      grid: blend(ink, background, 0.08),
      axis: inkMuted,
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /e/source/cafai && npx vitest run src/ui/palette.test.ts src/ui/color.test.ts > /tmp/t2.log 2>&1; echo exit=$?; tail -12 /tmp/t2.log`
Expected: exit=0. For the record, the controller's pre-check measured these worst cases (all passing): dark ink 13.7, light ink 13.9, dark muted 7.4, light muted 5.7, dark accent 7.9, light accent 5.3, light accent on accentSoft 4.70, light onAccent 5.5, light status 4.9, light graph 3.5.

- [ ] **Step 5: Typecheck and lint**

Run: `cd /e/source/cafai && npx tsc -p tsconfig.json --noEmit > /tmp/tc.log 2>&1; echo exit=$?; tail -5 /tmp/tc.log; npx eslint src/ui/palette.ts src/ui/palette.test.ts; echo lint=$?`
Expected: `exit=0`, `lint=0`. (`oklch(...FIXED[mode][role])` spreads a 3-tuple; if TypeScript rejects the spread, destructure `const [l, c, h] = FIXED[mode][role]; return oklch(l, c, h);`.)

- [ ] **Step 6: Report back** (commit: `feat: one palette from a tint and a mode, with every pair the UI draws checked for contrast`).

---

### Task 3: Figtree, the arrows fallback and its licence

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Create: `src/ui/fonts.css`, `LICENSE-FIGTREE.txt`
- Modify: `src/ui/fonts-symbols.css`, `src/ui/fonts.ts`, `src/ui/chat/preview/chatPreview.tsx`, `skin.config.json`, `NOTICE`, `README.md`

Figtree's latin subset has no → or ← (it has ↑ ↓), and CafAI prints arrows ("18.0 g → 40.4 g", diff lines). Roboto's symbols faces, which today extend the Roboto family for exactly those code points, become a family of their own, `CafAI Symbols`, that the theme lists right after Figtree.

- [ ] **Step 1: Install the font package, pinned exactly like the other dependencies**

Run: `cd /e/source/cafai && npm install --save-exact @fontsource-variable/figtree@5.3.0 > /tmp/npm.log 2>&1; echo exit=$?; tail -5 /tmp/npm.log; grep figtree package.json`
Expected: exit=0 and `"@fontsource-variable/figtree": "5.3.0",` in `dependencies` (alphabetical, before `@fontsource/roboto`).

- [ ] **Step 2: Check the files the CSS will point at**

Run: `cd /e/source/cafai && ls node_modules/@fontsource-variable/figtree/files/ | grep '^figtree-latin-wght' && node -e "console.log(require('./node_modules/@fontsource-variable/figtree/unicode.json').latin)"`
Expected: `figtree-latin-wght-italic.woff2`, `figtree-latin-wght-normal.woff2`, and the latin range `U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD`. If a name differs, use the real name in step 3.

- [ ] **Step 3: Create `src/ui/fonts.css`**

```css
/*
 * Figtree, variable weight 300-900, latin subset only, upright and italic
 * (the chat renders *emphasis*). Fontsource's variable package has no CSS
 * for a single subset, so the faces are declared here with the latin range
 * from its unicode.json; anything outside it falls back to the next family
 * in the theme's stack (CafAI Symbols for the arrows, then the system font).
 */
@font-face {
  font-family: 'Figtree';
  font-style: normal;
  font-display: swap;
  font-weight: 300 900;
  src: url('@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329,
    U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Figtree';
  font-style: italic;
  font-display: swap;
  font-weight: 300 900;
  src: url('@fontsource-variable/figtree/files/figtree-latin-wght-italic.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329,
    U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
```

- [ ] **Step 4: Rename the symbols faces** — in `src/ui/fonts-symbols.css` replace the header comment and the three `font-family: 'Roboto';` lines:

Header comment becomes:
```css
/*
 * Roboto's symbols subset, for the arrows CafAI prints ("18 g → 36 g", diff
 * lines), which Figtree does not have. A family of its own that the theme
 * lists right after Figtree, so only these code points come from it.
 * Fontsource's subset files carry no unicode-range, so these faces declare
 * it here: the browser fetches a file only when such a glyph is on screen.
 */
```
and in each of the three `@font-face` blocks: `font-family: 'CafAI Symbols';` (weights 400, 500, 700 and the `src` / `unicode-range` lines stay as they are).

- [ ] **Step 5: Rewrite `src/ui/fonts.ts`**

```ts
/**
 * Self-hosted Figtree (latin, upright and italic, every weight from one
 * variable file each), plus the few arrows CafAI prints, from Roboto's
 * symbols subset. Decaid skins run offline from localhost, so no font comes
 * from a CDN; other subsets would only add bytes to every skin update.
 *
 * Import this once from the entry point (side effects only).
 */
import './fonts.css';
import './fonts-symbols.css';
```

- [ ] **Step 6: The chat preview uses the same fonts** — in `src/ui/chat/preview/chatPreview.tsx` replace

```ts
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
```
with
```ts
import '../../fonts.ts';
```

- [ ] **Step 7: Ship the licence** — create `LICENSE-FIGTREE.txt` as a byte copy of the package's licence:

Run: `cd /e/source/cafai && cp node_modules/@fontsource-variable/figtree/LICENSE LICENSE-FIGTREE.txt && head -3 LICENSE-FIGTREE.txt && grep -c $'\r' LICENSE-FIGTREE.txt`
Expected: the first line names the Figtree Project Authors; the CR count is `0` (if not 0, convert to LF with `sed -i 's/\r$//' LICENSE-FIGTREE.txt`).

In `skin.config.json` change `"licenseFiles"` to:
```json
  "licenseFiles": [
    "LICENSE",
    "NOTICE",
    "LICENSE-FIGTREE.txt",
    "LICENSE-ROBOTO.txt"
  ],
```

In `NOTICE`, replace the last sentence of the Libraries section (`... and the Roboto font via Fontsource (SIL Open Font License 1.1; its text ships as LICENSE-ROBOTO.txt).`) with:
```
uPlot, Zod, core-js, the Figtree font via Fontsource (SIL Open Font License
1.1; its text ships as LICENSE-FIGTREE.txt), and the arrow glyphs of the
Roboto font via Fontsource (SIL Open Font License 1.1; its text ships as
LICENSE-ROBOTO.txt).
```
(keep the lines before it; re-wrap so no line passes 79 characters).

In `README.md`: in the Develop block, `npm run release:zip   # release/cafai-<version>.zip (with LICENSE, NOTICE and the font licence)` becomes `... (with LICENSE, NOTICE and the font licences)`; in "Credits and license" add a bullet after the Decent Espresso one:
```
- **[Figtree](https://github.com/erikdkennedy/figtree)** by Erik Kennedy,
  SIL Open Font License 1.1 (LICENSE-FIGTREE.txt), is CafAI's typeface;
  Roboto's arrows (LICENSE-ROBOTO.txt) fill in the few glyphs it lacks.
```

- [ ] **Step 8: Check the release still builds with the new licence at the zip root**

Run: `cd /e/source/cafai && npx vitest run scripts > /tmp/t3.log 2>&1; echo exit=$?; tail -5 /tmp/t3.log; npm run release:zip > /tmp/zip.log 2>&1; echo zip=$?; tail -3 /tmp/zip.log`
Expected: `exit=0`; `zip=0` and the last line lists `LICENSE + NOTICE + LICENSE-FIGTREE.txt + LICENSE-ROBOTO.txt`.

- [ ] **Step 9: Confirm the bundle carries only the two Figtree files and the three symbol files, and no Roboto latin**

Run: `cd /e/source/cafai && ls dist/assets | grep -i woff2`
Expected: `figtree-latin-wght-normal-*.woff2`, `figtree-latin-wght-italic-*.woff2`, three `roboto-symbols-*.woff2`; no `roboto-latin-*`.

- [ ] **Step 10: Report back** (commit: `feat: Figtree as CafAI's typeface, Roboto's arrows as a fallback family, and its licence in the zip`). Note: the theme still names Roboto until task 4, so the app renders in the system font between tasks 3 and 4; that is expected.

---

### Task 4: The theme from the palette

**Files:**
- Rewrite: `src/ui/theme.ts`, `src/ui/theme.test.ts`, `src/ui/chat/testing/previewTheme.ts`
- Modify: `src/main.tsx`

`graphColors`, `tokens` and `FONT_FAMILY`'s Roboto go. `LiveShotGraph.tsx` imports `graphColors` and `FONT_FAMILY`; this task keeps it compiling with a one-line change, and task 5 moves it onto the theme properly.

- [ ] **Step 1: Write the failing test** — replace `src/ui/theme.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { buildPalette, namedTint } from './palette.ts';
import { createCafaiTheme, FONT_FAMILY, theme, TOUCH_TARGET } from './theme.ts';

describe('theme', () => {
  const crema = buildPalette('dark', namedTint('crema'));

  it('defaults to dark Crema', () => {
    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.primary.main).toBe(crema.accent);
    expect(theme.palette.background.default).toBe(crema.background);
  });

  it('takes every colour from the palette it is given', () => {
    const p = buildPalette('light', namedTint('matcha'));
    const t = createCafaiTheme(p);
    expect(t.palette.mode).toBe('light');
    expect(t.palette.primary.main).toBe(p.accent);
    expect(t.palette.primary.contrastText).toBe(p.onAccent);
    expect(t.palette.error.contrastText).toBe(p.onError);
    expect(t.palette.background).toMatchObject({ default: p.background, paper: p.surface });
    expect(t.palette.text).toMatchObject({ primary: p.ink, secondary: p.inkMuted });
    expect(t.palette.divider).toBe(p.line);
    expect(t.palette.cafai).toEqual({ raised: p.raised, accentSoft: p.accentSoft, live: p.live, graph: p.graph });
  });

  it('sets everything in Figtree, with the arrows fallback next', () => {
    expect(FONT_FAMILY.startsWith('"Figtree", "CafAI Symbols"')).toBe(true);
    expect(theme.typography.fontFamily).toBe(FONT_FAMILY);
    expect(theme.typography.readout).toMatchObject({ fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums' });
    expect(theme.typography.display).toMatchObject({ fontVariantNumeric: 'tabular-nums' });
    expect(theme.typography.label).toMatchObject({ fontSize: '0.8125rem' });
    // Labels are sentence case now; nothing renders in capitals by default.
    expect(theme.typography.overline).toMatchObject({ textTransform: 'none' });
    expect(theme.typography.button).toMatchObject({ textTransform: 'none' });
  });

  it('has a tonal button variant on the raised colour', () => {
    const variants = theme.components!.MuiButton!.variants!;
    const tonal = variants.find((v) => typeof v.props === 'object' && v.props.variant === 'tonal' && v.props.color === undefined);
    expect(tonal?.style).toMatchObject({ backgroundColor: crema.raised, color: crema.ink });
    const error = variants.find((v) => typeof v.props === 'object' && v.props.variant === 'tonal' && v.props.color === 'error');
    expect(error?.style).toMatchObject({ color: crema.error });
  });

  it('makes every touch control at least 48 px tall', () => {
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(48);
    const overrides = theme.components!;
    expect(overrides.MuiButton?.styleOverrides?.root).toMatchObject({ minHeight: TOUCH_TARGET });
    expect(overrides.MuiButton?.styleOverrides?.sizeSmall).toMatchObject({ minHeight: TOUCH_TARGET });
    expect(overrides.MuiIconButton?.styleOverrides?.root).toMatchObject({ minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET });
    expect(overrides.MuiChip?.styleOverrides?.clickable).toMatchObject({ minHeight: TOUCH_TARGET });
  });

  it('publishes the --safe-* variables and touch rules through CssBaseline', () => {
    const baseline = theme.components!.MuiCssBaseline!.styleOverrides as Record<string, Record<string, string>>;
    expect(baseline[':root']).toMatchObject({ '--safe-bottom': 'env(safe-area-inset-bottom, 0px)' });
    expect(baseline.html).toMatchObject({ touchAction: 'manipulation' });
    expect(baseline['*']).toMatchObject({ WebkitTapHighlightColor: 'transparent' });
    expect(baseline['button, a, [role="button"], .MuiButtonBase-root']).toMatchObject({ userSelect: 'none' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /e/source/cafai && npx vitest run src/ui/theme.test.ts > /tmp/t4.log 2>&1; echo exit=$?; tail -20 /tmp/t4.log`
Expected: exit=1 (no `FONT_FAMILY` starting with Figtree, no `palette.cafai`, no `tonal`).

- [ ] **Step 3: Rewrite `src/ui/theme.ts`**

```ts
/**
 * CafAI's look, built from one palette (palette.ts): Figtree throughout, type
 * sized to be read from a step back from the machine, quiet tonal surfaces
 * instead of outlines, and every control at least 48 px tall because it is
 * pressed by a wet thumb, not a mouse.
 *
 * Plain palette colours only (no `cssVariables`): MUI's CSS-variable mode can
 * emit color-mix(), which the Chromium 91 WebView does not understand.
 */
import type { CSSProperties } from 'react';
import { createTheme, type Theme } from '@mui/material/styles';
import { blend } from './color.ts';
import { buildPalette, DEFAULT_TINT_ID, namedTint, type GraphPalette, type Palette } from './palette.ts';

/** Figtree for everything; the arrows it lacks (→) come from the CafAI Symbols faces (fonts-symbols.css). */
export const FONT_FAMILY = '"Figtree", "CafAI Symbols", system-ui, "Helvetica", "Arial", sans-serif';

/** Smallest comfortable touch target, in CSS px. */
export const TOUCH_TARGET = 48;

/** The palette colours MUI has no slot for: `theme.palette.cafai`, and in sx `bgcolor: 'cafai.raised'`. */
export interface CafaiColors {
  raised: string;
  accentSoft: string;
  live: string;
  graph: GraphPalette;
}

declare module '@mui/material/styles' {
  interface Palette {
    cafai: CafaiColors;
  }
  interface PaletteOptions {
    cafai?: CafaiColors;
  }
  interface TypographyVariants {
    display: CSSProperties;
    readoutLarge: CSSProperties;
    readout: CSSProperties;
    label: CSSProperties;
  }
  interface TypographyVariantsOptions {
    display?: CSSProperties;
    readoutLarge?: CSSProperties;
    readout?: CSSProperties;
    label?: CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    display: true;
    readoutLarge: true;
    readout: true;
    label: true;
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}

const tabular = { fontVariantNumeric: 'tabular-nums' } as const;

export function createCafaiTheme(palette: Palette = buildPalette('dark', namedTint(DEFAULT_TINT_ID))): Theme {
  const dark = palette.mode === 'dark';
  const tonalHover = blend(palette.ink, palette.raised, dark ? 0.08 : 0.06);
  const tonalDisabled = blend(palette.ink, palette.raised, 0.38);
  return createTheme({
    // Opt-in keyboard focus ring; touch users never see it.
    focusVisible: true,
    palette: {
      mode: palette.mode,
      primary: { main: palette.accent, contrastText: palette.onAccent },
      // Unused by CafAI; set so nothing falls back to MUI's purple.
      secondary: { main: palette.inkMuted, contrastText: palette.background },
      error: { main: palette.error, contrastText: palette.onError },
      warning: { main: palette.warning },
      success: { main: palette.success },
      info: { main: palette.info },
      background: { default: palette.background, paper: palette.surface },
      text: { primary: palette.ink, secondary: palette.inkMuted },
      divider: palette.line,
      cafai: { raised: palette.raised, accentSoft: palette.accentSoft, live: palette.live, graph: palette.graph },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_FAMILY,
      fontWeightMedium: 550,
      fontWeightBold: 700,
      // The live shot's timer.
      display: { fontFamily: FONT_FAMILY, fontSize: '2.875rem', fontWeight: 650, lineHeight: 1, letterSpacing: '-0.02em', ...tabular },
      // The live shot's readouts.
      readoutLarge: { fontFamily: FONT_FAMILY, fontSize: '1.875rem', fontWeight: 650, lineHeight: 1.1, letterSpacing: '-0.01em', ...tabular },
      h4: { fontSize: '1.75rem', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.015em' },
      // The machine's state line.
      h5: { fontSize: '1.4375rem', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.01em' },
      // Screen titles and the bag.
      h6: { fontSize: '1.1875rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.005em' },
      subtitle1: { fontSize: '1.0625rem', fontWeight: 650, lineHeight: 1.35 },
      subtitle2: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.4 },
      body1: { fontSize: '1rem', lineHeight: 1.55 },
      body2: { fontSize: '0.9375rem', lineHeight: 1.5 },
      // Machine readouts.
      readout: { fontFamily: FONT_FAMILY, fontSize: '1.1875rem', fontWeight: 650, lineHeight: 1.2, ...tabular },
      // Readout and field labels, sentence case.
      label: { fontFamily: FONT_FAMILY, fontSize: '0.8125rem', fontWeight: 550, lineHeight: 1.3 },
      button: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.25, textTransform: 'none', letterSpacing: '0.005em' },
      caption: { fontSize: '0.8125rem', lineHeight: 1.35 },
      // Kept for any stray use, but in sentence case like the labels.
      overline: { fontSize: '0.8125rem', fontWeight: 550, lineHeight: 1.3, letterSpacing: 0, textTransform: 'none' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Insets reach the layout only through these variables, so the
          // safe-area module (and the dev/tablet.html harness) can override
          // what env() reports.
          ':root': {
            '--safe-top': 'env(safe-area-inset-top, 0px)',
            '--safe-right': 'env(safe-area-inset-right, 0px)',
            '--safe-bottom': 'env(safe-area-inset-bottom, 0px)',
            '--safe-left': 'env(safe-area-inset-left, 0px)',
          },
          'html, body, #root': { height: '100%' },
          html: { touchAction: 'manipulation' },
          // The shell owns scrolling; the page itself never scrolls or bounces.
          body: { overflow: 'hidden', overscrollBehavior: 'none' },
          '*': { WebkitTapHighlightColor: 'transparent' },
          // A long press on a button must not select its label or open a callout.
          'button, a, [role="button"], .MuiButtonBase-root': {
            touchAction: 'manipulation',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          },
          // Even line lengths on headings; engines before Chromium 114 simply ignore it.
          'h1, h2, h3': { textWrap: 'balance' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          // Dark-mode elevation overlays would grey the tinted surfaces.
          root: { backgroundImage: 'none' },
          outlined: { borderRadius: 16 },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { minHeight: TOUCH_TARGET, borderRadius: 12, lineHeight: 1.25 },
          sizeSmall: { minHeight: TOUCH_TARGET },
          sizeLarge: { minHeight: 56, fontSize: '1.0625rem' },
        },
        variants: [
          {
            // Secondary actions: a quiet filled button on the raised colour, no outline.
            props: { variant: 'tonal' },
            style: {
              padding: '6px 16px',
              backgroundColor: palette.raised,
              color: palette.ink,
              '@media (hover: hover)': { '&:hover': { backgroundColor: tonalHover } },
              '&.Mui-disabled': { backgroundColor: palette.raised, color: tonalDisabled },
            },
          },
          { props: { variant: 'tonal', color: 'error' }, style: { color: palette.error } },
          { props: { variant: 'tonal', color: 'warning' }, style: { color: palette.warning } },
          { props: { variant: 'tonal', color: 'success' }, style: { color: palette.success } },
        ],
      },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET } },
      },
      MuiToggleButton: {
        styleOverrides: { root: { minHeight: TOUCH_TARGET, textTransform: 'none' } },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontSize: '0.9375rem' },
          // Anything tappable is a full touch target; status chips stay compact.
          clickable: { minHeight: TOUCH_TARGET, height: 'auto', borderRadius: TOUCH_TARGET / 2 },
          deletable: { minHeight: TOUCH_TARGET, height: 'auto', borderRadius: TOUCH_TARGET / 2 },
        },
      },
      MuiTab: { styleOverrides: { root: { minHeight: TOUCH_TARGET, textTransform: 'none' } } },
      MuiListItemButton: { styleOverrides: { root: { minHeight: TOUCH_TARGET } } },
      MuiMenuItem: { styleOverrides: { root: { minHeight: TOUCH_TARGET } } },
    },
  });
}

/** The default look (dark, Crema), for code without an appearance of its own: the app until stage 2, tests, previews. */
export const theme = createCafaiTheme();
```

- [ ] **Step 4: Keep `LiveShotGraph.tsx` compiling until task 5** — in `src/ui/machine/LiveShotGraph.tsx` replace

```ts
import { FONT_FAMILY, graphColors } from '../theme.ts';
```
with
```ts
import { FONT_FAMILY, theme } from '../theme.ts';

// Task 5 reads these from the theme in context; until then, the default theme's.
const graphColors = theme.palette.cafai.graph;
```

- [ ] **Step 5: The chat tests and the chat preview render in the real theme** — replace `src/ui/chat/testing/previewTheme.ts` with:

```ts
/**
 * The theme the chat, history and settings tests and the chat preview
 * render in: the app's own default (dark, Crema), so a test sees what the
 * barista sees. Not shipped.
 */
import { createCafaiTheme } from '../../theme.ts';

export const previewTheme = createCafaiTheme();
```

- [ ] **Step 6: The boot and failure screens use the palette** — in `src/main.tsx` add after the existing imports:

```ts
import { buildPalette, DEFAULT_TINT_ID, namedTint } from './ui/palette.ts';
import { FONT_FAMILY } from './ui/theme.ts';

// Before the app (and its appearance setting) loads, the default look.
const BOOT = buildPalette('dark', namedTint(DEFAULT_TINT_ID));
```
then in `buttonStyle` use `border: \`1px solid ${BOOT.line}\``, `color: BOOT.ink`, and in `Message` use `fontFamily: FONT_FAMILY`, `color: BOOT.ink`, `background: BOOT.background`; the detail line's `opacity: 0.8` becomes `color: BOOT.inkMuted` (drop the opacity). (Use real template literals in the file: `` border: `1px solid ${BOOT.line}` ``.)

- [ ] **Step 7: Run the theme test and every test that renders in a theme**

Run: `cd /e/source/cafai && npx vitest run src/ui > /tmp/t4.log 2>&1; echo exit=$?; tail -12 /tmp/t4.log`
Expected: exit=0. If a component test fails on a colour it asserted (for example `LoadedProfile.test.tsx` compares against `theme.palette.warning.main`, which still works), fix the test only when it hard-coded the old colour; otherwise report the failure.

- [ ] **Step 8: Typecheck and lint the whole repo**

Run: `cd /e/source/cafai && npm run typecheck > /tmp/tc.log 2>&1; echo exit=$?; tail -5 /tmp/tc.log; npm run lint > /tmp/lint.log 2>&1; echo lint=$?; tail -5 /tmp/lint.log`
Expected: `exit=0`, `lint=0`, no warnings. If TypeScript rejects `textWrap`, `fontWeightMedium: 550`, or the `variants` entries' `props`, report the exact error rather than casting broadly; a narrowly scoped fix (for example `props: { variant: 'tonal' as const }`) is fine.

- [ ] **Step 9: Report back** (commit: `feat: the MUI theme is built from the palette: Figtree, a tighter type scale, tonal buttons`).

---

### Task 5: Graph and shot card colours from the theme

**Files:**
- Modify: `src/ui/machine/LiveShotGraph.tsx`, `src/ui/chat/parts/ShotCard.tsx`
- Test: `src/ui/machine/LiveShotGraph.test.tsx`, `src/ui/chat/parts/ShotCard.test.tsx` (add one case each)

The graph draws on a canvas through uPlot, so it cannot use sx colours; it reads `theme.palette.cafai.graph` from `useTheme()` and the font from `theme.typography.fontFamily`. The plot is created in an effect; the graph colours and font join its dependencies. They are stable for a given theme, so nothing re-creates the plot today; stage 2 makes a theme change rebuild it without losing the shot.

- [ ] **Step 1: Write the failing tests**

Append to the top-level `describe` in `src/ui/machine/LiveShotGraph.test.tsx` (it already mocks uPlot and imports `fakePlots`, `renderWithServices`, `createFakeServices`):

```ts
  it('draws in the theme's graph colours and font', () => {
    renderWithServices(<LiveShotGraph />, createFakeServices());
    const opts = fakePlots[0]!.opts as { series: { stroke?: string }[]; axes: { font?: string; stroke?: string }[] };
    const graph = theme.palette.cafai.graph;
    // Same order as SERIES_KEYS: targets, weight, weight flow, flow, pressure.
    expect(opts.series.slice(1).map((s) => s.stroke)).toEqual([graph.pressure, graph.flow, graph.weight, graph.weightFlow, graph.flow, graph.pressure]);
    expect(opts.axes[0]!.stroke).toBe(graph.axis);
    expect(opts.axes[0]!.font).toBe(`12px ${theme.typography.fontFamily}`);
  });
```
and add `import { theme } from '../theme.ts';` to its imports.

Append a new `describe` to the end of `src/ui/chat/parts/ShotCard.test.tsx` (it already imports `renderThemed`, `sampleSummary`, `screen`, `ShotCard`):

```ts
describe('ShotCard sparkline', () => {
  it('keys the curves with drawn swatches, not box-drawing characters', () => {
    renderThemed(<ShotCard summary={sampleSummary()} />);
    expect(screen.getByRole('img', { name: 'Pressure and flow during the shot' })).toBeInTheDocument();
    expect(screen.getByText('Pressure')).toBeInTheDocument();
    expect(screen.getByText('Flow')).toBeInTheDocument();
    expect(screen.queryByText(/━/)).toBeNull();
  });
});
```
(If `sampleSummary()` has no pressure or flow series, the sparkline renders nothing and the first assertion fails: then pass `summarizeShot(shot01 as unknown as ShotRecord)` instead, the way other cases in the file do.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd /e/source/cafai && npx vitest run src/ui/machine/LiveShotGraph.test.tsx src/ui/chat/parts/ShotCard.test.tsx > /tmp/t5.log 2>&1; echo exit=$?; grep -E "✓|×|FAIL|passed|failed" /tmp/t5.log | tail -8`
Expected: exit=1; the font assertion fails (Roboto) and `getByText('Pressure')` fails (the text is "━ Pressure").

- [ ] **Step 3: Move the graph onto the theme** — in `src/ui/machine/LiveShotGraph.tsx`:

Replace the task 4 stopgap

```ts
import { FONT_FAMILY, theme } from '../theme.ts';

// Task 5 reads these from the theme in context; until then, the default theme's.
const graphColors = theme.palette.cafai.graph;
```
with
```ts
import { useTheme } from '@mui/material/styles';
import type { GraphPalette } from '../palette.ts';
```
(merge `useTheme` into the existing `import { keyframes } from '@mui/material/styles';` line).

Replace the legend definition with keys only; the colour comes from the palette at render:

```ts
type LegendKey = 'pressure' | 'flow' | 'weightFlow' | 'weight';

interface LegendItem {
  key: LegendKey;
  label: string;
  unit: string;
}

const LEGEND: readonly LegendItem[] = [
  { key: 'pressure', label: 'Pressure', unit: 'bar' },
  { key: 'flow', label: 'Flow', unit: 'ml/s' },
  { key: 'weightFlow', label: 'Weight flow', unit: 'g/s' },
  { key: 'weight', label: 'Weight', unit: 'g' },
];
```

Change `graphOptions` to take the colours and font:

```ts
function graphOptions(width: number, height: number, colors: GraphPalette, fontFamily: string): uPlot.Options {
  const font = `12px ${fontFamily}`;
```
and inside it replace every `graphColors.` with `colors.` (axes: `colors.axis`, `colors.grid`, `colors.weight`; series: `colors.pressure`, `colors.flow`, `colors.weight`, `colors.weightFlow`, `colors.flow`, `colors.pressure`).

In the component, before the first effect:

```ts
  const muiTheme = useTheme();
  const colors = muiTheme.palette.cafai.graph;
  const fontFamily = muiTheme.typography.fontFamily ?? 'sans-serif';
```
create the plot with `new uPlot(graphOptions(size.width, size.height, colors, fontFamily), buffer.data, host)` and change that effect's dependency list from `[telemetry]` to `[telemetry, colors, fontFamily]`.

In the plot host `sx`, `'& .uplot': { position: 'absolute', top: 0, left: 0, fontFamily: FONT_FAMILY }` becomes `'& .uplot': { position: 'absolute', top: 0, left: 0, fontFamily }`.

In the legend markup, the swatch's `bgcolor: item.color` becomes `bgcolor: colors[item.key]`.

Polish the header in the same file: the caption `Typography variant="subtitle1" component="h2"` stays; the timer becomes

```tsx
        <Typography
          ref={timer}
          data-testid={TID.shotTimer}
          variant="readout"
          component="span"
          aria-label="Shot time"
          sx={{ fontSize: '1.25rem' }}
        >
```
(the readout variant carries the tabular figures and weight that the old inline `sx` set).

- [ ] **Step 4: The shot card uses the graph colours and drawn swatches** — in `src/ui/chat/parts/ShotCard.tsx`:

In `Sparkline`, `const pressureColor = theme.palette.success.main;` and `const flowColor = theme.palette.info.main;` become

```ts
  const pressureColor = theme.palette.cafai.graph.pressure;
  const flowColor = theme.palette.cafai.graph.flow;
```
and the legend stack becomes

```tsx
      <Stack spacing={0.25} sx={{ flexShrink: 0 }}>
        <LegendKey color={pressureColor} label="Pressure" />
        <LegendKey color={flowColor} label="Flow" />
      </Stack>
```
with, above `Sparkline`:

```tsx
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box component="span" aria-hidden sx={{ width: 12, height: 3, borderRadius: 1, bgcolor: color, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.3 }}>
        {label}
      </Typography>
    </Stack>
  );
}
```

In `Metric`, the label becomes `variant="label"` (keep `component="div"`, `color: 'text.secondary'`, drop `lineHeight: 1.2`), and the value `sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}` becomes `sx={{ fontWeight: 650, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}`.

- [ ] **Step 5: Run the tests**

Run: `cd /e/source/cafai && npx vitest run src/ui/machine src/ui/chat/parts > /tmp/t5.log 2>&1; echo exit=$?; tail -8 /tmp/t5.log`
Expected: exit=0.

- [ ] **Step 6: Typecheck and lint**

Run: `cd /e/source/cafai && npm run typecheck > /tmp/tc.log 2>&1; echo exit=$?; npx eslint src/ui/machine src/ui/chat/parts; echo lint=$?`
Expected: `exit=0`, `lint=0` with no warnings (the effect's dependency list must name `colors` and `fontFamily`).

- [ ] **Step 7: Report back** (commit: `feat: the live graph and the shot card's sparkline draw in the palette's graph colours`).

---

### Task 6: Shell and machine column

**Files:**
- Modify: `src/ui/shell/AppShell.tsx`, `src/ui/machine/format.ts`, `src/ui/machine/MachineStatus.tsx`, `src/ui/machine/LoadedProfile.tsx`, `src/ui/machine/MachineControls.tsx`
- Test: `src/ui/machine/format.test.ts`

Every existing test id, accessible name and text stays: tests check `TID.groupTemp` has "92.4 °C", the connection row says "Machine connected", and so on.

- [ ] **Step 1: Write the failing test** — append to `src/ui/machine/format.test.ts` (add `splitUnit` to its import from `./format.ts`):

```ts
describe('splitUnit', () => {
  it('splits a readout into its number and unit', () => {
    expect(splitUnit('97.7 °C')).toEqual({ value: '97.7', unit: '°C' });
    expect(splitUnit('31 mm')).toEqual({ value: '31', unit: 'mm' });
    expect(splitUnit('0.0 g')).toEqual({ value: '0.0', unit: 'g' });
    expect(splitUnit('-1.5 g')).toEqual({ value: '-1.5', unit: 'g' });
  });

  it('leaves a dash or words whole', () => {
    expect(splitUnit('—')).toEqual({ value: '—', unit: null });
    expect(splitUnit('No scale')).toEqual({ value: 'No scale', unit: null });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /e/source/cafai && npx vitest run src/ui/machine/format.test.ts > /tmp/t6.log 2>&1; echo exit=$?; tail -6 /tmp/t6.log`
Expected: exit=1, `splitUnit` is not exported.

- [ ] **Step 3: Add `splitUnit`** — append to `src/ui/machine/format.ts`:

```ts
/**
 * "97.7 °C" as its number and unit, so a readout can set the unit smaller
 * and quieter than the number. A dash or a word comes back whole.
 */
export function splitUnit(text: string): { value: string; unit: string | null } {
  const match = /^(-?\d+(?:\.\d+)?)\s+(\S+)$/.exec(text);
  return match ? { value: match[1]!, unit: match[2]! } : { value: text, unit: null };
}
```

Run the test again; expected exit=0.

- [ ] **Step 4: Machine status readouts** — in `src/ui/machine/MachineStatus.tsx`:

Import `splitUnit` from `./format.ts` alongside the others. Replace the body of `Readout` with:

```tsx
function Readout({ testId, label, value, detail, warn }: ReadoutProps) {
  const { value: number, unit } = splitUnit(value);
  return (
    <Box data-testid={testId} sx={{ minWidth: 0 }}>
      <Typography variant="label" component="div" color="text.secondary" noWrap>
        {label}
      </Typography>
      <Typography variant="readout" component="div" noWrap color={warn ? 'warning.main' : 'text.primary'}>
        {number}
        {unit ? (
          <Box component="span" sx={{ fontSize: '0.68em', fontWeight: 550, color: 'text.secondary' }}>
            {' '}
            {unit}
          </Box>
        ) : null}
      </Typography>
      <Typography variant="caption" component="div" color={warn ? 'warning.main' : 'text.secondary'} noWrap>
        {detail ?? ' '}
      </Typography>
    </Box>
  );
}
```
(The space before the unit stays inside the text, so "92.4 °C" is still the readout's text.)

In `StateLine`, keep `variant="h5"`.

- [ ] **Step 5: Loaded profile label** — in `src/ui/machine/LoadedProfile.tsx`, the "Profile" `Typography` changes from `variant="overline"` with `sx={{ flex: 'none', lineHeight: 1.5 }}` to `variant="label"` with `sx={{ flex: 'none' }}`; the title `Typography` changes `sx={{ minWidth: 0, fontSize: '1.125rem', fontWeight: 500, lineHeight: 1.25 }}` to `variant="subtitle1"` with `sx={{ minWidth: 0 }}` (keep `component="div"`, `noWrap`, `title`).

- [ ] **Step 6: Tonal machine controls** — in `src/ui/machine/MachineControls.tsx`:

The start buttons:
```tsx
            <Button
              key={spec.command}
              data-testid={spec.testId}
              variant={spec.command === 'espresso' ? 'contained' : 'tonal'}
              disabled={!model.startsEnabled}
              loading={pending === spec.command}
              onClick={() => void send(spec.command, spec.failure)}
              sx={{ minHeight: START_HEIGHT, flexDirection: 'column', gap: 0.25, px: 0.5, fontSize: '0.9375rem', lineHeight: 1.15 }}
            >
```
(the `color` prop and the `borderColor` line go).

Stop: `variant={model.stopProminent ? 'contained' : 'tonal'}` (keep `color="error"`, `size="large"`, the rest).

Sleep / Wake and Tare: `variant="tonal"`, remove `color="inherit"`, and their `sx` becomes `sx={{ minHeight: ROW_HEIGHT, px: 1 }}`.

- [ ] **Step 7: The top bar** — in `src/ui/shell/AppShell.tsx`:

`const TOP_BAR_HEIGHT = 64;` becomes `56`.

Replace `import CoffeeMakerRounded from '@mui/icons-material/CoffeeMakerRounded';` with `import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';`, and in the Decaid settings button `startIcon={<CoffeeMakerRounded />}` becomes `startIcon={<OpenInNewRounded />}` (it leaves CafAI for Decaid's own page).

`Brand`'s text `sx={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.02em' }}` becomes `sx={{ fontSize: '1.1875rem', fontWeight: 750, letterSpacing: '0.005em' }}`.

The active nav item's `bgcolor: active ? 'rgba(200, 162, 122, 0.14)' : 'transparent'` becomes `bgcolor: active ? 'cafai.accentSoft' : 'transparent'`.

`ExitButton`: `variant="outlined" color="inherit"` becomes `variant="tonal"`, and its `sx` becomes `sx={{ flex: 'none', px: 1.5 }}`.

- [ ] **Step 8: Run the shell and machine tests**

Run: `cd /e/source/cafai && npx vitest run src/ui/shell src/ui/machine src/ui/router.dom.test.tsx > /tmp/t6.log 2>&1; echo exit=$?; tail -8 /tmp/t6.log`
Expected: exit=0.

- [ ] **Step 9: Typecheck and lint**

Run: `cd /e/source/cafai && npm run typecheck > /tmp/tc.log 2>&1; echo exit=$?; npx eslint src/ui/shell src/ui/machine; echo lint=$?`
Expected: `exit=0`, `lint=0`.

- [ ] **Step 10: Report back** (commit: `feat: the top bar and machine column in the new type scale, with tonal buttons and quieter units`).

---

### Task 7: Coach header and chat

**Files:**
- Modify: `src/ui/chat/CoachScreen.tsx`, `src/ui/chat/ChatSurface.tsx`, `src/ui/chat/parts/DiffCard.tsx`
- Test: `src/ui/chat/CoachScreen.test.tsx`

The bag picker becomes a title (still the native select, still 48 px, same test id), and the version beside it becomes quiet text: "v4 · Blooming Espresso". The bag's name already shows in the picker, so it is hidden from sight but kept in the text (screen readers, and every test that expects "Kiambu AA v4" in `TID.activeVersion`).

- [ ] **Step 1: Write the failing tests** — add inside the main `describe` of `src/ui/chat/CoachScreen.test.tsx` (it has `renderCoach` and `coachStateFor`; `coachStateFor('options')` has Kiambu AA v1 on `blooming-espresso`, so the template name is "Blooming Espresso"):

```ts
  it('shows the version quietly beside the bag, with its starting profile', () => {
    renderCoach(coachStateFor('options'));
    const version = screen.getByTestId(TID.activeVersion);
    // The whole title is still in the text for screen readers; the bag's name repeats the picker, so only "v1" shows.
    expect(version).toHaveTextContent('Kiambu AA v1 · Blooming Espresso');
    expect(within(version).getByText('v1')).toBeVisible();
  });

  it('names the bag picker for screen readers without a visible label', () => {
    renderCoach(coachStateFor('options'));
    expect(screen.getByRole('combobox', { name: 'Bag' })).toBe(screen.getByTestId(TID.bagPicker));
  });
```
The repeated name is hidden with the clip technique below (still in the text and read out), never `display: none` (which a screen reader skips).

- [ ] **Step 2: Run them to see them fail**

Run: `cd /e/source/cafai && npx vitest run src/ui/chat/CoachScreen.test.tsx > /tmp/t7.log 2>&1; echo exit=$?; grep -E "✓|×|passed|failed" /tmp/t7.log | tail -8`
Expected: exit=1 on the two new cases.

- [ ] **Step 3: The bag picker as a title** — in `src/ui/chat/CoachScreen.tsx`, `BagPicker`'s `TextField` becomes:

```tsx
    <TextField
      select
      variant="standard"
      value={activeBag?.id ?? ''}
      disabled={disabled}
      onChange={(event) => {
        const id = event.target.value;
        if (id && id !== activeBag?.id) fire(coach.selectBag(id));
      }}
      slotProps={{
        select: { native: true },
        input: { disableUnderline: true },
        htmlInput: { 'data-testid': TID.bagPicker, 'aria-label': 'Bag' },
      }}
      // The native select itself is the 48 px touch target; it reads as the screen's title.
      sx={{
        minWidth: 120,
        maxWidth: 320,
        flex: '0 1 auto',
        '& .MuiNativeSelect-select': {
          minHeight: 48,
          boxSizing: 'border-box',
          py: '11px',
          fontSize: '1.1875rem',
          fontWeight: 700,
          lineHeight: 1.4,
          letterSpacing: '-0.005em',
        },
      }}
    >
```
(the `label`, `size` and `inputLabel` props go; the children stay).

- [ ] **Step 4: The quiet version text** — add above `VersionLabel`:

```tsx
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

/**
 * The version on the machine, quietly: "v4 · Blooming Espresso". When the
 * title is just the bag's name and the version, the name (already in the
 * picker) is only read out, not shown twice.
 */
function VersionText({ version, bagName }: { version: ProfileVersion | null; bagName: string }) {
  if (!version) {
    return (
      <Typography data-testid={TID.activeVersion} variant="body2" component="span" noWrap sx={{ color: 'text.secondary' }}>
        No profile yet
      </Typography>
    );
  }
  const suffix = `v${version.version}`;
  const repeatsBag = version.title === `${bagName} ${suffix}`;
  return (
    <Typography
      data-testid={TID.activeVersion}
      variant="body2"
      component="span"
      sx={{ display: 'flex', minWidth: 0, maxWidth: 360, color: 'text.secondary', whiteSpace: 'nowrap' }}
    >
      <Box component="span" sx={{ color: 'text.primary', fontWeight: 650, display: 'flex', minWidth: 0 }}>
        {repeatsBag ? (
          <>
            <Box component="span" sx={visuallyHidden}>
              {`${bagName} `}
            </Box>
            <span>{suffix}</span>
          </>
        ) : (
          <VersionLabel title={version.title} version={version.version} />
        )}
      </Box>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
        {' · '}
        {templateName(version.templateId)}
      </Box>
    </Typography>
  );
}
```
Add the imports: `import type { Bag, ProfileVersion } from '../../storage/types.ts';` (extend the existing `Bag` import) and `import { templateName } from '../history/historyModel.ts';`.

In `CoachScreen`, the header `Chip` block

```tsx
          {activeBag ? (
            <Chip
              data-testid={TID.activeVersion}
              ...
            />
          ) : null}
```
becomes
```tsx
          {activeBag ? <VersionText version={activeVersion} bagName={activeBag.name} /> : null}
```
remove the now-unused `Chip` import, and change the header `Stack`'s `sx` to
`sx={{ alignItems: 'center', flexWrap: 'wrap', minHeight: 64, px: 1.5, py: 0.5, columnGap: 1.25, borderBottom: 1, borderColor: 'divider' }}` (drop `spacing={1}`; keep `direction`, `useFlexGap`, `component`, `aria-label`).

Undo and New bag in the header: `variant="outlined"` becomes `variant="tonal"` on both.

- [ ] **Step 5: The chat lane and the barista's bubble** — in `src/ui/chat/ChatSurface.tsx`, add to `chatSx` (after the bubble rules):

```ts
  // A comfortable line length on a wide pane: the thread and the composer centre.
  '& .MuiChatMessageList-content': { maxWidth: 680, width: '100%', mx: 'auto' },
  '& .MuiChatComposer-root': { maxWidth: 760, width: '100%', mx: 'auto' },
  // The barista's own words sit on a quiet tonal bubble; the accent is kept for actions.
  '& .MuiChatMessage-roleUser .MuiChatMessage-bubble': { bgcolor: 'cafai.raised', color: 'text.primary' },
```

- [ ] **Step 6: Tonal Undo on the change card** — in `src/ui/chat/parts/DiffCard.tsx`, the applied-state Undo button's `variant="outlined"` becomes `variant="tonal"`.

- [ ] **Step 7: Run the chat tests**

Run: `cd /e/source/cafai && npx vitest run src/ui/chat > /tmp/t7.log 2>&1; echo exit=$?; tail -8 /tmp/t7.log`
Expected: exit=0. `ChatSurface.test.tsx` checks paragraph margins (12px); those come from `RichText` and must not change.

- [ ] **Step 8: Typecheck and lint**

Run: `cd /e/source/cafai && npm run typecheck > /tmp/tc.log 2>&1; echo exit=$?; npx eslint src/ui/chat; echo lint=$?`
Expected: `exit=0`, `lint=0`.

- [ ] **Step 9: Report back** (commit: `feat: the bag reads as the coach screen's title, the version as quiet text, and the chat keeps a readable width`).

---

### Task 8: History and Settings

**Files:**
- Modify: `src/ui/history/HistoryScreen.tsx`, `src/ui/settings/SettingsScreen.tsx`

- [ ] **Step 1: History header and rows** — in `src/ui/history/HistoryScreen.tsx`:

Export and Import buttons in the header: `variant="outlined"` becomes `variant="tonal"` on both.

`IterationRow`'s box loses its 2 px side rule (a coloured side stripe is not used anywhere in the new look):
```tsx
    <Box data-testid={TID.historyIteration(record.id)} sx={{ py: 0.75, display: 'grid', gap: 0.25 }}>
```
and in `VersionCard` and in the "Shots without a profile version" paper, the boxes that list iteration rows (`sx={{ mt: 1.25, display: 'grid', gap: 1 }}` and `sx={{ display: 'grid', gap: 1 }}`) become hairline-separated lists:
```tsx
        <Box sx={{ mt: 1, display: 'grid', '& > * + *': { borderTop: 1, borderColor: 'divider' } }}>
```
and
```tsx
          <Box sx={{ display: 'grid', '& > * + *': { borderTop: 1, borderColor: 'divider' } }}>
```

- [ ] **Step 2: Settings** — in `src/ui/settings/SettingsScreen.tsx`, the "Forget key" button next to Save key: `variant="outlined"` becomes `variant="tonal"` (keep `color="error"`).

- [ ] **Step 3: Run their tests**

Run: `cd /e/source/cafai && npx vitest run src/ui/history src/ui/settings > /tmp/t8.log 2>&1; echo exit=$?; tail -8 /tmp/t8.log`
Expected: exit=0.

- [ ] **Step 4: Typecheck and lint**

Run: `cd /e/source/cafai && npm run typecheck > /tmp/tc.log 2>&1; echo exit=$?; npx eslint src/ui/history src/ui/settings; echo lint=$?`
Expected: `exit=0`, `lint=0`.

- [ ] **Step 5: Report back** (commit: `feat: tonal buttons and hairline rows in History and Settings`).

---

### Task 9: Stage 1 verification and decisions (controller)

**Files:**
- Modify: `DECISIONS.md`

- [ ] **Step 1: Full unit suite, typecheck, lint, build, zip**

Run: `cd /e/source/cafai && npm run typecheck > /tmp/v.log 2>&1 && npm run lint >> /tmp/v.log 2>&1 && npm test >> /tmp/v.log 2>&1 && npm run build >> /tmp/v.log 2>&1 && npm run release:zip >> /tmp/v.log 2>&1; echo exit=$?; grep -E "Tests |Test Files|ok -|error" /tmp/v.log | tail -6`
Expected: exit=0; test count at least 2047 + the new tests.

- [ ] **Step 2: End-to-end at the three tablet sizes** (no other server may hold port 4174, or Playwright reuses its stale build)

Run (PowerShell): `Get-NetTCPConnection -LocalPort 4174 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` then `cd /e/source/cafai && npm run e2e > /tmp/e2e.log 2>&1; echo exit=$?; tail -15 /tmp/e2e.log`
Expected: exit=0, every spec passing in `tablet-962x602`, `tablet-1280x800`, `tablet-1920x1200`.

- [ ] **Step 3: Chromium 91**

Run: `cd /e/source/cafai && npm run build:mock > /tmp/c91.log 2>&1 && npm run smoke:chrome91 >> /tmp/c91.log 2>&1 && npm run smoke:chrome91:loop >> /tmp/c91.log 2>&1; echo exit=$?; grep -E '"ok"|problems|failed' /tmp/c91.log | tail -6; grep -c "oklch(\|color-mix(" dist/assets/*.css dist/assets/*.js | grep -v ":0" || echo "no oklch/color-mix in the bundle"`
Expected: exit=0, both runs `"ok": true` with no problems; no `oklch(` or `color-mix(` in the bundle.

- [ ] **Step 4: Look at it** — screenshots of the demo (`http://localhost:5175/?demo=1`, a dev server on this working tree) at 962x602 and 1280x800 on the coach, history and settings routes, and mid-shot. Compare with `test-results/ux-shots/*-coach.png` from before. Check: Figtree everywhere (arrows render), tonal buttons, sentence-case labels, units muted, version text, no overflow at 962x602, and that the chat lane is centred at 1280.

- [ ] **Step 5: Record the decisions** — append to `DECISIONS.md`, as a new section after "Demo mode (2026-10-06)":

```markdown
## UX: modes and theme (2026-10-07)

The owner's brief: a tablet and a phone mode, the shot taking the screen,
nicer typography, and colours bound to a palette (light or dark plus a
tint). Design: docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md.

- **D80. One palette from a tint and a mode.** `src/ui/palette.ts` builds
  every colour from a tint (hue, accent chroma, neutral chroma) in OKLCH and
  writes plain hex (`src/ui/color.ts`), because Chromium 91 understands
  neither oklch() nor color-mix(). Success, warning, error, info and the
  shot graph's series never follow the tint (pressure green, flow blue, as
  on Decent's charts). `palette.test.ts` sweeps every named tint and every
  hue 0-359 in both modes against WCAG AA for each pair the UI draws; the
  spec's starting lightness for light-mode success (0.55) and warning (0.60)
  failed it and became 0.50 and 0.52. Components read colours only through
  the MUI theme (`theme.palette.cafai` for raised, accentSoft, live and the
  graph); secondary actions use a theme-level `tonal` Button variant.
- **D81. Figtree, with Roboto's arrows as a fallback family.** Figtree
  (variable, latin, upright and italic, about 20 KB each) replaces Roboto's
  three latin weights. Its latin subset lacks → and ←, which CafAI prints,
  so Roboto's symbols faces stay, renamed `CafAI Symbols`, listed right
  after Figtree. LICENSE-FIGTREE.txt joins the zip (amends D49). Labels are
  sentence case; live numbers use tabular figures with muted units.
```

- [ ] **Step 6: Commit** (`docs: D80 the palette, D81 Figtree`), then mark stage 1 complete.
