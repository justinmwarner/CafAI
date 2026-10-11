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

const DEFAULTS = {
  firstEventMs: 90_000,
  stallMs: 180_000,
  idleMs: 30 * 60_000,
};

/**
 * @typedef {object} Sink  Where one HTTP request's reply goes.
 * @property {() => void} open  A run has taken the request: start the reply (headers, pings).
 * @property {(event: object) => void} event
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
    .update(JSON.stringify([request.model, request.effort ?? null, request.system, tools]))
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
    this.timers = { firstEvent: null, idle: null, stall: null };
    this.child = null;
  }

  log(text) {
    this.manager.log(`run ${this.id.slice(0, 6)}: ${text}`);
  }

  /** Spawn Claude Code and send the first message. */
  start(request, fingerprints, sink) {
    const { workDir, install } = this.manager;
    mkdirSync(workDir, { recursive: true });
    const systemFile = path.join(workDir, `run-${this.id}-system.txt`);
    writeFileSync(systemFile, `${request.system}${this.tools.length > 0 ? TOOL_NOTE : ''}`, 'utf8');
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
    const args = buildRunArgs({ model: request.model, effort: request.effort, systemPromptFile: systemFile, mcpConfigFile: mcpFile });
    const env = childEnv(this.manager.env, { allowApiKey: this.manager.allowApiKey });
    if (request.maxTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(request.maxTokens);

    this.transcript = [...fingerprints];
    this.attach(sink);
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

    const last = request.messages[request.messages.length - 1];
    const content = request.messages.length === 1 ? toCliContent(last) : flattenConversation(request.messages);
    this.write(cliUserLine(content));
    this.log(
      `started for a ${request.messages.length === 1 ? 'new conversation' : `conversation of ${request.messages.length} messages (replayed)`}, ${request.model}`,
    );
  }

  write(line) {
    this.inTurn = true;
    this.child?.stdin.write(line);
  }

  attach(sink) {
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
    clearTimeout(this.timers.firstEvent);
    this.timers.firstEvent = setTimeout(() => {
      this.close('no answer from Claude Code', {
        status: 500,
        type: 'api_error',
        message: 'Claude Code on your computer did not answer. Update it (claude update) and try again.',
      });
    }, this.manager.firstEventMs);
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
    clearTimeout(this.timers.firstEvent);
    clearTimeout(this.timers.idle);
    this.timers.idle = setTimeout(() => this.close('idle'), this.manager.idleMs);
    sink?.end();
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
          clearTimeout(this.timers.firstEvent);
          this.transformer = createStreamTransformer();
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
    this.transformer = null;
    if (!transformer) return;
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
    clearTimeout(this.timers.firstEvent);
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
    clearTimeout(this.timers.firstEvent);
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
   * @param {number} [options.firstEventMs]
   * @param {number} [options.stallMs]
   * @param {boolean} [options.allowApiKey]
   * @param {NodeJS.ProcessEnv} [options.env]
   * @param {(line: string) => void} [options.log]
   */
  constructor({ install, workDir, maxRuns = 3, idleMs, firstEventMs, stallMs, allowApiKey = false, env = process.env, log = () => {} }) {
    this.install = install;
    this.workDir = workDir;
    this.maxRuns = maxRuns;
    this.idleMs = idleMs ?? DEFAULTS.idleMs;
    this.firstEventMs = firstEventMs ?? DEFAULTS.firstEventMs;
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
        run.answerTools(last, fingerprints[fingerprints.length - 1], sink);
        return 'tools';
      }
      if ((run.state === 'idle' || run.state === 'finishing') && results.length === 0) {
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
    const run = new Run(this, request);
    this.runs.set(run.id, run);
    try {
      run.start(request, fingerprints, sink);
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
    return 'new';
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
