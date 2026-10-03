// The scripted coach end to end: the real provider and runner against the MSW
// handler, with this test playing the engine (docs/briefs/ENGINE_PROTOCOL.md).
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TOOL, TOOL_INPUTS, UI_TOOLS, type ToolName } from '../../src/coach/contract.ts';
import { createAnthropicProvider } from '../../src/llm/anthropic.ts';
import { runConversation } from '../../src/llm/runner.ts';
import { toToolDefinition, zodValidator } from '../../src/llm/schema.ts';
import type { LlmMessage, RunnerTool, RunResult, ToolResultBlock } from '../../src/llm/types.ts';
import { anthropicHandlers, resetAnthropicMock } from './handlers.ts';

const server = setupServer(...anthropicHandlers({ speed: Infinity }));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetAnthropicMock();
});
afterAll(() => server.close());

const SYSTEM = 'You are CafAI, an espresso dial-in coach.';

function coachTools(executed: Array<{ name: string; input: unknown }>): RunnerTool[] {
  return (Object.keys(TOOL_INPUTS) as ToolName[]).map((name) => {
    const schema = TOOL_INPUTS[name];
    const tool: RunnerTool = {
      definition: toToolDefinition(name, `The ${name} tool.`, schema),
      kind: UI_TOOLS.includes(name) ? 'ui' : 'auto',
      validate: zodValidator(schema),
    };
    if (tool.kind === 'auto') {
      tool.execute = async (input) => {
        executed.push({ name, input });
        return { content: JSON.stringify(name === TOOL.saveBagDetails ? { saved: true } : { metric: 'pressure', tS: [0, 1], values: [0, 9] }) };
      };
    }
    return tool;
  });
}

function engine() {
  const transcript: LlmMessage[] = [];
  const executed: Array<{ name: string; input: unknown }> = [];
  const tools = coachTools(executed);
  const provider = createAnthropicProvider({ getApiKey: () => Promise.resolve('sk-ant-test') });
  let modelTurns = 0;
  return {
    transcript,
    executed,
    modelTurns: () => modelTurns,
    async send(...content: LlmMessage['content']): Promise<RunResult> {
      transcript.push({ role: 'user', content });
      return runConversation({
        provider,
        model: 'claude-opus-5-5',
        system: SYSTEM,
        messages: transcript,
        tools,
        onAppend: (message) => {
          transcript.push(message);
        },
        onTurnStart: () => {
          modelTurns += 1;
        },
      });
    },
  };
}

const answer = (id: string, payload: unknown): ToolResultBlock => ({
  type: 'tool_result',
  tool_use_id: id,
  content: JSON.stringify(payload),
});

describe('the scripted coach, end to end', () => {
  it('runs intake -> templates -> shot -> ask_user -> query -> propose_adjustment -> applied -> undo', async () => {
    const coach = engine();

    // 1. Bag intake: save_bag_details runs at once, propose_templates waits for a tap.
    const intake = await coach.send(
      { type: 'text', text: 'Kiambu AA, light roast, washed, from Kenya' },
      { type: 'text', text: '[context]\n{"grinder":{"name":"Niche Zero","setting":"14"},"scaleConnected":true}' },
    );
    expect(intake.finalText).toBe('Lovely. Here is where I would start.');
    expect(intake.pendingUiCalls.map((c) => c.name)).toEqual([TOOL.proposeTemplates]);
    expect(intake.heldResults).toEqual([{ type: 'tool_result', tool_use_id: expect.any(String), content: '{"saved":true}' }]);
    expect(coach.executed).toEqual([
      {
        name: TOOL.saveBagDetails,
        input: { name: 'Kiambu AA', roaster: null, origin: 'Kenya', roastLevel: 'light', process: 'washed', notes: null },
      },
    ]);
    const templates = intake.pendingUiCalls[0]!;
    expect((templates.input as { suggestions: Array<{ templateId: string }> }).suggestions[0]?.templateId).toBe('blooming-espresso');

    // 2. The template tap: held results first, then the pick.
    const loaded = await coach.send(
      ...intake.heldResults,
      answer(templates.id, { picked: 'blooming-espresso', version: 1, title: 'Kiambu AA v1', uploaded: true, note: null }),
    );
    expect(loaded).toEqual({
      pendingUiCalls: [],
      heldResults: [],
      stopReason: 'end_turn',
      finalText: 'Loaded Kiambu AA v1. Pull a shot when you are ready; I will read the curves.',
    });

    // 3. A shot finished.
    const shotPayload = {
      shotRef: 'latest',
      shotId: 'shot-1',
      version: 1,
      templateId: 'blooming-espresso',
      levers: { temp: 92, yield: 36, bloom: 30, piExit: 4, flow: 2.2 },
      doseG: 18,
      targetYieldG: 36,
      summary: { shotId: 'shot-1', durationS: 28.4, doseG: 18, yieldG: 36.2, ratio: 2 },
    };
    const asked = await coach.send({ type: 'text', text: `[event:shot_completed]\n${JSON.stringify(shotPayload)}` });
    expect(asked.finalText).toBe('Got it: 28.4 s, 36.2 g out.');
    expect(asked.pendingUiCalls.map((c) => [c.name, c.input])).toEqual([
      [
        TOOL.askUser,
        {
          question: 'How did it taste?',
          options: ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery'],
          multiSelect: false,
        },
      ],
    ]);

    // 4. The taste answer: the runner runs the curve query itself, then stops at the proposal.
    const proposed = await coach.send(answer(asked.pendingUiCalls[0]!.id, { selected: ['Sour / sharp'], other: null }));
    expect(coach.executed.map((e) => e.name)).toEqual([TOOL.saveBagDetails, TOOL.getShotSeries]);
    expect(coach.executed[1]?.input).toEqual({ shot: 'latest', metric: 'pressure', fromS: null, toS: null });
    expect(proposed.pendingUiCalls.map((c) => c.name)).toEqual([TOOL.proposeAdjustment]);
    expect(proposed.pendingUiCalls[0]?.input).toMatchObject({ variable: 'profile', lever: 'temp', value: 93, grind: null });
    expect(proposed.heldResults).toEqual([]);

    // 5. Confirmed and uploaded as v2.
    const applied = await coach.send(
      answer(proposed.pendingUiCalls[0]!.id, { applied: true, variable: 'profile', version: 2, title: 'Kiambu AA v2' }),
    );
    expect(applied.finalText).toBe('Done. v2 is on the machine. Pull another shot and tell me how it tastes.');

    // 6. Undo back to v1.
    const undone = await coach.send({ type: 'text', text: '[event:undo]\n{"from":2,"to":1,"title":"Kiambu AA v1"}' });
    expect(undone.finalText).toBe('Back on v1. Pull a shot when you are ready.');

    // Seven model turns, every one replayed unchanged (the fake answers 400 to any edit).
    expect(coach.modelTurns()).toBe(7);
    expect(coach.transcript.map((m) => m.role)).toEqual([
      'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
    ]);
    for (const message of coach.transcript.filter((m) => m.role === 'assistant')) {
      expect(message.content[0]).toMatchObject({ type: 'thinking', thinking: '' });
    }
  });

  it('keeps the version when the user declines the change', async () => {
    const coach = engine();
    const intake = await coach.send({ type: 'text', text: 'Italian Job, dark roast, natural' });
    const templates = intake.pendingUiCalls[0]!;
    await coach.send(
      ...intake.heldResults,
      answer(templates.id, { picked: 'londonium', version: 1, title: 'Italian Job v1', uploaded: true, note: null }),
    );
    const asked = await coach.send({
      type: 'text',
      text:
        '[event:shot_completed]\n' +
        JSON.stringify({
          shotRef: 'latest',
          shotId: 'shot-9',
          version: 1,
          templateId: 'londonium',
          levers: { temp: 88, yield: 42, soak: 12, peak: 9, declineEnd: 3 },
          doseG: 18,
          targetYieldG: 42,
          summary: { shotId: 'shot-9', durationS: 33, yieldG: 41.8 },
        }),
    });
    const proposed = await coach.send(answer(asked.pendingUiCalls[0]!.id, { selected: ['Bitter / harsh'], other: null }));
    expect(proposed.pendingUiCalls[0]?.input).toMatchObject({ variable: 'profile', lever: 'temp', value: 87 });
    const declined = await coach.send(answer(proposed.pendingUiCalls[0]!.id, { applied: false, reason: 'The user declined.' }));
    expect(declined.finalText).toBe('OK, we keep v1 as it is. Tell me what you would like to try instead.');
  });
});
