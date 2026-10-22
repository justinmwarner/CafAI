import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REPLAY_NOTE,
  blocksOf,
  createStreamTransformer,
  fingerprintMessage,
  flattenConversation,
  limitResetsAt,
  mapCliFailure,
  stripToolPrefix,
  toCliContent,
  toMcpResult,
  usageFromRateLimit,
} from './translate.mjs';

const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };

describe('fingerprintMessage', () => {
  it('reads a string and a single text block alike', () => {
    expect(fingerprintMessage({ role: 'user', content: 'hi' })).toBe(fingerprintMessage({ role: 'user', content: [{ type: 'text', text: 'hi' }] }));
  });

  it('ignores thinking blocks and tool inputs, but not ids, text or roles', () => {
    const base = { role: 'assistant', content: [{ type: 'text', text: 'Try finer.' }, { type: 'tool_use', id: 'toolu_1', name: 'propose_adjustment', input: { a: 1 } }] };
    const withThinking = { role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 's' }, ...base.content] };
    const otherInput = { role: 'assistant', content: [base.content[0], { ...base.content[1], input: { b: 2 } }] };
    expect(fingerprintMessage(withThinking)).toBe(fingerprintMessage(base));
    expect(fingerprintMessage(otherInput)).toBe(fingerprintMessage(base));
    expect(fingerprintMessage({ ...base, content: [base.content[0], { ...base.content[1], id: 'toolu_2' }] })).not.toBe(fingerprintMessage(base));
    expect(fingerprintMessage({ ...base, role: 'user' })).not.toBe(fingerprintMessage(base));
  });

  it('matches a prefixed tool name with the plain one CafAI stores', () => {
    const plain = { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'ask_user', input: {} }] };
    const prefixed = { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'mcp__cafai__ask_user', input: {} }] };
    expect(fingerprintMessage(prefixed)).toBe(fingerprintMessage(plain));
  });

  it('tells tool results apart by content and error flag', () => {
    const result = (content, isError) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content, ...(isError ? { is_error: true } : {}) }] });
    expect(fingerprintMessage(result('ok'))).toBe(fingerprintMessage(result([{ type: 'text', text: 'ok' }])));
    expect(fingerprintMessage(result('ok', true))).not.toBe(fingerprintMessage(result('ok')));
    expect(fingerprintMessage(result('no'))).not.toBe(fingerprintMessage(result('ok')));
  });
});

describe('flattenConversation', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'A Kenyan, washed.' }, image] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'secret', signature: 's' },
        { type: 'text', text: 'Pick one.' },
        { type: 'tool_use', id: 'toolu_1', name: 'propose_templates', input: { options: ['d-flow'] } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"picked":"d-flow"}' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Loaded.' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'bad', is_error: true }, { type: 'text', text: 'It was sour.' }] },
  ];

  it('replays the earlier turns as a transcript, then the latest message', () => {
    const content = flattenConversation(messages);
    const text = content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    expect(text.startsWith(REPLAY_NOTE)).toBe(true);
    expect(text).toContain('<user>\nA Kenyan, washed.');
    expect(text).toContain('<tool_call name="propose_templates" id="toolu_1">{"options":["d-flow"]}</tool_call>');
    expect(text).toContain('<tool_result for="toolu_1">\n{"picked":"d-flow"}\n</tool_result>');
    expect(text).not.toContain('secret');
    const [, latest] = text.split('</transcript>');
    expect(latest).toContain('<tool_result for="toolu_9" error="true">\nbad\n</tool_result>\nIt was sour.');
  });

  it('keeps images as image blocks in place', () => {
    const content = flattenConversation(messages);
    expect(content.filter((block) => block.type === 'image')).toEqual([image]);
    expect(content[1]).toEqual(image);
  });
});

describe('toCliContent', () => {
  it('passes text and images, drops thinking and cache_control', () => {
    const content = toCliContent({
      role: 'user',
      content: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'Read the bag.' }, { ...image, cache_control: { type: 'ephemeral' } }],
    });
    expect(content).toEqual([{ type: 'text', text: 'Read the bag.' }, image]);
  });

  it('writes tool results out as text when they cannot go to a held call', () => {
    const content = toCliContent({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] });
    expect(content).toEqual([{ type: 'text', text: '<tool_result for="x">\nok\n</tool_result>' }]);
  });

  it('never sends an empty message', () => {
    expect(toCliContent({ role: 'user', content: '' })).toEqual([{ type: 'text', text: '(no text)' }]);
    expect(blocksOf({ content: 7 })).toEqual([]);
  });
});

describe('toMcpResult', () => {
  it('carries the result, its error flag, and what came with it', () => {
    expect(toMcpResult({ type: 'tool_result', tool_use_id: 't', content: '{"saved":true}' })).toEqual({ content: [{ type: 'text', text: '{"saved":true}' }] });
    const answer = toMcpResult({ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'no' }], is_error: true }, [
      { type: 'text', text: '[event:shot_completed]\n{}' },
      image,
    ]);
    expect(answer).toEqual({
      content: [
        { type: 'text', text: 'no' },
        { type: 'text', text: "The user's next message:\n[event:shot_completed]\n{}" },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
      isError: true,
    });
    expect(toMcpResult({ type: 'tool_result', tool_use_id: 't', content: '' }).content).toEqual([{ type: 'text', text: '(empty)' }]);
  });
});

describe('createStreamTransformer', () => {
  const events = [
    { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 9, output_tokens: 1, cache_creation: {} }, container: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Grind ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'finer.' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__cafai__propose_adjustment', input: {}, caller: { type: 'direct' } } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"variable":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"grind"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null, stop_details: null }, usage: { output_tokens: 30 } },
    { type: 'message_stop' },
    { type: 'ping' },
  ];

  it('drops thinking, renumbers blocks, strips the tool prefix and caller', () => {
    const transformer = createStreamTransformer();
    const out = events.flatMap((event) => transformer.push(event));
    expect(out.some((event) => JSON.stringify(event).includes('thinking') || JSON.stringify(event).includes('sig'))).toBe(false);
    expect(out[0]).toEqual({
      type: 'message_start',
      message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } },
    });
    expect(out[1]).toEqual({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    expect(out).toContainEqual({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'propose_adjustment', input: {} } });
    expect(out).toContainEqual({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"grind"}' } });
    expect(out).toContainEqual({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } });
    expect(out[out.length - 1]).toEqual({ type: 'message_stop' });
    expect(transformer.stopReason).toBe('tool_use');
    expect(transformer.toolUses()).toEqual([{ id: 'toolu_1', name: 'propose_adjustment' }]);
  });

  it('remembers the message as CafAI will replay it', () => {
    const transformer = createStreamTransformer();
    for (const event of events) transformer.push(event);
    const asCafaiStoresIt = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Grind finer.' },
        { type: 'tool_use', id: 'toolu_1', name: 'propose_adjustment', input: { variable: 'grind' } },
      ],
    };
    expect(fingerprintMessage(transformer.message())).toBe(fingerprintMessage(asCafaiStoresIt));
  });

  it('does not count a built-in tool as a coach tool, nor pass it on', () => {
    const transformer = createStreamTransformer();
    transformer.push(events[0]);
    expect(transformer.push({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'Bash', input: {} } })).toEqual([]);
    expect(transformer.toolUses()).toEqual([]);
    expect(stripToolPrefix('Bash')).toBe('Bash');
  });
});

/** What CafAI's assembler (src/llm/assemble.ts) builds from the events: content and stop reason. */
function assembled(out) {
  const content = [];
  const json = new Map();
  let stopReason = null;
  for (const event of out) {
    if (event.type === 'content_block_start') {
      content[event.index] = { ...event.content_block };
      if (event.content_block.type === 'tool_use') json.set(event.index, '');
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') content[event.index].text += event.delta.text;
    else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') json.set(event.index, json.get(event.index) + event.delta.partial_json);
    else if (event.type === 'content_block_stop' && json.has(event.index)) content[event.index].input = JSON.parse(json.get(event.index) || '{}');
    else if (event.type === 'message_delta') stopReason = event.delta.stop_reason;
  }
  return { content, stopReason };
}

describe("Claude Code's own web search (D203)", () => {
  // Claude Code 2.1.301's stdout for one turn with WebSearch on (test/claude-web-search.jsonl): a sentence and a
  // WebSearch call (msg_search), the search's result, a share_fun_fact call (msg_fact), then the reply (msg_reply).
  const capture = readFileSync(new URL('../test/claude-web-search.jsonl', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const eventsOf = (id) => capture.filter((line) => line.type === 'stream_event' && line.api_message_id === id).map((line) => line.event);

  it("keeps the search inside the run and passes on one reply: the coach's sentence, then its tool call", () => {
    const transformer = createStreamTransformer();
    const out = eventsOf('msg_search').flatMap((event) => transformer.push(event));
    // A message of Claude Code's own calls only: the reply goes on.
    expect(transformer.continuing).toBe(true);
    out.push(...eventsOf('msg_fact').flatMap((event) => transformer.push(event)));
    expect(transformer.continuing).toBe(false);

    expect(JSON.stringify(out)).not.toMatch(/WebSearch|toolu_search|Web search results/);
    expect(out.filter((event) => event.type === 'message_start')).toHaveLength(1);
    expect(out.filter((event) => event.type === 'message_delta')).toEqual([
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: expect.any(Object) },
    ]);
    expect(out.at(-1)).toEqual({ type: 'message_stop' });
    const reply = assembled(out);
    expect(reply).toEqual({
      content: [
        { type: 'text', text: "I'll look up Onyx Coffee Lab for you." },
        {
          type: 'tool_use',
          id: 'toolu_fact',
          name: 'share_fun_fact',
          input: { topic: 'roaster', about: 'Onyx Coffee Lab', fact: expect.stringContaining('founded in 2012'), source: 'https://onyxcoffeelab.com/pages/our-story' },
        },
      ],
      stopReason: 'tool_use',
    });
    expect(transformer.stopReason).toBe('tool_use');
    expect(transformer.toolUses()).toEqual([{ id: 'toolu_fact', name: 'share_fun_fact' }]);
    expect(fingerprintMessage(transformer.message())).toBe(fingerprintMessage({ role: 'assistant', content: reply.content }));
  });

  it('starts the text after the search on a paragraph of its own', () => {
    const transformer = createStreamTransformer();
    for (const event of eventsOf('msg_search')) transformer.push(event);
    // The capture's reply, as if it came right after the search.
    const out = eventsOf('msg_reply').flatMap((event) => transformer.push(event));
    expect(out.find((event) => event.type === 'content_block_delta')).toEqual({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '\n\n' } });
    const reply = assembled(out);
    expect(reply.stopReason).toBe('end_turn');
    expect(transformer.message().content).toEqual([
      { type: 'text', text: "I'll look up Onyx Coffee Lab for you." },
      { type: 'text', text: expect.stringMatching(/^\n\nYour fun fact is ready: /) },
    ]);
    expect(fingerprintMessage(transformer.message())).toBe(
      fingerprintMessage({ role: 'assistant', content: [{ type: 'text', text: "I'll look up Onyx Coffee Lab for you." }, reply.content[1]] }),
    );
  });

  it("passes on no search results or citations Claude Code's model might get itself: they belong to the plan's organisation", () => {
    const transformer = createStreamTransformer();
    const out = [
      { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5-5', usage: {} } },
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"x"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '', citations: [] } },
      { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', encrypted_index: 'E..' } } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Founded in 2012.' } },
      { type: 'content_block_stop', index: 2 },
    ].flatMap((event) => transformer.push(event));
    expect(JSON.stringify(out)).not.toMatch(/srvtoolu|web_search|citation|encrypted/);
    expect(assembled(out).content).toEqual([{ type: 'text', text: 'Founded in 2012.' }]);
  });
});

describe('mapCliFailure', () => {
  it('names the fix for each of Claude Code failures', () => {
    expect(mapCliFailure({ error: 'model_not_found', status: 404, model: 'claude-x' })).toMatchObject({
      status: 404,
      type: 'not_found_error',
      message: expect.stringContaining('cannot use claude-x'),
    });
    expect(mapCliFailure({ error: 'invalid_request', text: 'Anthropic profile login expired · Run /login to use your claude.ai account' })).toMatchObject({
      status: 401,
      type: 'authentication_error',
      message: expect.stringContaining('sign in with /login'),
    });
    expect(mapCliFailure({ error: 'rate_limit', text: 'Claude AI usage limit reached', rateLimit: { status: 'rejected', resetsAt: 1791733200 } })).toMatchObject({
      status: 429,
      type: 'rate_limit_error',
      message: expect.stringMatching(/usage limit is reached; it resets (at|on) /),
    });
    expect(
      mapCliFailure({
        error: 'invalid_request',
        model: 'claude-opus-5-5',
        text: "API Error: 400 Claude Code 2.1.251 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.",
      }),
    ).toEqual({
      status: 400,
      type: 'invalid_request_error',
      message:
        'Claude Code on your computer is too old for claude-opus-5-5 (it needs 2.1.280 or newer). Run claude update there, or update the Claude desktop app, then try again.',
    });
    expect(mapCliFailure({ status: 529 })).toMatchObject({ status: 529, type: 'overloaded_error' });
    expect(mapCliFailure({ error: 'invalid_request', text: 'messages.1: bad' })).toMatchObject({
      status: 400,
      message: 'Claude Code rejected the request: messages.1: bad',
    });
    expect(mapCliFailure({ text: 'Something odd' })).toMatchObject({ status: 500, type: 'api_error', message: 'Claude Code on your computer failed: Something odd' });
  });
});

describe('limitResetsAt', () => {
  it('reads the binding window, from the top or from the windows', () => {
    expect(limitResetsAt({ status: 'rejected', resetsAt: 100, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { resetsAt: 200 } } })).toBe(100);
    expect(limitResetsAt({ status: 'rejected', rateLimitType: 'seven_day', unifiedWindows: { five_hour: { resetsAt: 200 }, seven_day: { resetsAt: 900 } } })).toBe(900);
    expect(
      limitResetsAt({ status: 'rejected', unifiedWindows: { five_hour: { utilization: 1, resetsAt: 200 }, seven_day: { utilization: 1.02, resetsAt: 900 } } }),
    ).toBe(900);
    expect(limitResetsAt({ status: 'rejected' })).toBeNull();
    expect(limitResetsAt(null)).toBeNull();
  });

  it('puts the reset time into the limit sentence whichever shape came', () => {
    const shapes = [{ status: 'rejected', resetsAt: 1791733200 }, { status: 'rejected', rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1791733200 } } }];
    for (const rateLimit of shapes) {
      expect(mapCliFailure({ error: 'rate_limit', rateLimit }).message).toMatch(/it resets (at|on) /);
    }
  });
});

describe('usageFromRateLimit', () => {
  it('stops counting a refusal once its reset time has passed', () => {
    const info = { status: 'rejected', resetsAt: 1000, unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1000 } } };
    expect(usageFromRateLimit(info, 999_000)?.status).toBe('rejected');
    expect(usageFromRateLimit(info, 1_000_000)?.status).toBe('allowed');
  });

  it('reads the plan windows', () => {
    expect(
      usageFromRateLimit({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.08, resetsAt: 1791733200 }, seven_day: { utilization: 0.3 } } }),
    ).toEqual({
      status: 'allowed',
      fiveHour: { utilization: 0.08, resetsAt: new Date(1791733200 * 1000).toISOString() },
      sevenDay: { utilization: 0.3, resetsAt: null },
    });
    expect(usageFromRateLimit(null)).toBeNull();
  });
});
