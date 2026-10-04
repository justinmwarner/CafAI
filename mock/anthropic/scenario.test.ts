import { describe, expect, it } from 'vitest';
import { TOOL, TOOL_INPUTS, type ToolName } from '../../src/coach/contract.ts';
import { createScenarioMemory, respond, type ScenarioMemory, type ScenarioResponse } from './scenario.ts';

type Block = Record<string, unknown>;
type Message = { role: 'user' | 'assistant'; content: Block[] };

const HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'x-api-key': 'sk-ant-test',
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
};

const TOOLS = Object.keys(TOOL_INPUTS).map((name) => ({
  name,
  description: name,
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  strict: true,
}));

const text = (t: string): Block => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: unknown = {}): Block => ({ type: 'tool_use', id, name, input });
const toolResult = (id: string, payload: unknown): Block => ({
  type: 'tool_result',
  tool_use_id: id,
  content: typeof payload === 'string' ? payload : JSON.stringify(payload),
});
const user = (...content: Block[]): Message => ({ role: 'user', content });
const assistant = (...content: Block[]): Message => ({ role: 'assistant', content });

function request(messages: Message[], over: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    stream: true,
    system: 'You are an espresso coach.',
    messages,
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    cache_control: { type: 'ephemeral' },
    output_config: { effort: 'medium' },
    ...over,
  };
}

function call(
  messages: Message[],
  options: { memory?: ScenarioMemory; headers?: Record<string, string>; over?: Record<string, unknown> } = {},
): ScenarioResponse {
  const headers = new Headers({ ...HEADERS, ...options.headers });
  return respond(request(messages, options.over), headers, options.memory ?? createScenarioMemory({ session: 't' }));
}

function ok(result: ScenarioResponse) {
  if (result.status !== 200 || !('content' in result)) throw new Error(`expected 200, got ${JSON.stringify(result)}`);
  const content = result.content as Block[];
  const stopReason = (result.events.at(-2)?.data.delta as { stop_reason: string }).stop_reason;
  return {
    content,
    stopReason,
    text: content.filter((b) => b.type === 'text').map((b) => b.text as string).join(''),
    tools: content.filter((b) => b.type === 'tool_use') as Array<{ id: string; name: ToolName; input: unknown }>,
  };
}

function errorOf(result: ScenarioResponse) {
  if (!('errorBody' in result)) throw new Error('expected an error response');
  return { status: result.status, type: result.errorBody.error.type, message: result.errorBody.error.message };
}

function expectValidInputs(tools: Array<{ name: ToolName; input: unknown }>) {
  for (const tool of tools) {
    const parsed = TOOL_INPUTS[tool.name].safeParse(tool.input);
    expect(parsed.success, `${tool.name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  }
}

// A conversation the engine could have sent, following ENGINE_PROTOCOL.md.
const INTAKE = user(
  text('Kiambu AA, light roast, washed, from Kenya. Blackcurrant and grapefruit.'),
  text('[context]\n{"grinder":{"name":"Niche Zero","setting":"14"},"scaleConnected":true}'),
);
const INTAKE_REPLY = assistant(
  text('Lovely.'),
  toolUse('t_save', TOOL.saveBagDetails, { name: 'Kiambu AA' }),
  toolUse('t_tpl', TOOL.proposeTemplates, { suggestions: [] }),
);
const PICKED = user(
  toolResult('t_save', { saved: true }),
  toolResult('t_tpl', { picked: 'blooming-espresso', version: 1, title: 'Kiambu AA v1', uploaded: true, note: null }),
);
const LOADED_REPLY = assistant(text('Loaded Kiambu AA v1.'));
const shot = (levers: Record<string, number>, templateId = 'blooming-espresso', version = 1) =>
  user(
    text(
      '[event:shot_completed]\n' +
        JSON.stringify({
          shotRef: 'latest',
          shotId: 'shot-1',
          version,
          templateId,
          levers,
          doseG: 18,
          targetYieldG: 36,
          summary: { shotId: 'shot-1', durationS: 28.4, yieldG: 36.2, doseG: 18 },
        }),
    ),
  );
const BLOOMING_LEVERS = { temp: 92, yield: 36, bloom: 30, piExit: 4, flow: 2.2 };
const SHOT_REPLY = assistant(text('Got it.'), toolUse('t_ask', TOOL.askUser, { question: 'How did it taste?' }));
const answer = (selected: string[], other: string | null = null) => user(toolResult('t_ask', { selected, other }));
const ANSWER_REPLY = assistant(text('Thanks.'), toolUse('t_series', TOOL.getShotSeries, { shot: 'latest' }));
const SERIES = user(toolResult('t_series', { metric: 'pressure', tS: [0, 1, 2], values: [0, 4, 9] }));
const ADJUST_REPLY = assistant(toolUse('t_adj', TOOL.proposeAdjustment, { variable: 'profile' }));

const UP_TO_SHOT = [INTAKE, INTAKE_REPLY, PICKED, LOADED_REPLY];

function adjustmentFor(selected: string[], levers: Record<string, number> = BLOOMING_LEVERS, templateId = 'blooming-espresso') {
  const reply = ok(call([...UP_TO_SHOT, shot(levers, templateId), SHOT_REPLY, answer(selected), ANSWER_REPLY, SERIES]));
  expect(reply.tools.map((t) => t.name)).toEqual([TOOL.proposeAdjustment]);
  expectValidInputs(reply.tools);
  return reply.tools[0]?.input as Record<string, unknown>;
}

describe('request checks', () => {
  it('answers 400 for missing or wrong headers', () => {
    for (const [name, value] of [
      ['x-api-key', ''],
      ['anthropic-version', '2024-01-01'],
      ['anthropic-dangerous-direct-browser-access', 'false'],
      ['content-type', 'text/plain'],
    ] as const) {
      const error = errorOf(call([INTAKE], { headers: { [name]: value } }));
      expect(error, name).toMatchObject({ status: 400, type: 'invalid_request_error' });
      expect(error.message).toContain(name);
    }
  });

  it('answers 401 for the invalid test key and 529 for the overloaded one', () => {
    expect(errorOf(call([INTAKE], { headers: { 'x-api-key': 'sk-ant-invalid' } }))).toMatchObject({
      status: 401,
      type: 'authentication_error',
    });
    expect(errorOf(call([INTAKE], { headers: { 'x-api-key': 'sk-ant-overloaded' } }))).toMatchObject({
      status: 529,
      type: 'overloaded_error',
    });
  });

  it('answers 400 when the request does not stream, forces a tool, or has a non-strict tool', () => {
    expect(errorOf(call([INTAKE], { over: { stream: false } })).message).toContain('stream');
    expect(errorOf(call([INTAKE], { over: { tool_choice: { type: 'any' } } })).message).toContain('tool_choice');
    expect(errorOf(call([INTAKE], { over: { tool_choice: undefined } })).message).toContain('tool_choice');
    const loose = TOOLS.map((t, i) => (i === 3 ? { ...t, strict: false } : t));
    expect(errorOf(call([INTAKE], { over: { tools: loose } })).message).toContain('strict');
  });

  it('answers 400 when a tool_use is not answered in the next user message', () => {
    const error = errorOf(call([INTAKE, INTAKE_REPLY, user(toolResult('t_save', { saved: true }))]));
    expect(error.status).toBe(400);
    expect(error.message).toContain('t_tpl');
  });

  it('answers 400 for a tool_result that answers no tool_use', () => {
    const error = errorOf(call([INTAKE, INTAKE_REPLY, user(...PICKED.content, toolResult('t_ghost', {}))]));
    expect(error.status).toBe(400);
    expect(error.message).toContain('t_ghost');
  });

  it('answers 400 for assistant prefill (the last message must be from the user)', () => {
    expect(errorOf(call([INTAKE, assistant(text('Sure'))])).status).toBe(400);
  });

  it('answers 400 when an assistant turn it produced comes back modified, and only then', () => {
    const memory = createScenarioMemory({ session: 'replay' });
    const first = ok(call([INTAKE], { memory }));
    const reply = assistant(...first.content);
    const answers = user(
      toolResult(first.tools[0]!.id, { saved: true }),
      toolResult(first.tools[1]!.id, { picked: 'd-flow', version: 1, title: 'Kiambu AA v1', uploaded: true, note: null }),
    );
    expect(call([INTAKE, reply, answers], { memory }).status).toBe(200);

    const edited = assistant(...first.content.map((b) => (b.type === 'text' ? { ...b, text: 'Edited.' } : b)));
    expect(errorOf(call([INTAKE, edited, answers], { memory })).message).toMatch(/modified/);

    const withoutThinking = assistant(...first.content.slice(1));
    expect(errorOf(call([INTAKE, withoutThinking, answers], { memory })).message).toMatch(/modified/);

    // A fresh memory (a page reload) does not know the turn and does not check it.
    expect(call([INTAKE, edited, answers], { memory: createScenarioMemory({ session: 'other' }) }).status).toBe(200);
  });
});

describe('scripted replies', () => {
  it('starts every reply with an empty thinking block whose signature is unique', () => {
    const memory = createScenarioMemory({ session: 's' });
    const a = ok(call([INTAKE], { memory }));
    const b = ok(call([INTAKE], { memory }));
    expect(a.content[0]).toMatchObject({ type: 'thinking', thinking: '' });
    expect(typeof a.content[0]?.signature).toBe('string');
    expect(a.content[0]?.signature).not.toBe(b.content[0]?.signature);
    expect(a.tools[0]?.id).not.toBe(b.tools[0]?.id);
  });

  it('rule 7: intake saves the bag details and proposes templates ranked for a light roast', () => {
    const reply = ok(call([INTAKE]));
    expect(reply.text).toBe('Lovely. Here is where I would start.');
    expect(reply.stopReason).toBe('tool_use');
    expect(reply.tools.map((t) => t.name)).toEqual([TOOL.saveBagDetails, TOOL.proposeTemplates]);
    expectValidInputs(reply.tools);
    expect(reply.tools[0]?.input).toEqual({
      name: 'Kiambu AA',
      roaster: null,
      origin: 'Kenya',
      roastLevel: 'light',
      process: 'washed',
      notes: null,
    });
    const suggestions = (reply.tools[1]?.input as { suggestions: Array<{ templateId: string; confidence: string }> })
      .suggestions;
    expect(suggestions.map((s) => [s.templateId, s.confidence])).toEqual([
      ['blooming-espresso', 'high'],
      ['d-flow', 'medium'],
      ['londonium', 'low'],
    ]);
  });

  it('rule 7: ranks templates for dark and for other roasts', () => {
    const ranking = (description: string) => {
      const reply = ok(call([user(text(description))]));
      const input = reply.tools[1]?.input as { suggestions: Array<{ templateId: string; confidence: string }> };
      return { roast: (reply.tools[0]?.input as { roastLevel: unknown }).roastLevel, order: input.suggestions.map((s) => `${s.templateId}:${s.confidence}`) };
    };
    expect(ranking('Italian Job, dark roast, natural')).toEqual({
      roast: 'dark',
      order: ['londonium:high', 'd-flow:medium', 'blooming-espresso:low'],
    });
    expect(ranking('Some blend, medium-light, honey')).toEqual({
      roast: 'medium-light',
      order: ['d-flow:high', 'blooming-espresso:medium', 'londonium:medium'],
    });
    expect(ranking('Mystery beans')).toEqual({
      roast: null,
      order: ['d-flow:high', 'blooming-espresso:medium', 'londonium:medium'],
    });
  });

  it('rule 7: names the bag from the text before the first comma, at most 40 characters', () => {
    const long = ok(call([user(text('A very long coffee name that goes on and on forever and ever'))]));
    const name = (long.tools[0]?.input as { name: string }).name;
    expect(name.length).toBeLessThanOrEqual(40);
    expect('A very long coffee name that goes on and on forever and ever'.startsWith(name)).toBe(true);
    expectValidInputs(long.tools);
  });

  it('rule 5: a picked template is loaded', () => {
    const reply = ok(call([INTAKE, INTAKE_REPLY, PICKED]));
    expect(reply.text).toBe('Loaded Kiambu AA v1. Pull a shot when you are ready; I will read the curves.');
    expect(reply.tools).toEqual([]);
    expect(reply.stopReason).toBe('end_turn');
  });

  it('rule 5: a pick that did not load on the machine asks for a retry', () => {
    const failed = user(
      toolResult('t_save', { saved: true }),
      toolResult('t_tpl', { picked: 'blooming-espresso', version: 1, title: 'Kiambu AA v1', uploaded: false, note: null }),
    );
    const reply = ok(call([INTAKE, INTAKE_REPLY, failed]));
    expect(reply.text).toBe('I saved Kiambu AA v1, but it did not load on the machine. Tap Retry above, then pull a shot.');
    expect(reply.tools).toEqual([]);
  });

  it('a question the user typed past is not a pick, a taste or a decision', () => {
    const typedPast = { answered: false, note: 'The user typed a message instead.' };
    const nudge = 'Got it. Pull a shot when you are ready, or tell me more about the coffee.';
    const pastTemplates = user(toolResult('t_save', { saved: true }), toolResult('t_tpl', typedPast), text('Which is sweetest?'));
    expect(ok(call([INTAKE, INTAKE_REPLY, pastTemplates])).text).toBe(nudge);

    const pastTaste = user(toolResult('t_ask', typedPast), text('Is the grinder too coarse?'));
    const taste = ok(call([...UP_TO_SHOT, shot(BLOOMING_LEVERS), SHOT_REPLY, pastTaste]));
    expect(taste.text).toBe(nudge);
    expect(taste.tools).toEqual([]);

    const base = [...UP_TO_SHOT, shot(BLOOMING_LEVERS), SHOT_REPLY, answer(['Sour / sharp']), ANSWER_REPLY, SERIES, ADJUST_REPLY];
    const pastChange = ok(call([...base, user(toolResult('t_adj', typedPast), text('What does that change do?'))]));
    expect(pastChange.text).toBe(nudge);
  });

  it('rule 4: a finished shot is summed up and the taste asked for', () => {
    const reply = ok(call([...UP_TO_SHOT, shot(BLOOMING_LEVERS)]));
    expect(reply.text).toBe('Got it: 28.4 s, 36.2 g out.');
    expect(reply.tools.map((t) => [t.name, t.input])).toEqual([
      [
        TOOL.askUser,
        {
          question: 'How did it taste?',
          options: ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery'],
          multiSelect: false,
        },
      ],
    ]);
    expect(reply.stopReason).toBe('tool_use');
  });

  it('rule 3: a taste answer leads to the pressure curve', () => {
    const reply = ok(call([...UP_TO_SHOT, shot(BLOOMING_LEVERS), SHOT_REPLY, answer(['Sour / sharp'])]));
    expect(reply.text).toBe('Thanks. Let me look at the pressure curve.');
    expect(reply.tools.map((t) => [t.name, t.input])).toEqual([
      [TOOL.getShotSeries, { shot: 'latest', metric: 'pressure', fromS: null, toS: null }],
    ]);
  });

  it('rule 2: sour raises the temperature by 1 °C', () => {
    expect(adjustmentFor(['Sour / sharp'])).toMatchObject({ variable: 'profile', lever: 'temp', value: 93, grind: null });
  });

  it('rule 2: sour at the template maximum lengthens the yield instead', () => {
    const levers = { temp: 94, yield: 50, soak: 3, soakWeight: 4, pourFlow: 1.7, pourPmax: 8.5 };
    expect(adjustmentFor(['Sour / sharp'], levers, 'd-flow')).toMatchObject({ variable: 'profile', lever: 'yield', value: 52 });
  });

  it('rule 2: bitter, weak, strong, balanced and anything else', () => {
    expect(adjustmentFor(['Bitter / harsh'])).toMatchObject({ variable: 'profile', lever: 'temp', value: 91 });
    expect(adjustmentFor(['Weak / watery'])).toMatchObject({ variable: 'profile', lever: 'yield', value: 34 });
    expect(adjustmentFor(['Other'])).toMatchObject({
      variable: 'grind',
      lever: null,
      value: null,
      grind: { direction: 'finer', amount: 1, setting: null },
    });
    expect(adjustmentFor(['Balanced, sweet'])).toMatchObject({ variable: 'none', lever: null, value: null, grind: null });
    const strong = ok(
      call([...UP_TO_SHOT, shot(BLOOMING_LEVERS), SHOT_REPLY, user(toolResult('t_ask', { selected: ['Other'], other: 'Too strong' })), ANSWER_REPLY, SERIES]),
    );
    expect(strong.tools[0]?.input).toMatchObject({ lever: 'yield', value: 38 });
  });

  it('rule 1: an applied change is confirmed, a declined one keeps the version', () => {
    const base = [...UP_TO_SHOT, shot(BLOOMING_LEVERS), SHOT_REPLY, answer(['Sour / sharp']), ANSWER_REPLY, SERIES, ADJUST_REPLY];
    const decide = (payload: unknown) => ok(call([...base, user(toolResult('t_adj', payload))]));
    expect(decide({ applied: true, variable: 'profile', version: 2, title: 'Kiambu AA v2' }).text).toBe(
      'Done. v2 is on the machine. Pull another shot and tell me how it tastes.',
    );
    expect(decide({ applied: true, variable: 'grind', version: null, title: null }).text).toBe(
      'Make that change, then pull another shot.',
    );
    expect(decide({ applied: false, reason: 'The user declined.' }).text).toBe(
      'OK, we keep v1 as it is. Tell me what you would like to try instead.',
    );
    const done = decide({ applied: false, error: 'The machine did not take the profile.' });
    expect(done.text).toBe('OK, we keep v1 as it is. Tell me what you would like to try instead.');
    expect(done.stopReason).toBe('end_turn');
  });

  it('rule 6: undo goes back a version', () => {
    const reply = ok(call([...UP_TO_SHOT, user(text('[event:undo]\n{"from":2,"to":1,"title":"Kiambu AA v1"}'))]));
    expect(reply.text).toBe('Back on v1. Pull a shot when you are ready.');
    expect(reply.stopReason).toBe('end_turn');
  });

  it('rule 8: anything else gets a nudge', () => {
    const reply = ok(call([...UP_TO_SHOT, user(text('It smells amazing'))]));
    expect(reply.text).toBe('Got it. Pull a shot when you are ready, or tell me more about the coffee.');
    expect(reply.tools).toEqual([]);
  });
});
