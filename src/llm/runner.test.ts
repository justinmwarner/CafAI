import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clone } from '../util/clone.ts';
import { runConversation } from './runner.ts';
import { toToolDefinition, zodValidator } from './schema.ts';
import { markUnparsedToolInput } from './toolInput.ts';
import {
  LlmError,
  type ContentBlock,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
  type RunRequest,
  type RunnerTool,
  type ToolUseBlock,
} from './types.ts';

type ScriptedTurn = { content: ContentBlock[]; stopReason: string } | LlmError | 'no_done';

const THINKING: ContentBlock = { type: 'thinking', thinking: '', signature: 'sig' };
const text = (t: string): ContentBlock => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: unknown): ToolUseBlock => ({ type: 'tool_use', id, name, input });
const turn = (stopReason: string, ...content: ContentBlock[]) => ({ content: [THINKING, ...content], stopReason });

/** Plays back scripted turns as a stream and records every request it was sent. */
function scriptedProvider(turns: ScriptedTurn[]) {
  const requests: LlmRequest[] = [];
  let next = 0;
  const provider: LlmProvider = {
    id: 'fake',
    async *stream(request): AsyncGenerator<LlmStreamEvent> {
      const { signal, ...rest } = request;
      requests.push({ ...clone(rest), signal });
      const scripted = turns[next++];
      if (scripted === undefined) throw new Error('the script ran out');
      if (scripted instanceof LlmError) throw scripted;
      const id = `msg_${next}`;
      yield { type: 'message_start', id, model: request.model };
      if (scripted === 'no_done') return;
      for (const [index, block] of scripted.content.entries()) {
        if (block.type === 'text') {
          const half = Math.ceil(block.text.length / 2);
          yield { type: 'text_delta', index, text: block.text.slice(0, half) };
          yield { type: 'text_delta', index, text: block.text.slice(half) };
        }
        if (block.type === 'tool_use') yield { type: 'tool_use_start', index, id: block.id, name: block.name };
        yield { type: 'block_stop', index };
      }
      yield {
        type: 'message_done',
        turn: { id, model: request.model, content: scripted.content, stopReason: scripted.stopReason, usage: { inputTokens: 10, outputTokens: 5 } },
      };
    },
  };
  return { provider, requests };
}

const lookupSchema = z.object({ shot: z.string().min(1) });
const askSchema = z.object({ question: z.string().min(1), options: z.array(z.string()).min(2).max(5) });

function makeTools(log: string[] = []): RunnerTool[] {
  return [
    {
      definition: toToolDefinition('lookup', 'Look up a shot.', lookupSchema),
      kind: 'auto',
      validate: zodValidator(lookupSchema),
      execute: async (value) => {
        const { shot } = value as z.infer<typeof lookupSchema>;
        log.push(`execute ${shot}`);
        if (shot === 'broken') throw new Error('the shot store is unavailable');
        if (shot === 'missing') return { content: 'No such shot.', isError: true };
        return { content: JSON.stringify({ found: shot }) };
      },
    },
    { definition: toToolDefinition('ask', 'Ask the user.', askSchema), kind: 'ui', validate: zodValidator(askSchema) },
  ];
}

const USER: LlmMessage = { role: 'user', content: [{ type: 'text', text: 'How was my shot?' }] };

function start(turns: ScriptedTurn[], over: Partial<RunRequest> = {}) {
  const { provider, requests } = scriptedProvider(turns);
  const log: string[] = [];
  const appended: LlmMessage[] = [];
  const deltas: string[] = [];
  let turnStarts = 0;
  const promise = runConversation({
    provider,
    model: 'claude-opus-5-5',
    system: 'You are a coach.',
    messages: [USER],
    tools: makeTools(log),
    onAppend: (message) => {
      log.push(`append ${message.role}`);
      appended.push(message);
    },
    onTextDelta: (delta) => deltas.push(delta),
    onTurnStart: () => {
      turnStarts += 1;
    },
    ...over,
  });
  return { promise, requests, log, appended, deltas, turnStarts: () => turnStarts };
}

function errorResult(id: string, content: string) {
  return { type: 'tool_result', tool_use_id: id, content, is_error: true };
}

describe('runConversation', () => {
  it('appends the assistant turn verbatim and returns at end_turn', async () => {
    const run = start([turn('end_turn', text('Hello there.'))]);
    const result = await run.promise;
    expect(result).toEqual({ pendingUiCalls: [], heldResults: [], stopReason: 'end_turn', finalText: 'Hello there.' });
    expect(run.appended).toEqual([{ role: 'assistant', content: [THINKING, text('Hello there.')] }]);
    expect(run.deltas.join('')).toBe('Hello there.');
    expect(run.turnStarts()).toBe(1);
  });

  it('passes the model, system, tools, effort, max tokens and signal to the provider', async () => {
    const controller = new AbortController();
    const run = start([turn('end_turn', text('Hi'))], { effort: 'low', maxTokens: 3000, signal: controller.signal });
    await run.promise;
    const sent = run.requests[0]!;
    expect(sent).toMatchObject({ model: 'claude-opus-5-5', system: 'You are a coach.', effort: 'low', maxTokens: 3000 });
    expect(sent.signal).toBe(controller.signal);
    expect(sent.messages).toEqual([USER]);
    expect(sent.tools.map((t) => t.name)).toEqual(['lookup', 'ask']);
  });

  it('runs auto tools and sends every result in one user message, in tool_use order', async () => {
    const run = start([
      turn('tool_use', text('Checking.'), toolUse('t1', 'lookup', { shot: 'latest' }), toolUse('t2', 'lookup', { shot: 'previous' })),
      turn('end_turn', text('Both look fine.')),
    ]);
    const result = await run.promise;
    const answers: LlmMessage = {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '{"found":"latest"}' },
        { type: 'tool_result', tool_use_id: 't2', content: '{"found":"previous"}' },
      ],
    };
    expect(run.appended.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(run.appended[1]).toEqual(answers);
    expect(run.requests[1]?.messages.at(-1)).toEqual(answers);
    expect(run.requests[1]?.messages).toHaveLength(3);
    expect(result.finalText).toBe('Both look fine.');
    expect(run.turnStarts()).toBe(2);
    // Persisted before the tools run, so a crash never loses a turn.
    expect(run.log).toEqual(['append assistant', 'execute latest', 'execute previous', 'append user', 'append assistant']);
  });

  it('stops at a valid UI tool and holds the results of the other calls', async () => {
    const run = start([
      turn('tool_use', text('One moment.'), toolUse('t1', 'lookup', { shot: 'latest' }), toolUse('t2', 'ask', { question: 'How?', options: ['Sour', 'Bitter'] })),
    ]);
    const result = await run.promise;
    expect(result).toEqual({
      pendingUiCalls: [{ id: 't2', name: 'ask', input: { question: 'How?', options: ['Sour', 'Bitter'] } }],
      heldResults: [{ type: 'tool_result', tool_use_id: 't1', content: '{"found":"latest"}' }],
      stopReason: 'tool_use',
      finalText: 'One moment.',
    });
    expect(run.appended.map((m) => m.role)).toEqual(['assistant']);
    expect(run.requests).toHaveLength(1);
  });

  it('answers invalid input with is_error so the model can retry', async () => {
    const run = start([
      turn('tool_use', toolUse('t1', 'lookup', { shot: '' })),
      turn('tool_use', toolUse('t2', 'lookup', { shot: 'latest' })),
      turn('end_turn', text('Got it.')),
    ]);
    await run.promise;
    expect(run.appended[1]).toEqual({ role: 'user', content: [errorResult('t1', 'shot: expected at least 1 character')] });
    expect(run.log.filter((l) => l.startsWith('execute'))).toEqual(['execute latest']);
  });

  it('answers invalid UI input with is_error and keeps going', async () => {
    const run = start([turn('tool_use', toolUse('t1', 'ask', { question: 'How?', options: ['Only one'] })), turn('end_turn', text('Sorry.'))]);
    const result = await run.promise;
    expect(run.appended[1]).toEqual({ role: 'user', content: [errorResult('t1', 'options: expected at least 2 items')] });
    expect(result.pendingUiCalls).toEqual([]);
  });

  it('answers an unknown tool with is_error naming the real ones', async () => {
    const run = start([turn('tool_use', toolUse('t1', 'teleport', {})), turn('end_turn', text('OK.'))]);
    await run.promise;
    expect(run.appended[1]).toEqual({
      role: 'user',
      content: [errorResult('t1', 'Unknown tool "teleport". Use one of: lookup, ask.')],
    });
  });

  it('answers unparseable input with an INVALID_JSON error', async () => {
    const broken = toolUse('t1', 'lookup', {});
    markUnparsedToolInput(broken, '{"shot": "lat');
    const run = start([turn('tool_use', broken), turn('end_turn', text('Retrying.'))]);
    await run.promise;
    expect(run.appended[1]).toEqual({ role: 'user', content: [errorResult('t1', '{"INVALID_JSON":"{\\"shot\\": \\"lat"}')] });
    expect(run.log.some((l) => l.startsWith('execute'))).toBe(false);
  });

  it('treats raw-string input from a provider as unparseable too', async () => {
    const run = start([turn('tool_use', toolUse('t1', 'lookup', '{"shot":')), turn('end_turn', text('Retrying.'))]);
    await run.promise;
    expect(run.appended[1]).toEqual({ role: 'user', content: [errorResult('t1', '{"INVALID_JSON":"{\\"shot\\":"}')] });
  });

  it('turns a failing or erroring auto tool into an is_error result', async () => {
    const run = start([
      turn('tool_use', toolUse('t1', 'lookup', { shot: 'broken' }), toolUse('t2', 'lookup', { shot: 'missing' })),
      turn('end_turn', text('Hmm.')),
    ]);
    await run.promise;
    expect(run.appended[1]).toEqual({
      role: 'user',
      content: [errorResult('t1', 'The tool "lookup" failed: the shot store is unavailable'), errorResult('t2', 'No such shot.')],
    });
  });

  it('answers tool calls cut off by max_tokens with an error and asks again', async () => {
    const run = start([
      turn('max_tokens', text('Let me'), toolUse('t1', 'lookup', { shot: 'lat' }), toolUse('t2', 'ask', { question: 'Ho' })),
      turn('end_turn', text('Short answer.')),
    ]);
    const result = await run.promise;
    const cutOff = 'Your output was cut off; answer again more briefly.';
    expect(run.appended[1]).toEqual({ role: 'user', content: [errorResult('t1', cutOff), errorResult('t2', cutOff)] });
    expect(run.log.some((l) => l.startsWith('execute'))).toBe(false);
    expect(result.finalText).toBe('Short answer.');
  });

  it('returns a max_tokens turn without tool calls as it is', async () => {
    const result = await start([turn('max_tokens', text('A long answer that'))]).promise;
    expect(result).toMatchObject({ stopReason: 'max_tokens', finalText: 'A long answer that', pendingUiCalls: [] });
  });

  it.each(['pause_turn', 'stop_sequence'])('returns at %s', async (stopReason) => {
    const result = await start([turn(stopReason, text('Paused.'))]).promise;
    expect(result.stopReason).toBe(stopReason);
  });

  it('throws a refusal without appending the refused turn', async () => {
    const run = start([turn('refusal', text('I cannot'))]);
    await expect(run.promise).rejects.toMatchObject({ kind: 'refusal' });
    expect(run.appended).toEqual([]);
  });

  it('gives up with a protocol error after maxModelCalls, leaving a valid transcript', async () => {
    const looping = Array.from({ length: 10 }, (_, i) => turn('tool_use', toolUse(`t${i}`, 'lookup', { shot: 'latest' })));
    const run = start(looping, { maxModelCalls: 3 });
    const error = await run.promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ kind: 'protocol', message: 'The coach got stuck. Try again.' });
    expect(run.requests).toHaveLength(3);
    expect(run.appended.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
  });

  it('allows six model calls by default', async () => {
    const looping = Array.from({ length: 10 }, (_, i) => turn('tool_use', toolUse(`t${i}`, 'lookup', { shot: 'latest' })));
    const run = start(looping);
    await expect(run.promise).rejects.toMatchObject({ kind: 'protocol' });
    expect(run.requests).toHaveLength(6);
  });

  it('passes provider errors through untouched', async () => {
    const rateLimited = new LlmError('rate_limit', 'Anthropic is rate limiting. Wait a moment and try again.', 429, true);
    const run = start([rateLimited]);
    await expect(run.promise).rejects.toBe(rateLimited);
    expect(run.appended).toEqual([]);
  });

  it('treats a stream without message_done as a protocol error', async () => {
    await expect(start(['no_done']).promise).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('waits for onAppend before running tools', async () => {
    const order: string[] = [];
    const run = start([turn('tool_use', toolUse('t1', 'lookup', { shot: 'latest' })), turn('end_turn', text('Done.'))], {
      onAppend: async (message) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`saved ${message.role}`);
      },
      tools: makeTools(order),
    });
    await run.promise;
    expect(order).toEqual(['saved assistant', 'execute latest', 'saved user', 'saved assistant']);
  });

  it('refuses a transcript that does not end with a user message', async () => {
    const run = start([turn('end_turn', text('Hi'))], {
      messages: [USER, { role: 'assistant', content: [text('Hello')] }],
    });
    await expect(run.promise).rejects.toMatchObject({ kind: 'protocol' });
    expect(run.requests).toHaveLength(0);
  });
});
