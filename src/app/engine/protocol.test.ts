import { describe, expect, it } from 'vitest';
import {
  awaitingModel,
  grinderPayload,
  intakeBlocks,
  shotCompletedBlock,
  summaryForModel,
  toolResult,
  unansweredToolUses,
  undoBlock,
} from './protocol.ts';
import type { LlmMessage } from '../../llm/types.ts';
import type { GrinderInfo, ShotSummary } from '../../coach/types.ts';

const NICHE: GrinderInfo = { model: 'Niche Zero', settingType: 'numeric', smallStep: 0.5, bigStep: 2, values: null };
const ENCORE: GrinderInfo = {
  model: 'Baratza Encore ESP',
  settingType: 'preset',
  smallStep: null,
  bigStep: null,
  values: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
};

const summary: ShotSummary = {
  shotId: 's1',
  timestamp: '2026-10-03T08:00:00.000000',
  profileTitle: 'Kiambu v1',
  durationS: 31.2,
  doseG: 18,
  yieldG: 36.4,
  ratio: 2.02,
  targetYieldG: 36,
  timeToFirstDropS: 7.5,
  preinfusionEndS: 9.1,
  peakPressureBar: 8.8,
  peakPressureAtS: 12,
  meanPourFlowMlS: 1.9,
  meanPourWeightFlowGs: 1.7,
  meanTempC: 92.3,
  tempDeviationC: 0.4,
  resistanceTrend: 'flat',
  channelingFlags: [],
  stopReason: 'targetWeight',
  phases: [],
  series: { tS: [0, 1], pressure: [0, 1], flow: [0, 1], weight: [0, 0], weightFlow: [0, 0], temperature: [92, 92], targetPressure: [null, null], targetFlow: [null, null] },
};

describe('engine protocol', () => {
  it('builds the intake turn with a [context] block', () => {
    const blocks = intakeBlocks('Kenya Kiambu, light, washed', {
      grinder: { name: 'Niche', setting: '12' },
      scaleConnected: true,
    });
    expect(blocks).toEqual([
      { type: 'text', text: 'Kenya Kiambu, light, washed' },
      { type: 'text', text: '[context]\n{"grinder":{"name":"Niche","setting":"12"},"scaleConnected":true}' },
    ]);
  });

  it("puts the dose and the linked grinder's dial in the intake context (rule 1)", () => {
    const blocks = intakeBlocks('Kenya Kiambu, light, washed', {
      grinder: grinderPayload('Niche Zero', '15', NICHE),
      scaleConnected: true,
      doseG: 18,
    });
    expect(blocks[1]).toEqual({
      type: 'text',
      text: '[context]\n{"grinder":{"name":"Niche Zero","setting":"15","settingType":"numeric","step":0.5,"values":null},"scaleConnected":true,"doseG":18}',
    });
  });

  describe('grinderPayload', () => {
    it("gives a numeric grinder's small step and no values", () => {
      expect(grinderPayload('Niche Zero', '15', NICHE)).toEqual({
        name: 'Niche Zero',
        setting: '15',
        settingType: 'numeric',
        step: 0.5,
        values: null,
      });
    });

    it("gives a preset grinder's settings, in Decaid's order, and no step", () => {
      const payload = grinderPayload('Baratza Encore ESP', '5', ENCORE);
      expect(payload).toEqual({ name: 'Baratza Encore ESP', setting: '5', settingType: 'preset', step: null, values: ENCORE.values });
      expect(payload.values).not.toBe(ENCORE.values);
    });

    it('says null for everything Decaid does not know', () => {
      expect(grinderPayload('DF64', '14', null)).toEqual({ name: 'DF64', setting: '14', settingType: null, step: null, values: null });
      expect(grinderPayload(null, null, { ...NICHE, smallStep: null })).toMatchObject({ settingType: 'numeric', step: null, values: null });
      for (const smallStep of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(grinderPayload('Niche Zero', '15', { ...NICHE, smallStep }).step, String(smallStep)).toBeNull();
      }
      expect(grinderPayload('Encore', '5', { ...ENCORE, values: [] })).toMatchObject({ settingType: 'preset', values: null });
      // A step on a preset grinder, or a list on a numeric one, is not how its dial moves.
      expect(grinderPayload('Encore', '5', { ...ENCORE, smallStep: 1 }).step).toBeNull();
      expect(grinderPayload('Niche Zero', '15', { ...NICHE, values: ['1', '2'] }).values).toBeNull();
    });
  });

  it('encodes tool results as JSON text, flagging errors only when asked', () => {
    expect(toolResult('t1', { picked: 'd-flow' })).toEqual({
      type: 'tool_result',
      tool_use_id: 't1',
      content: '{"picked":"d-flow"}',
    });
    expect(toolResult('t2', 'nope', true)).toEqual({ type: 'tool_result', tool_use_id: 't2', content: 'nope', is_error: true });
  });

  it('strips the series from the shot payload the model gets up front', () => {
    const block = shotCompletedBlock({
      shotRef: 'latest',
      shotId: 's1',
      version: 1,
      templateId: 'd-flow',
      levers: { temp: 88 },
      doseG: 18,
      targetYieldG: 36,
      grinder: { name: 'Niche Zero', setting: '13' },
      summary: summaryForModel(summary),
    });
    expect(block.text.startsWith('[event:shot_completed]\n')).toBe(true);
    const payload = JSON.parse(block.text.split('\n')[1]!);
    expect(payload.levers.temp).toBe(88);
    expect(payload.grinder).toEqual({ name: 'Niche Zero', setting: '13' });
    expect(payload.summary.series).toBeUndefined();
    expect(payload.summary.yieldG).toBe(36.4);
  });

  it("carries the linked grinder's dial in the shot event (rule 3)", () => {
    const block = shotCompletedBlock({
      shotRef: 'latest',
      shotId: 's1',
      version: 1,
      templateId: 'd-flow',
      levers: { temp: 88 },
      doseG: 18,
      targetYieldG: 50,
      grinder: grinderPayload('Baratza Encore ESP', '5', ENCORE),
      summary: summaryForModel(summary),
    });
    expect(block.text).toContain(
      '"grinder":{"name":"Baratza Encore ESP","setting":"5","settingType":"preset","step":null,"values":["1","2","3","4","5","6","7","8","9","10","11","12"]}',
    );
  });

  it('formats the undo event', () => {
    expect(undoBlock({ from: 3, to: 2, title: 'Kiambu v2' }).text).toBe(
      '[event:undo]\n{"from":3,"to":2,"title":"Kiambu v2"}',
    );
  });

  it('finds the tool calls a transcript is still waiting on', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'Pick one' },
          { type: 'tool_use', id: 'a', name: 'save_bag_details', input: {} },
          { type: 'tool_use', id: 'b', name: 'propose_templates', input: {} },
        ],
      },
    ];
    expect(unansweredToolUses(messages).map((b) => b.id)).toEqual(['a', 'b']);
    expect(awaitingModel(messages)).toBe(false);
    expect(unansweredToolUses(messages.slice(0, 1))).toEqual([]);
    expect(awaitingModel(messages.slice(0, 1))).toBe(true);
  });
});
