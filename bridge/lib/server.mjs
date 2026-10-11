// CafAI Bridge's HTTP server: the Anthropic Messages API on the LAN, answered
// by the user's own Claude Code (protocol 1, docs/superpowers/specs/2026-10-11-local-claude-design.md).
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { claudeAuthStatus, EFFORTS, findClaude, probeClaude } from './claude.mjs';
import { normalizeCode } from './config.mjs';
import { handleMcpPost } from './mcp.mjs';
import { RunManager } from './runs.mjs';
import { mapCliFailure } from './translate.mjs';

export const PROTOCOL = 1;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;
// The API caps a tool name at 64 characters; Claude Code prefixes ours with mcp__cafai__ (12).
const TOOL_NAME = /^[A-Za-z0-9_-]{1,52}$/;
const BAD_CODE = 'CafAI Bridge did not accept that code. Check the code it shows on your computer.';
const NO_CLAUDE =
  'Claude Code is not installed on this computer, or CafAI Bridge cannot find it. Install it from https://claude.com/claude-code, sign in, and restart the bridge.';

function errorBody(type, message) {
  return { type: 'error', error: { type, message } };
}

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function sendError(res, status, type, message, headers) {
  sendJson(res, status, errorBody(type, message), headers);
}

function isLoopback(address) {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Five wrong codes from one address within ten minutes lock it out for a
 * minute, doubling up to fifteen: the code has 40 bits, so guessing stays hopeless.
 */
export function createCodeLimiter({ maxFailures = 5, windowMs = 10 * 60_000, baseLockMs = 60_000, maxLockMs = 15 * 60_000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    lockedFor(address) {
      const entry = entries.get(address);
      return entry && entry.until > now() ? entry.until - now() : 0;
    },
    fail(address) {
      const t = now();
      const entry = entries.get(address) ?? { fails: [], until: 0, lock: baseLockMs };
      entry.fails = entry.fails.filter((at) => t - at < windowMs);
      entry.fails.push(t);
      if (entry.fails.length >= maxFailures) {
        entry.until = t + entry.lock;
        entry.lock = Math.min(entry.lock * 2, maxLockMs);
        entry.fails = [];
      }
      entries.set(address, entry);
    },
    succeed(address) {
      entries.delete(address);
    },
  };
}

/**
 * A streamed reply (`stream: true`): Anthropic's SSE, with pings while Claude
 * Code thinks. Opened when a run takes the request, so a refusal before that
 * (every slot busy) still gets a real HTTP status.
 */
function sseSink(res, pingMs) {
  let opened = false;
  let timer = null;
  let done = false;
  const closers = [];
  const write = (event) => {
    if (!res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const open = () => {
    if (opened || done) return;
    opened = true;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.socket?.setNoDelay(true);
    // CafAI's provider times out with no byte in 60 s and with 90 s between
    // chunks; thinking happens before the first block CafAI sees.
    write({ type: 'ping' });
    timer = setInterval(() => write({ type: 'ping' }), pingMs);
  };
  res.on('close', () => {
    clearInterval(timer);
    if (done) return;
    done = true;
    for (const listener of closers) listener();
  });
  return {
    get closed() {
      return done;
    },
    open,
    event(event) {
      open();
      write(event);
    },
    fail(failure) {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (!opened) {
        sendError(res, failure.status, failure.type, failure.message);
        return;
      }
      write({ type: 'error', error: { type: failure.type, message: failure.message } });
      res.end();
    },
    end() {
      if (done) return;
      open();
      done = true;
      clearInterval(timer);
      res.end();
    },
    onClose(listener) {
      closers.push(listener);
    },
  };
}

/** A plain reply (`stream: false`): the events folded into one Message. */
function jsonSink(res) {
  const message = { id: '', type: 'message', role: 'assistant', model: '', content: [], stop_reason: null, stop_sequence: null, usage: {} };
  const partial = new Map();
  let done = false;
  const closers = [];
  res.on('close', () => {
    if (done) return;
    done = true;
    for (const listener of closers) listener();
  });
  return {
    get closed() {
      return done;
    },
    open() {},
    event(event) {
      switch (event.type) {
        case 'message_start':
          message.id = event.message.id;
          message.model = event.message.model;
          message.usage = { ...event.message.usage };
          break;
        case 'content_block_start':
          message.content[event.index] = { ...event.content_block };
          if (event.content_block.type === 'tool_use') partial.set(event.index, '');
          break;
        case 'content_block_delta': {
          const block = message.content[event.index];
          if (!block) break;
          if (event.delta.type === 'text_delta') block.text = String(block.text ?? '') + event.delta.text;
          if (event.delta.type === 'input_json_delta') partial.set(event.index, (partial.get(event.index) ?? '') + event.delta.partial_json);
          break;
        }
        case 'content_block_stop': {
          const json = partial.get(event.index);
          if (json !== undefined && message.content[event.index]) {
            try {
              message.content[event.index].input = json.trim() === '' ? {} : JSON.parse(json);
            } catch {
              message.content[event.index].input = {};
            }
          }
          break;
        }
        case 'message_delta':
          message.stop_reason = event.delta.stop_reason;
          message.stop_sequence = event.delta.stop_sequence ?? null;
          Object.assign(message.usage, event.usage);
          break;
        default:
      }
    },
    fail(failure) {
      if (done) return;
      done = true;
      sendError(res, failure.status, failure.type, failure.message);
    },
    end() {
      if (done) return;
      done = true;
      message.content = message.content.filter(Boolean);
      sendJson(res, 200, message);
    },
    onClose(listener) {
      closers.push(listener);
    },
  };
}

/**
 * Check a Messages API body and reduce it to what the runs use.
 * @returns {{ ok: true, request: import('./runs.mjs').BridgeRequest, stream: boolean } | { ok: false, message: string }}
 */
export function parseMessagesBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'The request body must be a JSON object.' };
  if (typeof body.model !== 'string' || !MODEL_ID.test(body.model.trim())) return { ok: false, message: 'model: a model id is required.' };
  if (!Array.isArray(body.messages) || body.messages.length === 0) return { ok: false, message: 'messages: at least one message is required.' };
  for (const message of body.messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
      return { ok: false, message: 'messages: every message needs the role "user" or "assistant".' };
    }
    if (typeof message.content !== 'string' && !Array.isArray(message.content)) {
      return { ok: false, message: 'messages: every message needs content.' };
    }
  }
  if (body.messages[body.messages.length - 1].role !== 'user') return { ok: false, message: 'messages: the last message must be from the user.' };
  let system = '';
  if (typeof body.system === 'string') system = body.system;
  else if (Array.isArray(body.system)) {
    system = body.system
      .filter((block) => block && block.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('\n\n');
  }
  const tools = [];
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) return { ok: false, message: 'tools: must be a list.' };
    for (const tool of body.tools) {
      if (!tool || typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name)) {
        return { ok: false, message: `tools: "${tool?.name}" is not a tool name CafAI Bridge can serve (letters, digits, _ and -, at most 52).` };
      }
      // Server tools (web search and the like) have a `type` and no schema; Claude Code's tools are off.
      if (tool.type && tool.type !== 'custom') continue;
      tools.push({ name: tool.name, description: typeof tool.description === 'string' ? tool.description : '', input_schema: tool.input_schema });
    }
  }
  const effort = typeof body.output_config?.effort === 'string' && EFFORTS.includes(body.output_config.effort) ? body.output_config.effort : null;
  const maxTokens = Number.isInteger(body.max_tokens) && body.max_tokens > 0 ? body.max_tokens : undefined;
  return {
    ok: true,
    stream: body.stream === true,
    request: { model: body.model.trim(), maxTokens, system, messages: body.messages, tools, effort },
  };
}

/**
 * Start the bridge.
 * @param {object} options
 * @param {string} options.code  The pairing code CafAI must send.
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string | null} [options.claudePath]
 * @param {number} [options.maxRuns]
 * @param {number} [options.idleMinutes]
 * @param {boolean} [options.allowApiKey]
 * @param {string} options.workDir
 * @param {string} options.version
 * @param {(line: string) => void} [options.log]
 * @param {() => void} [options.onShutdownRequest]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {{ firstEventMs?: number, stallMs?: number, pingMs?: number, keepaliveMs?: number, authCacheMs?: number }} [options.timing]  For tests.
 */
export async function startBridgeServer(options) {
  const {
    code,
    port = 8877,
    host = '0.0.0.0',
    claudePath = null,
    maxRuns = 3,
    idleMinutes = 30,
    allowApiKey = false,
    workDir,
    version,
    log = () => {},
    onShutdownRequest = () => {},
    env = process.env,
    timing = {},
  } = options;
  if (!workDir) throw new Error('startBridgeServer: workDir is required.');
  const expectedCode = normalizeCode(code ?? '');
  if (expectedCode.length < 8) throw new Error('startBridgeServer: the pairing code needs 8 letters or digits.');
  mkdirSync(workDir, { recursive: true });
  // A bridge that did not stop cleanly leaves its runs' prompt and MCP files behind.
  for (const name of readdirSync(workDir)) {
    if (/^run-[0-9a-f]+-(?:system\.txt|mcp\.json)$/.test(name)) rmSync(path.join(workDir, name), { force: true });
  }

  const locate = async () => (await findClaude({ explicit: claudePath, env })).chosen;
  const manager = new RunManager({
    install: await locate(),
    workDir,
    maxRuns,
    idleMs: idleMinutes * 60_000,
    firstEventMs: timing.firstEventMs,
    stallMs: timing.stallMs,
    allowApiKey,
    env,
    log,
  });
  const limiter = createCodeLimiter();
  const pingMs = timing.pingMs ?? 10_000;
  const authCacheMs = timing.authCacheMs ?? 60_000;
  let authCache = { at: 0, value: null, install: null };
  let probing = null;

  async function install() {
    // Claude Code installed after the bridge started is picked up on the next request.
    if (!manager.install) manager.install = await locate();
    return manager.install;
  }

  async function accountStatus(found) {
    if (authCache.install === found && Date.now() - authCache.at < authCacheMs) return authCache.value;
    const value = await claudeAuthStatus(found, { env, allowApiKey });
    authCache = { at: Date.now(), value, install: found };
    return value;
  }

  async function statusBody(withProbe) {
    const found = await install();
    const account = found ? await accountStatus(found) : null;
    const usage = manager.usage();
    const problems = [];
    if (!found) problems.push(NO_CLAUDE);
    else if (account && !account.loggedIn) {
      problems.push('Claude Code is not signed in on this computer. Open a terminal there, run claude and sign in with /login.');
    } else if (account?.authMethod && /api.?key|console/i.test(account.authMethod)) {
      problems.push('Claude Code is signed in with an API key, so the coach would be billed to that key. Sign in with your Claude plan instead (run claude, then /login).');
    }
    const LIMIT = "Your Claude plan's usage limit is reached. Try again when it resets.";
    if (usage?.status === 'rejected') problems.push(LIMIT);
    const body = {
      ok: problems.length === 0,
      app: 'cafai-bridge',
      version,
      protocol: PROTOCOL,
      claude: found ? { found: true, version: found.version, path: found.path } : { found: false },
      account,
      usage,
      runs: { live: manager.liveCount(), max: maxRuns },
      problems,
    };
    if (withProbe && found) {
      // CafAI's Test names the coach's model: a Claude Code too old for it shows up here, not mid-chat.
      const model = typeof withProbe === 'string' && MODEL_ID.test(withProbe) ? withProbe : 'claude-haiku-4-5';
      probing ??= probeClaude(found, { env, workDir, allowApiKey, model }).finally(() => {
        probing = null;
      });
      const probe = await probing;
      body.probe = probe.ok
        ? probe
        : { ok: false, error: probe.said ? mapCliFailure({ status: probe.status, text: probe.said, model }).message : probe.error };
      if (!body.probe.ok) problems.push(body.probe.error);
      else if (usage?.status === 'rejected') {
        // A turn that just answered says the limit has lifted, whatever the last run saw.
        manager.noteRateLimit({ ...manager.lastRateLimit, status: 'allowed' });
        body.usage = manager.usage();
        problems.splice(problems.indexOf(LIMIT), 1);
      }
      body.ok = problems.length === 0;
    }
    return body;
  }

  async function messages(req, res) {
    let raw;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (error) {
      if (error?.tooLarge) sendError(res, 413, 'request_too_large', 'That request is too large for CafAI Bridge.');
      return;
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      sendError(res, 400, 'invalid_request_error', 'The request body is not valid JSON.');
      return;
    }
    const parsed = parseMessagesBody(body);
    if (!parsed.ok) {
      sendError(res, 400, 'invalid_request_error', parsed.message);
      return;
    }
    const found = await install();
    if (!found) {
      sendError(res, 500, 'api_error', NO_CLAUDE);
      return;
    }
    const started = Date.now();
    const sink = parsed.stream ? sseSink(res, pingMs) : jsonSink(res);
    const route = manager.handle(parsed.request, sink);
    res.on('close', () => {
      log(`POST /v1/messages ${parsed.request.model}, ${parsed.request.messages.length} messages, ${route}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    });
  }

  async function mcp(req, res, runId) {
    const target = manager.mcpTarget(runId, version);
    if (!target || !safeEqual(req.headers.authorization ?? '', `Bearer ${target.secret}`)) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST, DELETE' });
      res.end();
      return;
    }
    let rpc;
    try {
      rpc = JSON.parse(await readBody(req, MAX_MCP_BODY_BYTES));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }
    handleMcpPost(req, res, rpc, target, { keepaliveMs: timing.keepaliveMs });
  }

  function codeOf(req) {
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header !== '') return header;
    const auth = req.headers.authorization;
    return typeof auth === 'string' && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '') : '';
  }

  let closing = null;
  async function close() {
    closing ??= new Promise((resolve) => {
      manager.closeAll();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    return closing;
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://bridge.invalid');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'retry-after');
    if (req.method === 'OPTIONS') {
      const headers = {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': req.headers['access-control-request-headers'] ?? 'content-type, x-api-key, authorization',
        'access-control-max-age': '600',
      };
      // Chrome's Private Network Access preflight, for a page reaching a LAN address.
      if (req.headers['access-control-request-private-network'] === 'true') headers['access-control-allow-private-network'] = 'true';
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const remote = req.socket.remoteAddress ?? '';
    if (url.pathname.startsWith('/mcp/')) {
      if (!isLoopback(remote)) {
        res.writeHead(403);
        res.end();
        return;
      }
      await mcp(req, res, url.pathname.slice('/mcp/'.length));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, app: 'cafai-bridge', version, protocol: PROTOCOL });
      return;
    }

    const locked = limiter.lockedFor(remote);
    if (locked > 0) {
      const seconds = Math.ceil(locked / 1000);
      sendError(res, 429, 'rate_limit_error', `Too many wrong codes from this device. Try again in ${seconds} s.`, { 'retry-after': String(seconds) });
      return;
    }
    if (!safeEqual(normalizeCode(codeOf(req)), expectedCode)) {
      limiter.fail(remote);
      log(`wrong code from ${remote}`);
      sendError(res, 401, 'authentication_error', BAD_CODE);
      return;
    }
    limiter.succeed(remote);

    if (req.method === 'GET' && url.pathname === '/v1/status') {
      const probe = url.searchParams.get('probe') === '1' ? (url.searchParams.get('model') ?? true) : false;
      sendJson(res, 200, await statusBody(probe));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      await messages(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/shutdown') {
      if (!isLoopback(remote)) {
        sendError(res, 403, 'permission_error', 'CafAI Bridge can only be stopped from its own computer.');
        return;
      }
      sendJson(res, 202, { ok: true });
      setImmediate(() => {
        void close().then(() => onShutdownRequest());
      });
      return;
    }
    sendError(res, 404, 'not_found_error', `CafAI Bridge has no ${req.method} ${url.pathname}.`);
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      log(`internal error: ${error?.stack ?? error}`);
      if (!res.headersSent) sendError(res, 500, 'api_error', 'CafAI Bridge hit an internal error. Try again.');
      else res.end();
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  const address = server.address();
  manager.port = typeof address === 'object' && address ? address.port : port;
  server.on('error', (error) => log(`server error: ${error?.message ?? error}`));
  log(
    `listening on ${host}:${manager.port}; ${manager.install ? `Claude Code ${manager.install.version} at ${manager.install.path}` : 'Claude Code not found'}`,
  );

  return {
    get port() {
      return manager.port;
    },
    host,
    get claude() {
      return manager.install;
    },
    close,
  };
}
