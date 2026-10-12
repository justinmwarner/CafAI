/**
 * The five coach templates and their bounded levers.
 *
 * Each template is a bundled Decaid profile, copied byte-for-byte into
 * ./source and normalized once here, plus the levers the model may move.
 * Lever ids are fixed by docs/briefs/ENGINE_PROTOCOL.md; paths, bounds,
 * granularity and per-iteration maximum change come from
 * docs/verified/03-profiles.md section 9. Everything not reachable through a
 * lever stays exactly as Decaid ships it, so a version with every lever at its
 * template value hashes to the bundled default's id. v1 itself starts at the
 * author's brew ratio times the dose (`startRatio`, start.ts), not at the
 * bundled stop.
 *
 * The registry is deep-frozen: clone() a profile before changing it.
 */
import { normalizeProfile } from '../profile.ts';
import type { Lever, LeverConstraint, Template } from '../types.ts';
import bloomingSource from './source/Blooming_espresso.json';
import dflowSource from './source/D-Flow____default.json';
import gentleSource from './source/Gentle_and_sweet1.json';
import londoniumSource from './source/Londonium.json';
import allongeSource from './source/rao_allonge.json';

const DECAID_REPO = 'decentespresso/decaid';
const DECAID_COMMIT = 'a45961b323831d2170b3e7f3fef7c72fdd341642';

const source = (file: string) => ({ repo: DECAID_REPO, file: `assets/defaultProfiles/${file}`, commit: DECAID_COMMIT });

function temperatureLever(anchor: string, min: number, max: number, shape: string): Lever {
  return {
    id: 'temp',
    label: 'Brew temperature',
    unit: '°C',
    mode: 'uniformShift',
    paths: ['steps[*].temperature'],
    anchor,
    min,
    max,
    granularity: 0.5,
    maxDelta: 2,
    description: `Hotter extracts more; cooler extracts less. Every step moves by the same amount, ${shape}.`,
  };
}

/**
 * Stop-at-weight reads the workflow's targetYield and only a scale can measure
 * it, so every yield lever needs one. `maxDelta` defaults to 4 g, about 7-10%
 * of an espresso yield; a long ratio takes proportionally bigger steps.
 */
function yieldLever(min: number, max: number, ratio: { min: number; max: number }, maxDelta = 4): Lever {
  return {
    id: 'yield',
    label: 'Yield',
    unit: 'g',
    mode: 'linked',
    paths: ['target_weight'],
    min,
    max,
    doseRatio: ratio,
    granularity: 1,
    maxDelta,
    workflowContextKey: 'targetYield',
    requiresScale: true,
    description:
      'Where the shot stops (grams in the cup). More yield is a longer ratio: more water through the same coffee, more extracted and more dilute. Less yield is shorter and more concentrated.',
  };
}

// After the bloom the pour runs a 5 s ramp, 20 s at the flow and a 1 s
// pump-off tail, then the profile ends: about 22.5 s x flow of water (49.5 ml
// at 2.2 ml/s) on top of the ~8 g the bloom drips. The description says so,
// so the coach does not propose yields the pour can never reach.
const blooming: Template = {
  id: 'blooming-espresso',
  name: 'Blooming Espresso',
  style: 'Blooming',
  shape: 'Fill at 4 ml/s, 30 s bloom with the pump off, then a flat 2.2 ml/s pour',
  description:
    "Scott Rao's blooming shot: wet the puck, let it rest with the pump off, then pour at a steady flow. The rest saturates the puck so dense light roasts extract high and evenly, especially washed ones. Its pour stops 26 s after the bloom, so the cup tops out near the bloom's drip plus about 22.5 s x the flow (about 57 g at 2.2 ml/s); above that, more yield needs more flow.",
  roastFit: ['light', 'medium-light'],
  decaidDefaultId: 'profile:7438cb7266f60558b48f',
  source: source('Blooming_espresso.json'),
  profile: normalizeProfile(bloomingSource),
  // 1:2.8 (D57): Rao's bloom post reaches 24% extraction at 8.5% TDS, and
  // Decent's best-practice light profile pulls "18g in, 50g out".
  startRatio: 2.8,
  levers: [
    temperatureLever('steps[4].temperature', 86, 94, 'keeping the hot fill, the cooler bloom and the 92 °C pour'),
    yieldLever(30, 80, { min: 2.0, max: 3.5 }),
    {
      id: 'bloom',
      label: 'Bloom time',
      unit: 's',
      mode: 'linked',
      paths: ['steps[2].seconds'],
      min: 10,
      max: 40,
      granularity: 1,
      maxDelta: 5,
      description:
        'How long the wet puck rests with the pump off. A longer bloom saturates it more evenly and extracts more; a shorter one extracts less.',
    },
    {
      id: 'piExit',
      label: 'Bloom starts at pressure',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[1].exit.value'],
      min: 2,
      max: 6,
      granularity: 0.5,
      maxDelta: 1,
      description:
        'The pressure that ends the fill and starts the bloom. Higher means a fuller, more saturated puck before it rests, and usually more drips during the bloom.',
    },
    {
      id: 'flow',
      label: 'Extraction flow',
      unit: 'ml/s',
      mode: 'linked',
      paths: ['steps[3].flow', 'steps[4].flow'],
      min: 1.5,
      max: 3.5,
      granularity: 0.1,
      maxDelta: 0.4,
      description:
        'Water flow after the bloom (the ramp and the flat pour together). Higher is a faster shot with less contact time; lower gives more contact time and extracts more.',
    },
  ],
  constraints: [],
};

const dflow: Template = {
  id: 'd-flow',
  name: 'D-Flow',
  style: 'D-Flow',
  shape: 'Fill and soak at 3 bar until 4 g drip, then pour at 1.7 ml/s (max 8.5 bar)',
  description:
    "Damian Brakel's D-Flow: a gentle pressure soak until the first drips, then a steady flow pour capped at 8.5 bar. A forgiving all-rounder for medium-light and medium roasts.",
  roastFit: ['medium-light', 'medium'],
  decaidDefaultId: 'profile:59036f8846b1ed3b4255',
  source: source('D-Flow____default.json'),
  profile: normalizeProfile(dflowSource),
  // 1:2.8 (D57): Damian's D-Flow plugin stops at 50 g for 18 g by default.
  startRatio: 2.8,
  levers: [
    temperatureLever('steps[2].temperature', 84, 94, 'and all three steps share one temperature'),
    yieldLever(30, 70, { min: 1.8, max: 3.0 }),
    {
      id: 'soak',
      label: 'Fill & soak pressure',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[0].pressure', 'steps[1].pressure'],
      min: 2,
      max: 6,
      granularity: 0.5,
      maxDelta: 1,
      description:
        'Pressure while the puck fills and soaks. Higher saturates it faster and more evenly; lower is gentler on a fine grind.',
    },
    {
      id: 'soakWeight',
      label: 'Soak until (drips in cup)',
      unit: 'g',
      mode: 'linked',
      paths: ['steps[1].weight'],
      min: 2,
      max: 8,
      granularity: 1,
      maxDelta: 2,
      requiresScale: true,
      description:
        "Grams that drip into the cup before the pour starts. A longer soak saturates the puck more and extracts more. Without a scale the soak's 60 s time limit decides instead.",
    },
    {
      id: 'pourFlow',
      label: 'Pour flow',
      unit: 'ml/s',
      mode: 'linked',
      paths: ['steps[2].flow'],
      min: 1,
      max: 3,
      granularity: 0.1,
      maxDelta: 0.3,
      description:
        'Flow during the pour. Lower means more contact time: stronger and more extracted. Higher is faster and lighter.',
    },
    {
      id: 'pourPmax',
      label: 'Max pressure while pouring',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[2].limiter.value'],
      min: 6,
      max: 10,
      granularity: 0.5,
      maxDelta: 1,
      description:
        'The pressure cap during the pour, which acts as the peak pressure. Higher lets a tight puck build more pressure and extract more; lower is gentler and less prone to channeling.',
    },
  ],
  constraints: [],
};

/** Londonium and Gentle and Sweet: the pressure has to fall after the peak, or there is no decline. */
const peakAboveDeclineEnd: LeverConstraint = {
  kind: 'minGap',
  higher: 'peak',
  lower: 'declineEnd',
  minGap: 1,
  message: 'Peak pressure must stay at least 1.0 bar above the decline end pressure.',
};

const londonium: Template = {
  id: 'londonium',
  name: 'Londonium',
  style: 'Lever',
  shape: 'Fill, 12 s soak at 3 bar, a 9 bar peak, then a decline to 3 bar',
  description:
    "Damian Brakel's Londinium R lever-machine style: a soak, a 9 bar peak, then a slowly falling pressure that eases off as the puck erodes. Suits medium to dark roasts, which extract readily; it forgives imperfect puck prep.",
  roastFit: ['medium', 'medium-dark', 'dark'],
  decaidDefaultId: 'profile:729d284747718d27c93a',
  source: source('Londonium.json'),
  profile: normalizeProfile(londoniumSource),
  // 1:2 (D57): the profile is identical to Damian's LRv2, which stops at 36 g,
  // and Decent pulls a Londinium 18 g -> 36 g.
  startRatio: 2.0,
  levers: [
    temperatureLever('steps[4].temperature', 84, 92, 'keeping the 89 / 88.5 / 88 °C shape'),
    yieldLever(25, 60, { min: 1.5, max: 2.8 }),
    {
      id: 'soak',
      label: 'Soak time',
      unit: 's',
      mode: 'linked',
      paths: ['steps[2].seconds'],
      min: 4,
      max: 24,
      granularity: 1,
      maxDelta: 4,
      description:
        'Seconds the puck soaks at 3 bar before the peak. A longer soak evens out extraction and helps light or dense coffee.',
    },
    {
      id: 'peak',
      label: 'Peak pressure',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[3].pressure'],
      min: 6,
      max: 10,
      granularity: 0.5,
      maxDelta: 1,
      description:
        "The lever's top pressure. Higher pushes harder and extracts more; lower (6-7 bar) is gentler and channels less.",
    },
    {
      id: 'declineEnd',
      label: 'Decline end pressure',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[4].pressure', 'steps[5].pressure'],
      min: 2,
      max: 6,
      granularity: 0.5,
      maxDelta: 1,
      description:
        'Where the pressure falls to at the end of the shot. Lower eases off and extracts less late in the shot; higher keeps pushing and extracts more.',
    },
  ],
  constraints: [peakAboveDeclineEnd],
};

// Both steps are named "hold at 4.5 ml/s" with the same flow and pressure cap.
// Step 0 is a fixed 2 s start; the levers act on step 1, the pour, so a diff
// line never adds the step name, which keeps saying 4.5 ml/s after a change.
const allonge: Template = {
  id: 'allonge',
  name: 'Rao Allongé',
  style: 'Allongé',
  shape: 'One steady 4.5 ml/s pour capped at 8.6 bar, stopping at about 5x the dose',
  description:
    "Scott Rao's allongé: a long, fast shot at a steady 4.5 ml/s through a coarse espresso grind, aiming for an 8-9 bar peak in 35-40 s. It stops at about 5x the dose (90 g for 18 g). The fast, high flow pushes a lot of water through very light, washed, high-grown coffees that resist extraction. Advanced: small grind or dose moves swing the pressure a lot.",
  roastFit: ['light'],
  decaidDefaultId: 'profile:372f1be4c5e3641bbfe2',
  source: source('rao_allonge.json'),
  profile: normalizeProfile(allongeSource),
  // 1:5 (D57): its own notes say "5:1 ratio".
  startRatio: 5.0,
  levers: [
    temperatureLever('steps[1].temperature', 88, 96, 'and both steps share one temperature'),
    // 4-6 x dose: Decent pours an allongé "5:1 or 6:1", and beginners about
    // 4:1. The 135 g ceiling is Decent's bundled stop (1:5.4 at a 25 g dose),
    // which D35's hard bound keeps valid; v1 no longer starts there (D57).
    yieldLever(50, 135, { min: 4.0, max: 6.0 }, 10),
    {
      id: 'flow',
      label: 'Flow rate',
      unit: 'ml/s',
      mode: 'linked',
      paths: ['steps[1].flow'],
      min: 3.5,
      max: 5.5,
      granularity: 0.1,
      maxDelta: 0.5,
      description:
        'Pump flow after the first 2 s (the step names keep saying 4.5 ml/s). Lower gives more contact time and less pressure, so it extracts more. Higher is faster, with more pressure and less contact time.',
    },
    {
      id: 'maxPressure',
      label: 'Max pressure',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[1].limiter.value'],
      min: 6,
      max: 10,
      granularity: 0.1,
      maxDelta: 1,
      description:
        'The pressure cap during the pour; the flow eases off when a tight puck reaches it. Higher lets the shot keep its 8-9 bar peak; lower is gentler and less prone to channeling.',
    },
  ],
  constraints: [],
};

const gentle: Template = {
  id: 'gentle-and-sweet',
  name: 'Gentle and Sweet',
  style: 'Low pressure',
  shape: 'Fast fill, rise to 6 bar and hold 13 s, then a slow decline to 4 bar',
  description:
    "Decent's easiest espresso: a fast fill, a low 6 bar peak and a slow decline to 4 bar, with flow capped at 4 ml/s so a weak spot in the puck cannot gush. The low pressure keeps extraction gentle and channeling rare; for beginners, milk drinks, and medium to dark roasts.",
  roastFit: ['medium', 'medium-dark', 'dark'],
  decaidDefaultId: 'profile:1baa29bd9d9dc6d47f2a',
  source: source('Gentle_and_sweet1.json'),
  profile: normalizeProfile(gentleSource),
  // 1:2 (D57): Decent's guide calls for "a 1:2 ratio", and the file ships 36 g.
  startRatio: 2.0,
  levers: [
    temperatureLever('steps[3].temperature', 84, 92, 'and all five steps share one temperature'),
    // Up to 3 x dose: Decent's guide pulls it "1:2 or 1:3".
    yieldLever(25, 60, { min: 1.5, max: 3.0 }),
    {
      id: 'peak',
      label: 'Peak pressure',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[2].pressure', 'steps[3].pressure'],
      min: 4,
      max: 8,
      granularity: 0.5,
      maxDelta: 1,
      description:
        'The top pressure, held after the fill. Higher pushes harder and extracts more; lower is gentler and channels less.',
    },
    {
      id: 'declineEnd',
      label: 'Decline end pressure',
      unit: 'bar',
      mode: 'linked',
      paths: ['steps[4].pressure'],
      min: 2,
      max: 6,
      granularity: 0.5,
      maxDelta: 1,
      description:
        'Where the pressure falls to over the last 30 s. Lower eases off and extracts less late in the shot; higher keeps pushing and extracts more.',
    },
    {
      id: 'hold',
      label: 'Peak hold time',
      unit: 's',
      mode: 'linked',
      paths: ['steps[3].seconds'],
      min: 5,
      max: 25,
      granularity: 1,
      maxDelta: 4,
      description:
        'Seconds the peak holds (after a 3 s rise) before the decline starts. Longer keeps the pressure up and extracts more; shorter reaches the gentle decline sooner and extracts less.',
    },
  ],
  constraints: [peakAboveDeclineEnd],
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Blooming, D-Flow, Londonium, Rao Allongé, Gentle and Sweet: the order of TEMPLATE_IDS. */
export const TEMPLATES: readonly Template[] = deepFreeze([blooming, dflow, londonium, allonge, gentle]);

/** The template with this id, or undefined. */
export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
