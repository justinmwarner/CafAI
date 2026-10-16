/**
 * The scripted coach's demo voice (`npm run demo`, D76): what a calm barista
 * coaching a home user would say at each step, with the script's decisions
 * unchanged. Two to four short sentences, plain words, the why in one
 * clause, now and then a **bold** lever or a short list. It quotes only
 * numbers the request carries (the shot event, the tool results, the
 * pressure series), a shot's as its shot card shows them, and writes the
 * sentence without one it lacks. The card fields (summary, rationale,
 * expectedEffect) show as plain text, so they carry no markdown. It leaves
 * the taste to the barista (D127): their words are the reason, the change is
 * explained by what it does at the machine, and the next cup is theirs to
 * judge. Deterministic: the same facts, the same words.
 */
import type { TemplateId } from '../../src/coach/contract.ts';
import { EY_MAX_PCT } from '../../src/coach/extraction.ts';
import { TEMPLATES } from '../../src/coach/templates/index.ts';
import {
  brewChange,
  eyText,
  tdsText,
  type AppliedFacts,
  type BagFacts,
  type ChangeFacts,
  type ChangeKind,
  type PickFacts,
  type ProposalText,
  type Voice,
} from './voice.ts';

/** One decimal at most, as CafAI shows measurements: 28.44 -> "28.4", 18 -> "18". */
const n1 = (value: number) => String(Math.round(value * 10) / 10);
const bold = (text: string) => `**${text}**`;

const templateName = (id: TemplateId) => TEMPLATES.find((template) => template.id === id)?.name ?? id;

/** Why the first pick suits the bag, one clause, no numbers: what the profile does with the coffee, never how it will taste. */
const START_WHY: Record<TemplateId, string> = {
  'blooming-espresso': 'its bloom pause lets dense, light beans soak through before the pour',
  'd-flow': 'its gentle soak and steady pour forgive small slips while we learn the coffee',
  londonium: 'its slowly falling pressure goes easy on a darker roast, which extracts readily',
  allonge: 'its long, fast pour puts more water through very light, dense beans',
  'gentle-and-sweet': 'its low peak and slow decline keep the pressure gentle all the way',
};

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** "a washed light roast from Kenya", or null when the description named none of it. */
function describeBag({ roastLevel, process, origin }: BagFacts): string | null {
  const kind = roastLevel ? [process, `${roastLevel} roast`].filter(Boolean).join(' ') : process ? `${process} coffee` : null;
  const parts = [kind ? `${article(kind)} ${kind}` : null, origin ? `from ${origin}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

const onRoast = (roastLevel: string | null) => (roastLevel ? ` on a ${roastLevel} roast` : '');

/** "**Kiambu AA v2**", "**v2**", or a plain phrase when the result named neither. */
function versionName(title: string | null, version: number | null, fallback: string): string {
  if (title) return bold(title);
  return version === null ? fallback : bold(`v${n1(version)}`);
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** What the change does and why, after the curve: two sentences per decision. */
function leadFor(change: ChangeFacts): string[] {
  switch (change.kind) {
    case 'warmer':
      return [
        `I'd raise the ${bold('brew temperature')} by ${brewChange(1, change.temperatureUnit)} and keep the grind and dose as they are.`,
        'Hotter water extracts more in the same time, without changing how the shot flows.',
      ];
    case 'longerForSour':
      return [
        `The temperature is already at the top of this profile, so I'd let the shot run ${bold('2 g longer')} instead.`,
        'More water through the same coffee extracts a little more.',
      ];
    case 'cooler':
      return [
        `I'd lower the ${bold('brew temperature')} by ${brewChange(1, change.temperatureUnit)} and keep the grind and dose as they are.`,
        'Cooler water extracts a little less in the same time.',
      ];
    case 'shorter':
      return [`I'd stop the shot ${bold('2 g earlier')} and keep everything else the same.`, 'Less water through the same coffee makes a more concentrated cup.'];
    case 'longer':
      return [`I'd let the shot run ${bold('2 g longer')} and keep everything else the same.`, 'More water through the same coffee dilutes the cup a little.'];
    case 'keep':
      return ["You found it balanced and sweet, so I wouldn't change a thing.", "Let's lock it in."];
    case 'finer':
      return finerLead(change);
    case 'coarser':
      return [
        change.stop === null
          ? "The profile has no room for that change right now, so let's work at the grinder instead."
          : change.stop.reached
            ? "The yield can't run any longer in this profile, so the next lever is the grinder."
            : stopSentence(change, 'longer'),
        `${bold('One step coarser')} on the grinder lets the water through a little faster, so it pulls out a little less.`,
      ];
    case 'keepAfterRejectedGrind':
      return ["Let's keep the recipe as it is for one more shot.", 'Taste it again before we change anything.'];
  }
}

/** The shot ran out before its yield lever's stop, with both numbers from the shot event; else null. */
function shortOfStop(change: ChangeFacts): { yieldG: number; targetG: number } | null {
  const stop = change.stop;
  if (!stop || stop.reached || stop.yieldG === null || stop.targetG === null || stop.yieldG >= stop.targetG) return null;
  return { yieldG: stop.yieldG, targetG: stop.targetG };
}

/** Why a yield move would change nothing: the shot never got to its stop. */
function stopSentence(change: ChangeFacts, move: 'sooner' | 'longer'): string {
  const outcome = move === 'sooner' ? 'stopping it sooner would change nothing' : 'a longer stop would never be reached';
  const short = shortOfStop(change);
  return short
    ? `The shot ended at ${n1(short.yieldG)} g, before its ${n1(short.targetG)} g stop, so ${outcome}.`
    : `This shot didn't stop at its target yield, so ${outcome}.`;
}

function finerLead(change: ChangeFacts): string[] {
  const { taste, stop } = change;
  // A shot that never got to its stop: a yield move would change nothing, whatever the lever's room.
  const shortOfYield = stop !== null && !stop.reached;
  if (taste === 'sour') {
    if (shortOfYield) {
      return ['The temperature is already at the top of this profile.', stopSentence(change, 'longer'), `${bold('One step finer')} slows the water down so it extracts more.`];
    }
    return [
      "The temperature and yield are already at this profile's limits, so the next lever is the grinder.",
      `${bold('One step finer')} slows the water down so it extracts more.`,
    ];
  }
  if (taste === 'weak') {
    if (shortOfYield) return [stopSentence(change, 'sooner'), `${bold('One step finer')} on the grinder pulls more from the coffee.`];
    return [
      "The yield can't go any shorter in this profile, so the next lever is the grinder.",
      `${bold('One step finer')} slows the shot, so it extracts more.`,
    ];
  }
  if (taste === 'other') {
    return [
      "The taste doesn't point to one clear fix, so let's change one thing at a time.",
      `${bold('One step finer')} on the grinder slows the shot a little, so the water stays longer in the coffee.`,
    ];
  }
  return [
    "The profile has no room for that change right now, so let's work at the grinder instead.",
    `${bold('One step finer')} shifts the extraction a little without touching the profile.`,
  ];
}

function finerWhy(change: ChangeFacts): string {
  if (change.afterRejection) {
    return "The last change was outside this profile's limits, so make one small move at the grinder instead: a slightly finer grind slows the shot and extracts a little more.";
  }
  const shortOfYield = change.stop !== null && !change.stop.reached;
  if (change.taste === 'sour') {
    if (shortOfYield) {
      return "You found it sour, the temperature is at this profile's top, and this shot did not stop at its target yield, so a longer stop would change nothing. A finer grind extracts more instead.";
    }
    return "You found it sour and this profile's temperature and yield are at their limits, so a finer grind is the way to slow the water and extract more.";
  }
  if (change.taste === 'weak') {
    if (shortOfYield) {
      return 'You found it weak, and this shot did not stop at its target yield, so stopping it sooner would change nothing. A slightly finer grind extracts more.';
    }
    return 'You found it weak and the yield is already as short as this profile allows, so a finer grind adds contact time and extracts more.';
  }
  return 'The taste did not point to one clear lever, so change one thing at a time: a slightly finer grind slows the shot and extracts a little more.';
}

const CHANGE_TEXT: Record<ChangeKind, (change: ChangeFacts) => ProposalText> = {
  warmer: ({ roastLevel, temperatureUnit }) => ({
    summary: `Brew ${brewChange(1, temperatureUnit)} hotter`,
    rationale: `You found it sour${onRoast(roastLevel)}, which usually means under-extraction. A little more heat extracts more from the same grind and dose.`,
    expectedEffect: 'Hotter water extracts more in the same time; the flow and the shot time stay about the same.',
  }),
  longerForSour: () => ({
    summary: 'Let the shot run 2 g longer',
    rationale: "You found it sour and the temperature is already at this profile's top, so a slightly longer ratio is the next way to extract more.",
    expectedEffect: 'More water through the same coffee: the shot runs a little longer and extracts a little more.',
  }),
  cooler: ({ temperatureUnit }) => ({
    summary: `Brew ${brewChange(1, temperatureUnit)} cooler`,
    rationale: 'You found it bitter and harsh, which usually means over-extraction. A little less heat extracts less from the same grind and dose.',
    expectedEffect: 'Cooler water extracts less in the same time; the flow and the shot time stay about the same.',
  }),
  shorter: () => ({
    summary: 'Stop the shot 2 g earlier',
    rationale: 'You found it weak and watery, so a slightly shorter ratio concentrates the cup without touching the grind.',
    expectedEffect: 'The shot stops 2 g sooner: less water through the same coffee, so a more concentrated cup.',
  }),
  longer: () => ({
    summary: 'Let the shot run 2 g longer',
    rationale: 'You found it too strong, so a slightly longer ratio puts more water through the same coffee and dilutes it a little.',
    expectedEffect: 'The shot runs 2 g longer: more water through the same coffee, so a more dilute cup.',
  }),
  keep: () => ({
    summary: 'Keep this recipe exactly as it is',
    rationale: 'You found it balanced and sweet, so keep this recipe. Changing anything now would only move you away from it.',
    expectedEffect: 'Nothing changes: the same recipe, shot after shot.',
  }),
  finer: (change) => ({
    summary: change.grindSetting === null ? 'Grind one step finer' : `Grind one step finer, to ${change.grindSetting}`,
    rationale: finerWhy(change),
    expectedEffect: 'A slightly slower shot: the water stays longer in the coffee and extracts a little more.',
  }),
  coarser: (change) => ({
    summary: change.grindSetting === null ? 'Grind one step coarser' : `Grind one step coarser, to ${change.grindSetting}`,
    rationale:
      change.stop?.reached === true
        ? 'You found it too strong and the yield is already as long as this profile allows, so a slightly coarser grind lets the water through faster and extracts a little less.'
        : 'You found it too strong, and this shot did not stop at its target yield, so a longer stop would change nothing. A slightly coarser grind lets the water through faster and extracts a little less.',
    expectedEffect: 'A slightly faster shot: the water spends less time in the coffee and extracts a little less.',
  }),
  keepAfterRejectedGrind: () => ({
    summary: 'Keep this recipe for one more shot',
    rationale: 'That grind move does not fit this setup, so keep the recipe as it is and taste it once more before the next change.',
    expectedEffect: 'Nothing changes, so the next change starts from a clear read.',
  }),
};

// ---------------------------------------------------------------------------
// The voice
// ---------------------------------------------------------------------------

export const DEMO_VOICE: Voice = {
  intake(bag) {
    const about = describeBag(bag);
    return [
      `Lovely, ${bold(bag.name)}${about ? `: ${about}` : ''}.`,
      `I'd start with ${bold(templateName(bag.topTemplate))}, because ${START_WHY[bag.topTemplate]}.`,
      "Tap the profile you want and I'll load it on the machine.",
    ].join(' ');
  },

  templatesAgain: ({ topTemplate }) =>
    `No problem. Here are the starting profiles again, and I'd still begin with ${bold(templateName(topTemplate))}. Tap one and I'll load it on the machine.`,

  picked({ title, status, yieldG, doseG }: PickFacts) {
    const name = title ? bold(title) : 'your first version';
    if (status === 'notUploaded') return `I saved ${name}, but it didn't load on the machine. Tap ${bold('Retry')} above, then pull a first shot once it's on.`;
    if (status === 'notConfirmed') {
      return `I saved ${name}, but the machine hasn't confirmed it yet. Tap ${bold('Retry')} above, then pull a first shot so we taste the right recipe.`;
    }
    if (status === 'offline') return `I saved ${name}. Decaid loads it as soon as the machine connects, so pull a first shot after that.`;
    const stop = yieldG === null ? '' : ` It stops at ${bold(`${n1(yieldG)} g`)} in the cup${doseG === null ? '' : `, from your ${n1(doseG)} g dose`}.`;
    return `Done: ${name} is on the machine.${stop} Pull a first shot when you're ready: it's our baseline, and I'll read its curves as soon as it finishes.`;
  },

  shotCompleted({ durationS, yieldG, doseG }) {
    const ran = durationS === null ? null : `ran ${bold(`${n1(durationS)} s`)}`;
    const gave = yieldG === null ? null : `gave ${n1(yieldG)} g in the cup${doseG === null ? '' : ` from your ${n1(doseG)} g dose`}`;
    const facts = [ran, gave].filter(Boolean);
    const first = facts.length > 0 ? `That one ${facts.join(' and ')}.` : "That shot's in.";
    return `${first} Taste it while it's still warm: how it tastes tells us which lever to move next.`;
  },

  tasteAnswer({ taste, roastLevel }) {
    const check = 'Let me check the pressure curve before we change anything.';
    switch (taste) {
      case 'sour':
        return `Sour${onRoast(roastLevel)} usually means ${bold('under-extraction')}: the water didn't pull enough out of the coffee. ${check}`;
      case 'bitter':
        return `Bitter and harsh usually means ${bold('over-extraction')}: the water pulled out too much. ${check}`;
      case 'weak':
        return `Weak and watery usually means the cup is too dilute. ${check}`;
      case 'strong':
        return `Too strong usually means the cup is more concentrated than you like. ${check}`;
      case 'balanced':
        return "You found it balanced and sweet: that's a recipe worth keeping. Let me check the pressure curve to make sure the shot ran clean.";
      case 'other':
        return 'Thanks, that helps. Let me check the pressure curve before I suggest a change.';
    }
  },

  proposalLead(change) {
    const sentences: string[] = [];
    // A curve that never built pressure says nothing worth a sentence.
    if (change.peakPressureBar !== null && change.peakPressureBar > 0) {
      // Word for word what the shot card shows, counted from the start of the pour: "5.4 bar at 60 s".
      const seconds = change.peakPressureAtS === null ? 0 : Math.round(change.peakPressureAtS);
      const at = seconds > 0 ? `, ${seconds} s in` : '';
      const clean = change.channelingFlags?.length === 0 ? ', with no sign of channeling' : '';
      sentences.push(`The pressure peaked at ${change.peakPressureBar.toFixed(1)} bar${at}${clean}.`);
    }
    sentences.push(...leadFor(change));
    if (change.channelingFlags && change.channelingFlags.length > 0) {
      sentences.push('The app also flagged some channeling, so take extra care with distribution and tamping.');
    }
    return sentences.join(' ');
  },

  proposalText: (change) => CHANGE_TEXT[change.kind](change),

  rejected: (replacement) =>
    replacement.kind === 'keepAfterRejectedGrind'
      ? "That grind move doesn't fit this setup. Let's keep the recipe as it is for one more shot and taste it again before changing anything."
      : `That change is outside what this profile allows. Let's make the move at the grinder instead: ${bold('one step finer')}, then we taste again.`,

  applied({ status, version, title }: AppliedFacts) {
    const name = versionName(title, version, 'the new version');
    if (status === 'manual') return 'Make that change before your next shot and keep everything else the same, so we can taste exactly what it did.';
    if (status === 'kept') return 'Locked in. Keep pulling shots just like this one, and tell me if the taste drifts as the beans age.';
    if (status === 'notConfirmed') {
      return `I saved ${name}, but the machine hasn't confirmed it yet. Tap ${bold('Retry')} above, then pull the next shot so we taste the new version.`;
    }
    if (status === 'offline') return `I saved ${name}. Decaid loads it as soon as the machine connects, so pull the next shot after that.`;
    return [
      `Done: ${name} is on the machine. For the next shot:`,
      '',
      '- Keep the dose, grind and puck prep the same.',
      '- Taste it against the last one.',
      '',
      'Changing one thing at a time shows us what each lever really does.',
    ].join('\n');
  },

  declined: ({ version }) =>
    `We'll stay on ${bold(`v${version}`)} for now. Tell me what you'd like to try instead, or pull another shot and we'll taste it again.`,

  undo: ({ to, title }) =>
    `No harm done: we're back on ${title ? bold(title) : bold(`v${to}`)}. Pull a shot when you're ready and tell me how it tastes; we'll pick up from there.`,

  fallback: () => "Noted. Pull a shot when you're ready and I'll read its curves with you, or tell me more about the coffee.",

  // What the reading is, never what it tastes like (D127, D168).
  measured({ tdsPct, eyPct }) {
    if (tdsPct === null) return "Got it: I'll leave that TDS reading out.";
    const tds = `${tdsText(tdsPct)} %`;
    if (eyPct === null) return `Thanks for measuring: TDS ${tds}. That shot has no dose or yield to go with it, so I can't work out its extraction.`;
    if (eyPct > EY_MAX_PCT) {
      return `Thanks for measuring, but TDS ${tds} works out to an extraction of ${eyText(eyPct)} %, more than coffee can give: check the reading, and the dose in Decaid.`;
    }
    return `Thanks for measuring: TDS ${tds} puts that shot's extraction at ${bold(`${eyText(eyPct)} %`)}.`;
  },
};
