import { describe, expect, it } from 'vitest';
import { createTurnAssembler } from './assemble.ts';
import { unparsedToolInput } from './toolInput.ts';
import { LlmError, type LlmAssistantTurn, type LlmStreamEvent, type ToolUseBlock } from './types.ts';

const messageStart = {
  type: 'message_start',
  message: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 1 },
  },
};
const blockStart = (index: number, block: Record<string, unknown>) => ({
  type: 'content_block_start',
  index,
  content_block: block,
});
const delta = (index: number, d: Record<string, unknown>) => ({ type: 'content_block_delta', index, delta: d });
const blockStop = (index: number) => ({ type: 'content_block_stop', index });
const messageDelta = (stopReason: string, outputTokens = 30) => ({
  type: 'message_delta',
  delta: { stop_reason: stopReason, stop_sequence: null },
  usage: { output_tokens: outputTokens },
});
const messageStop = { type: 'message_stop' };

function feed(events: unknown[]): LlmStreamEvent[] {
  const assembler = createTurnAssembler();
  return events.flatMap((event) => assembler.push(event));
}

function turnOf(events: LlmStreamEvent[]): LlmAssistantTurn {
  const done = events.filter((e) => e.type === 'message_done');
  expect(done).toHaveLength(1);
  return (done[0] as Extract<LlmStreamEvent, { type: 'message_done' }>).turn;
}

describe('createTurnAssembler', () => {
  it('streams text deltas and assembles the finished turn', () => {
    const events = feed([
      messageStart,
      { type: 'ping' },
      blockStart(0, { type: 'text', text: '' }),
      delta(0, { type: 'text_delta', text: 'Hel' }),
      delta(0, { type: 'text_delta', text: 'lo' }),
      blockStop(0),
      messageDelta('end_turn'),
      messageStop,
    ]);
    expect(events.slice(0, -1)).toEqual([
      { type: 'message_start', id: 'msg_1', model: 'claude-opus-5-5' },
      { type: 'text_delta', index: 0, text: 'Hel' },
      { type: 'text_delta', index: 0, text: 'lo' },
      { type: 'block_stop', index: 0 },
    ]);
    expect(turnOf(events)).toEqual({
      id: 'msg_1',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'Hello' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 100, cacheCreationInputTokens: 0 },
    });
  });

  it('assembles tool input from partial JSON when the block stops', () => {
    const events = feed([
      messageStart,
      blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'get_shot_summary', input: {} }),
      delta(0, { type: 'input_json_delta', partial_json: '' }),
      delta(0, { type: 'input_json_delta', partial_json: '{"shot":' }),
      delta(0, { type: 'input_json_delta', partial_json: ' "latest"}' }),
      blockStop(0),
      messageDelta('tool_use'),
      messageStop,
    ]);
    expect(events[1]).toEqual({ type: 'tool_use_start', index: 0, id: 'toolu_1', name: 'get_shot_summary' });
    expect(turnOf(events).content).toEqual([
      { type: 'tool_use', id: 'toolu_1', name: 'get_shot_summary', input: { shot: 'latest' } },
    ]);
    expect(turnOf(events).stopReason).toBe('tool_use');
  });

  it('gives a tool with no input deltas an empty object', () => {
    const events = feed([
      messageStart,
      blockStart(0, { type: 'tool_use', id: 'toolu_2', name: 'get_bag_history', input: {} }),
      blockStop(0),
      messageDelta('tool_use'),
      messageStop,
    ]);
    expect(turnOf(events).content).toEqual([{ type: 'tool_use', id: 'toolu_2', name: 'get_bag_history', input: {} }]);
  });

  it('sets unparseable tool input aside and stores a replayable empty object', () => {
    const events = feed([
      messageStart,
      blockStart(0, { type: 'tool_use', id: 'toolu_3', name: 'get_shot_summary', input: {} }),
      delta(0, { type: 'input_json_delta', partial_json: '{"shot": "lat' }),
      blockStop(0),
      messageDelta('tool_use'),
      messageStop,
    ]);
    const block = turnOf(events).content[0] as ToolUseBlock;
    expect(block.input).toEqual({});
    expect(unparsedToolInput(block)).toBe('{"shot": "lat');
    // The side note never reaches storage or the wire.
    expect(JSON.stringify(block)).toBe('{"type":"tool_use","id":"toolu_3","name":"get_shot_summary","input":{}}');
  });

  it('keeps thinking text and signature exactly, and redacted thinking untouched', () => {
    const events = feed([
      messageStart,
      blockStart(0, { type: 'thinking', thinking: '', signature: '' }),
      delta(0, { type: 'thinking_delta', thinking: 'Let me ' }),
      delta(0, { type: 'thinking_delta', thinking: 'think.' }),
      delta(0, { type: 'signature_delta', signature: 'EqQBCkgIBRABGAIiQ==' }),
      blockStop(0),
      blockStart(1, { type: 'redacted_thinking', data: 'opaque-bytes' }),
      blockStop(1),
      blockStart(2, { type: 'text', text: '' }),
      delta(2, { type: 'text_delta', text: 'Done.' }),
      blockStop(2),
      messageDelta('end_turn'),
      messageStop,
    ]);
    expect(turnOf(events).content).toEqual([
      { type: 'thinking', thinking: 'Let me think.', signature: 'EqQBCkgIBRABGAIiQ==' },
      { type: 'redacted_thinking', data: 'opaque-bytes' },
      { type: 'text', text: 'Done.' },
    ]);
    // Reasoning is never displayed: only the text block produced deltas.
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([{ type: 'text_delta', index: 2, text: 'Done.' }]);
  });

  it('preserves unknown block types and extra fields as received', () => {
    const events = feed([
      messageStart,
      blockStart(0, { type: 'text', text: '', citations: null }),
      delta(0, { type: 'text_delta', text: 'Hi' }),
      blockStop(0),
      blockStart(1, { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} }),
      delta(1, { type: 'input_json_delta', partial_json: '{"query":"kiambu"}' }),
      blockStop(1),
      blockStart(2, { type: 'mystery_block', payload: { a: 1 } }),
      delta(2, { type: 'mystery_delta', stuff: 'ignored' }),
      blockStop(2),
      messageDelta('end_turn'),
      messageStop,
    ]);
    expect(turnOf(events).content).toEqual([
      { type: 'text', text: 'Hi', citations: null },
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'kiambu' } },
      { type: 'mystery_block', payload: { a: 1 } },
    ]);
  });

  it('drops what the declined model wrote before a fallback boundary, except its text', () => {
    const events = feed([
      messageStart,
      blockStart(0, { type: 'thinking', thinking: '', signature: 'declined-sig' }),
      blockStop(0),
      blockStart(1, { type: 'text', text: 'Partial ' }),
      blockStop(1),
      blockStart(2, { type: 'tool_use', id: 'toolu_x', name: 'get_bag_history', input: {} }),
      blockStop(2),
      blockStart(3, { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' } }),
      blockStop(3),
      blockStart(4, { type: 'thinking', thinking: '', signature: 'rescue-sig' }),
      blockStop(4),
      blockStart(5, { type: 'text', text: 'Rescued.' }),
      blockStop(5),
      messageDelta('end_turn'),
      messageStop,
    ]);
    expect(turnOf(events).content).toEqual([
      { type: 'text', text: 'Partial ' },
      { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' } },
      { type: 'thinking', thinking: '', signature: 'rescue-sig' },
      { type: 'text', text: 'Rescued.' },
    ]);
  });

  it('throws the mapped LlmError for an error event', () => {
    const assembler = createTurnAssembler();
    assembler.push(messageStart);
    let caught: unknown;
    try {
      assembler.push({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LlmError);
    expect((caught as LlmError).kind).toBe('overloaded');
  });

  it('refuses a delta for a block that never started', () => {
    const assembler = createTurnAssembler();
    assembler.push(messageStart);
    expect(() => assembler.push(delta(4, { type: 'text_delta', text: 'x' }))).toThrow(LlmError);
  });

  it('ignores unknown events and reports when the message is finished', () => {
    const assembler = createTurnAssembler();
    expect(assembler.push({ type: 'some_future_event', x: 1 })).toEqual([]);
    expect(assembler.finished).toBe(false);
    assembler.push(messageStart);
    assembler.push(messageDelta('end_turn'));
    const last = assembler.push(messageStop);
    expect(assembler.finished).toBe(true);
    expect(last).toHaveLength(1);
    expect(last[0]?.type).toBe('message_done');
  });
});
