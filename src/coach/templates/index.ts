/**
 * The five coach templates and their bounded levers.
 *
 * Each template is a bundled Decaid profile, copied byte-for-byte into
 * ./source and normalized once here, plus the levers the model may move.
 * Lever ids are fixed by docs/briefs/ENGINE_PROTOCOL.md; paths, bounds,
 * granularity and per-iteration maximum change come from
 * docs/verified/03-profiles.md section 9. Everything not reachable through a
 * lever stays exactly as Decaid ships it, so a version with every lever at its
 * template value hashes to the bundled default's id.
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
    description: `Hotter extracts more: less sour, more bitter. Every step moves by the same amount, ${shape}.`,
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
      'Where the shot stops (grams in the cup). More yield is a longer ratio: lighter, less intense and more extracted, so less sour. Less yield is stronger and heavier.',
  };
}

const blooming: Template = {
  id: 'blooming-espresso',
  name: 'Blooming Espresso',
  style: 'Blooming',
  shape: 'Fill at 4 ml/s, 30 s bloom with the pump off, then a flat 2.2 ml/s pour',
  description:
    "Scott Rao's blooming shot: wet the puck, let it rest with the pump off, then pour at a steady flow. High, sweet extraction for light and complex coffees, especially washed ones.",
  roastFit: ['light', 'medium-light'],
  decaidDefaultId: 'profile:7438cb7266f60558b48f',
  source: source('Blooming_espresso.json'),
  profile: normalizeProfile(bloomingSource),
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
        'How long the wet puck rests with the pump off. A longer bloom extracts more and sweetens light roasts; a shorter one tastes brighter.',
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
        'Water flow after the bloom (the ramp and the flat pour together). Higher is a faster, lighter shot; lower gives more contact time and body.',
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
        "Grams that drip into the cup before the pour starts. A longer soak extracts more and sweetens. Without a scale the soak's 60 s time limit decides instead.",
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
        'The pressure cap during the pour, which acts as the peak pressure. Higher lets a tight puck build more body; lower is gentler and less prone to channeling.',
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
    "Damian Brakel's Londinium R lever-machine style: a soak, a 9 bar peak, then a slowly falling pressure. Big body and a syrupy texture for medium to dark roasts; it forgives imperfect puck prep.",
  roastFit: ['medium', 'medium-dark', 'dark'],
  decaidDefaultId: 'profile:729d284747718d27c93a',
  source: source('Londonium.json'),
  profile: normalizeProfile(londoniumSource),
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
        "The lever's top pressure. Higher gives more body and intensity; lower (6-7 bar) is gentler and clearer.",
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
        'Where the pressure falls to at the end of the shot. Lower is gentler with a less bitter finish; higher keeps more strength.',
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
  shape: 'One steady 4.5 ml/s pour capped at 8.6 bar, stopping at 135 g',
  description:
    "Scott Rao's allongé: a long, fast shot at a steady 4.5 ml/s through a coarse espresso grind, aiming for an 8-9 bar peak in 35-40 s at about 1:5 (the default stop of 135 g is longer for doses under 27 g). A fruit bomb for very light, washed, high-grown coffees. Advanced: small grind or dose moves swing the pressure a lot.",
  roastFit: ['light'],
  decaidDefaultId: 'profile:372f1be4c5e3641bbfe2',
  source: source('rao_allonge.json'),
  profile: normalizeProfile(allongeSource),
  levers: [
    temperatureLever('steps[1].temperature', 88, 96, 'and both steps share one temperature'),
    // Decent's own 135 g stop is the ceiling (it is v1, so it must stay valid)
    // and is 1:7.5 at an 18 g dose, so the ratio window reaches it. The notes
    // aim for about 1:5, which the window also covers.
    yieldLever(50, 135, { min: 4.0, max: 7.5 }, 10),
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
        'Pump flow after the first 2 s (the step names keep saying 4.5 ml/s). Lower gives more contact time and less pressure: stronger and sweeter. Higher is faster, with more pressure and a lighter cup.',
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
    "Decent's easiest espresso: a fast fill, a low 6 bar peak and a slow decline to 4 bar, with flow capped at 4 ml/s so a weak spot in the puck cannot gush. Low acidity and little channeling; for beginners, milk drinks, and medium to dark roasts.",
  roastFit: ['medium', 'medium-dark', 'dark'],
  decaidDefaultId: 'profile:1baa29bd9d9dc6d47f2a',
  source: source('Gentle_and_sweet1.json'),
  profile: normalizeProfile(gentleSource),
  levers: [
    temperatureLever('steps[3].temperature', 84, 92, 'and all five steps share one temperature'),
    yieldLever(25, 60, { min: 1.5, max: 2.5 }),
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
        'The top pressure, held after the fill. Higher gives more body and intensity; lower is gentler and clearer and channels less.',
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
        'Where the pressure falls to over the last 30 s. Lower is gentler with a softer, less bitter finish; higher keeps more strength.',
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
        'Seconds the peak holds (after a 3 s rise) before the decline starts. Longer gives more body and strength; shorter reaches the gentle decline sooner, for a softer, sweeter cup.',
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
