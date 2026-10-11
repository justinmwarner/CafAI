/**
 * The demo's story (D76): what the barista did, when, and what the coach
 * answered. mock/demo/build.ts plays it through CafAI's own coach engine, so
 * every message, card, notice and record CafAI writes along the way comes
 * from the engine itself; only the coach's turns are written here, by hand.
 *
 * Two bags. Santos (Brazil, natural, medium-dark), a day ago: Gentle and
 * Sweet, one 5-star shot answered "Balanced, sweet", and the coach's keep
 * card confirmed, so History says it was kept. Then Kiambu AA (Kenya,
 * washed, light): Blooming Espresso over four shots, with a hotter v2, a
 * by-hand grind move, a shot that ran another profile, a slower pour
 * declined, re-offered, applied and undone, a middle way as v4, and the last
 * shot's "How did it taste?" left open for the viewer to answer.
 *
 * Two choices follow the mock rather than an idea of the story:
 * - The channeling warning is on Santos's shot. Blooming Espresso is all
 *   flow steps, so CafAI's detector never sees a settled pressure on it (as
 *   on the real Blooming shot in src/coach/__fixtures__); Gentle and Sweet's
 *   fast fill overshoots its 6 bar, which the detector reports.
 * - Kiambu AA's v3 and v4 slow the pour instead of shortening the yield: on
 *   the mock, a blooming shot ends with its profile short of its 50 g stop
 *   (about 40-48 g once the drips are in; even the uneven puck of shot two
 *   ends just short), so a shorter stop would change nothing in the cup.
 *
 * Coach turns that quote a number read it from the request they answer
 * (mock/demo/transcript.ts), the way the real coach can only know what it
 * was told.
 */
import { TOOL, type ProposeAdjustment, type ToolName } from '../../src/coach/contract.ts';
import { resolveGrindMove } from '../../src/coach/grinder.ts';
import { pourTime } from '../../src/coach/summary/pourClock.ts';
import type { ShotCompletedPayload, TemplatePickedPayload, AdjustmentResultPayload } from '../../src/app/engine/protocol.ts';
import type { LlmMessage } from '../../src/llm/types.ts';
import { MOCK_GRINDER_IDS } from '../decaid/grinders.ts';
import type { ShotSpec } from './shots.ts';
import { EVENT, lastResult, latestEvent, latestToolInput } from './transcript.ts';

/** One assistant turn as the model streams it (its thinking block is added when it is played). */
export interface CoachTurn {
  text?: string;
  tools?: Array<{ name: ToolName; input: Record<string, unknown> }>;
}

/** A turn, or one written from the request it answers. */
export type CoachReply = CoachTurn | ((messages: readonly LlmMessage[]) => CoachTurn);

/** When something happened: minutes before the demo was opened. */
interface At {
  minutesAgo: number;
}

export type StoryStep =
  | (At & { kind: 'newBag' })
  | (At & { kind: 'say'; text: string; coach: CoachReply[] })
  | (At & { kind: 'pick'; templateId: string; coach: CoachReply[] })
  | (At & { kind: 'shot'; shot: ShotSpec; coach: CoachReply[] })
  /** Another skin (or the machine's own screen) puts a profile from Decaid's library in the workflow. */
  | (At & { kind: 'otherProfile'; profileId: string })
  /** A shot of whatever the machine runs that is not the bag's version: CafAI says so and offers Retry. */
  | (At & { kind: 'strayShot'; shot: ShotSpec })
  | (At & { kind: 'retry' })
  /** Stars on the latest shot card. */
  | (At & { kind: 'rate'; stars: number })
  | (At & { kind: 'answer'; selected: string[]; other: string | null; coach: CoachReply[] })
  | (At & { kind: 'confirm'; coach: CoachReply[] })
  | (At & { kind: 'decline'; coach: CoachReply[] })
  | (At & { kind: 'undo'; coach: CoachReply[] });

// ---------------------------------------------------------------------------
// Settings before the story, and the shots
// ---------------------------------------------------------------------------

/** The placeholder key the demo stores: the scripted coach answers any key but its two error keys. */
export const DEMO_API_KEY = 'sk-ant-demo';

/** The grinder as Settings had it before the story: the mock's Niche Zero, linked from Decaid's library, at 15. */
export const STARTING_GRINDER = {
  grinderName: 'Niche Zero',
  grinderSetting: '15',
  grinderId: MOCK_GRINDER_IDS.nicheZero,
} as const;

/**
 * Every puck its own, as at a real grinder: a sound one within about 10% of
 * the mock's default resistance (2.4, which a shot pulled in the demo gets),
 * finer after the grind move, so no two shots run the same time, drip at the
 * same moment or give the same yield (a finer puck drips later and gives
 * less; mock/decaid/shotPlayer.ts). Shot two's uneven puck is far below on
 * purpose.
 */
export const SHOTS = {
  santos: { id: '3f6c2b9e-1d4a-4e8b-9c71-5a2d8e0f4b13', puckResistance: 2.4, seed: 7 },
  // At 15, a touch coarse.
  kiambu1: { id: '8b2e4d6f-0a1c-4f3e-8d5b-7c9a1e3f5d24', puckResistance: 2.2, seed: 1 },
  // An uneven puck: the water finds a path, the pour never builds pressure.
  kiambu2: { id: 'c4a6e8f0-2b3d-4a5c-9e7f-1d3b5c7e9a35', puckResistance: 1.4, seed: 2 },
  stray: { id: 'e1f3a5c7-9b0d-4e2f-a4c6-8e0a2c4e6f46', puckResistance: 2.45, seed: 5 },
  // One step finer, and a better prepared puck: a slower shot.
  kiambu3: { id: '5d7f9b1c-3e5a-4c7d-b9f1-3a5c7e9b1d57', puckResistance: 2.6, seed: 3 },
  kiambu4: { id: 'a9c1e3f5-7b9d-4f1a-8c3e-5b7d9f1a3c68', puckResistance: 2.5, seed: 4 },
} as const satisfies Record<string, ShotSpec>;

/** Decaid's bundled "D-Flow / default", which another skin loads before the stray shot. */
export const OTHER_PROFILE_ID = 'profile:59036f8846b1ed3b4255';

/** The taste chips the scripted coach offers (mock/anthropic/scenario.ts): the open question uses them too. */
export const TASTE_OPTIONS = ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery'] as const;

// ---------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------

function known(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('The demo coach quoted a number the request does not have.');
  return value;
}

/** A setting as the coach says it: whole when it is ("50 g", "v2", "18 g dose"), else one decimal. */
function num(value: number | null | undefined): string {
  return String(Math.round(known(value) * 10) / 10);
}

/** A measurement or a flow, with the one decimal the cards show ("48.0 g", "7.0 bar", "2.0 ml/s"). */
function one(value: number | null | undefined): string {
  return known(value).toFixed(1);
}

function shot(messages: readonly LlmMessage[]): ShotCompletedPayload {
  const payload = latestEvent<ShotCompletedPayload>(messages, EVENT.shotCompleted);
  if (!payload) throw new Error('The demo coach answered a shot it was not told about.');
  return payload;
}

function result<T>(messages: readonly LlmMessage[], name: ToolName): T {
  const value = lastResult<T>(messages, name);
  if (value === null) throw new Error(`The demo coach expected a ${name} result.`);
  return value;
}

function lever(messages: readonly LlmMessage[], id: string): number {
  const value = shot(messages).levers[id];
  if (value === undefined) throw new Error(`The latest shot has no ${id} lever.`);
  return value;
}

function proposal(messages: readonly LlmMessage[]): ProposeAdjustment {
  const input = latestToolInput<ProposeAdjustment>(messages, TOOL.proposeAdjustment);
  if (!input) throw new Error('The demo coach expected its own proposal earlier in the transcript.');
  return input;
}

function tasteQuestion(): NonNullable<CoachTurn['tools']> {
  return [{ name: TOOL.askUser, input: { question: 'How did it taste?', options: [...TASTE_OPTIONS], multiSelect: false } }];
}

// ---------------------------------------------------------------------------
// The coach's turns
// ---------------------------------------------------------------------------

const santosIntake: CoachTurn = {
  text:
    'A natural Brazil at a medium-dark roast gives itself up easily, so it wants gentle pressure. ' +
    '**Gentle and Sweet** keeps the peak low and eases off as the shot goes.',
  tools: [
    {
      name: TOOL.saveBagDetails,
      input: {
        name: 'Santos',
        roaster: null,
        origin: 'Brazil',
        roastLevel: 'medium-dark',
        process: 'natural',
        notes: 'milk chocolate, hazelnut, cherry',
      },
    },
    {
      name: TOOL.proposeTemplates,
      input: {
        suggestions: [
          {
            templateId: 'gentle-and-sweet',
            confidence: 'high',
            reason: 'A low 6 bar peak and a slow decline go easy on a medium-dark natural, which extracts readily.',
          },
          {
            templateId: 'londonium',
            confidence: 'medium',
            reason: 'A lever-style decline from a higher peak: more pressure early, then easing off.',
          },
          {
            templateId: 'd-flow',
            confidence: 'low',
            reason: 'A forgiving all-rounder, but it suits lighter roasts better than this one.',
          },
        ],
      },
    },
  ],
};

/** After a starting profile is picked: where v1 stops, from the pick's own result. */
const onTheMachine = (messages: readonly LlmMessage[]): CoachTurn => {
  const picked = result<TemplatePickedPayload>(messages, TOOL.proposeTemplates);
  return {
    text:
      `${picked.title} is on the machine and stops at ${num(picked.yieldG)} g from your ${num(picked.doseG)} g dose. ` +
      'Pull a shot when you are ready, and I will read the curves.',
  };
};

const santosShot = (messages: readonly LlmMessage[]): CoachTurn => {
  const { summary } = shot(messages);
  const dipped = summary.channelingFlags.includes('pressure_dip_after_peak');
  // The cup is weighed once the drips are in (Decaid's settled yield), so it can end past the stop.
  const [yieldG, target] = [known(summary.yieldG), known(summary.targetYieldG)];
  const stop =
    Math.abs(yieldG - target) < 0.5
      ? `right at the ${num(target)} g stop`
      : yieldG > target && summary.stopReason === 'targetWeight'
        ? `the scale stopped it at ${num(target)} g and the last drips added the rest`
        : `a little ${yieldG < target ? 'short of' : 'past'} the ${num(target)} g stop`;
  return {
    text:
      `${one(summary.durationS)} s and ${one(summary.yieldG)} g in the cup: ${stop}. ` +
      (dipped
        ? `The pressure peaked at ${one(summary.peakPressureBar)} bar early on and dipped right after, which can mean a small channel, but your taste decides.`
        : `The pressure peaked at ${one(summary.peakPressureBar)} bar early on and held steady.`),
    tools: tasteQuestion(),
  };
};

/** "Balanced, sweet": a keep card, so a confirm records the recipe as kept (History: "Kept as is"). */
const santosKeep = (messages: readonly LlmMessage[]): CoachTurn => {
  const { version, grinder } = shot(messages);
  return {
    text:
      `You found it balanced and sweet, and that is what counts, so I would keep **v${num(version)}** as it is. ` +
      'Watch the small pressure dip on the next shot: if it grows, we look at your puck prep.',
    tools: [
      {
        name: TOOL.proposeAdjustment,
        input: {
          variable: 'none',
          lever: null,
          value: null,
          grind: null,
          summary: `Keep v${num(version)} as it is`,
          rationale: 'You found it balanced and sweet, so keep this recipe. The small pressure dip after the peak is one to watch, not to change.',
          expectedEffect: 'Nothing changes: the same recipe, shot after shot.',
          tips: [grinder.setting ? `Keep the grinder at ${grinder.setting} and the same dose.` : 'Keep the same grind and dose.'],
        },
      },
    ],
  };
};

const santosKept = (messages: readonly LlmMessage[]): CoachTurn => ({
  text: `Locked in. Keep the grinder at ${shot(messages).grinder.setting ?? 'its setting'} and the same dose to repeat it, and tell me if the taste drifts as the beans age.`,
});

const kiambuIntake: CoachTurn = {
  text: [
    'A washed Kenyan at a light roast is dense and slow to give itself up, so it needs a full, even soak before the pour.',
    '',
    '**Blooming Espresso** is my first choice:',
    '- a 4 ml/s fill wets the whole puck',
    '- a 30 s bloom with the pump off lets it soak evenly',
    '- a steady 2.2 ml/s pour then extracts it evenly',
  ].join('\n'),
  tools: [
    {
      name: TOOL.saveBagDetails,
      input: {
        name: 'Kiambu AA',
        roaster: null,
        origin: 'Kenya',
        roastLevel: 'light',
        process: 'washed',
        notes: 'blackcurrant, grapefruit, brown sugar',
      },
    },
    {
      name: TOOL.proposeTemplates,
      input: {
        suggestions: [
          {
            templateId: 'blooming-espresso',
            confidence: 'high',
            reason: 'The bloom lets a dense, light washed coffee soak evenly before the pour, so it extracts evenly.',
          },
          {
            templateId: 'allonge',
            confidence: 'medium',
            reason: 'A long, fast shot that puts more water through a very light washed coffee, for a longer drink.',
          },
          {
            templateId: 'd-flow',
            confidence: 'low',
            reason: 'A gentle soak and a steady pour: forgiving, but it may under-extract a dense, light Kenyan.',
          },
        ],
      },
    },
  ],
};

const firstShot = (messages: readonly LlmMessage[]): CoachTurn => {
  const { summary } = shot(messages);
  return {
    text:
      `Shot one: ${one(summary.durationS)} s and ${one(summary.yieldG)} g in the cup. ` +
      `The pour ended with the profile, a little short of the ${num(summary.targetYieldG)} g stop, and the first drops came at ${one(pourTime(summary.timeToFirstDropS, summary.pourStartS))} s.`,
    tools: tasteQuestion(),
  };
};

/** The coach looks at the pressure curve before it proposes anything; nothing shows in the chat. */
const lookAtPressure: CoachTurn = {
  tools: [{ name: TOOL.getShotSeries, input: { shot: 'latest', metric: 'pressure', fromS: null, toS: null } }],
};

const hotter = (messages: readonly LlmMessage[]): CoachTurn => {
  const series = result<{ values: Array<number | null> }>(messages, TOOL.getShotSeries);
  const peak = Math.max(...series.values.filter((value): value is number => value !== null));
  return {
    text:
      'You found it sour, which on a light washed coffee usually means it is under-extracted. ' +
      `The pressure rose steadily to ${one(peak)} bar through the pour, so the puck held up and heat is the lever to pull. ` +
      "Let's go **1 °C hotter** and keep everything else the same, then you tell me what changed.",
    tools: [
      {
        name: TOOL.proposeAdjustment,
        input: {
          variable: 'profile',
          lever: 'temp',
          value: lever(messages, 'temp') + 1,
          grind: null,
          summary: 'Raise the brew temperature by 1 °C',
          rationale:
            'You found it sour and sharp, which on a light washed Kenyan points to under-extraction. A degree more heat extracts more without changing the flow.',
          expectedEffect: 'Hotter water extracts more in the same time; the flow stays the same.',
          tips: ['Keep the same dose, grind and puck prep.'],
        },
      },
    ],
  };
};

const pullAnother = (messages: readonly LlmMessage[]): CoachTurn => {
  const applied = result<Extract<AdjustmentResultPayload, { applied: true }>>(messages, TOOL.proposeAdjustment);
  return {
    text: `v${num(applied.version)} is on the machine, 1 °C hotter. Pull your next shot with the same prep and tell me how it tastes.`,
  };
};

const unevenPuck = (messages: readonly LlmMessage[]): CoachTurn => {
  const { summary } = shot(messages);
  return {
    text:
      `This one ran ${one(summary.durationS)} s for ${one(summary.yieldG)} g, but the highest pressure, ${one(summary.peakPressureBar)} bar, came during the fill at ${one(pourTime(summary.peakPressureAtS, summary.pourStartS))} s. ` +
      'The pour never built pressure after the bloom, which usually means the water found an easy path through the puck.',
    tools: [
      {
        name: TOOL.askUser,
        input: {
          question: 'What does the puck look like?',
          options: ['Pinholes', 'Wet patches', 'Cracks at the edge', 'Looks even'],
          multiSelect: true,
        },
      },
    ],
  };
};

const grindFiner = (messages: readonly LlmMessage[]): CoachTurn => {
  const { grinder } = shot(messages);
  // One step finer on the dial Decaid's library describes, worked out as CafAI's own validator does.
  const dial = { model: grinder.name ?? '', settingType: 'numeric' as const, smallStep: grinder.step, bigStep: null, values: null };
  const move = resolveGrindMove(dial, grinder.setting, { direction: 'finer', amount: 1, setting: null });
  if (!move?.ok || move.move.setting === null) throw new Error('The demo grinder cannot go one step finer.');
  const finer = move.move.setting;
  return {
    text:
      'Pinholes and wet patches mean the water rushed through weak spots. ' +
      `A slightly finer grind slows it down and evens out the puck, and your ${grinder.name ?? 'grinder'} moves in ${num(grinder.step)} steps, so one step finer is **${finer}**.`,
    tools: [
      {
        name: TOOL.proposeAdjustment,
        input: {
          variable: 'grind',
          lever: null,
          value: null,
          grind: { direction: 'finer', amount: 1, setting: finer },
          summary: `Grind one step finer, to ${finer}`,
          rationale:
            'Pinholes and wet patches mean the water found weak spots in the puck. A finer grind adds resistance, so the pour builds pressure evenly.',
          expectedEffect: 'Higher, steadier pressure in the pour, and a slightly slower shot.',
          tips: ['Break up clumps and level the bed before you tamp.'],
        },
      },
    ],
  };
};

const afterGrind = (messages: readonly LlmMessage[]): CoachTurn => ({
  text:
    `Set the dial to ${proposal(messages).grind?.setting ?? 'the new setting'} and take an extra moment with your distribution. ` +
    'Then pull another shot and tell me how it tastes.',
});

const betterShot = (messages: readonly LlmMessage[]): CoachTurn => {
  const { summary } = shot(messages);
  return {
    text:
      `This one held together: ${one(summary.durationS)} s, ${one(summary.yieldG)} g, and the pressure climbed to ${one(summary.peakPressureBar)} bar by the end of the pour. ` +
      'The finer grind kept the puck even this time.',
    tools: tasteQuestion(),
  };
};

/** "Sweeter, but a little thin": a slower pour, more contact time (the flow lever, at most 0.4 ml/s a step). */
const slowerPour = (messages: readonly LlmMessage[], text: string): CoachTurn => {
  const flow = lever(messages, 'flow');
  const to = Math.round((flow - 0.4) * 10) / 10;
  return {
    text: text.replace('{from}', one(flow)).replace('{to}', one(to)),
    tools: [
      {
        name: TOOL.proposeAdjustment,
        input: {
          variable: 'profile',
          lever: 'flow',
          value: to,
          grind: null,
          summary: `Slow the extraction flow to ${one(to)} ml/s`,
          rationale: 'You found it sweeter but thin. A slower pour after the bloom gives the water more contact time in the coffee.',
          expectedEffect: 'A slower pour after the bloom: more contact time, and a shot a few seconds longer.',
          tips: ['Keep the 14.5 grind and the same dose.'],
        },
      },
    ],
  };
};

const thin = (messages: readonly LlmMessage[]) =>
  slowerPour(
    messages,
    'Sweeter but thin, in your words. A slower pour gives the water more contact time in the coffee, ' +
      "so let's take the extraction flow from {from} to **{to} ml/s** and see what you notice.",
  );

const keepV2 = (messages: readonly LlmMessage[]): CoachTurn => ({
  text: `No problem, we stay on v${num(shot(messages).version)}. If it still feels thin to you, the slower pour is there whenever you want it.`,
});

const offerAgain = (messages: readonly LlmMessage[]) =>
  slowerPour(messages, 'Sure. Here is the slower pour again, from {from} to {to} ml/s; Confirm loads it as a new version.');

const slowerLoaded = (messages: readonly LlmMessage[]): CoachTurn => {
  const applied = result<Extract<AdjustmentResultPayload, { applied: true }>>(messages, TOOL.proposeAdjustment);
  return {
    text: `v${num(applied.version)} is on the machine with the slower ${one(proposal(messages).value)} ml/s pour. Pull a shot when you are ready.`,
  };
};

const backOnV2 = (messages: readonly LlmMessage[]): CoachTurn => {
  const undo = latestEvent<{ to: number }>(messages, EVENT.undo);
  return {
    text: `We're back on v${num(undo?.to)} at the ${one(lever(messages, 'flow'))} ml/s pour. Tell me what you would like to try, or pull a shot as it is.`,
  };
};

const halfway = (messages: readonly LlmMessage[]): CoachTurn => {
  const flow = lever(messages, 'flow');
  const to = Math.round((flow - 0.2) * 10) / 10;
  return {
    text:
      'Good call: smaller steps are easier to taste. ' +
      `**${one(to)} ml/s** still adds contact time without slowing the shot too much.`,
    tools: [
      {
        name: TOOL.proposeAdjustment,
        input: {
          variable: 'profile',
          lever: 'flow',
          value: to,
          grind: null,
          summary: `Slow the extraction flow to ${one(to)} ml/s`,
          rationale: 'A smaller step: a little more contact time, while the shot stays close to the one you liked.',
          expectedEffect: `A little more contact time than v${num(shot(messages).version)}, and a shot only slightly slower.`,
          tips: ['Keep the 14.5 grind and the same dose.'],
        },
      },
    ],
  };
};

const halfwayLoaded = (messages: readonly LlmMessage[]): CoachTurn => {
  const applied = result<Extract<AdjustmentResultPayload, { applied: true }>>(messages, TOOL.proposeAdjustment);
  return {
    text: `v${num(applied.version)} is on the machine at ${one(proposal(messages).value)} ml/s. Pull a shot and tell me how it compares.`,
  };
};

const lastShot = (messages: readonly LlmMessage[]): CoachTurn => {
  const { summary, version } = shot(messages);
  return {
    text:
      `Shot four on v${num(version)}: ${one(summary.durationS)} s and ${one(summary.yieldG)} g, with the slower pour peaking at ${one(summary.peakPressureBar)} bar. ` +
      'Taste it while it is warm and tell me how it compares.',
    tools: tasteQuestion(),
  };
};

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

const HOUR = 60;

/**
 * Santos about a day ago, Kiambu AA from just after it; this morning the
 * stray shot, Kiambu AA's third shot and the flow changes; the last shot a
 * few minutes before the demo opens.
 */
export const STORY: readonly StoryStep[] = [
  // Santos
  { kind: 'newBag', minutesAgo: 26.5 * HOUR },
  {
    kind: 'say',
    minutesAgo: 26.5 * HOUR - 1,
    text: 'Santos from Brazil, natural process, medium-dark roast. Milk chocolate, hazelnut and a little cherry.',
    coach: [santosIntake],
  },
  { kind: 'pick', minutesAgo: 26.5 * HOUR - 2, templateId: 'gentle-and-sweet', coach: [onTheMachine] },
  { kind: 'shot', minutesAgo: 26.5 * HOUR - 7, shot: SHOTS.santos, coach: [santosShot] },
  { kind: 'rate', minutesAgo: 26.5 * HOUR - 8, stars: 5 },
  { kind: 'answer', minutesAgo: 26.5 * HOUR - 8.5, selected: ['Balanced, sweet'], other: null, coach: [santosKeep] },
  { kind: 'confirm', minutesAgo: 26.5 * HOUR - 9, coach: [santosKept] },

  // Kiambu AA, yesterday
  { kind: 'newBag', minutesAgo: 24 * HOUR },
  {
    kind: 'say',
    minutesAgo: 24 * HOUR - 1,
    text: 'Kiambu AA from Kenya, washed, light roast. Notes of blackcurrant, grapefruit and brown sugar.',
    coach: [kiambuIntake],
  },
  { kind: 'pick', minutesAgo: 24 * HOUR - 2, templateId: 'blooming-espresso', coach: [onTheMachine] },
  { kind: 'shot', minutesAgo: 24 * HOUR - 8, shot: SHOTS.kiambu1, coach: [firstShot] },
  { kind: 'rate', minutesAgo: 24 * HOUR - 9.5, stars: 2 },
  { kind: 'answer', minutesAgo: 24 * HOUR - 10, selected: ['Sour / sharp'], other: null, coach: [lookAtPressure, hotter] },
  { kind: 'confirm', minutesAgo: 24 * HOUR - 11, coach: [pullAnother] },
  { kind: 'shot', minutesAgo: 24 * HOUR - 19, shot: SHOTS.kiambu2, coach: [unevenPuck] },
  { kind: 'rate', minutesAgo: 24 * HOUR - 20.5, stars: 3 },
  { kind: 'answer', minutesAgo: 24 * HOUR - 21, selected: ['Pinholes', 'Wet patches'], other: null, coach: [grindFiner] },
  { kind: 'confirm', minutesAgo: 24 * HOUR - 22, coach: [afterGrind] },

  // This morning
  { kind: 'otherProfile', minutesAgo: 55, profileId: OTHER_PROFILE_ID },
  { kind: 'strayShot', minutesAgo: 50, shot: SHOTS.stray },
  { kind: 'retry', minutesAgo: 47 },
  { kind: 'shot', minutesAgo: 38, shot: SHOTS.kiambu3, coach: [betterShot] },
  { kind: 'rate', minutesAgo: 36.5, stars: 4 },
  { kind: 'answer', minutesAgo: 36, selected: ['Other'], other: 'Sweeter, but a little thin', coach: [thin] },
  { kind: 'decline', minutesAgo: 35, coach: [keepV2] },
  { kind: 'say', minutesAgo: 33, text: "Actually, let's try the slower pour after all.", coach: [offerAgain] },
  { kind: 'confirm', minutesAgo: 32, coach: [slowerLoaded] },
  { kind: 'undo', minutesAgo: 30, coach: [backOnV2] },
  { kind: 'say', minutesAgo: 29, text: '1.8 feels like a big jump. Could we meet halfway, at 2.0?', coach: [halfway] },
  { kind: 'confirm', minutesAgo: 28, coach: [halfwayLoaded] },
  { kind: 'shot', minutesAgo: 6, shot: SHOTS.kiambu4, coach: [lastShot] },
];
