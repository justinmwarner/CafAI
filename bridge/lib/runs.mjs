// One conversation = one live `claude -p` process.
//
// CafAI sends the whole transcript with every request (the Messages API is
// stateless). A run remembers the transcript it holds, as fingerprints; a
// request whose history is exactly that continues the run: new user text goes
// to the process's stdin, tool results go to the MCP calls it is waiting on.
// Anything else starts a new run, whose first message replays the history.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRunArgs, childEnv, killProcess, spawnClaude } from './claude.mjs';
import {
  blocksOf,
  cliUserLine,
  createStreamTransformer,
  fingerprintMessage,
  flattenConversation,
  mapCliFailure,
  toCliContent,
  toMcpResult,
  usageFromRateLimit,
} from './translate.mjs';

export const TOOL_NOTE =
  '\n\n[CafAI Bridge] The tools are provided under the prefix mcp__cafai__: a tool this prompt calls ' +
  'propose_adjustment is called as mcp__cafai__propose_adjustment, and so on.';

/**
 * Claude Code's WebSearch stands in for Anthropic's web_search (D203): the
 * request's `max_uses` is kept by asking, and the links its results ask for
 * would show in CafAI as markdown.
 */
export function webSearchNote(maxUses) {
  const limit = maxUses === 1 ? ': search at most once per reply' : maxUses ? `: search at most ${maxUses} times per reply` : '';
  return (
    `\n\n[CafAI Bridge] The web search this prompt calls web_search is the WebSearch tool here${limit}. ` +
    'Its results ask you to list their sources as markdown links, which CafAI shows as plain text: name each source by its site instead (onyxcoffeelab.com).'
  );
}

/** The system prompt a run starts with: the coach's, and what the bridge adds. */
export function runSystemPrompt(request) {
  const tools = request.tools.length > 0 ? TOOL_NOTE : '';
  return `${request.system}${tools}${request.webSearch ? webSearchNote(request.webSearch.maxUses) : ''}`;
}

// Until a reply begins (D280): Claude Code silent for quietMs is restarted
// once, then the request fails; while it writes anything (an api_retry,
// say) the request waits, up to maxWaitMs in all, restart included.
const DEFAULTS = {
  quietMs: 90_000,
  maxWaitMs: 5 * 60_000,
  stallMs: 180_000,
  idleMs: 30 * 60_000,
};

/** Why Claude Code tries Anthropic again, from an api_retry's error_status (and error). */
export function retryReason(status, error = null) {
  if (status === 529 || (status == null && error === 'overloaded')) return 'overloaded';
  if (status === 429) return 'rate_limited';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (status == null) return 'network';
  return 'other';
}

/**
 * What a request that waited `maxWaitMs` for a reply to begin fails with:
 * said from Claude Code's last api_retry, when it was retrying.
 * @param {{ status: number | null, error: string | null } | null} retry
 * @param {number} maxWaitMs
 * @returns {{ status: number, type: string, message: string }}
 */
export function waitFailure(retry, maxWaitMs) {
  const minutes = Math.max(1, Math.round(maxWaitMs / 60_000));
  const silent = `Claude Code on your computer did not answer in ${minutes} minute${minutes === 1 ? '' : 's'}. Try again.`;
  switch (retry ? retryReason(retry.status, retry.error) : null) {
    case 'overloaded':
      return { status: 529, type: 'overloaded_error', message: 'Claude is overloaded right now. Try again in a few minutes.' };
    case 'rate_limited':
      return { status: 500, type: 'api_error', message: 'Claude is limiting requests right now. Try again in a few minutes.' };
    case 'server':
      return { status: 500, type: 'api_error', message: 'Claude is having trouble right now. Try again in a few minutes.' };
    case 'network':
      return {
        status: 500,
        type: 'api_error',
        message: "Claude Code on your computer could not reach Claude. Check the computer's internet connection, then try again.",
      };
    default:
      return { status: 500, type: 'api_error', message: silent };
  }
}

/**
 * @typedef {object} Sink  Where one HTTP request's reply goes.
 * @property {() => void} open  A run has taken the request: start the reply (headers, pings).
 * @property {(event: object) => void} event
 * @property {(report: { stage: string, attempt?: number, of?: number, reason?: string }) => void} wait
 *   What the request waits on, before the reply begins (D280): a cafai_wait event on a stream.
 * @property {(failure: { status: number, type: string, message: string }) => void} fail
 * @property {() => void} end
 * @property {(listener: () => void) => void} onClose   The client went away before end().
 * @property {boolean} closed
 */

/**
 * @typedef {object} BridgeRequest
 * @property {string} model
 * @property {number | undefined} maxTokens
 * @property {string} system
 * @property {Array<{ role: string, content: unknown }>} messages
 * @property {Array<{ name: string, description?: string, input_schema?: object }>} tools
 * @property {string | null} effort
 * @property {{ maxUses: number | null } | null} webSearch  The request's web_search server tool (D203).
 */

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameSet(list, set) {
  return list.length === set.size && list.every((value) => set.has(value));
}

function textOf(message) {
  return blocksOf(message)
    .map((block) => (block.type === 'text' ? String(block.text ?? '') : ''))
    .join('')
    .trim();
}

export function configKey(request) {
  const tools = request.tools.map((tool) => [tool.name, tool.description ?? '', tool.input_schema ?? null]);
  return createHash('sha256')
    .update(JSON.stringify([request.model, request.effort ?? null, request.system, tools, request.webSearch ?? null]))
    .digest('hex');
}

class Run {
  /**
   * @param {RunManager} manager
   * @param {BridgeRequest} request
   */
  constructor(manager, request) {
    this.manager = manager;
    this.id = randomBytes(8).toString('hex');
    this.secret = randomBytes(24).toString('hex');
    this.configKey = configKey(request);
    this.model = request.model;
    this.tools = request.tools;
    /** @type {'streaming' | 'awaiting_tools' | 'finishing' | 'idle' | 'closed'} */
    this.state = 'streaming';
    /** @type {string[]} */
    this.transcript = [];
    /** Tool_use ids the paused turn waits on. */
    this.expected = new Set();
    /** @type {Array<{ id: string, name: string }>} */
    this.lastToolUses = [];
    /** @type {Map<string, { result?: object, resolve?: (result: object) => void, claimed?: boolean }>} */
    this.held = new Map();
    /** @type {Sink | null} */
    this.sink = null;
    this.transformer = null;
    this.failure = null;
    this.rejectedLimit = null;
    this.inTurn = false;
    this.pendingLine = null;
    this.lastUsed = Date.now();
    this.lastOutput = Date.now();
    this.lastStreamEvent = Date.now();
    this.messageId = '';
    this.stderr = '';
    this.files = [];
    this.timers = { quiet: null, cap: null, idle: null, stall: null };
    this.child = null;
    /** The request this run answers now, whole: a restart starts it again (D280). */
    this.current = null;
    /**
     * Until the reply begins: when the request came, whether Claude Code was
     * restarted for it, what it last wrote and when, and its last api_retry.
     * @type {{ startedAt: number, restarted: boolean, last: string, lastAt: number, retry: { attempt: number | null, of: number | null, status: number | null, error: string | null } | null } | null}
     */
    this.waiting = null;
  }

  log(text) {
    this.manager.log(`run ${this.id.slice(0, 6)}: ${text}`);
  }

  /**
   * Spawn Claude Code and send the first message. `wait` carries a restart's
   * request on (D280): when it came, and that Claude Code was restarted for it.
   * @param {BridgeRequest} request
   * @param {string[]} fingerprints
   * @param {Sink} sink
   * @param {{ startedAt?: number, restarted?: boolean, restartOf?: string }} [wait]
   */
  start(request, fingerprints, sink, wait = {}) {
    const { workDir, install } = this.manager;
    this.current = { request, fingerprints };
    mkdirSync(workDir, { recursive: true });
    const systemFile = path.join(workDir, `run-${this.id}-system.txt`);
    writeFileSync(systemFile, runSystemPrompt(request), 'utf8');
    this.files.push(systemFile);
    let mcpFile = null;
    if (this.tools.length > 0) {
      mcpFile = path.join(workDir, `run-${this.id}-mcp.json`);
      const url = `http://127.0.0.1:${this.manager.port}/mcp/${this.id}`;
      writeFileSync(
        mcpFile,
        JSON.stringify({ mcpServers: { cafai: { type: 'http', url, headers: { Authorization: `Bearer ${this.secret}` } } } }),
        'utf8',
      );
      this.files.push(mcpFile);
    }
    const args = buildRunArgs({
      model: request.model,
      effort: request.effort,
      systemPromptFile: systemFile,
      mcpConfigFile: mcpFile,
      webSearch: Boolean(request.webSearch),
    });
    const env = childEnv(this.manager.env, { allowApiKey: this.manager.allowApiKey });
    if (request.maxTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(request.maxTokens);

    this.transcript = [...fingerprints];
    this.attach(sink, wait);
    this.timers.stall = setInterval(() => this.checkStall(), Math.min(10_000, this.manager.stallMs));

    let child;
    try {
      child = spawnClaude(install, args, { cwd: workDir, env });
    } catch (error) {
      this.close('could not start Claude Code', {
        status: 500,
        type: 'api_error',
        message: `CafAI Bridge could not start Claude Code: ${error?.message ?? error}`,
      });
      return;
    }
    this.child = child;
    child.on('error', (error) => {
      // The desktop app removes an old copy when it updates its Claude Code: look again next time.
      if (error?.code === 'ENOENT') this.manager.install = null;
      this.close('Claude Code failed to start', {
        status: 500,
        type: 'api_error',
        message: `CafAI Bridge could not start Claude Code: ${error?.message ?? error}`,
      });
    });
    child.stdin.on('error', () => {
      // The process is gone; its exit handler says so.
    });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === '') continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        this.onLine(parsed);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });
    child.on('exit', (code, signal) => this.onExit(code, signal));
    this.noteWait('started Claude Code');
    this.report({ stage: 'starting' });

    const last = request.messages[request.messages.length - 1];
    const content = request.messages.length === 1 ? toCliContent(last) : flattenConversation(request.messages);
    this.write(cliUserLine(content));
    this.log(
      `started ${wait.restartOf ? 'again ' : ''}for a ${request.messages.length === 1 ? 'new conversation' : `conversation of ${request.messages.length} messages (replayed)`}, ${request.model}` +
        (wait.restartOf ? `, in place of run ${wait.restartOf.slice(0, 6)}` : ''),
    );
  }

  write(line) {
    this.inTurn = true;
    this.child?.stdin.write(line);
  }

  /**
   * Take a request: its reply goes to `sink`, and the wait for that reply to
   * begin is timed (D280), from `startedAt` when a restart carries it on.
   */
  attach(sink, { startedAt = Date.now(), restarted = false } = {}) {
    sink.open();
    this.sink = sink;
    this.state = 'streaming';
    this.transformer = null;
    this.messageId = '';
    this.failure = null;
    this.rejectedLimit = null;
    this.lastUsed = Date.now();
    this.lastOutput = Date.now();
    this.lastStreamEvent = Date.now();
    clearTimeout(this.timers.idle);
    this.waiting = { startedAt, restarted, last: 'nothing yet', lastAt: Date.now(), retry: null };
    this.armQuiet();
    clearTimeout(this.timers.cap);
    this.timers.cap = setTimeout(() => this.onWaitedTooLong(), Math.max(0, startedAt + this.manager.maxWaitMs - Date.now()));
    sink.onClose(() => {
      if (this.sink === sink) {
        this.sink = null;
        this.close('CafAI stopped the request');
      }
    });
  }

  /** The reply for this request is complete; the run waits for the next one. */
  detach(state) {
    const sink = this.sink;
    this.sink = null;
    this.state = state;
    this.lastUsed = Date.now();
    this.endWait();
    clearTimeout(this.timers.idle);
    this.timers.idle = setTimeout(() => this.close('idle'), this.manager.idleMs);
    sink?.end();
  }

  // -------------------------------------------------------------------------
  // The wait for a reply to begin (D280)
  // -------------------------------------------------------------------------

  armQuiet() {
    clearTimeout(this.timers.quiet);
    this.timers.quiet = setTimeout(() => this.onQuiet(), this.manager.quietMs);
  }

  /** Claude Code wrote something before the reply began: it is alive. */
  noteWait(what) {
    if (!this.waiting) return;
    this.waiting.last = what;
    this.waiting.lastAt = Date.now();
    this.armQuiet();
  }

  /** Tell CafAI what the request waits on (a cafai_wait event). */
  report(report) {
    if (this.waiting) this.sink?.wait?.(report);
  }

  /** The reply began, finished or failed: nothing is waited on now. */
  endWait() {
    this.waiting = null;
    clearTimeout(this.timers.quiet);
    clearTimeout(this.timers.cap);
  }

  /** For the log: how long the request waited, what Claude Code last wrote, and its stderr's end. */
  describeWait() {
    const now = Date.now();
    const seconds = (at) => Math.round((now - at) / 1000);
    const parts = [];
    if (this.waiting) parts.push(`waited ${seconds(this.waiting.startedAt)} s`, `last: ${this.waiting.last}, ${seconds(this.waiting.lastAt)} s ago`);
    const stderr = this.stderr.trim().replace(/\s+/g, ' ');
    if (stderr !== '') parts.push(`stderr: ${stderr.slice(-300)}`);
    return parts.join('; ');
  }

  /**
   * Claude Code wrote nothing for quietMs before the reply began: a hung
   * connection or a start that never finished. A fresh process mends that,
   * so the first time it is restarted on the same request; nothing had
   * reached CafAI. The second time the request fails.
   */
  onQuiet() {
    if (this.state !== 'streaming' || !this.waiting) return;
    const quiet = `Claude Code went quiet for ${Math.round(this.manager.quietMs / 1000)} s (${this.describeWait()})`;
    if (!this.waiting.restarted && this.current) {
      this.log(`${quiet}; starting it again`);
      this.report({ stage: 'restarting' });
      this.manager.restart(this);
      return;
    }
    this.close(`no answer from Claude Code: ${quiet}${this.waiting.restarted ? ', after a restart' : ''}`, {
      status: 500,
      type: 'api_error',
      message: this.waiting.restarted
        ? 'Claude Code on your computer stopped answering, even after a restart. Try again; if it keeps happening, restart CafAI Bridge.'
        : 'Claude Code on your computer stopped answering. Try again; if it keeps happening, restart CafAI Bridge.',
    });
  }

  /** The reply has not begun in maxWaitMs, though Claude Code kept writing (retrying Anthropic, say). */
  onWaitedTooLong() {
    if (this.state !== 'streaming' || !this.waiting) return;
    const failure = waitFailure(this.waiting.retry, this.manager.maxWaitMs);
    this.close(`no answer from Claude Code in ${Math.round(this.manager.maxWaitMs / 1000)} s (${this.describeWait()})`, failure);
  }

  checkStall() {
    if (this.state !== 'streaming' || !this.transformer) return;
    // Stream events only: Claude Code's 30 s tool heartbeats say nothing about the reply.
    if (Date.now() - this.lastStreamEvent < this.manager.stallMs) return;
    this.close('Claude Code went quiet', {
      status: 500,
      type: 'api_error',
      message: 'Claude Code on your computer stopped answering. Try again.',
    });
  }

  /** The reply broke off and Claude Code started it again: CafAI would get it twice. */
  desync(reason) {
    this.close(reason, {
      status: 500,
      type: 'api_error',
      message: "Claude Code's reply broke off on your computer. Try again.",
    });
  }

  onLine(line) {
    this.lastOutput = Date.now();
    // Before the reply begins, any line says Claude Code is alive (D280).
    if (this.waiting) this.noteWait(line.type === 'system' ? [line.subtype, line.status].filter(Boolean).join(' ') || 'system' : String(line.type));
    switch (line.type) {
      case 'stream_event': {
        if (line.parent_tool_use_id) return;
        this.lastStreamEvent = Date.now();
        const event = line.event ?? {};
        if (event.type === 'message_start') {
          if (this.transformer && !this.transformer.stopped) {
            this.desync('a new message started before the last one ended');
            return;
          }
          this.endWait();
          // After Claude Code ran its own calls (its WebSearch, D203), its next message goes on with the same reply.
          if (!this.transformer?.continuing) this.transformer = createStreamTransformer();
          this.messageId = String(event.message?.id ?? '');
        }
        if (!this.transformer) return;
        for (const out of this.transformer.push(event)) this.sink?.event(out);
        if (event.type === 'message_stop') this.onMessageStop();
        return;
      }
      case 'assistant':
        if (line.error || line.is_api_error_message || line.message?.model === '<synthetic>') {
          this.failure = { error: typeof line.error === 'string' ? line.error : null, text: textOf(line.message) };
        } else if (!line.parent_tool_use_id && this.state === 'streaming' && String(line.message?.id ?? '') !== this.messageId) {
          // A message that never streamed (Claude Code fell back to a plain
          // request, say): CafAI would never see it end.
          this.desync('a message arrived that was not streamed');
        }
        return;
      case 'rate_limit_event':
        this.manager.noteRateLimit(line.rate_limit_info);
        if (line.rate_limit_info?.status === 'rejected') this.rejectedLimit = line.rate_limit_info;
        else if (line.rate_limit_info?.status === 'allowed') this.rejectedLimit = null;
        return;
      case 'system':
        if (line.subtype === 'init' && this.tools.length > 0) {
          const server = Array.isArray(line.mcp_servers) ? line.mcp_servers.find((s) => s?.name === 'cafai') : null;
          if (server && server.status === 'failed') {
            this.close("Claude Code could not reach the coach's tools", {
              status: 500,
              type: 'api_error',
              message: "Claude Code could not reach the coach's tools on CafAI Bridge. Restart the bridge and try again.",
            });
          }
        } else if (line.subtype === 'status' && line.status === 'requesting') {
          this.report({ stage: 'requesting' });
        } else if (line.subtype === 'api_retry' && this.waiting) {
          // Anthropic failed and Claude Code tries again (2.1.317 writes these): alive, and waiting on Anthropic.
          const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
          const retry = {
            attempt: count(line.attempt),
            of: count(line.max_retries),
            status: count(line.error_status),
            error: typeof line.error === 'string' ? line.error : null,
          };
          this.waiting.retry = retry;
          this.waiting.last = `api_retry ${retry.attempt ?? '?'} of ${retry.of ?? '?'} (${retry.status ?? 'no status'}${retry.error ? ` ${retry.error}` : ''})`;
          this.report({
            stage: 'retrying',
            ...(retry.attempt !== null ? { attempt: retry.attempt } : {}),
            ...(retry.of !== null ? { of: retry.of } : {}),
            reason: retryReason(retry.status, retry.error),
          });
        }
        return;
      case 'result':
        this.onResult(line);
        return;
      default:
    }
  }

  onMessageStop() {
    const transformer = this.transformer;
    // Claude Code runs its own calls and writes on: the reply goes on with its next message.
    if (!transformer || transformer.continuing) return;
    this.transformer = null;
    const stop = transformer.stopReason;
    const fingerprint = fingerprintMessage(transformer.message());
    const uses = transformer.toolUses();
    if (stop === 'tool_use' && uses.length > 0) {
      this.transcript.push(fingerprint);
      this.lastToolUses = uses;
      this.expected = new Set(uses.map((use) => use.id));
      for (const use of uses) if (!this.held.has(use.id)) this.held.set(use.id, {});
      this.detach('awaiting_tools');
      return;
    }
    if (stop === 'end_turn' || stop === 'stop_sequence') {
      this.transcript.push(fingerprint);
      this.detach('finishing');
      return;
    }
    // max_tokens, refusal, pause_turn: CafAI handles the turn itself and the
    // next request will not continue this one; end the reply and the run.
    const sink = this.sink;
    this.sink = null;
    sink?.end();
    this.close(`turn ended with ${stop ?? 'no stop reason'}`);
  }

  onResult(line) {
    this.inTurn = false;
    // No endWait() here: a message that came while this turn finished (pendingLine) is waited on still,
    // and every other way on closes the run or found the reply already ended.
    const failed = line.is_error === true || line.terminal_reason === 'api_error' || String(line.subtype ?? '').startsWith('error');
    if (failed) {
      const failure = mapCliFailure({
        error: this.failure?.error ?? null,
        status: typeof line.api_error_status === 'number' ? line.api_error_status : null,
        text: typeof line.result === 'string' && line.result !== '' ? line.result : (this.failure?.text ?? ''),
        rateLimit: this.rejectedLimit,
        model: this.model,
      });
      this.close(`Claude Code failed (${failure.type})`, failure);
      return;
    }
    if (this.pendingLine) {
      // The previous turn finished; now send the message that came meanwhile.
      const line2 = this.pendingLine;
      this.pendingLine = null;
      this.write(line2);
      return;
    }
    if (this.state === 'finishing') {
      // A request without tools (the bag photo) is never continued: free its slot now.
      if (this.tools.length === 0) {
        this.close('one-off request answered');
        return;
      }
      this.state = 'idle';
      return;
    }
    if (this.state === 'streaming') {
      this.close('turn ended without a reply', {
        status: 500,
        type: 'api_error',
        message: 'Claude Code ended the turn without a reply. Try again.',
      });
      return;
    }
    // A result while tool calls were held: Claude Code moved on without them.
    if (this.state === 'awaiting_tools') this.close('Claude Code finished without the tool results');
  }

  onExit(code, signal) {
    if (this.state === 'closed') return;
    const failure = this.failure
      ? mapCliFailure({ error: this.failure.error, text: this.failure.text, rateLimit: this.rejectedLimit, model: this.model })
      : {
          status: 500,
          type: 'api_error',
          message: `Claude Code on your computer stopped unexpectedly (${signal ?? `exit code ${code}`}). Try again.`,
        };
    if (!this.failure && this.stderr.trim() !== '') this.log(`stderr: ${this.stderr.trim().slice(-300)}`);
    this.close('Claude Code exited', failure);
  }

  /** CafAI answered the tool calls this run waits on. */
  answerTools(message, fingerprint, sink) {
    const blocks = blocksOf(message);
    const results = blocks.filter((block) => block.type === 'tool_result');
    const extras = blocks.filter((block) => block.type === 'text' || block.type === 'image');
    results.forEach((block, i) => {
      const answer = toMcpResult(block, i === results.length - 1 ? extras : []);
      const entry = this.held.get(block.tool_use_id) ?? {};
      this.held.set(block.tool_use_id, entry);
      if (entry.resolve) {
        const resolve = entry.resolve;
        entry.resolve = undefined;
        resolve(answer);
      } else {
        entry.result = answer;
      }
    });
    this.transcript.push(fingerprint);
    this.expected = new Set();
    this.attach(sink);
  }

  /** A new user turn in this conversation. */
  sendUser(message, fingerprint, sink) {
    const line = cliUserLine(toCliContent(message));
    this.transcript.push(fingerprint);
    this.attach(sink);
    if (this.inTurn) this.pendingLine = line;
    else this.write(line);
  }

  /** Claude Code calls a coach tool: answer now if CafAI already did, else when it does. */
  callTool({ name, toolUseId }) {
    if (this.state === 'closed') {
      return Promise.resolve({ content: [{ type: 'text', text: 'CafAI Bridge closed this conversation.' }], isError: true });
    }
    let id = toolUseId;
    if (!id) {
      // Older Claude Code without the tool_use id: the first unclaimed call of that name.
      const uses = this.transformer?.toolUses() ?? this.lastToolUses;
      id = uses.find((use) => use.name === name && !this.held.get(use.id)?.claimed)?.id ?? `unmatched-${name}`;
    }
    const entry = this.held.get(id) ?? {};
    this.held.set(id, entry);
    entry.claimed = true;
    if (entry.result) {
      const result = entry.result;
      this.held.delete(id);
      return Promise.resolve(result);
    }
    return new Promise((resolve) => {
      entry.resolve = (result) => {
        this.held.delete(id);
        resolve(result);
      };
    });
  }

  /** Claude Code stopped waiting for a tool result: this process cannot go on. */
  onToolAbandoned() {
    if (this.state !== 'closed') this.close('Claude Code stopped waiting for a tool result');
  }

  /**
   * @param {string} reason  For the log.
   * @param {{ status: number, type: string, message: string }} [failure]  Sent to a request still waiting.
   */
  close(reason, failure) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.endWait();
    clearTimeout(this.timers.idle);
    clearInterval(this.timers.stall);
    // Kill first; answering a held call now would let Claude Code start one
    // more turn on the plan before it dies. The answers only end the requests.
    const held = [...this.held.values()];
    this.held.clear();
    setTimeout(() => {
      for (const entry of held) entry.resolve?.({ content: [{ type: 'text', text: 'CafAI Bridge closed this conversation.' }], isError: true });
    }, 2000).unref?.();
    const sink = this.sink;
    this.sink = null;
    if (sink && !sink.closed) {
      if (failure) sink.fail(failure);
      else sink.end();
    }
    killProcess(this.child);
    for (const file of this.files) rmSync(file, { force: true });
    this.manager.runs.delete(this.id);
    this.log(`closed: ${reason}`);
  }
}

export class RunManager {
  /**
   * @param {object} options
   * @param {import('./claude.mjs').ClaudeInstall | null} options.install
   * @param {string} options.workDir
   * @param {number} [options.maxRuns]
   * @param {number} [options.idleMs]
   * @param {number} [options.quietMs]    Claude Code silent this long before a reply begins: restarted once, then the request fails.
   * @param {number} [options.maxWaitMs]  The longest a request waits for its reply to begin, a restart included.
   * @param {number} [options.stallMs]
   * @param {boolean} [options.allowApiKey]
   * @param {NodeJS.ProcessEnv} [options.env]
   * @param {(line: string) => void} [options.log]
   */
  constructor({ install, workDir, maxRuns = 3, idleMs, quietMs, maxWaitMs, stallMs, allowApiKey = false, env = process.env, log = () => {} }) {
    this.install = install;
    this.workDir = workDir;
    this.maxRuns = maxRuns;
    this.idleMs = idleMs ?? DEFAULTS.idleMs;
    this.quietMs = quietMs ?? DEFAULTS.quietMs;
    this.maxWaitMs = maxWaitMs ?? DEFAULTS.maxWaitMs;
    this.stallMs = stallMs ?? DEFAULTS.stallMs;
    this.allowApiKey = allowApiKey;
    this.env = env;
    this.log = log;
    this.port = 0;
    /** @type {Map<string, Run>} */
    this.runs = new Map();
    this.lastRateLimit = null;
  }

  liveCount() {
    return this.runs.size;
  }

  noteRateLimit(info) {
    if (info && typeof info === 'object') this.lastRateLimit = info;
  }

  usage() {
    return usageFromRateLimit(this.lastRateLimit);
  }

  /**
   * Route one request: continue a live run, or start a new one.
   * @param {BridgeRequest} request
   * @param {Sink} sink
   * @returns {'tools' | 'continue' | 'new' | 'busy'}
   */
  handle(request, sink) {
    const key = configKey(request);
    const fingerprints = request.messages.map(fingerprintMessage);
    const history = fingerprints.slice(0, -1);
    const last = request.messages[request.messages.length - 1];
    const results = blocksOf(last).filter((block) => block.type === 'tool_result');

    for (const run of [...this.runs.values()]) {
      if (run.configKey !== key || !sameList(run.transcript, history)) continue;
      if (run.state === 'awaiting_tools' && results.length > 0 && sameSet(results.map((b) => b.tool_use_id), run.expected)) {
        run.current = { request, fingerprints };
        run.answerTools(last, fingerprints[fingerprints.length - 1], sink);
        return 'tools';
      }
      if ((run.state === 'idle' || run.state === 'finishing') && results.length === 0) {
        run.current = { request, fingerprints };
        run.sendUser(last, fingerprints[fingerprints.length - 1], sink);
        return 'continue';
      }
      // Same history in any other state (a retry while it still streams, say):
      // that run is stale for this request.
      run.close('superseded by a new request');
    }

    if (!this.makeRoom()) {
      sink.fail({
        status: 503,
        type: 'overloaded_error',
        message: 'CafAI Bridge is busy with other conversations. Try again in a moment.',
      });
      return 'busy';
    }
    this.launch(request, fingerprints, sink);
    return 'new';
  }

  /** A new run for `request`, its reply going to `sink`. */
  launch(request, fingerprints, sink, wait = {}) {
    const run = new Run(this, request);
    this.runs.set(run.id, run);
    try {
      run.start(request, fingerprints, sink, wait);
    } catch (error) {
      // Its files could not be written (a full disk, a locked or missing work
      // folder): close it, or it would hold its slot for good.
      const failure = {
        status: 500,
        type: 'api_error',
        message: `CafAI Bridge could not prepare the conversation on your computer: ${error?.message ?? error}`,
      };
      const attached = run.sink === sink;
      run.close('could not prepare the run', attached ? failure : undefined);
      if (!attached) sink.fail(failure);
    }
    return run;
  }

  /**
   * Start a quiet run's Claude Code again on the request it holds (D280):
   * the old run ends without failing the request, and a new one takes the
   * same reply, the conversation replayed. Nothing had reached CafAI.
   */
  restart(run) {
    const sink = run.sink;
    const { request, fingerprints } = run.current;
    const startedAt = run.waiting?.startedAt ?? Date.now();
    run.sink = null;
    run.close('restarted');
    if (!sink || sink.closed) return null;
    return this.launch(request, fingerprints, sink, { startedAt, restarted: true, restartOf: run.id });
  }

  /** Close the least recently used waiting run when every slot is taken. */
  makeRoom() {
    if (this.runs.size < this.maxRuns) return true;
    const waiting = [...this.runs.values()]
      .filter((run) => run.state === 'idle' || run.state === 'awaiting_tools' || run.state === 'finishing')
      .sort((a, b) => a.lastUsed - b.lastUsed);
    if (waiting.length === 0) return false;
    waiting[0].close('made room for another conversation');
    return true;
  }

  /** What the MCP endpoint needs for one run, or null for an unknown or closed one. */
  mcpTarget(runId, version) {
    const run = this.runs.get(runId);
    if (!run) return null;
    return {
      secret: run.secret,
      sessionId: run.id,
      version,
      tools: run.tools,
      callTool: (call) => run.callTool(call),
      onAbandon: (toolUseId) => run.onToolAbandoned(toolUseId),
    };
  }

  closeAll(reason = 'CafAI Bridge is stopping') {
    for (const run of [...this.runs.values()]) {
      run.close(reason, { status: 503, type: 'api_error', message: 'CafAI Bridge stopped. Start it again on your computer.' });
    }
  }
}
