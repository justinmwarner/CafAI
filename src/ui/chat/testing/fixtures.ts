/**
 * Sample data for the chat, history and settings tests and the preview page:
 * one light Kenyan bag dialed in over three days, with every chat part kind.
 * Not shipped.
 */
import type { BeanPickerOption, CoachState, CoachUiMessage, CoachUiPart } from '../../../app/types.ts';
import type { SaveBagDetails } from '../../../coach/contract.ts';
import type { ShotSeries, ShotSummary } from '../../../coach/types.ts';
import type { Bag, IterationRecord, ProfileVersion } from '../../../storage/types.ts';

const OTHER = 'Other';
export const TASTE_OPTIONS = ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery', OTHER];

export function sampleSeries(durationS = 28, peak = 9): ShotSeries {
  const tS: number[] = [];
  const pressure: (number | null)[] = [];
  const flow: (number | null)[] = [];
  for (let t = 0; t <= durationS; t += 1) {
    tS.push(t);
    let p: number;
    let f: number;
    if (t < 6) {
      p = t * 0.6;
      f = 4 - t * 0.5;
    } else if (t < 12) {
      p = 3.6 - (t - 6) * 0.35;
      f = 0.3;
    } else if (t < 16) {
      p = 1.5 + (t - 12) * ((peak - 1.5) / 4);
      f = 1 + (t - 12) * 0.3;
    } else {
      p = peak - (t - 16) * ((peak - 6) / Math.max(1, durationS - 16));
      f = 2.1 + Math.sin(t / 2) * 0.15;
    }
    pressure.push(Math.round(p * 10) / 10);
    flow.push(Math.round(f * 10) / 10);
  }
  const blank = tS.map(() => null);
  return { tS, pressure, flow, weight: blank, weightFlow: blank, temperature: blank, targetPressure: blank, targetFlow: blank };
}

export function sampleSummary(overrides: Partial<ShotSummary> = {}): ShotSummary {
  const doseG = overrides.doseG === undefined ? 18 : overrides.doseG;
  const yieldG = overrides.yieldG === undefined ? 36.4 : overrides.yieldG;
  return {
    shotId: 'shot-1',
    timestamp: '2026-10-03T08:12:00.000Z',
    profileTitle: 'Kiambu AA v1',
    durationS: 27.8,
    doseG,
    yieldG,
    ratio: doseG && yieldG ? Math.round((yieldG / doseG) * 100) / 100 : null,
    targetYieldG: 36,
    timeToFirstDropS: 9.4,
    preinfusionEndS: 12,
    peakPressureBar: 8.9,
    peakPressureAtS: 16,
    meanPourFlowMlS: 2.1,
    meanPourWeightFlowGs: 1.9,
    meanTempC: 92.8,
    tempDeviationC: 0.3,
    resistanceTrend: 'flat',
    channelingFlags: [],
    stopReason: 'weight',
    phases: [],
    series: sampleSeries(),
    ...overrides,
  };
}

export const KIAMBU: Bag = {
  id: 'bag-kiambu',
  name: 'Kiambu AA',
  roaster: 'Square Mile',
  origin: 'Kenya, Kiambu',
  roastLevel: 'light',
  process: 'washed',
  notes: 'blackcurrant, grapefruit, brown sugar',
  templateId: 'blooming-espresso',
  activeVersionId: 'ver-3',
  conversationId: 'conv-kiambu',
  archived: false,
  createdAt: '2026-10-01T07:50:00.000Z',
  updatedAt: '2026-10-03T08:40:00.000Z',
};

export const SANTOS: Bag = {
  id: 'bag-santos',
  name: 'Brazil Santos',
  roaster: null,
  origin: 'Brazil',
  roastLevel: 'medium-dark',
  process: 'natural',
  notes: 'chocolate, hazelnut',
  templateId: 'londonium',
  activeVersionId: 'ver-s1',
  conversationId: 'conv-santos',
  archived: false,
  createdAt: '2026-09-20T07:00:00.000Z',
  updatedAt: '2026-09-21T07:00:00.000Z',
};

function version(n: number, status: ProfileVersion['status'], createdAt: string, change: ProfileVersion['change']): ProfileVersion {
  return {
    id: `ver-${n}`,
    bagId: KIAMBU.id,
    version: n,
    title: `Kiambu AA v${n}`,
    templateId: 'blooming-espresso',
    profile: { title: `Kiambu AA v${n}` } as ProfileVersion['profile'],
    decaidProfileId: n === 1 ? 'profile:7438cb7266f60558b48f' : null,
    parentVersionId: n === 1 ? null : `ver-${n - 1}`,
    change,
    status,
    createdAt,
  };
}

export const KIAMBU_VERSIONS: ProfileVersion[] = [
  version(1, 'superseded', '2026-10-01T08:00:00.000Z', null),
  version(2, 'superseded', '2026-10-02T08:10:00.000Z', {
    variable: 'profile',
    lever: 'temp',
    from: 92,
    to: 93,
    diffLines: ['Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)'],
    summary: 'Raise brew temperature by 1 °C',
  }),
  version(3, 'active', '2026-10-03T08:20:00.000Z', {
    variable: 'profile',
    lever: 'yield',
    from: 36,
    to: 38,
    diffLines: ['Yield: 36 g -> 38 g (the shot stops at 38 g)'],
    summary: 'Pull a slightly longer shot',
  }),
  version(4, 'undone', '2026-10-03T08:35:00.000Z', {
    variable: 'profile',
    lever: 'bloom',
    from: 30,
    to: 35,
    diffLines: ['Bloom time: 30 s -> 35 s'],
    summary: 'Bloom 5 s longer',
  }),
];

function iteration(
  id: string,
  versionNumber: number,
  createdAt: string,
  fields: Partial<IterationRecord>,
): IterationRecord {
  return {
    id,
    bagId: KIAMBU.id,
    bagName: KIAMBU.name,
    profileVersionId: `ver-${versionNumber}`,
    profileVersion: versionNumber,
    shotId: `shot-${id}`,
    summary: sampleSummary({ shotId: `shot-${id}`, profileTitle: `Kiambu AA v${versionNumber}` }),
    feedback: null,
    proposal: null,
    change: null,
    outcome: 'pending',
    createdAt,
    updatedAt: createdAt,
    ...fields,
  };
}

export const KIAMBU_ITERATIONS: IterationRecord[] = [
  iteration('it-1', 1, '2026-10-01T08:12:00.000Z', {
    feedback: { question: 'How did it taste?', selected: ['Sour / sharp'], otherText: null },
    proposal: {
      variable: 'profile',
      lever: 'temp',
      value: 93,
      grind: null,
      summary: 'Raise brew temperature by 1 °C',
      rationale: 'Sour with a fast flow: more heat extracts more sweetness.',
      expectedEffect: 'Less sharp, rounder acidity.',
      tips: [],
    },
    change: KIAMBU_VERSIONS[1]?.change ?? null,
    outcome: 'applied',
  }),
  iteration('it-2', 2, '2026-10-02T08:30:00.000Z', {
    summary: sampleSummary({ shotId: 'shot-it-2', durationS: 25.2, yieldG: 35.8, profileTitle: 'Kiambu AA v2' }),
    feedback: { question: 'How did it taste?', selected: ['Weak / watery'], otherText: null },
    proposal: {
      variable: 'profile',
      lever: 'yield',
      value: 38,
      grind: null,
      summary: 'Pull a slightly longer shot',
      rationale: 'Thin body at a 1:2 ratio; a little more yield adds extraction.',
      expectedEffect: 'More body and sweetness.',
      tips: [],
    },
    change: KIAMBU_VERSIONS[2]?.change ?? null,
    outcome: 'applied',
  }),
  iteration('it-3', 3, '2026-10-03T08:30:00.000Z', {
    summary: sampleSummary({
      shotId: 'shot-it-3',
      yieldG: 38.1,
      profileTitle: 'Kiambu AA v3',
      channelingFlags: ['pressure_dip_after_peak'],
    }),
    feedback: { question: 'How did it taste?', selected: ['Other'], otherText: 'Sweet but a little hollow' },
    proposal: {
      variable: 'grind',
      lever: null,
      value: null,
      grind: { direction: 'finer', amount: 1, setting: null },
      summary: 'Grind 1 step finer',
      rationale: 'The pressure dipped after the peak.',
      expectedEffect: 'A steadier pour.',
      tips: [],
    },
    outcome: 'declined',
  }),
];

const T0 = Date.parse('2026-10-03T08:00:00.000Z');
let clock = 0;
function msg(role: CoachUiMessage['role'], parts: CoachUiPart[]): CoachUiMessage {
  clock += 1;
  return { id: `m-${clock}`, role, parts, createdAt: new Date(T0 + clock * 60_000).toISOString() };
}
const text = (value: string, streaming = false): CoachUiPart => ({ kind: 'text', text: value, ...(streaming ? { streaming } : {}) });

/** Two batches of Decaid's bean library as the bean card offers them (6.1), the second frozen for 12 days. */
export const BEAN_OPTIONS: BeanPickerOption[] = [
  {
    beanId: 'bean-red',
    batchId: 'batch-red',
    name: 'Red Brick',
    roaster: 'Square Mile Coffee Roasters',
    origin: 'Brazil, Mogiana',
    process: 'washed',
    notes: 'Chocolate, plum',
    roastLevel: 'medium',
    roastDate: '2026-09-24',
    freezeDate: null,
    unfreezeDate: null,
  },
  {
    beanId: 'bean-chel',
    batchId: 'batch-chel',
    name: 'Ethiopia Chelchele',
    roaster: 'Heart Coffee Roasters',
    origin: 'Ethiopia, Guji',
    process: 'natural',
    notes: null,
    roastLevel: 'light',
    roastDate: '2026-09-03',
    freezeDate: '2026-09-04',
    unfreezeDate: '2026-09-16',
  },
];

/** A bag's details as read from a photo of it (6.8). */
export const BAG_FROM_PHOTO: SaveBagDetails = {
  name: 'Kiambu AA',
  roaster: 'Square Mile',
  origin: 'Kenya, Kiambu',
  roastLevel: 'light',
  process: 'washed',
  notes: 'blackcurrant, grapefruit, brown sugar',
  roastDate: '2026-09-28',
};

export const TEMPLATE_ITEMS = [
  {
    templateId: 'blooming-espresso',
    name: 'Blooming Espresso',
    style: 'Blooming',
    shape: 'Fill, 30 s bloom, flat 2.2 ml/s flow',
    confidence: 'high' as const,
    reason: 'Light washed Kenyans open up with a long bloom and a gentle flow.',
  },
  {
    templateId: 'd-flow',
    name: 'D-Flow',
    style: 'Adaptive (D-Flow)',
    shape: 'Soak until first drops, then a flow-limited pour',
    confidence: 'medium' as const,
    reason: 'Forgiving if the grind is still being found.',
  },
  {
    templateId: 'londonium',
    name: 'Londonium',
    style: 'Lever',
    shape: 'Soak, 9 bar peak, declining pressure',
    confidence: 'low' as const,
    reason: 'Better suited to darker roasts; can taste flat on this coffee.',
  },
];

export type ConversationStage =
  | 'intake'
  | 'templates'
  | 'machine-loading'
  | 'shot-search'
  | 'shot'
  | 'options'
  | 'rated'
  | 'options-multi'
  | 'diff'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'streaming';

/** A transient progress notice, as the engine shows while it loads a profile or looks for a shot. */
function progressNotice(text: string, value: number | null, label: string | null): CoachUiPart {
  return { kind: 'notice', tone: 'info', text, progress: { value, label } };
}

/** The Kiambu conversation, ending at `stage` (every earlier step already answered). */
export function conversation(stage: ConversationStage): CoachUiMessage[] {
  clock = 0;
  const out: CoachUiMessage[] = [
    msg('assistant', [
      text(
        'New bag! Tell me about it: origin, roast level, process, and the tasting notes on the label. Type it the way it reads on the bag; I will take it from there.',
      ),
    ]),
  ];
  if (stage === 'intake') return out;
  out.push(msg('user', [text('Kiambu AA from Square Mile, washed, light roast.\nBlackcurrant, grapefruit, brown sugar.')]));
  out.push(
    msg('assistant', [
      text('Lovely. A **bright, light** Kenyan. Here is where I would start:'),
      {
        kind: 'templates',
        requestId: 'tu-templates',
        items: TEMPLATE_ITEMS,
        pickedTemplateId: stage === 'templates' ? null : 'blooming-espresso',
      },
    ]),
  );
  if (stage === 'templates') return out;
  if (stage === 'machine-loading') {
    out.push(msg('system', [progressNotice('Loading Kiambu AA v1 on the machine…', null, null)]));
    return out;
  }
  out.push(msg('assistant', [{ kind: 'notice', tone: 'success', text: 'Kiambu AA v1 is on the machine.' }]));
  out.push(msg('assistant', [text('Loaded Kiambu AA v1. Pull a shot when you are ready; I will read the curves.')]));
  if (stage === 'shot-search') {
    out.push(msg('system', [progressNotice('Looking for that shot in Decaid…', 2 / 6, 'Try 3 of 6')]));
    return out;
  }
  out.push(
    msg('assistant', [
      {
        kind: 'shot',
        shotId: 'shot-1',
        summary: sampleSummary({ channelingFlags: ['pressure_dip_after_peak'] }),
        ...(stage === 'rated' ? { stars: 4 } : {}),
      },
    ]),
  );
  out.push(msg('assistant', [text('Got it: 27.8 s, 36.4 g out.')]));
  if (stage === 'shot') return out;
  const asking = stage === 'options' || stage === 'options-multi' || stage === 'rated';
  out.push(
    msg('assistant', [
      {
        kind: 'options',
        requestId: 'tu-ask',
        question: stage === 'options-multi' ? 'What did you notice? Pick all that apply.' : 'How did it taste?',
        options: TASTE_OPTIONS,
        multiSelect: stage === 'options-multi',
        answer: asking ? null : { selected: ['Sour / sharp'], otherText: null },
        taste: stage !== 'options-multi',
      },
    ]),
  );
  if (asking) return out;
  out.push(msg('assistant', [text('Thanks. Let me look at the pressure curve.')]));
  if (stage === 'streaming') {
    out.push(msg('assistant', [text('Sour with a fast pour usually means the water is not pulling enough from the', true)]));
    return out;
  }
  const status = stage === 'diff' ? 'pending' : stage;
  out.push(
    msg('assistant', [
      text(
        'The shot ran fast and the cup was sharp. One change for the next shot:\n- keep the dose at 18 g\n- keep your puck prep the same',
      ),
      {
        kind: 'diff',
        requestId: 'tu-adjust',
        summary: 'Raise brew temperature by 1 °C',
        lines: ['Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)'],
        manualSteps: [],
        rationale: 'Sour and a fast 27.8 s shot: a little more heat pulls more sweetness from a light roast.',
        expectedEffect: 'Less sharp, rounder acidity, a touch more sweetness.',
        versionLabel: 'Kiambu AA v2',
        status,
        error: stage === 'failed' ? 'Decaid did not answer. Check that this device is on the same network.' : null,
      },
    ]),
  );
  if (stage === 'applied') {
    out.push(msg('assistant', [text('Done. v2 is on the machine. Pull another shot and tell me how it tastes.')]));
  }
  return out;
}

export function coachStateFor(stage: ConversationStage, overrides: Partial<CoachState> = {}): Partial<CoachState> {
  const picked = stage !== 'intake' && stage !== 'templates';
  return {
    ready: true,
    hasApiKey: true,
    bags: [KIAMBU, SANTOS],
    activeBag: KIAMBU,
    activeVersion: picked ? (stage === 'applied' ? (KIAMBU_VERSIONS[1] ?? null) : (KIAMBU_VERSIONS[0] ?? null)) : null,
    versions: KIAMBU_VERSIONS.slice(0, stage === 'applied' ? 2 : 1),
    phase:
      stage === 'intake'
        ? 'intake'
        : stage === 'templates'
          ? 'choosing_template'
          : stage === 'diff'
            ? 'awaiting_confirmation'
            : stage === 'options' || stage === 'options-multi' || stage === 'rated'
              ? 'awaiting_feedback'
              : 'awaiting_shot',
    messages: conversation(stage),
    busy: stage === 'applying' || stage === 'streaming' || stage === 'machine-loading' || stage === 'shot-search',
    error: null,
    canUndo: stage === 'applied',
    ...overrides,
  };
}
