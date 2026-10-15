import { describe, expect, it } from 'vitest';
import { withTds } from '../../coach/extraction.ts';
import type { ShotSummary } from '../../coach/types.ts';
import type { LlmMessage } from '../../llm/types.ts';
import type { CoachUiMessage } from '../types.ts';
import { shotCompletedBlock, shotMeasuredBlock, textBlock } from './protocol.ts';
import { setShotTds, shotCard, untoldReadings } from './shotReading.ts';

const summary = (shotId: string, fields: Partial<ShotSummary> = {}): ShotSummary => ({
  shotId,
  timestamp: '2026-10-15T08:00:00.000000',
  profileTitle: 'Kiambu AA v1',
  durationS: 30,
  doseG: 18,
  yieldG: 40.4,
  ratio: 2.24,
  targetYieldG: 40,
  timeToFirstDropS: 8,
  preinfusionEndS: 10,
  peakPressureBar: 8.4,
  peakPressureAtS: 14,
  meanPourFlowMlS: 1.7,
  meanPourWeightFlowGs: 1.6,
  meanTempC: 92,
  tempDeviationC: 0.3,
  resistanceTrend: 'flat',
  channelingFlags: [],
  stopReason: 'targetWeight',
  phases: [],
  series: { tS: [0], pressure: [0], flow: [0], weight: [0], weightFlow: [0], temperature: [92], targetPressure: [null], targetFlow: [null] },
  ...fields,
});

const chat = (...summaries: ShotSummary[]): CoachUiMessage[] =>
  summaries.map((s, i) => ({ id: `m${i}`, role: 'system', createdAt: '2026-10-15T08:00:00.000Z', parts: [{ kind: 'shot', shotId: s.shotId, summary: s }] }));

const user = (...texts: string[]): LlmMessage => ({ role: 'user', content: texts.map(textBlock) });

const measured = (shotId: string, tdsPct: number | null, eyPct: number | null) =>
  shotMeasuredBlock({ shotId, tdsPct, eyPct, doseG: 18, yieldG: 40.4 }).text;

describe('setShotTds and shotCard', () => {
  it("puts a reading in the card's summary with its EY, and takes it out again; other cards keep their identity", () => {
    const messages = chat(summary('shot-1'), summary('shot-2'));
    const read = setShotTds(messages, 'shot-1', 9.25);
    expect(shotCard(read, 'shot-1')!.summary).toMatchObject({ tdsPct: 9.25, eyPct: 20.8 });
    expect(read[1]).toBe(messages[1]);
    const cleared = setShotTds(read, 'shot-1', null);
    expect(shotCard(cleared, 'shot-1')!.summary).not.toHaveProperty('tdsPct');
    expect(shotCard(cleared, 'shot-elsewhere')).toBeUndefined();
  });
});

describe('untoldReadings (D-TDS-6)', () => {
  it('tells a card’s reading the transcript has not told, with the dose and yield it came from', () => {
    const messages = chat(withTds(summary('shot-1'), 9.25));
    expect(untoldReadings([], messages)).toEqual([{ shotId: 'shot-1', tdsPct: 9.25, eyPct: 20.8, doseG: 18, yieldG: 40.4 }]);
  });

  it('tells nothing once the transcript has told it, and again when it changes', () => {
    const transcript = [user(measured('shot-1', 9.25, 20.8))];
    expect(untoldReadings(transcript, chat(withTds(summary('shot-1'), 9.25)))).toEqual([]);
    expect(untoldReadings(transcript, chat(withTds(summary('shot-1'), 9.5)))).toEqual([
      { shotId: 'shot-1', tdsPct: 9.5, eyPct: 21.3, doseG: 18, yieldG: 40.4 },
    ]);
  });

  it('tells a removed reading as null, only when one was told', () => {
    expect(untoldReadings([user(measured('shot-1', 9.25, 20.8))], chat(summary('shot-1')))).toEqual([
      { shotId: 'shot-1', tdsPct: null, eyPct: null, doseG: 18, yieldG: 40.4 },
    ]);
    expect(untoldReadings([], chat(summary('shot-1')))).toEqual([]);
    expect(untoldReadings([user(measured('shot-1', null, null))], chat(summary('shot-1')))).toEqual([]);
  });

  it('counts a reading its record came with, in the shot’s own event, as told', () => {
    const read = withTds(summary('shot-1'), 9.25);
    const { series: _series, ...forModel } = read;
    const event = shotCompletedBlock({
      shotRef: 'latest',
      shotId: 'shot-1',
      version: 1,
      templateId: 'd-flow',
      levers: {},
      doseG: 18,
      targetYieldG: 40,
      grinder: { name: null, setting: null, settingType: null, step: null, values: null, linked: false },
      roast: null,
      today: '2026-10-15',
      summary: forModel,
    }).text;
    expect(untoldReadings([user(event)], chat(read))).toEqual([]);
  });

  it('keeps the chat’s order, reads only user turns, and passes over cards it cannot read', () => {
    const transcript: LlmMessage[] = [{ role: 'assistant', content: [textBlock(measured('shot-2', 9, 20))] }, user('Hello')];
    const broken = { ...summary('shot-3'), tdsPct: 'nine' as unknown as number };
    const untold = untoldReadings(transcript, chat(withTds(summary('shot-1'), 9.25), withTds(summary('shot-2'), 9), broken));
    expect(untold.map((reading) => reading.shotId)).toEqual(['shot-1', 'shot-2']);
  });

  it('reads a block that is not JSON, or a reading for no shot, as no reading told', () => {
    const transcript = [user('[event:shot_measured]\nnot json', '[event:shot_measured]\n{"tdsPct":9}')];
    expect(untoldReadings(transcript, chat(withTds(summary('shot-1'), 9.25)))).toHaveLength(1);
  });
});

describe('shotMeasuredBlock', () => {
  it('is the event marker and the compact JSON payload', () => {
    expect(shotMeasuredBlock({ shotId: 's', tdsPct: 9.25, eyPct: null, doseG: 18, yieldG: null })).toEqual({
      type: 'text',
      text: '[event:shot_measured]\n{"shotId":"s","tdsPct":9.25,"eyPct":null,"doseG":18,"yieldG":null}',
    });
  });
});
