/**
 * The scripted coach's words, apart from its decisions. scenario.ts decides
 * every reply (which rule fires, which tool, which values) and hands a voice
 * the facts it may mention; the voice only writes the text. Two voices:
 *
 *   - terse (the default): the short test strings the unit and e2e tests pin.
 *   - demo (demoVoice.ts): fuller coaching prose for `npm run demo` (D76).
 *
 * Facts carry only what the request said (null when it did not), so a voice
 * never has a number to invent. Both follow the coach's taste rules (D127):
 * the barista's own words are the reason for a change, what it does at the
 * machine is its effect, and no voice says how a shot will taste.
 */
import type { RoastLevel, TemplateId } from '../../src/coach/contract.ts';
import { changeIn, type TemperatureUnit } from '../../src/coach/temperature.ts';

export type VoiceName = 'terse' | 'demo';

/** What the latest taste answer names (tapped, or typed instead: rule 3b), read as the script reads it (the first match wins). */
export type Taste = 'sour' | 'bitter' | 'weak' | 'strong' | 'balanced' | 'other';

/** The change the script proposes. */
export type ChangeKind =
  /** Sour: temperature +1 °C. */
  | 'warmer'
  /** Sour, temperature already at the template's top, and the shot reached its yield: yield +2 g. */
  | 'longerForSour'
  /** Bitter: temperature -1 °C. */
  | 'cooler'
  /** Weak, and the shot reached its yield: yield -2 g. */
  | 'shorter'
  /** Too strong, and the shot reached its yield: yield +2 g. */
  | 'longer'
  /** Balanced: no change. */
  | 'keep'
  /** Anything else, no room on the lever, or a weak or sour shot that stopped short of its yield: one grind step finer. */
  | 'finer'
  /** Too strong, and the yield cannot run longer (the shot stopped short of it, or it is at the template's top): one grind step coarser. */
  | 'coarser'
  /** CafAI rejected a grind move: keep the recipe. */
  | 'keepAfterRejectedGrind';

export interface BagFacts {
  /** From the bag description (save_bag_details' name). */
  name: string;
  roastLevel: RoastLevel | null;
  process: string | null;
  origin: string | null;
  /** The template the script ranks first. */
  topTemplate: TemplateId;
}

export interface PickFacts {
  /** "<Bag> v1", when the result named it. */
  title: string | null;
  /** On the machine; not uploaded; uploaded but not confirmed by the connected machine; saved while it is offline. */
  status: 'loaded' | 'notUploaded' | 'notConfirmed' | 'offline';
  /** Where v1 stops, and the dose it was worked out from. */
  yieldG: number | null;
  doseG: number | null;
}

/** From the [event:shot_completed] payload. */
export interface ShotFacts {
  durationS: number | null;
  yieldG: number | null;
  doseG: number | null;
}

export interface TasteFacts {
  taste: Taste;
  roastLevel: RoastLevel | null;
}

/** How the latest shot ended against the yield its lever aims at. */
export interface ShotStop {
  /** It stopped on weight, or within 1 g of the yield lever: only then can a yield move change the cup. */
  reached: boolean;
  /** What it gave (the summary's yield) and the yield lever, when the shot event said. */
  yieldG: number | null;
  targetG: number | null;
}

export interface ChangeFacts {
  kind: ChangeKind;
  taste: Taste;
  roastLevel: RoastLevel | null;
  /** The setting a grind move lands on, when the script could name one. */
  grindSetting: string | null;
  /**
   * The latest shot's peak pressure and when it came, in seconds from the
   * start of the pour (the summary's time minus its pourStartS, never below
   * 0), from its shot event's summary: the numbers its shot card shows.
   * Without them, the top of a pressure series a get_shot_series result just
   * returned, with no time (a rounded series can tie along a plateau).
   */
  peakPressureBar: number | null;
  peakPressureAtS: number | null;
  /** How the latest shot ended against its yield; null without a shot event. */
  stop: ShotStop | null;
  /** The latest shot's channeling flags (empty: none fired); null when the shot event carried none. */
  channelingFlags: string[] | null;
  /** This change replaces one CafAI rejected. */
  afterRejection: boolean;
  /** The unit the prompt asks for (D-TEMP-7): its "Temperatures in °F" section, or °C. */
  temperatureUnit: TemperatureUnit;
}

export interface AppliedFacts {
  /** A new version on the machine, not confirmed, or saved while offline; a change by hand (grind, dose); no change. */
  status: 'loaded' | 'notConfirmed' | 'offline' | 'manual' | 'kept';
  version: number | null;
  title: string | null;
}

/** A TDS reading from an [event:shot_measured] payload (D-TDS-6): the TDS and its EY, null when the request had none. */
export interface ReadingFacts {
  /** Null: the barista removed the reading. */
  tdsPct: number | null;
  /** Null without a dose or a yield, or with no reading. */
  eyPct: number | null;
}

/** propose_adjustment's free text. */
export interface ProposalText {
  summary: string;
  rationale: string;
  expectedEffect: string;
}

export interface Voice {
  /** Rule 7: the bag described; before save_bag_details and propose_templates. */
  intake(bag: BagFacts): string;
  /** Rule 7b: the starting profiles again. */
  templatesAgain(bag: Pick<BagFacts, 'roastLevel' | 'topTemplate'>): string;
  /** Rule 5: a template was picked. */
  picked(pick: PickFacts): string;
  /** Rule 4: a shot finished; the line before "How did it taste?". */
  shotCompleted(shot: ShotFacts): string;
  /** Rule 3: the taste answer, tapped or typed (3b); the line before get_shot_series. */
  tasteAnswer(answer: TasteFacts): string;
  /** Rule 2: the text before propose_adjustment, or null for the tool call alone. */
  proposalLead(change: ChangeFacts): string | null;
  /** propose_adjustment's summary, rationale and expectedEffect (rules 1 and 2). */
  proposalText(change: ChangeFacts): ProposalText;
  /** Rule 1: CafAI rejected the change; the line before the replacement. */
  rejected(replacement: ChangeFacts): string;
  /** Rule 1: the change was applied. */
  applied(result: AppliedFacts): string;
  /** Rule 1: declined, or not applied. */
  declined(current: { version: number }): string;
  /** Rule 6. */
  undo(back: { to: number; title: string | null }): string;
  /** Rule 8. */
  fallback(): string;
  /** Rule 0b: the line a reply to a turn carrying a TDS reading starts with (D-TDS-9). */
  measured(reading: ReadingFacts): string;
}

/** A TDS as CafAI writes it, to 0.01 ("9.25"); an EY to 0.1 ("20.8"). */
export const tdsText = (tdsPct: number) => tdsPct.toFixed(2);
export const eyText = (eyPct: number) => (Math.round(eyPct * 10) / 10).toFixed(1);

function formatNumber(value: number | null): string {
  return value === null ? '?' : String(Math.round(value * 10) / 10);
}

/**
 * A change of brew temperature as the prompt asks for it (D-TEMP-7): "1 °C",
 * or in °F "1.8 °F", a change converted without the 32, to one decimal as the
 * change card shows it. The proposal itself stays in °C.
 */
export function brewChange(celsius: number, unit: TemperatureUnit): string {
  return unit === 'fahrenheit' ? `${changeIn(celsius, unit).toFixed(1)} °F` : `${celsius} °C`;
}

/**
 * The barista's taste words are the reason; what the change does at the
 * machine is the effect, never a taste to expect (D127).
 */
const TERSE_CHANGES: Record<ChangeKind, (change: ChangeFacts) => ProposalText> = {
  warmer: ({ temperatureUnit }) => ({
    summary: `Raise brew temperature by ${brewChange(1, temperatureUnit)}`,
    rationale: 'You found it sour, which usually means under-extraction. A little more heat extracts more.',
    expectedEffect: 'More extraction at the same flow and time.',
  }),
  longerForSour: () => ({
    summary: 'Lengthen the yield by 2 g',
    rationale: 'You found it sour and the temperature is already at the top of this profile, so a longer ratio extracts a little more.',
    expectedEffect: '2 g more water through the same coffee.',
  }),
  cooler: ({ temperatureUnit }) => ({
    summary: `Lower brew temperature by ${brewChange(1, temperatureUnit)}`,
    rationale: 'You found it bitter, which usually means over-extraction. A little less heat extracts less.',
    expectedEffect: 'Less extraction at the same flow and time.',
  }),
  shorter: () => ({
    summary: 'Shorten the yield by 2 g',
    rationale: 'You found it weak, so a shorter ratio puts less water through the same coffee.',
    expectedEffect: 'A shorter shot and a more concentrated cup.',
  }),
  longer: () => ({
    summary: 'Lengthen the yield by 2 g',
    rationale: 'You found it too strong, so a longer ratio puts more water through the same coffee.',
    expectedEffect: 'A longer shot and a more dilute cup.',
  }),
  keep: () => ({
    summary: 'Keep everything as it is',
    rationale: 'You found it balanced and sweet, so lock this recipe in.',
    expectedEffect: 'Nothing changes.',
  }),
  finer: ({ grindSetting }) => ({
    summary: grindSetting === null ? 'Grind 1 step finer' : `Grind 1 step finer, to ${grindSetting}`,
    rationale: 'The taste did not point to one clear fix, so slow the shot slightly with a finer grind.',
    expectedEffect: 'A slightly slower shot that extracts a little more.',
  }),
  coarser: ({ grindSetting }) => ({
    summary: grindSetting === null ? 'Grind 1 step coarser' : `Grind 1 step coarser, to ${grindSetting}`,
    rationale: 'You found it too strong and the yield cannot run any longer, so a coarser grind lets the water through faster.',
    expectedEffect: 'A slightly faster shot that extracts a little less.',
  }),
  keepAfterRejectedGrind: () => ({
    summary: 'Keep everything as it is',
    rationale: 'That change is outside what this profile allows, so keep this recipe for one more shot.',
    expectedEffect: 'Nothing changes: pull it again and compare.',
  }),
};

/** The test script's strings, exactly as the unit and e2e tests expect them. */
export const TERSE_VOICE: Voice = {
  intake: () => 'Lovely. Here is where I would start.',
  templatesAgain: () => 'Here are the starting profiles again. Tap one to begin.',
  picked({ title, status }) {
    const name = title ?? 'the profile';
    if (status === 'notUploaded') return `I saved ${name}, but it did not load on the machine. Tap Retry above, then pull a shot.`;
    if (status === 'notConfirmed') return `I saved ${name}, but the machine has not confirmed it. Tap Retry above, then pull a shot.`;
    if (status === 'offline') return `Saved ${name}. Decaid loads it when the machine connects; pull a shot after that.`;
    return `Loaded ${name}. Pull a shot when you are ready; I will read the curves.`;
  },
  shotCompleted: ({ durationS, yieldG }) => `Got it: ${formatNumber(durationS)} s, ${formatNumber(yieldG)} g out.`,
  tasteAnswer: () => 'Thanks. Let me look at the pressure curve.',
  proposalLead: () => null,
  proposalText: (change) => TERSE_CHANGES[change.kind](change),
  rejected: () => 'That one is outside what this profile allows. Here is another change.',
  applied({ status, version }) {
    if (status === 'manual') return 'Make that change, then pull another shot.';
    if (status === 'kept') return 'Locked in. Keep pulling shots like this one.';
    if (status === 'notConfirmed') {
      return `Saved v${formatNumber(version)}, but the machine has not confirmed it. Tap Retry above, then pull another shot.`;
    }
    if (status === 'offline') return `Saved v${formatNumber(version)}. Decaid loads it when the machine connects; pull another shot after that.`;
    return `Done. v${formatNumber(version)} is on the machine. Pull another shot and tell me how it tastes.`;
  },
  declined: ({ version }) => `OK, we keep v${version} as it is. Tell me what you would like to try instead.`,
  undo: ({ to }) => `Back on v${to}. Pull a shot when you are ready.`,
  fallback: () => 'Got it. Pull a shot when you are ready, or tell me more about the coffee.',
  measured({ tdsPct, eyPct }) {
    if (tdsPct === null) return 'Noted: no TDS reading for that shot.';
    return eyPct === null ? `Noted: TDS ${tdsText(tdsPct)} %, no EY.` : `Noted: TDS ${tdsText(tdsPct)} %, EY ${eyText(eyPct)} %.`;
  },
};
