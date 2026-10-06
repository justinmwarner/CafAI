/**
 * The scripted coach's demo voice (`npm run demo`, D76): what a calm barista
 * coaching a home user would say at each step, with the script's decisions
 * unchanged. Two to four short sentences, plain words, the why in one
 * clause, now and then a **bold** lever or a short list. It quotes only
 * numbers the request carries (the shot event, the tool results, the
 * pressure series) and writes the sentence without one it lacks. The card
 * fields (summary, rationale, expectedEffect) show as plain text, so they
 * carry no markdown. Deterministic: the same facts, the same words.
 */
import type { TemplateId } from '../../src/coach/contract.ts';
import { TEMPLATES } from '../../src/coach/templates/index.ts';
import type { AppliedFacts, BagFacts, ChangeFacts, ChangeKind, PickFacts, ProposalText, Taste, Voice } from './voice.ts';

/** One decimal at most, as CafAI shows measurements: 28.44 -> "28.4", 18 -> "18". */
const n1 = (value: number) => String(Math.round(value * 10) / 10);
const bold = (text: string) => `**${text}**`;

const templateName = (id: TemplateId) => TEMPLATES.find((template) => template.id === id)?.name ?? id;

/** Why the first pick suits the bag, one clause, no numbers. */
const START_WHY: Record<TemplateId, string> = {
  'blooming-espresso': 'its bloom pause draws the sweetness out of dense, light beans',
  'd-flow': 'its gentle soak and steady pour forgive small slips while we learn the coffee',
  londonium: 'its slowly falling pressure keeps a darker roast smooth instead of bitter',
  allonge: 'its long, fast pour makes very light roasts sweet and clear',
  'gentle-and-sweet': 'its low, gentle pressure keeps the acidity soft',
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
        `I'd raise the ${bold('brew temperature')} by 1 °C and keep the grind and dose as they are.`,
        'More heat pulls out more sweetness without changing how the shot flows.',
      ];
    case 'longerForSour':
      return [
        `The temperature is already at the top of this profile, so I'd let the shot run ${bold('2 g longer')} instead.`,
        'A longer ratio extracts a little more and softens the acidity.',
      ];
    case 'cooler':
      return [
        `I'd lower the ${bold('brew temperature')} by 1 °C and keep the grind and dose as they are.`,
        'Less heat pulls out fewer of the harsh notes that come late in the shot.',
      ];
    case 'shorter':
      return [`I'd stop the shot ${bold('2 g earlier')} and keep everything else the same.`, 'A shorter ratio concentrates the cup and gives it more body.'];
    case 'longer':
      return [`I'd let the shot run ${bold('2 g longer')} and keep everything else the same.`, 'A longer ratio dilutes the cup a little and opens up the flavours.'];
    case 'keep':
      return ["Balanced and sweet means this recipe is dialled in, so I wouldn't change a thing.", "Let's lock it in."];
    case 'finer':
      return finerLead(change.taste);
    case 'keepAfterRejectedGrind':
      return ["Let's keep the recipe as it is for one more shot.", 'Taste it again before we change anything.'];
  }
}

function finerLead(taste: Taste): string[] {
  if (taste === 'sour') {
    return [
      "The temperature and yield are already at this profile's limits, so the next lever is the grinder.",
      `${bold('One step finer')} slows the water down so it extracts more.`,
    ];
  }
  if (taste === 'weak') {
    return [
      "The yield can't go any shorter in this profile, so the next lever is the grinder.",
      `${bold('One step finer')} slows the shot and builds body.`,
    ];
  }
  if (taste === 'other') {
    return [
      "The taste doesn't point to one clear fix, so let's change one thing at a time.",
      `${bold('One step finer')} on the grinder slows the shot a little, which usually brings more sweetness.`,
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
  if (change.taste === 'sour') {
    return "It tasted sour and this profile's temperature and yield are at their limits, so a finer grind is the way to slow the water and extract more.";
  }
  if (change.taste === 'weak') {
    return 'It tasted weak and the yield is already as short as this profile allows, so a finer grind adds contact time and body.';
  }
  return 'The taste did not point to one clear lever, so change one thing at a time: a slightly finer grind slows the shot and usually adds sweetness.';
}

const CHANGE_TEXT: Record<ChangeKind, (change: ChangeFacts) => ProposalText> = {
  warmer: ({ roastLevel }) => ({
    summary: 'Brew 1 °C hotter',
    rationale: `Sour${onRoast(roastLevel)} usually means under-extraction. A little more heat dissolves more of the sugars, so they balance the acidity.`,
    expectedEffect: 'Less sharpness, more sweetness and a rounder finish.',
  }),
  longerForSour: () => ({
    summary: 'Let the shot run 2 g longer',
    rationale: "It tasted sour and the temperature is already at this profile's top, so a slightly longer ratio is the next way to extract more.",
    expectedEffect: 'A rounder cup with gentler acidity.',
  }),
  cooler: () => ({
    summary: 'Brew 1 °C cooler',
    rationale: 'Bitter and harsh usually means over-extraction. A little less heat pulls out fewer of the harsh compounds that come late in the shot.',
    expectedEffect: 'A softer, cleaner finish with less bitterness.',
  }),
  shorter: () => ({
    summary: 'Stop the shot 2 g earlier',
    rationale: 'It tasted weak and watery, so a slightly shorter ratio concentrates the cup without touching the grind.',
    expectedEffect: 'More body and a fuller, more intense cup.',
  }),
  longer: () => ({
    summary: 'Let the shot run 2 g longer',
    rationale: 'It tasted too strong, so a slightly longer ratio dilutes it and opens up the flavours.',
    expectedEffect: 'A lighter, clearer cup that is easier to drink.',
  }),
  keep: () => ({
    summary: 'Keep this recipe exactly as it is',
    rationale: 'It tasted balanced and sweet, so this recipe is dialled in. Changing anything now would only move you away from it.',
    expectedEffect: 'The same balanced, sweet cup, shot after shot.',
  }),
  finer: (change) => ({
    summary: change.grindSetting === null ? 'Grind one step finer' : `Grind one step finer, to ${change.grindSetting}`,
    rationale: finerWhy(change),
    expectedEffect: 'A slightly slower shot with more sweetness and body.',
  }),
  keepAfterRejectedGrind: () => ({
    summary: 'Keep this recipe for one more shot',
    rationale: 'That grind move does not fit this setup, so keep the recipe as it is and taste it once more before the next change.',
    expectedEffect: 'The same cup again, so the next change starts from a clear read.',
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
        return `Sour${onRoast(roastLevel)} usually means ${bold('under-extraction')}: the water didn't pull out enough sweetness. ${check}`;
      case 'bitter':
        return `Bitter and harsh usually means ${bold('over-extraction')}: the water pulled out too much. ${check}`;
      case 'weak':
        return `Weak and watery usually means the cup is too dilute. ${check}`;
      case 'strong':
        return `Too strong usually means the cup is more concentrated than you like. ${check}`;
      case 'balanced':
        return "Balanced and sweet is exactly what we're after. Let me check the pressure curve to make sure the shot ran clean.";
      case 'other':
        return 'Thanks, that helps. Let me check the pressure curve before I suggest a change.';
    }
  },

  proposalLead(change) {
    const sentences: string[] = [];
    // A curve that never built pressure says nothing worth a sentence.
    if (change.peakPressureBar !== null && change.peakPressureBar > 0) {
      const at = change.peakPressureAtS !== null && change.peakPressureAtS > 0 ? `, ${n1(change.peakPressureAtS)} s in` : '';
      const clean = change.channelingFlags?.length === 0 ? ', with no sign of channeling' : '';
      sentences.push(`The pressure peaked at ${n1(change.peakPressureBar)} bar${at}${clean}.`);
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
};
