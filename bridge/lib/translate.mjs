// Between the Anthropic Messages API (what CafAI speaks) and Claude Code's
// stream-json (what `claude -p` speaks).
import { createHash } from 'node:crypto';
import { TOOL_PREFIX } from './claude.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function stripToolPrefix(name) {
  return typeof name === 'string' && name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
}

/** A message's content as blocks (the API also accepts a plain string). */
export function blocksOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content === '' ? [] : [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter((block) => block && typeof block === 'object') : [];
}

/** The text a tool_result carries; images in it count as "[image]". */
export function toolResultText(block) {
  const content = block?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : part?.type === 'image' ? '[image]' : '')).join('\n');
}

function blockKey(block) {
  switch (block.type) {
    case 'text':
      return ['t', String(block.text ?? '')];
    case 'tool_use':
      // The id is unique per reply; the input is not needed to know the turn.
      return ['u', String(block.id ?? ''), stripToolPrefix(String(block.name ?? ''))];
    case 'tool_result':
      return ['r', String(block.tool_use_id ?? ''), block.is_error === true ? 1 : 0, toolResultText(block)];
    case 'image':
    case 'document':
      return ['i', sha256(JSON.stringify(block.source ?? null))];
    default:
      // Thinking (dropped on the way out, so CafAI holds none from us) and
      // block types this build does not know.
      return null;
  }
}

/**
 * Identifies a message by what matters to the conversation. A live run
 * remembers these for the transcript it holds; CafAI replays our streamed
 * turns verbatim, so its history matches them while the run lives.
 */
export function fingerprintMessage(message) {
  const keys = blocksOf(message)
    .map(blockKey)
    .filter((key) => key !== null);
  return sha256(JSON.stringify([message?.role ?? '', keys]));
}

function pushText(parts, text) {
  if (text === '') return;
  const last = parts[parts.length - 1];
  if (typeof last === 'string') parts[parts.length - 1] = last + text;
  else parts.push(text);
}

function mediaBlock(block) {
  const copy = { ...block };
  delete copy.cache_control;
  return copy;
}

function attr(value) {
  return String(value ?? '').replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
}

function renderBlocks(blocks, parts) {
  let wrote = false;
  const separate = () => {
    if (wrote) pushText(parts, '\n');
    wrote = true;
  };
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        separate();
        pushText(parts, String(block.text ?? ''));
        break;
      case 'tool_use':
        separate();
        pushText(
          parts,
          `<tool_call name="${attr(stripToolPrefix(block.name))}" id="${attr(block.id)}">${JSON.stringify(block.input ?? {})}</tool_call>`,
        );
        break;
      case 'tool_result': {
        separate();
        pushText(parts, `<tool_result for="${attr(block.tool_use_id)}"${block.is_error === true ? ' error="true"' : ''}>\n`);
        if (typeof block.content === 'string') pushText(parts, block.content);
        else if (Array.isArray(block.content)) {
          for (const part of block.content) {
            if (part?.type === 'text') pushText(parts, String(part.text ?? ''));
            else if (part?.type === 'image') parts.push(mediaBlock(part));
          }
        }
        pushText(parts, '\n</tool_result>');
        break;
      }
      case 'image':
      case 'document':
        separate();
        parts.push(mediaBlock(block));
        break;
      default:
        // Thinking and unknown blocks: nothing to replay.
        break;
    }
  }
}

function toContent(parts) {
  const content = parts.map((part) => (typeof part === 'string' ? { type: 'text', text: part } : part));
  return content.length > 0 ? content : [{ type: 'text', text: '(no text)' }];
}

export const REPLAY_NOTE =
  'CafAI Bridge started a new Claude Code session for this conversation, so the conversation so far is replayed ' +
  'below as a transcript. Treat it as what you and the user said earlier. The tools named in it are the tools you ' +
  'have now: call tools the normal way, never by writing them out as text.';

/**
 * A conversation the bridge holds no live process for (it restarted, the bag
 * was coached yesterday): one user message carrying the earlier turns as a
 * transcript, then the latest message. Claude Code cannot be handed earlier
 * assistant turns any other way.
 */
export function flattenConversation(messages) {
  const parts = [];
  pushText(parts, `${REPLAY_NOTE}\n\n<transcript>\n`);
  for (const message of messages.slice(0, -1)) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    pushText(parts, `<${role}>\n`);
    renderBlocks(blocksOf(message), parts);
    pushText(parts, `\n</${role}>\n`);
  }
  pushText(parts, '</transcript>\n\nThe latest message follows. Answer it as the assistant.\n\n');
  renderBlocks(blocksOf(messages[messages.length - 1]), parts);
  return toContent(parts);
}

/** A user message as Claude Code takes it on stdin. */
export function toCliContent(message) {
  const blocks = blocksOf(message);
  const plain = blocks.every((block) => ['text', 'image', 'document', 'thinking', 'redacted_thinking'].includes(block.type));
  if (!plain) {
    const parts = [];
    renderBlocks(blocks, parts);
    return toContent(parts);
  }
  const content = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      if (String(block.text ?? '') !== '') content.push({ type: 'text', text: String(block.text) });
    } else if (block.type === 'image' || block.type === 'document') content.push(mediaBlock(block));
  }
  return content.length > 0 ? content : [{ type: 'text', text: '(no text)' }];
}

export function cliUserLine(content) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' })}\n`;
}

/**
 * A tool_result from CafAI as the answer to a held MCP call. Blocks that came
 * in the same message (text typed while a card was open, a shot that finished
 * meanwhile) ride along as more content of the last result, since the model
 * only reads on once every call is answered.
 */
export function toMcpResult(block, extraBlocks = []) {
  const content = [];
  // The API refuses empty text blocks, so an empty result becomes "(empty)" below.
  if (typeof block.content === 'string') {
    if (block.content !== '') content.push({ type: 'text', text: block.content });
  } else if (Array.isArray(block.content)) {
    for (const part of block.content) {
      if (part?.type === 'text' && String(part.text ?? '') !== '') content.push({ type: 'text', text: String(part.text) });
      else if (part?.type === 'image' && part.source?.type === 'base64') {
        content.push({ type: 'image', data: part.source.data, mimeType: part.source.media_type });
      }
    }
  }
  for (const extra of extraBlocks) {
    if (extra.type === 'text' && String(extra.text ?? '') !== '') {
      content.push({ type: 'text', text: `The user's next message:\n${extra.text}` });
    } else if (extra.type === 'image' && extra.source?.type === 'base64') {
      content.push({ type: 'image', data: extra.source.data, mimeType: extra.source.media_type });
    }
  }
  if (content.length === 0) content.push({ type: 'text', text: '(empty)' });
  return block.is_error === true ? { content, isError: true } : { content };
}

function pickUsage(usage) {
  const out = {};
  if (!usage || typeof usage !== 'object') return out;
  for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (typeof usage[key] === 'number') out[key] = usage[key];
  }
  return out;
}

/**
 * Blocks bound to the plan's organisation: thinking signatures, and the
 * search results a model that searched itself would get (D203).
 */
const DROPPED_BLOCKS = new Set(['thinking', 'redacted_thinking', 'server_tool_use', 'web_search_tool_result']);
const DROPPED_DELTAS = new Set(['thinking_delta', 'signature_delta', 'citations_delta']);

const isCoachTool = (name) => typeof name === 'string' && name.startsWith(TOOL_PREFIX);

/**
 * Rewrites one assistant reply of Claude Code's stream for CafAI: thinking
 * blocks are dropped and the rest renumbered (their signatures belong to the
 * plan's organisation and could fail if replayed to the API under a Console
 * key; CafAI never shows them), tool names lose `mcp__cafai__`, and fields
 * the API would not take back (`caller`) go. Claude Code's own tool calls
 * (its WebSearch, D203) stay inside the run: a message that makes only those
 * does not end the reply, and the message Claude Code writes once it has run
 * them goes on in the same reply, its text on a paragraph of its own. It also
 * keeps the reply as sent, for the run's transcript.
 */
export function createStreamTransformer() {
  let map = new Map();
  const blocks = [];
  let next = 0;
  let stopReason = null;
  let started = false;
  let stopped = false;
  /** This message's calls of Claude Code's own tools, and of the coach's. */
  let ownCalls = 0;
  let coachCalls = 0;
  /** The message ended on Claude Code's own calls only: its next one goes on with this reply. */
  let continuing = false;
  /** The next text starts a paragraph: the reply said something before Claude Code's own calls. */
  let breakText = false;

  return {
    get started() {
      return started;
    },
    get stopped() {
      return stopped;
    },
    get stopReason() {
      return stopReason;
    },
    get continuing() {
      return continuing;
    },
    /** The reply as CafAI will hold it: one message, however many Claude Code wrote. */
    message() {
      return {
        role: 'assistant',
        content: blocks.map((block) => {
          if (block.type === 'text') return { type: 'text', text: block.text };
          if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: {} };
          return { type: block.type };
        }),
      };
    },
    /** The coach-tool calls in the reply (Claude Code's own never reach CafAI). */
    toolUses() {
      return blocks.filter((block) => block.type === 'tool_use').map((block) => ({ id: block.id, name: block.name }));
    },
    push(event) {
      if (!event || typeof event !== 'object') return [];
      switch (event.type) {
        case 'message_start': {
          if (continuing) {
            // Claude Code ran its own calls and writes on: still the reply CafAI is reading.
            continuing = false;
            stopped = false;
            map = new Map();
            ownCalls = 0;
            coachCalls = 0;
            breakText = blocks.some((block) => block.type === 'text' && block.text.trim() !== '');
            return [];
          }
          started = true;
          const message = event.message ?? {};
          return [
            {
              type: 'message_start',
              message: {
                id: String(message.id ?? ''),
                type: 'message',
                role: 'assistant',
                model: String(message.model ?? ''),
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: pickUsage(message.usage),
              },
            },
          ];
        }
        case 'content_block_start': {
          const block = event.content_block ?? {};
          if (DROPPED_BLOCKS.has(block.type)) {
            map.set(event.index, -1);
            return [];
          }
          if (block.type === 'tool_use' && !isCoachTool(block.name)) {
            // Claude Code runs and answers it itself; CafAI would not know the tool.
            map.set(event.index, -1);
            ownCalls += 1;
            return [];
          }
          const index = next++;
          map.set(event.index, index);
          let clean;
          if (block.type === 'tool_use') {
            coachCalls += 1;
            clean = { type: 'tool_use', id: String(block.id ?? ''), name: stripToolPrefix(String(block.name ?? '')), input: {} };
            blocks[index] = { type: 'tool_use', id: clean.id, name: clean.name };
          } else if (block.type === 'text') {
            clean = { type: 'text', text: String(block.text ?? '') };
            blocks[index] = { type: 'text', text: clean.text };
          } else {
            clean = { ...block };
            delete clean.caller;
            blocks[index] = { type: String(block.type) };
          }
          return [{ type: 'content_block_start', index, content_block: clean }];
        }
        case 'content_block_delta': {
          const index = map.get(event.index);
          if (index === undefined || index < 0) return [];
          const delta = event.delta ?? {};
          if (DROPPED_DELTAS.has(delta.type)) return [];
          const out = [];
          if (delta.type === 'text_delta' && blocks[index]?.type === 'text') {
            if (breakText && String(delta.text ?? '') !== '') {
              breakText = false;
              blocks[index].text += '\n\n';
              out.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: '\n\n' } });
            }
            blocks[index].text += String(delta.text ?? '');
          }
          out.push({ type: 'content_block_delta', index, delta });
          return out;
        }
        case 'content_block_stop': {
          const index = map.get(event.index);
          if (index === undefined || index < 0) return [];
          return [{ type: 'content_block_stop', index }];
        }
        case 'message_delta': {
          const delta = event.delta ?? {};
          if (typeof delta.stop_reason === 'string') stopReason = delta.stop_reason;
          if (delta.stop_reason === 'tool_use' && ownCalls > 0 && coachCalls === 0) {
            continuing = true;
            return [];
          }
          return [
            {
              type: 'message_delta',
              delta: { stop_reason: delta.stop_reason ?? null, stop_sequence: delta.stop_sequence ?? null },
              usage: pickUsage(event.usage),
            },
          ];
        }
        case 'message_stop':
          stopped = true;
          return continuing ? [] : [{ type: 'message_stop' }];
        case 'error':
          return [event];
        default:
          // `ping` (the bridge sends its own) and anything newer.
          return [];
      }
    },
  };
}

/** "at 15:00", or "on Tue at 09:00" when it is not today. */
export function resetPhrase(resetsAt, now = new Date()) {
  const seconds = Number(resetsAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const at = new Date(seconds * 1000);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === now.toDateString()) return `at ${time}`;
  return `on ${at.toLocaleDateString([], { weekday: 'short' })} at ${time}`;
}

/**
 * When a rate limit lifts, in epoch seconds. Claude Code 2.1.251 sends both a
 * top-level `resetsAt` (the window that binds, `rateLimitType`) and every
 * window in `unifiedWindows`; either may be missing in another version.
 */
export function limitResetsAt(info) {
  if (!info || typeof info !== 'object') return null;
  if (Number.isFinite(info.resetsAt)) return info.resetsAt;
  const windows = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : {};
  const binding = windows[info.rateLimitType];
  if (Number.isFinite(binding?.resetsAt)) return binding.resetsAt;
  // Every window at its limit has to reset before the plan answers again.
  const full = Object.values(windows).filter((w) => w && w.utilization >= 1 && Number.isFinite(w.resetsAt));
  return full.length > 0 ? Math.max(...full.map((w) => w.resetsAt)) : null;
}

/** The plan's usage from a `rate_limit_event`, for /v1/status; a refusal past its reset time no longer counts. */
export function usageFromRateLimit(info, now = Date.now()) {
  if (!info || typeof info !== 'object') return null;
  const windows = info.unifiedWindows ?? {};
  const window = (raw) =>
    raw && typeof raw === 'object' && typeof raw.utilization === 'number'
      ? { utilization: raw.utilization, resetsAt: Number.isFinite(raw.resetsAt) ? new Date(raw.resetsAt * 1000).toISOString() : null }
      : null;
  let status = typeof info.status === 'string' ? info.status : 'unknown';
  const lifts = limitResetsAt(info);
  if (status === 'rejected' && lifts !== null && lifts * 1000 <= now) status = 'allowed';
  const usage = { status };
  const fiveHour = window(windows.five_hour);
  const sevenDay = window(windows.seven_day);
  if (fiveHour) usage.fiveHour = fiveHour;
  if (sevenDay) usage.sevenDay = sevenDay;
  return usage;
}

const AUTH_TEXT = /\/login|log ?in|logged out|not logged|sign(?:ed)? ?in|authenticat|credential|expired|oauth/i;
const LIMIT_TEXT = /usage limit|rate limit|limit reached|too many requests/i;
const UPDATE_TEXT = /does not support this model|newer is required|claude update/i;

/**
 * Claude Code's failure (a synthetic assistant message, a failed result, a
 * rejected rate limit) as an Anthropic error a barista can act on.
 * @returns {{ status: number, type: string, message: string }}
 */
export function mapCliFailure({ error = null, status = null, text = '', rateLimit = null, model = '' } = {}) {
  const said = String(text ?? '').trim();
  if (UPDATE_TEXT.test(said)) {
    // "Claude Code 2.1.251 does not support this model; version 2.1.280 or newer is required."
    const needed = /version (\d+\.\d+\.\d+) or newer/i.exec(said)?.[1];
    return {
      status: 400,
      type: 'invalid_request_error',
      message:
        `Claude Code on your computer is too old for ${model || 'this model'}${needed ? ` (it needs ${needed} or newer)` : ''}. ` +
        'Run claude update there, or update the Claude desktop app, then try again.',
    };
  }
  if (error === 'model_not_found' || status === 404) {
    return {
      status: 404,
      type: 'not_found_error',
      message: `Claude Code on your computer cannot use ${model || 'that model'}. It may not be part of your plan; pick another model in Settings.`,
    };
  }
  if (error === 'authentication_failed' || status === 401 || (AUTH_TEXT.test(said) && !LIMIT_TEXT.test(said))) {
    return {
      status: 401,
      type: 'authentication_error',
      message: 'Claude Code on your computer is not signed in. Open a terminal there, run claude and sign in with /login.',
    };
  }
  if (error === 'rate_limit' || status === 429 || rateLimit?.status === 'rejected' || LIMIT_TEXT.test(said)) {
    const when = resetPhrase(limitResetsAt(rateLimit));
    return {
      status: 429,
      type: 'rate_limit_error',
      message: when ? `Your Claude plan's usage limit is reached; it resets ${when}.` : "Your Claude plan's usage limit is reached. Try again later.",
    };
  }
  if (error === 'billing_error' || status === 402 || status === 403) {
    return { status: 403, type: 'permission_error', message: said ? `Claude Code says: ${said}` : 'Your Claude plan cannot be used for this.' };
  }
  if (error === 'overloaded' || status === 529 || /overloaded/i.test(said)) {
    return { status: 529, type: 'overloaded_error', message: 'Claude is overloaded right now. Try again in a minute.' };
  }
  if (error === 'invalid_request' || status === 400 || status === 413) {
    return { status: 400, type: 'invalid_request_error', message: said ? `Claude Code rejected the request: ${said}` : 'Claude Code rejected the request.' };
  }
  if (error === 'server_error' || (typeof status === 'number' && status >= 500)) {
    return { status: 500, type: 'api_error', message: 'Claude is having trouble at its end. Try again shortly.' };
  }
  return { status: 500, type: 'api_error', message: said ? `Claude Code on your computer failed: ${said}` : 'Claude Code on your computer failed. Try again.' };
}
