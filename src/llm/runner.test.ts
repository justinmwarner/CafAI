import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clone } from '../util/clone.ts';
import { contentText, runConversation, SEARCH_FIRST_MESSAGE, waitsOnServerTool } from './runner.ts';
import { toToolDefinition, zodValidator } from './schema.ts';
import { markUnparsedToolInput } from './toolInput.ts';
import { WEB_SEARCH_TOOL } from './webSearch.ts';
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
  /** How many model calls had been made when each message was appended. */
  const appendedAt: number[] = [];
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
      appendedAt.push(requests.length);
    },
    onTextDelta: (delta) => deltas.push(delta),
    onTurnStart: () => {
      turnStarts += 1;
    },
    ...over,
  });
  return { promise, requests, log, appended, appendedAt, deltas, turnStarts: () => turnStarts };
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

  it('returns at stop_sequence', async () => {
    const result = await start([turn('stop_sequence', text('Stopped.'))]).promise;
    expect(result.stopReason).toBe('stop_sequence');
  });

  describe('a web search (D203)', () => {
    const SEARCH: ContentBlock = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Onyx Coffee Lab' } };
    const RESULTS: ContentBlock = {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [{ type: 'web_search_result', url: 'https://onyxcoffeelab.com/pages/our-story', title: 'Our Story', encrypted_content: 'Eqgf==', page_age: null }],
    };

    it('passes the server tools on with every model call of the run', async () => {
      const run = start([turn('tool_use', toolUse('t1', 'lookup', { shot: 'latest' })), turn('end_turn', text('Done.'))], {
        serverTools: [WEB_SEARCH_TOOL],
      });
      await run.promise;
      expect(run.requests.map((request) => request.serverTools)).toEqual([[WEB_SEARCH_TOOL], [WEB_SEARCH_TOOL]]);
      expect(run.requests[1]?.tools.map((tool) => tool.name)).toEqual(['lookup', 'ask']);
    });

    it('sends none for a run without them', async () => {
      const run = start([turn('end_turn', text('Hi'))], { serverTools: [] });
      await run.promise;
      expect(run.requests[0]).not.toHaveProperty('serverTools');
    });

    it('sends a paused turn back as it is, with no new user message, and appends it with the turn that finishes it', async () => {
      const paused = turn('pause_turn', text("I'll look it up."), SEARCH);
      const finished = turn('end_turn', RESULTS, text('Onyx publishes what it pays.'));
      const run = start([paused, finished]);
      const result = await run.promise;
      expect(run.requests).toHaveLength(2);
      expect(run.requests[1]?.messages).toEqual([USER, { role: 'assistant', content: paused.content }]);
      expect(run.appended).toEqual([
        { role: 'assistant', content: paused.content },
        { role: 'assistant', content: finished.content },
      ]);
      // Only once the server finished the turn: a stored transcript never ends with a turn it must go on with.
      expect(run.appendedAt).toEqual([2, 2]);
      expect(result).toEqual({
        pendingUiCalls: [],
        heldResults: [],
        stopReason: 'end_turn',
        finalText: "I'll look it up.\n\nOnyx publishes what it pays.",
      });
    });

    it('counts each part against maxModelCalls, and appends nothing when it gives up', async () => {
      const run = start(
        Array.from({ length: 5 }, () => turn('pause_turn', SEARCH)),
        { maxModelCalls: 3 },
      );
      await expect(run.promise).rejects.toMatchObject({ kind: 'protocol', message: 'The coach got stuck. Try again.' });
      expect(run.requests).toHaveLength(3);
      expect(run.requests[2]?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant']);
      expect(run.appended).toEqual([]);
    });

    it('appends nothing when the rest of the turn fails or is refused, so a retry asks again', async () => {
      const overloaded = new LlmError('overloaded', 'Claude is overloaded right now.', 529, true);
      const failed = start([turn('pause_turn', SEARCH), overloaded]);
      await expect(failed.promise).rejects.toBe(overloaded);
      expect(failed.appended).toEqual([]);
      const refused = start([turn('pause_turn', SEARCH), turn('refusal', text('I cannot'))]);
      await expect(refused.promise).rejects.toMatchObject({ kind: 'refusal' });
      expect(refused.appended).toEqual([]);
    });

    it('handles a paused turn with client tool calls as tool_use', async () => {
      const run = start([turn('pause_turn', SEARCH, toolUse('t1', 'lookup', { shot: 'latest' })), turn('end_turn', text('Done.'))]);
      await run.promise;
      expect(run.appended.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant']);
      expect(run.appended[1]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"found":"latest"}' }] });
      expect(run.requests[1]?.messages.at(-1)).toEqual(run.appended[1]);
    });

    it('sends back a card called beside a search still waiting, to be asked again once the search ran', async () => {
      // The API runs a search called beside a client tool only once that tool's result comes back, and that
      // message must hold tool results alone: a card waiting for a tap there would leave the chat stuck.
      const beside = turn('tool_use', text('Let me check.'), SEARCH, toolUse('t1', 'lookup', { shot: 'latest' }), toolUse('t2', 'ask', { question: 'How did it taste?', options: ['Sour', 'Sweet'] }));
      const after = turn('tool_use', RESULTS, toolUse('t3', 'ask', { question: 'How did it taste?', options: ['Sour', 'Sweet'] }));
      const run = start([beside, after]);
      const result = await run.promise;
      expect(run.appended[1]).toEqual({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"found":"latest"}' },
          errorResult('t2', SEARCH_FIRST_MESSAGE),
        ],
      });
      expect(run.requests[1]?.messages.at(-1)).toEqual(run.appended[1]);
      expect(result.pendingUiCalls).toEqual([{ id: 't3', name: 'ask', input: { question: 'How did it taste?', options: ['Sour', 'Sweet'] } }]);
    });

    it('lets a card wait for its tap when the turn has the search result', async () => {
      const done = turn('tool_use', SEARCH, RESULTS, toolUse('t1', 'ask', { question: 'How did it taste?', options: ['Sour', 'Sweet'] }));
      const result = await start([done]).promise;
      expect(result.pendingUiCalls.map((call) => call.id)).toEqual(['t1']);
      expect(waitsOnServerTool(done.content)).toBe(false);
      expect(waitsOnServerTool([SEARCH])).toBe(true);
    });

    it('keeps a paused turn in one bubble: no new turn start for the rest, and a paragraph break before its text', async () => {
      const run = start([turn('pause_turn', text("I'll look it up."), SEARCH), turn('end_turn', RESULTS, text('Onyx began in Arkansas.'))]);
      await run.promise;
      expect(run.turnStarts()).toBe(1);
      expect(run.deltas.join('')).toBe("I'll look it up.\n\nOnyx began in Arkansas.");
    });

    it('streams a paragraph break where a search sits between text, and none inside text its citations split', async () => {
      const cited: ContentBlock = {
        type: 'text',
        text: 'what it pays.',
        citations: [{ type: 'web_search_result_location', url: 'https://onyxcoffeelab.com/pages/our-story', title: 'Our Story', encrypted_index: 'Eo8=', cited_text: 'price paid' }],
      };
      const run = start([turn('end_turn', text("I'll look it up."), SEARCH, RESULTS, text('Onyx publishes '), cited)]);
      const result = await run.promise;
      expect(run.deltas.join('')).toBe("I'll look it up.\n\nOnyx publishes what it pays.");
      expect(result.finalText).toBe("I'll look it up.\n\nOnyx publishes what it pays.");
    });
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

describe('contentText', () => {
  const SEARCH: ContentBlock = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} };

  it('joins text blocks next to each other with nothing, and text a block sits between as paragraphs', () => {
    expect(contentText([THINKING, text('Hel'), text('lo.')])).toBe('Hello.');
    expect(contentText([text('Looking.'), SEARCH, text(''), text('Found it.')])).toBe('Looking.\n\nFound it.');
    expect(contentText([THINKING, SEARCH, text('Only this.')])).toBe('Only this.');
  });
});
