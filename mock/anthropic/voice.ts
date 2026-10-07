/**
 * The scripted coach's words, apart from its decisions. scenario.ts decides
 * every reply (which rule fires, which tool, which values) and hands a voice
 * the facts it may mention; the voice only writes the text. Two voices:
 *
 *   - terse (the default): the short test strings the unit and e2e tests pin.
 *   - demo (demoVoice.ts): fuller coaching prose for `npm run demo` (D76).
 *
 * Facts carry only what the request said (null when it did not), so a voice
 * never has a number to invent.
 */
import type { RoastLevel, TemplateId } from '../../src/coach/contract.ts';

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
   * The latest shot's peak pressure and when it came (s from the shot's
   * start), from its shot event's summary: the numbers its shot card shows.
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
}

export interface AppliedFacts {
  /** A new version on the machine, not confirmed, or saved while offline; a change by hand (grind, dose); no change. */
  status: 'loaded' | 'notConfirmed' | 'offline' | 'manual' | 'kept';
  version: number | null;
  title: string | null;
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
}

function formatNumber(value: number | null): string {
  return value === null ? '?' : String(Math.round(value * 10) / 10);
}

const TERSE_CHANGES: Record<ChangeKind, (change: ChangeFacts) => ProposalText> = {
  warmer: () => ({
    summary: 'Raise brew temperature by 1 °C',
    rationale: 'It tasted sour, which usually means under-extraction. A little more heat pulls out more sweetness.',
    expectedEffect: 'Less sharpness and more sweetness.',
  }),
  longerForSour: () => ({
    summary: 'Lengthen the yield by 2 g',
    rationale: 'It tasted sour and the temperature is already at the top of this profile, so a longer ratio extracts a little more.',
    expectedEffect: 'A rounder, less sharp cup.',
  }),
  cooler: () => ({
    summary: 'Lower brew temperature by 1 °C',
    rationale: 'It tasted bitter, which usually means over-extraction. A little less heat softens the finish.',
    expectedEffect: 'A softer, less harsh finish.',
  }),
  shorter: () => ({
    summary: 'Shorten the yield by 2 g',
    rationale: 'It tasted weak, so a shorter ratio will concentrate the cup.',
    expectedEffect: 'More body and intensity.',
  }),
  longer: () => ({
    summary: 'Lengthen the yield by 2 g',
    rationale: 'It tasted too strong, so a longer ratio will open it up.',
    expectedEffect: 'A lighter, clearer cup.',
  }),
  keep: () => ({
    summary: 'Keep everything as it is',
    rationale: 'It tasted balanced and sweet. This recipe is dialled in, so lock it in.',
    expectedEffect: 'The same good cup again.',
  }),
  finer: ({ grindSetting }) => ({
    summary: grindSetting === null ? 'Grind 1 step finer' : `Grind 1 step finer, to ${grindSetting}`,
    rationale: 'The taste did not point to one clear fix, so slow the shot slightly with a finer grind.',
    expectedEffect: 'A slightly slower shot with more sweetness.',
  }),
  coarser: ({ grindSetting }) => ({
    summary: grindSetting === null ? 'Grind 1 step coarser' : `Grind 1 step coarser, to ${grindSetting}`,
    rationale: 'It tasted too strong and the yield cannot run any longer, so a coarser grind will lighten it.',
    expectedEffect: 'A lighter, clearer cup.',
  }),
  keepAfterRejectedGrind: () => ({
    summary: 'Keep everything as it is',
    rationale: 'That change is outside what this profile allows, so keep this recipe for one more shot.',
    expectedEffect: 'The same cup, to taste again.',
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
};
