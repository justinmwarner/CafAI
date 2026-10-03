/**
 * Realistic records for storage tests: a bag, its versions, a shot iteration
 * with a full ~1 Hz series, and a conversation with thinking, tool use and UI
 * parts. Every builder takes overrides so a test states only what it cares about.
 */
import type { ProfileJson, ShotSummary } from '../../coach/types.ts';
import type { Bag, ConversationRecord, IterationRecord, ProfileVersion, Settings } from '../types.ts';
import { newId } from '../../util/id.ts';

export const MODEL = 'claude-opus-5-5';
export const API_KEY = 'sk-ant-api03-TESTKEY-0123456789abcdefghijklmnopqrstuvwxyz-DO-NOT-LEAK';

/** A unique IndexedDB name, so tests never share a database. */
export function uniqueDbName(prefix = 'cafai-test'): string {
  return `${prefix}-${newId()}`;
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { model: MODEL, grinderName: null, grinderSetting: null, activeBagId: null, ...overrides };
}

export function makeBag(overrides: Partial<Bag> = {}): Bag {
  return {
    id: 'bag_kiambu',
    name: 'Kiambu AA',
    roaster: 'Square Mile',
    origin: 'Kenya',
    roastLevel: 'light',
    process: 'washed',
    notes: 'blackcurrant, grapefruit',
    templateId: 'blooming-espresso',
    activeVersionId: 'ver_kiambu_1',
    conversationId: 'conv_kiambu',
    archived: false,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<ProfileJson> = {}): ProfileJson {
  return {
    version: '2',
    title: 'Kiambu AA v1',
    notes: 'Blooming espresso',
    author: 'Decent',
    beverage_type: 'espresso',
    steps: [
      {
        name: 'fill',
        pump: 'flow',
        transition: 'fast',
        sensor: 'coffee',
        temperature: 92,
        seconds: 25,
        volume: 0,
        weight: 0,
        flow: 8,
        exit: { type: 'pressure', condition: 'over', value: 3 },
        limiter: { value: 0, range: 0.6 },
      },
      {
        name: 'pour',
        pump: 'flow',
        transition: 'smooth',
        sensor: 'coffee',
        temperature: 92,
        seconds: 60,
        volume: 0,
        weight: 0,
        flow: 2.2,
        exit: null,
        limiter: { value: 9, range: 0.6 },
      },
    ],
    target_volume: 0,
    target_weight: 40,
    target_volume_count_start: 2,
    tank_temperature: 0,
    ...overrides,
  };
}

export function makeVersion(overrides: Partial<ProfileVersion> = {}): ProfileVersion {
  return {
    id: 'ver_kiambu_1',
    bagId: 'bag_kiambu',
    version: 1,
    title: 'Kiambu AA v1',
    templateId: 'blooming-espresso',
    profile: makeProfile(),
    decaidProfileId: 'profile:7438cb7266f60558b48f',
    parentVersionId: null,
    change: null,
    status: 'active',
    createdAt: '2026-10-01T08:01:00.000Z',
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<ShotSummary> = {}): ShotSummary {
  const tS = Array.from({ length: 32 }, (_, i) => i);
  return {
    shotId: 'shot-1',
    timestamp: '2026-10-01T10:05:00.123456',
    profileTitle: 'Kiambu AA v1',
    durationS: 31.4,
    doseG: 18,
    yieldG: 40.3,
    ratio: 2.24,
    targetYieldG: 40,
    timeToFirstDropS: 7.6,
    preinfusionEndS: 8.2,
    peakPressureBar: 8.8,
    peakPressureAtS: 12.4,
    meanPourFlowMlS: 2.1,
    meanPourWeightFlowGs: 1.8,
    meanTempC: 92.4,
    tempDeviationC: 0.3,
    resistanceTrend: 'falling',
    channelingFlags: [],
    stopReason: 'targetWeight',
    phases: [
      { name: 'preinfusion', startS: 0, endS: 8.2 },
      { name: 'pouring', startS: 8.2, endS: 31.4 },
    ],
    series: {
      tS,
      pressure: tS.map((t) => Math.min(9, t * 0.6)),
      flow: tS.map((t) => (t < 8 ? 4 : 2.1)),
      weight: tS.map((t) => (t < 8 ? null : (t - 8) * 1.7)),
      weightFlow: tS.map((t) => (t < 8 ? null : 1.8)),
      temperature: tS.map(() => 92.4),
      targetPressure: tS.map(() => null),
      targetFlow: tS.map((t) => (t < 8 ? 8 : 2.2)),
    },
    ...overrides,
  };
}

export function makeIteration(overrides: Partial<IterationRecord> = {}): IterationRecord {
  return {
    id: 'it_kiambu_1',
    bagId: 'bag_kiambu',
    bagName: 'Kiambu AA',
    profileVersionId: 'ver_kiambu_1',
    profileVersion: 1,
    shotId: 'shot-1',
    summary: makeSummary(),
    feedback: { question: 'How did it taste?', selected: ['Sour'], otherText: null },
    proposal: {
      variable: 'profile',
      lever: 'temp',
      value: 93,
      grind: null,
      summary: 'Raise brew temperature by 1 °C',
      rationale: 'Sour cup and a fast pour: more heat extracts more.',
      expectedEffect: 'Less sourness, a rounder finish.',
      tips: ['Keep the same dose and puck prep.'],
    },
    change: null,
    outcome: 'pending',
    createdAt: '2026-10-01T10:06:00.000Z',
    updatedAt: '2026-10-01T10:06:00.000Z',
    ...overrides,
  };
}

export function makeConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: 'conv_kiambu',
    bagId: 'bag_kiambu',
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'Kiambu AA, washed, light roast' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Light washed Kenyan: bloom suits it.', signature: 'EqQBCkgIARABGAIi' },
          { type: 'text', text: 'Lovely. Here is where I would start.' },
          { type: 'tool_use', id: 'toolu_01', name: 'propose_templates', input: { suggestions: [] } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: '{"picked":"blooming-espresso"}' }],
      },
    ],
    uiMessages: [
      { id: 'ui_1', role: 'user', parts: [{ kind: 'text', text: 'Kiambu AA, washed, light roast' }], createdAt: '2026-10-01T08:00:10.000Z' },
      { id: 'ui_2', role: 'assistant', parts: [{ kind: 'shot', shotId: 'shot-1', summary: makeSummary() }], createdAt: '2026-10-01T10:05:40.000Z' },
    ],
    createdAt: '2026-10-01T08:00:05.000Z',
    updatedAt: '2026-10-01T10:05:40.000Z',
    ...overrides,
  };
}
