/**
 * Latte Art's pours (D228, D-LATTE-1): each a timeline of the unseen
 * pitcher, key by key, for latteModel.ts to pour from. A key says where the
 * stream lands, how high the pitcher is, how much milk comes and how wide it
 * wiggles; between two keys the pitcher eases from one to the next, or keeps
 * an even pace (a slow draw back, a line drawn).
 *
 * The pours are the real ones, slowed to about 25 s for the eye:
 * - a heart: a disc poured in one place, then cut by a pull-through across it;
 * - a tulip: discs poured one behind the other, each pushing those before it
 *   forward into nested crescents, then a pull-through;
 * - a rosetta: a wiggle while the pitcher draws back, the foam pushed forward
 *   into a stack of thin wavy leaves, then a pull-through to the front;
 * - a swan: a rosetta's wings off to one side, then a neck drawn as an S and
 *   a small heart for its head.
 *
 * Every pour starts high, the stream diving under the crema (the base), and
 * comes down to the surface for the foam to show. Units are the coffee's
 * radius: x across, y toward the front of the cup, which is down the screen.
 */

export type PourId = 'heart' | 'tulip' | 'rosetta' | 'swan';

export interface PitcherKey {
  /** Seconds into the pour. */
  t: number;
  /** Where the stream lands, before its wiggle. */
  x: number;
  y: number;
  /** 0 is the spout at the surface, where the foam comes up; 1 is high, the stream diving under. */
  height: number;
  /** How much milk comes, 0 to 1. */
  flow: number;
  /** Half the width of the wiggle, side to side (0: none). */
  wiggle: number;
  /** Which way the stream pushes the surface, in radians from the front of the cup (down the screen) toward the right. 0 when left out. */
  heading?: number;
  /** How much more of the surface the stream pushes ahead than behind: 0 (evenly all round, when left out) to 1. */
  lean?: number;
  /** How the pitcher comes here from the key before: easing in and out (the default), or at an even pace. */
  pace?: 'eased' | 'even';
}

export interface Choreography {
  id: PourId;
  /** As it shows under the cup. */
  name: string;
  /** Seconds: the last key's moment. */
  duration: number;
  /** Wiggles a second, while the pitcher wiggles. */
  wiggleRate: number;
  keys: readonly PitcherKey[];
}

/** The pitcher at one moment: where its stream lands (the wiggle in), how high, how much, which way it pushes and how much ahead. */
export interface PitcherState {
  x: number;
  y: number;
  height: number;
  flow: number;
  heading: number;
  lean: number;
}

export function createPitcherState(): PitcherState {
  return { x: 0, y: 0, height: 1, flow: 0, heading: 0, lean: 0 };
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Writes the pitcher at `t` seconds into `choreo` into `out`; before the first key it is the first key, after the last the last. */
export function pitcherAt(choreo: Choreography, t: number, out: PitcherState): PitcherState {
  const keys = choreo.keys;
  let next = 0;
  while (next < keys.length && keys[next]!.t <= t) next += 1;
  const after = keys[Math.min(next, keys.length - 1)]!;
  const before = keys[Math.max(0, next - 1)]!;
  const span = after.t - before.t;
  const raw = span > 0 ? Math.min(1, Math.max(0, (t - before.t) / span)) : 1;
  const k = after.pace === 'even' ? raw : ease(raw);
  const heading = (before.heading ?? 0) + ((after.heading ?? 0) - (before.heading ?? 0)) * k;
  const wiggle = before.wiggle + (after.wiggle - before.wiggle) * k;
  const sway = wiggle * Math.sin(2 * Math.PI * choreo.wiggleRate * t);
  // The wiggle is side to side: across the way the stream pushes.
  out.x = before.x + (after.x - before.x) * k + sway * Math.cos(heading);
  out.y = before.y + (after.y - before.y) * k - sway * Math.sin(heading);
  out.height = before.height + (after.height - before.height) * k;
  out.flow = before.flow + (after.flow - before.flow) * k;
  out.heading = heading;
  out.lean = (before.lean ?? 0) + ((after.lean ?? 0) - (before.lean ?? 0)) * k;
  return out;
}

/** The base every pour starts with: high, the milk diving under the crema and stirring it, until `until` seconds. */
function base(until: number, x = 0, y = 0): PitcherKey[] {
  return [
    { t: 0, x, y, height: 1, flow: 0, wiggle: 0 },
    { t: 1, x, y, height: 1, flow: 0.7, wiggle: 0 },
    { t: until, x, y, height: 1, flow: 0.7, wiggle: 0 },
  ];
}

/**
 * The heart: down to the surface in the middle, where the white comes up and
 * grows into a disc; then up and away to just behind it, and a thin stream
 * drawn across it and out past it: the cleft where it goes in, the point where
 * it comes out.
 */
const HEART: Choreography = {
  id: 'heart',
  name: 'Heart',
  duration: 25,
  wiggleRate: 0,
  keys: [
    ...base(6, 0, -0.15),
    { t: 8, x: 0, y: -0.25, height: 0.05, flow: 0.9, wiggle: 0 },
    { t: 18, x: 0, y: -0.25, height: 0.05, flow: 0.9, wiggle: 0 },
    { t: 18.6, x: 0, y: -0.25, height: 0.7, flow: 0, wiggle: 0 },
    { t: 19.2, x: 0, y: -0.85, height: 0.55, flow: 0, wiggle: 0 },
    { t: 19.5, x: 0, y: -0.85, height: 0.55, flow: 0.45, wiggle: 0 },
    { t: 21.2, x: 0, y: 0.63, height: 0.55, flow: 0.45, wiggle: 0 },
    { t: 21.7, x: 0, y: 0.67, height: 1, flow: 0, wiggle: 0 },
    { t: 25, x: 0, y: 0.67, height: 1, flow: 0, wiggle: 0 },
  ],
};

/** The tulip's discs: where each lands (one behind the other) and when it pours. */
const TULIP_DISCS: ReadonlyArray<readonly [y: number, from: number, to: number]> = [
  [0.1, 6, 9],
  [-0.22, 10.3, 12.6],
  [-0.48, 13.6, 15.4],
  [-0.7, 16.4, 17.6],
];

/**
 * The tulip: four discs, each poured just behind the last with the stream
 * leaning forward, so it pushes the ones before it forward into crescents round
 * it; between them the pitcher lifts and the milk dives. Then a thin
 * pull-through from behind the top one out past the first: the top a small
 * heart, the crescents nested hearts.
 */
const TULIP: Choreography = {
  id: 'tulip',
  name: 'Tulip',
  duration: 25,
  wiggleRate: 0,
  keys: [
    ...base(5),
    ...TULIP_DISCS.flatMap(([y, from, to]): PitcherKey[] => [
      { t: from - 0.5, x: 0, y, height: 1, flow: 0.3, wiggle: 0 },
      { t: from, x: 0, y, height: 0.05, flow: 0.9, wiggle: 0, lean: 0.6 },
      { t: to, x: 0, y, height: 0.05, flow: 0.9, wiggle: 0, lean: 0.6 },
      { t: to + 0.35, x: 0, y, height: 1, flow: 0.3, wiggle: 0 },
    ]),
    { t: 19.2, x: 0, y: -0.86, height: 1, flow: 0, wiggle: 0 },
    { t: 19.5, x: 0, y: -0.86, height: 0.55, flow: 0.15, wiggle: 0 },
    { t: 21.2, x: 0, y: 0.8, height: 0.55, flow: 0.15, wiggle: 0 },
    { t: 21.7, x: 0, y: 0.84, height: 1, flow: 0, wiggle: 0 },
    { t: 25, x: 0, y: 0.84, height: 1, flow: 0, wiggle: 0 },
  ],
};

/**
 * The rosetta: down a little forward of the middle, wiggling as it comes, the
 * stream leaning hard forward; drawn back at an even pace, still wiggling, a
 * leaf laid each wiggle and pushed forward onto the ones before; then lifted
 * and pulled through to the front.
 */
const ROSETTA: Choreography = {
  id: 'rosetta',
  name: 'Rosetta',
  duration: 25,
  wiggleRate: 1,
  keys: [
    ...base(4.4),
    { t: 5.2, x: 0, y: 0.2, height: 1, flow: 0.7, wiggle: 0.11 },
    { t: 6.2, x: 0, y: 0.3, height: 0.05, flow: 0.9, wiggle: 0.12, lean: 0.9 },
    { t: 7.5, x: 0, y: 0.27, height: 0.05, flow: 0.9, wiggle: 0.12, lean: 0.9 },
    { t: 17, x: 0, y: -0.6, height: 0.05, flow: 0.9, wiggle: 0.07, lean: 0.9, pace: 'even' },
    { t: 17.5, x: 0, y: -0.66, height: 1, flow: 0, wiggle: 0 },
    { t: 17.8, x: 0, y: -0.7, height: 0.55, flow: 0.2, wiggle: 0 },
    { t: 19.6, x: 0, y: 0.84, height: 0.55, flow: 0.2, wiggle: 0 },
    { t: 20.1, x: 0, y: 0.86, height: 1, flow: 0, wiggle: 0 },
    { t: 25, x: 0, y: 0.86, height: 1, flow: 0, wiggle: 0 },
  ],
};

/** The swan's wing: from its body (where the first, widest leaves go) back to its tip; and the pull-through along it, tip to body. */
const WING = { bodyX: 0.1, bodyY: 0.42, tipX: 0.32, tipY: -0.3 } as const;
const WING_PULL = { fromX: 0.36, fromY: -0.42, toX: 0, toY: 0.62 } as const;
/** Its neck, a cubic from the front of the body up to the head; the head, and where its beak points. */
const NECK = [-0.17, 0.55, -0.9, 0.3, 0.2, -0.05, -0.3, -0.42] as const;
const HEAD = { x: -0.33, y: -0.5, beakX: -0.61, beakY: -0.34 } as const;

function swanKeys(): PitcherKey[] {
  // The wing's leaves are pushed from its tip toward its body.
  const heading = Math.atan2(WING.bodyX - WING.tipX, WING.bodyY - WING.tipY);
  const keys: PitcherKey[] = [
    ...base(4.2),
    { t: 5, x: WING.bodyX * 0.7, y: WING.bodyY * 0.7, height: 1, flow: 0.7, wiggle: 0.126, heading },
    // The wing: a rosetta off to the right, drawn back toward its tip, then pulled through toward its body.
    { t: 6, x: WING.bodyX, y: WING.bodyY, height: 0.05, flow: 0.9, wiggle: 0.14, heading, lean: 0.9 },
    { t: 13.5, x: WING.tipX, y: WING.tipY, height: 0.05, flow: 0.85, wiggle: 0.07, heading, lean: 0.9, pace: 'even' },
    { t: 13.8, x: WING_PULL.fromX, y: WING_PULL.fromY, height: 1, flow: 0, wiggle: 0, heading },
    { t: 14.1, x: WING_PULL.fromX, y: WING_PULL.fromY, height: 0.55, flow: 0.2, wiggle: 0 },
    { t: 15.4, x: WING_PULL.toX, y: WING_PULL.toY, height: 0.55, flow: 0.2, wiggle: 0 },
    { t: 15.8, x: WING_PULL.toX, y: WING_PULL.toY, height: 1, flow: 0, wiggle: 0 },
  ];
  // The neck: a line drawn out of the front of the body as an S, the stream just
  // low enough to lay foam and lifted enough to drag it along.
  const start = 16.4;
  const end = 19;
  const points = 10;
  for (let i = 0; i <= points; i += 1) {
    const s = i / points;
    const u = 1 - s;
    const x = u * u * u * NECK[0] + 3 * u * u * s * NECK[2] + 3 * u * s * s * NECK[4] + s * s * s * NECK[6];
    const y = u * u * u * NECK[1] + 3 * u * u * s * NECK[3] + 3 * u * s * s * NECK[5] + s * s * s * NECK[7];
    if (i === 0) {
      keys.push({ t: start - 0.3, x, y, height: 1, flow: 0, wiggle: 0 });
      keys.push({ t: start, x, y, height: 0.22, flow: 0.45, wiggle: 0 });
    } else {
      keys.push({ t: start + (end - start) * s, x, y, height: 0.22, flow: 0.45, wiggle: 0, pace: 'even' });
    }
  }
  // The head: a small disc at the top of the neck, then a short pull through it, the beak its point.
  const backX = HEAD.x - (HEAD.beakX - HEAD.x) * 0.75;
  const backY = HEAD.y - (HEAD.beakY - HEAD.y) * 0.75;
  keys.push(
    { t: end + 0.4, x: HEAD.x, y: HEAD.y, height: 0.05, flow: 0.6, wiggle: 0 },
    { t: end + 1.6, x: HEAD.x, y: HEAD.y, height: 0.05, flow: 0.6, wiggle: 0 },
    { t: end + 2, x: backX, y: backY, height: 1, flow: 0, wiggle: 0 },
    { t: end + 2.3, x: backX, y: backY, height: 0.55, flow: 0.2, wiggle: 0 },
    { t: end + 3.3, x: HEAD.beakX, y: HEAD.beakY, height: 0.55, flow: 0.2, wiggle: 0 },
    { t: end + 3.7, x: HEAD.beakX, y: HEAD.beakY, height: 1, flow: 0, wiggle: 0 },
    { t: 25, x: HEAD.beakX, y: HEAD.beakY, height: 1, flow: 0, wiggle: 0 },
  );
  return keys;
}

/** The swan: a rosetta's wing off to the right, pulled through toward its body, a neck drawn up out of the body as an S, and a small heart for the head. */
const SWAN: Choreography = {
  id: 'swan',
  name: 'Swan',
  duration: 25,
  wiggleRate: 1.3,
  keys: swanKeys(),
};

/** Every pour. */
export const CHOREOGRAPHIES: Readonly<Record<PourId, Choreography>> = { heart: HEART, tulip: TULIP, rosetta: ROSETTA, swan: SWAN };
