/**
 * Builds one assistant turn from the parsed events of an Anthropic Messages
 * stream, and says which incremental events to show while it streams.
 *
 * Every content block is kept exactly as received so the turn can be replayed
 * unchanged: thinking text and signature, redacted_thinking data, and block
 * types this build does not know, as raw objects with all their fields (a web
 * search's call and results, D203). Only deltas mutate a block (text, partial
 * tool JSON, thinking, signature, citations).
 */
import { ANTHROPIC_WORDING, errorFromStreamError, unreadableReplyError, type ProviderWording } from './errors.ts';
import { markUnparsedToolInput } from './toolInput.ts';
import type { ContentBlock, LlmAssistantTurn, LlmStreamEvent, LlmUsage, ToolUseBlock } from './types.ts';

type Raw = Record<string, unknown>;

interface Slot {
  block: Raw;
  /** Accumulated `partial_json` for blocks that carry an `input`; null for the rest. */
  json: string | null;
}

export interface TurnAssembler {
  /** Feed one parsed stream event. Throws LlmError for an `error` event or a broken stream. */
  push(event: unknown): LlmStreamEvent[];
  /** True once `message_stop` has produced the `message_done` event. */
  readonly finished: boolean;
}

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finishInput(slot: Slot): void {
  const raw = slot.json ?? '';
  // No deltas: the input from content_block_start stands (normally {}).
  if (raw.trim() === '') {
    if (!isRecord(slot.block.input)) slot.block.input = {};
    return;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      slot.block.input = parsed;
      return;
    }
  } catch {
    // Falls through: keep a replayable placeholder and the raw text beside it.
  }
  slot.block.input = {};
  if (slot.block.type === 'tool_use') markUnparsedToolInput(slot.block as unknown as ToolUseBlock, raw);
}

/**
 * After a server-side refusal fallback, only the declined model's text may be
 * echoed back from before the last `fallback` block: its thinking, tool calls
 * and other model-internal blocks must be left out of the replay.
 */
function dropDeclinedPartial(content: Raw[]): Raw[] {
  let boundary = -1;
  content.forEach((block, i) => {
    if (block.type === 'fallback') boundary = i;
  });
  if (boundary < 0) return content;
  return content.filter((block, i) => i >= boundary || block.type === 'text');
}

function toUsage(usage: Raw): LlmUsage {
  const out: LlmUsage = {
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
  };
  if (typeof usage.cache_read_input_tokens === 'number') out.cacheReadInputTokens = usage.cache_read_input_tokens;
  if (typeof usage.cache_creation_input_tokens === 'number') {
    out.cacheCreationInputTokens = usage.cache_creation_input_tokens;
  }
  const server = isRecord(usage.server_tool_use) ? usage.server_tool_use : {};
  if (typeof server.web_search_requests === 'number') out.webSearchRequests = server.web_search_requests;
  return out;
}

/** `wording` tells a broken stream or an `error` event in the server's terms (errors.ts). */
export function createTurnAssembler(wording: ProviderWording = ANTHROPIC_WORDING): TurnAssembler {
  let id = '';
  let model = '';
  let stopReason: string | null = null;
  let finished = false;
  const usage: Raw = {};
  const slots: Slot[] = [];

  function slotAt(index: unknown): Slot {
    const slot = typeof index === 'number' ? slots[index] : undefined;
    if (!slot) throw unreadableReplyError(wording);
    return slot;
  }

  function buildTurn(): LlmAssistantTurn {
    const blocks = slots.filter((slot): slot is Slot => slot !== undefined).map((slot) => slot.block);
    return {
      id,
      model,
      content: dropDeclinedPartial(blocks) as unknown as ContentBlock[],
      stopReason: stopReason ?? 'end_turn',
      usage: toUsage(usage),
    };
  }

  return {
    get finished() {
      return finished;
    },

    push(event) {
      if (finished || !isRecord(event)) return [];
      switch (event.type) {
        case 'message_start': {
          const message = isRecord(event.message) ? event.message : {};
          id = str(message.id);
          model = str(message.model);
          if (isRecord(message.usage)) Object.assign(usage, message.usage);
          return [{ type: 'message_start', id, model }];
        }

        case 'content_block_start': {
          const index = event.index;
          const block = event.content_block;
          if (typeof index !== 'number' || !isRecord(block)) throw unreadableReplyError(wording);
          const copy: Raw = { ...block };
          slots[index] = { block: copy, json: 'input' in copy ? '' : null };
          return copy.type === 'tool_use' ? [{ type: 'tool_use_start', index, id: str(copy.id), name: str(copy.name) }] : [];
        }

        case 'content_block_delta': {
          const slot = slotAt(event.index);
          const index = event.index as number;
          const delta = isRecord(event.delta) ? event.delta : {};
          switch (delta.type) {
            case 'text_delta': {
              const text = str(delta.text);
              slot.block.text = str(slot.block.text) + text;
              return slot.block.type === 'text' ? [{ type: 'text_delta', index, text }] : [];
            }
            case 'input_json_delta':
              // A server tool's call can start without an input; its deltas still carry it.
              slot.json = (slot.json ?? '') + str(delta.partial_json);
              return [];
            case 'citations_delta': {
              // One citation at a time, onto the text it cites, as the API's whole turn lists them (D203).
              const citations = Array.isArray(slot.block.citations) ? (slot.block.citations as unknown[]) : [];
              if (slot.block.type === 'text' && delta.citation !== undefined) slot.block.citations = [...citations, delta.citation];
              return [];
            }
            case 'thinking_delta':
              slot.block.thinking = str(slot.block.thinking) + str(delta.thinking);
              return [];
            case 'signature_delta':
              slot.block.signature = str(delta.signature);
              return [];
            default:
              return [];
          }
        }

        case 'content_block_stop': {
          const slot = slotAt(event.index);
          if (slot.json !== null) finishInput(slot);
          return [{ type: 'block_stop', index: event.index as number }];
        }

        case 'message_delta': {
          if (isRecord(event.delta) && typeof event.delta.stop_reason === 'string') stopReason = event.delta.stop_reason;
          if (isRecord(event.usage)) {
            for (const [key, value] of Object.entries(event.usage)) if (typeof value === 'number') usage[key] = value;
            if (isRecord(event.usage.server_tool_use)) usage.server_tool_use = event.usage.server_tool_use;
          }
          return [];
        }

        case 'message_stop':
          finished = true;
          return [{ type: 'message_done', turn: buildTurn() }];

        case 'error':
          throw errorFromStreamError(event, wording);

        default:
          // `ping`, and event types added after this build.
          return [];
      }
    },
  };
}
