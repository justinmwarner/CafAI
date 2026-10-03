/**
 * Encodes assistant content as an Anthropic Messages event stream, shaped the
 * way the real API delivers it: `message_start`, a `ping`, one leading empty
 * thinking block (Opus 5.5 always thinks, and with the default display its
 * text is empty; only the signature arrives), text in small deltas, tool input
 * as several `input_json_delta` pieces, then `message_delta` (stop reason and
 * usage) and `message_stop`.
 */
import type { ContentBlock, StopReason, TextBlock, ToolUseBlock } from '../../src/llm/types.ts';
import { clone } from '../../src/util/clone.ts';

export interface SseMessage {
  event: string;
  data: Record<string, unknown>;
}

export interface EncodeOptions {
  id: string;
  model: string;
  stopReason: StopReason;
  /** Signature of the leading thinking block; deterministic so replays can be checked. */
  signature: string;
  inputTokens?: number;
}

export interface EncodedTurn {
  /** The turn exactly as a correct client assembles (and must replay) it. */
  content: ContentBlock[];
  events: SseMessage[];
}

const WORDS_PER_DELTA = 2;
const MAX_DELTA_LENGTH = 24;
const JSON_PIECES = 4;

function chunkCodePoints(text: string, size: number): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''));
  return out;
}

/** Two words per delta (never more than 24 characters), joining back to the exact text. */
export function splitText(text: string): string[] {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += WORDS_PER_DELTA) {
    const piece = tokens.slice(i, i + WORDS_PER_DELTA).join('');
    out.push(...(piece.length > MAX_DELTA_LENGTH ? chunkCodePoints(piece, MAX_DELTA_LENGTH) : [piece]));
  }
  return out;
}

/** Tool input JSON in about four pieces, cut anywhere (mid-key, mid-string), as the API does. */
export function splitJson(json: string, pieces = JSON_PIECES): string[] {
  const length = Array.from(json).length;
  if (length <= pieces) return [json];
  return chunkCodePoints(json, Math.ceil(length / pieces));
}

export function sseFrame(message: SseMessage): string {
  return `event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`;
}

export function encodeAssistantTurn(blocks: Array<TextBlock | ToolUseBlock>, options: EncodeOptions): EncodedTurn {
  const content: ContentBlock[] = [{ type: 'thinking', thinking: '', signature: options.signature }, ...clone(blocks)];
  const events: SseMessage[] = [];
  const emit = (data: Record<string, unknown>) => events.push({ event: String(data.type), data });
  let outputChars = 0;

  emit({
    type: 'message_start',
    message: {
      id: options.id,
      type: 'message',
      role: 'assistant',
      model: options.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: options.inputTokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      },
    },
  });
  emit({ type: 'ping' });

  content.forEach((block, index) => {
    if (block.type === 'thinking') {
      emit({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      emit({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else if (block.type === 'text') {
      emit({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const text of splitText(block.text)) {
        emit({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } });
      }
      outputChars += block.text.length;
    } else if (block.type === 'tool_use') {
      emit({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      const json = JSON.stringify(block.input);
      for (const partial_json of splitJson(json)) {
        emit({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } });
      }
      outputChars += json.length;
    }
    emit({ type: 'content_block_stop', index });
  });

  emit({
    type: 'message_delta',
    delta: { stop_reason: options.stopReason, stop_sequence: null },
    usage: { output_tokens: Math.max(1, Math.ceil(outputChars / 4)) },
  });
  emit({ type: 'message_stop' });

  return { content, events };
}
