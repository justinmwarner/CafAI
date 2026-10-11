import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  awaitingModel,
  grinderPayload,
  intakeBlocks,
  photoIntakeText,
  pickedIntakeText,
  shotCompletedBlock,
  shotRatedBlock,
  summaryForModel,
  toolResult,
  unansweredToolUses,
  undoBlock,
  type GrinderPayload,
  type IntakeContext,
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
  pourStartS: 2.4,
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
  it('builds the intake turn with a [context] block (rule 1)', () => {
    const blocks = intakeBlocks('Kenya Kiambu, light, washed', {
      grinder: grinderPayload('Niche', '12', null, false),
      scaleConnected: true,
      doseG: null,
      bag: null,
      roast: null,
      today: '2026-10-10',
    });
    expect(blocks).toEqual([
      { type: 'text', text: 'Kenya Kiambu, light, washed' },
      {
        type: 'text',
        text: '[context]\n{"grinder":{"name":"Niche","setting":"12","settingType":null,"step":null,"values":null,"linked":false},"scaleConnected":true,"doseG":null,"bag":null,"roast":null,"today":"2026-10-10"}',
      },
    ]);
  });

  it("puts the dose and the linked grinder's dial in the intake context (rule 1)", () => {
    const blocks = intakeBlocks('Kenya Kiambu, light, washed', {
      grinder: grinderPayload('Niche Zero', '15', NICHE, true),
      scaleConnected: true,
      doseG: 18,
      bag: null,
      roast: null,
      today: '2026-10-10',
    });
    expect(blocks[1]).toEqual({
      type: 'text',
      text: '[context]\n{"grinder":{"name":"Niche Zero","setting":"15","settingType":"numeric","step":0.5,"values":null,"linked":true},"scaleConnected":true,"doseG":18,"bag":null,"roast":null,"today":"2026-10-10"}',
    });
  });

  describe('a bag picked from Decaid or read from a photo (6.1, 6.8)', () => {
    const bag = {
      name: 'Red Brick',
      roaster: 'Square Mile',
      origin: 'Brazil, Mogiana',
      roastLevel: 'medium' as const,
      process: 'washed',
      notes: 'chocolate, plum',
      roastDate: '2026-09-24',
    };

    it('says what the user picked, by whom, with its details', () => {
      expect(pickedIntakeText(bag)).toBe(
        "The user picked Red Brick by Square Mile from Decaid's bean library: Brazil, Mogiana; washed; medium roast; roasted 2026-09-24; tasting notes: chocolate, plum.",
      );
      expect(pickedIntakeText({ ...bag, roaster: null, origin: null, process: null, roastLevel: null, notes: null, roastDate: null })).toBe(
        "The user picked Red Brick from Decaid's bean library: no other details.",
      );
    });

    it('says the user confirmed the details read from a photo of the bag', () => {
      expect(photoIntakeText(bag)).toBe(
        'The user confirmed these details read from a photo of the bag: Red Brick by Square Mile; Brazil, Mogiana; washed; medium roast; roasted 2026-09-24; tasting notes: chocolate, plum.',
      );
    });

    it('puts the saved details and the roast in the context block', () => {
      const blocks = intakeBlocks(pickedIntakeText(bag), {
        grinder: grinderPayload(null, null, null, false),
        scaleConnected: false,
        doseG: 18,
        bag,
        roast: 'Roasted 2026-09-24 (9 days ago)',
        today: '2026-10-03',
      });
      expect(JSON.parse((blocks[1] as { text: string }).text.split('\n')[1]!)).toMatchObject({
        doseG: 18,
        bag,
        roast: 'Roasted 2026-09-24 (9 days ago)',
        today: '2026-10-03',
      });
    });
  });

  it('leaves nothing out of the grinder or the intake context: unknown is null (rules 1 and 3)', () => {
    // Checked by the typecheck: every sender (the engine, the live API check) builds the full shapes.
    expectTypeOf<GrinderPayload>().toEqualTypeOf<Required<GrinderPayload>>();
    expectTypeOf<IntakeContext>().toEqualTypeOf<Required<IntakeContext>>();
  });

  describe('grinderPayload', () => {
    it("gives a numeric grinder's small step and no values", () => {
      expect(grinderPayload('Niche Zero', '15', NICHE, true)).toEqual({
        name: 'Niche Zero',
        setting: '15',
        settingType: 'numeric',
        step: 0.5,
        values: null,
        linked: true,
      });
    });

    it("gives a preset grinder's settings, in Decaid's order, and no step", () => {
      const payload = grinderPayload('Baratza Encore ESP', '5', ENCORE, true);
      expect(payload).toEqual({
        name: 'Baratza Encore ESP',
        setting: '5',
        settingType: 'preset',
        step: null,
        values: ENCORE.values,
        linked: true,
      });
      expect(payload.values).not.toBe(ENCORE.values);
    });

    it('says null for everything Decaid does not know', () => {
      expect(grinderPayload('DF64', '14', null, false)).toEqual({
        name: 'DF64',
        setting: '14',
        settingType: null,
        step: null,
        values: null,
        linked: false,
      });
      expect(grinderPayload(null, null, { ...NICHE, smallStep: null }, true)).toMatchObject({ settingType: 'numeric', step: null, values: null });
      for (const smallStep of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(grinderPayload('Niche Zero', '15', { ...NICHE, smallStep }, true).step, String(smallStep)).toBeNull();
      }
      expect(grinderPayload('Encore', '5', { ...ENCORE, values: [] }, true)).toMatchObject({ settingType: 'preset', values: null });
      // A step on a preset grinder, or a list on a numeric one, is not how its dial moves.
      expect(grinderPayload('Encore', '5', { ...ENCORE, smallStep: 1 }, true).step).toBeNull();
      expect(grinderPayload('Niche Zero', '15', { ...NICHE, values: ['1', '2'] }, true).values).toBeNull();
    });

    it('keeps a link Decaid no longer lists: linked, but nothing about its dial (directions only)', () => {
      expect(grinderPayload('Niche Zero', '15', null, true)).toEqual({
        name: 'Niche Zero',
        setting: '15',
        settingType: null,
        step: null,
        values: null,
        linked: true,
      });
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
      grinder: grinderPayload('Niche Zero', '13', null, false),
      roast: 'Roasted 2026-09-24 (9 days ago)',
      today: '2026-10-03',
      summary: summaryForModel(summary),
    });
    expect(block.text.startsWith('[event:shot_completed]\n')).toBe(true);
    const payload = JSON.parse(block.text.split('\n')[1]!);
    expect(payload.levers.temp).toBe(88);
    // The coffee's age on the day of the shot (6.1), and that day, for a roast date said in words after it.
    expect(payload.roast).toBe('Roasted 2026-09-24 (9 days ago)');
    expect(payload.today).toBe('2026-10-03');
    expect(block.text).toContain('"roast":"Roasted 2026-09-24 (9 days ago)","today":"2026-10-03","summary":');
    expect(payload.grinder).toEqual({ name: 'Niche Zero', setting: '13', settingType: null, step: null, values: null, linked: false });
    expect(payload.summary.series).toBeUndefined();
    expect(payload.summary.yieldG).toBe(36.4);
    // Where the pour starts, so the coach counts a time it tells the user from there, as the shot card does.
    expect(payload.summary.pourStartS).toBe(2.4);
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
      grinder: grinderPayload('Baratza Encore ESP', '5', ENCORE, true),
      roast: null,
      today: '2026-10-03',
      summary: summaryForModel(summary),
    });
    expect(block.text).toContain(
      '"grinder":{"name":"Baratza Encore ESP","setting":"5","settingType":"preset","step":null,"values":["1","2","3","4","5","6","7","8","9","10","11","12"],"linked":true}',
    );
  });

  it('formats the undo event', () => {
    expect(undoBlock({ from: 3, to: 2, title: 'Kiambu v2' }).text).toBe(
      '[event:undo]\n{"from":3,"to":2,"title":"Kiambu v2"}',
    );
  });

  it("formats the barista's verdict on a shot, with what it was compared with (D126)", () => {
    expect(shotRatedBlock({ shotId: 's2', verdict: 'much better', comparedWith: { kind: 'previous', shotId: 's1' } }).text).toBe(
      '[event:shot_rated]\n{"shotId":"s2","verdict":"much better","comparedWith":{"kind":"previous","shotId":"s1"}}',
    );
    expect(shotRatedBlock({ shotId: 's1', verdict: 'worse', comparedWith: { kind: 'otherCoffee', shotId: 'r9', coffee: 'Red Brick' } }).text).toBe(
      '[event:shot_rated]\n{"shotId":"s1","verdict":"worse","comparedWith":{"kind":"otherCoffee","shotId":"r9","coffee":"Red Brick"}}',
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
