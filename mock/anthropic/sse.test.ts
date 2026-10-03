import { describe, expect, it } from 'vitest';
import { createTurnAssembler } from '../../src/llm/assemble.ts';
import { createSseParser } from '../../src/llm/sse.ts';
import type { LlmStreamEvent } from '../../src/llm/types.ts';
import { encodeAssistantTurn, splitJson, splitText, sseFrame } from './sse.ts';

const askUser = {
  type: 'tool_use' as const,
  id: 'toolu_mock_1',
  name: 'ask_user',
  input: { question: 'How did it taste?', options: ['Sour / sharp', 'Balanced, sweet'], multiSelect: false },
};

const encoded = encodeAssistantTurn([{ type: 'text', text: 'Got it: 28.4 s, 36 g out. 92 °C.' }, askUser], {
  id: 'msg_mock_1',
  model: 'claude-opus-5-5',
  stopReason: 'tool_use',
  signature: 'mock-sig-1',
  inputTokens: 512,
});

describe('encodeAssistantTurn', () => {
  it('starts every turn with an empty thinking block carrying the signature', () => {
    expect(encoded.content).toEqual([
      { type: 'thinking', thinking: '', signature: 'mock-sig-1' },
      { type: 'text', text: 'Got it: 28.4 s, 36 g out. 92 °C.' },
      askUser,
    ]);
  });

  it('emits the Anthropic event sequence', () => {
    const types = encoded.events.map((e) => e.event);
    expect(types[0]).toBe('message_start');
    expect(types[1]).toBe('ping');
    expect(types.slice(2, 5)).toEqual(['content_block_start', 'content_block_delta', 'content_block_stop']);
    expect(types.slice(-2)).toEqual(['message_delta', 'message_stop']);
    const start = encoded.events[0]?.data as { message: { id: string; model: string; usage: { input_tokens: number } } };
    expect(start.message.id).toBe('msg_mock_1');
    expect(start.message.model).toBe('claude-opus-5-5');
    expect(start.message.usage.input_tokens).toBe(512);
    const messageDelta = encoded.events.at(-2)?.data as { delta: { stop_reason: string }; usage: { output_tokens: number } };
    expect(messageDelta.delta.stop_reason).toBe('tool_use');
    expect(messageDelta.usage.output_tokens).toBeGreaterThan(0);
  });

  it('streams text in several small deltas and tool input in several JSON pieces', () => {
    const deltas = encoded.events.filter((e) => e.event === 'content_block_delta').map((e) => e.data.delta as Record<string, string>);
    expect(deltas.filter((d) => d.type === 'text_delta').length).toBeGreaterThan(2);
    expect(deltas.filter((d) => d.type === 'input_json_delta').length).toBeGreaterThanOrEqual(3);
    expect(deltas.filter((d) => d.type === 'signature_delta')).toEqual([{ type: 'signature_delta', signature: 'mock-sig-1' }]);
  });

  it("round-trips through the client's SSE parser and assembler to the same content", () => {
    const bytes = new TextEncoder().encode(encoded.events.map(sseFrame).join(''));
    const parser = createSseParser();
    const assembler = createTurnAssembler();
    const out: LlmStreamEvent[] = [];
    // Odd-sized chunks, as a network would deliver them.
    for (let i = 0; i < bytes.length; i += 7) {
      for (const event of parser.push(bytes.subarray(i, i + 7))) out.push(...assembler.push(JSON.parse(event.data)));
    }
    const done = out.find((e) => e.type === 'message_done');
    expect(done?.type === 'message_done' && done.turn.content).toEqual(encoded.content);
    expect(done?.type === 'message_done' && done.turn.id).toBe('msg_mock_1');
  });

  it('is deterministic', () => {
    const again = encodeAssistantTurn([{ type: 'text', text: 'Got it: 28.4 s, 36 g out. 92 °C.' }, askUser], {
      id: 'msg_mock_1',
      model: 'claude-opus-5-5',
      stopReason: 'tool_use',
      signature: 'mock-sig-1',
      inputTokens: 512,
    });
    expect(again).toEqual(encoded);
  });
});

describe('splitting helpers', () => {
  it('splits text into small pieces that join back exactly', () => {
    for (const text of ['', 'One', '  leading and trailing  ', 'Lovely. Here is where I would start. 🙂 92 °C']) {
      const pieces = splitText(text);
      expect(pieces.join('')).toBe(text);
      for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(24);
    }
    expect(splitText('Thanks. Let me look at the pressure curve.').length).toBeGreaterThan(2);
  });

  it('splits JSON into pieces that join back exactly', () => {
    const json = JSON.stringify(askUser.input);
    const pieces = splitJson(json);
    expect(pieces.length).toBe(4);
    expect(pieces.join('')).toBe(json);
    expect(splitJson('{}')).toEqual(['{}']);
  });

  it('frames one event the way the API does', () => {
    expect(sseFrame({ event: 'ping', data: { type: 'ping' } })).toBe('event: ping\ndata: {"type":"ping"}\n\n');
  });
});
