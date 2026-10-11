import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCodeLimiter, parseMessagesBody, startBridgeServer } from './server.mjs';
import { REPLAY_NOTE } from './translate.mjs';

const FAKE = fileURLToPath(new URL('../test/fake-claude.mjs', import.meta.url));
const CODE = 'ABCD-EFGH';
const TIMING = { firstEventMs: 6000, pingMs: 1000, keepaliveMs: 200, stallMs: 10_000, authCacheMs: 0 };

async function start({ env = {}, timing = TIMING, ...options } = {}) {
  const lines = [];
  const sharedEnv = { ...process.env, ...env };
  const bridge = await startBridgeServer({
    code: CODE,
    port: 0,
    host: '127.0.0.1',
    claudePath: FAKE,
    workDir: mkdtempSync(path.join(tmpdir(), 'cafai-bridge-server-')),
    version: 'test',
    log: (line) => lines.push(line),
    env: sharedEnv,
    timing,
    ...options,
  });
  return { bridge, env: sharedEnv, lines, url: `http://127.0.0.1:${bridge.port}` };
}

function parseSse(text) {
  return text
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data: ')))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
}

/** What CafAI's assembler (src/llm/assemble.ts) would store from the events. */
function assemble(events) {
  const content = [];
  const json = new Map();
  let stopReason = null;
  let error = null;
  for (const event of events) {
    if (event.type === 'content_block_start') {
      content[event.index] = { ...event.content_block };
      if (event.content_block.type === 'tool_use') json.set(event.index, '');
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') content[event.index].text += event.delta.text;
      if (event.delta.type === 'input_json_delta') json.set(event.index, json.get(event.index) + event.delta.partial_json);
    } else if (event.type === 'content_block_stop' && json.has(event.index)) {
      content[event.index].input = JSON.parse(json.get(event.index) || '{}');
    } else if (event.type === 'message_delta') stopReason = event.delta.stop_reason;
    else if (event.type === 'error') error = event.error;
  }
  return { message: { role: 'assistant', content }, stopReason, error, text: content.map((b) => (b.type === 'text' ? b.text : '')).join('') };
}

async function ask(base, body, { code = CODE, signal } = {}) {
  const response = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': code },
    body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 1000, stream: true, system: 'You coach espresso.', ...body }),
    signal,
  });
  const text = await response.text();
  const streamed = (response.headers.get('content-type') ?? '').includes('text/event-stream');
  const events = streamed ? parseSse(text) : [];
  return { response, events, reply: assemble(events), json: streamed ? null : JSON.parse(text) };
}

async function status(base, query = '') {
  const response = await fetch(`${base}/v1/status${query}`, { headers: { 'x-api-key': CODE } });
  return { response, body: await response.json() };
}

const user = (text) => ({ role: 'user', content: [{ type: 'text', text }] });
const TOOL = (name) => ({
  name,
  description: `The ${name} tool.`,
  input_schema: { type: 'object', properties: { shot: { type: 'string' } }, required: [], additionalProperties: false },
});

describe('CafAI Bridge', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await start();
  });
  afterAll(async () => {
    await ctx.bridge.close();
  });

  it('answers /health without a code, and says nothing about the account', async () => {
    const response = await fetch(`${ctx.url}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ ok: true, app: 'cafai-bridge', version: 'test', protocol: 1 });
  });

  it("answers a CORS preflight, Chrome's private network check included", async () => {
    const response = await fetch(`${ctx.url}/v1/messages`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://192.168.1.30:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access',
        'access-control-request-private-network': 'true',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('anthropic-dangerous-direct-browser-access');
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('refuses a wrong code with an Anthropic-shaped error', async () => {
    const { response, json } = await ask(ctx.url, { messages: [user('hi')] }, { code: 'WRONG-CODE' });
    expect(response.status).toBe(401);
    expect(json).toEqual({ type: 'error', error: { type: 'authentication_error', message: expect.stringContaining('did not accept that code') } });
  });

  it('takes the code with or without the dash, in either case', async () => {
    const response = await fetch(`${ctx.url}/v1/status`, { headers: { authorization: 'Bearer abcdefgh' } });
    expect(response.status).toBe(200);
  });

  it('reports Claude Code and the sign-in, never the email', async () => {
    const { body } = await status(ctx.url, '?probe=1');
    expect(body).toMatchObject({
      ok: true,
      app: 'cafai-bridge',
      claude: { found: true, version: '9.9.9', path: FAKE },
      account: { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' },
      problems: [],
      probe: { ok: true, model: 'claude-haiku-4-5' },
    });
    expect(JSON.stringify(body)).not.toContain('example.com');
  });

  it("probes the coach's model when Test names it, in the bridge's words when it fails", async () => {
    expect((await status(ctx.url, '?probe=1&model=claude-sonnet-5')).body.probe).toMatchObject({ ok: true, model: 'claude-sonnet-5' });
    ctx.env.FAKE_CLAUDE_PROBE = 'fail';
    try {
      const { body } = await status(ctx.url, '?probe=1');
      expect(body.ok).toBe(false);
      expect(body.probe).toEqual({ ok: false, error: "Your Claude plan's usage limit is reached. Try again later." });
      expect(body.problems).toContain(body.probe.error);
    } finally {
      delete ctx.env.FAKE_CLAUDE_PROBE;
    }
  });

  it('streams a reply without thinking blocks, pinging first', async () => {
    const { response, events, reply } = await ask(ctx.url, { messages: [user('hello one')] });
    expect(response.status).toBe(200);
    expect(events[0]).toEqual({ type: 'ping' });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['message_start', 'content_block_start', 'content_block_delta', 'message_stop']));
    expect(JSON.stringify(events)).not.toMatch(/thinking|sig-of-the-plan-org/);
    expect(reply.message.content).toEqual([{ type: 'text', text: expect.stringMatching(/^pid \d+ turn 1: hello one$/) }]);
    expect(reply.stopReason).toBe('end_turn');
  });

  it('continues the same Claude Code process for the next turn', async () => {
    // As the coach sends them: with its tools (a request without tools is a one-off, below).
    const tools = [TOOL('get_bag_history')];
    const first = await ask(ctx.url, { tools, messages: [user('first turn')] });
    const pid = /^pid (\d+)/.exec(first.reply.text)[1];
    const second = await ask(ctx.url, { tools, messages: [user('first turn'), first.reply.message, user('second turn')] });
    expect(second.reply.text).toBe(`pid ${pid} turn 2: second turn`);
  });

  it('frees the slot of a request without tools (the bag photo) once it is answered', async () => {
    const before = (await status(ctx.url)).body.runs.live;
    const { reply } = await ask(ctx.url, { messages: [user('a one-off question')] });
    expect(reply.stopReason).toBe('end_turn');
    await vi.waitFor(async () => expect((await status(ctx.url)).body.runs.live).toBeLessThanOrEqual(before), { timeout: 5000 });
  });

  it('gives up on a reply that breaks off and starts again, rather than show it twice', async () => {
    const { reply, events } = await ask(ctx.url, { tools: [TOOL('get_shot')], messages: [user('RESTART please')] });
    expect(reply.error).toEqual({ type: 'api_error', message: "Claude Code's reply broke off on your computer. Try again." });
    expect(events.filter((event) => event.type === 'message_start')).toHaveLength(1);
  });

  it('gives up on a message that was never streamed', async () => {
    const { reply } = await ask(ctx.url, { tools: [TOOL('get_shot')], messages: [user('NOT_STREAMED please')] });
    expect(reply.error).toMatchObject({ type: 'api_error', message: expect.stringContaining('broke off') });
  });

  it('replays a conversation it holds no process for', async () => {
    const { reply } = await ask(ctx.url, {
      messages: [user('roasted last week'), { role: 'assistant', content: [{ type: 'text', text: 'Said elsewhere.' }] }, user('so?')],
    });
    expect(reply.text).toMatch(/^pid \d+ turn 1: /);
    expect(reply.text).toContain(REPLAY_NOTE);
    expect(reply.text).toContain('<assistant>\nSaid elsewhere.\n</assistant>');
    expect(reply.text).toContain('Answer it as the assistant.\n\nso?');
  });

  it('holds a tool call until CafAI answers it, then carries on in the same process', async () => {
    const tools = [TOOL('get_shot')];
    const ask1 = [user('USE_TOOL:get_shot:{"shot":"latest"}')];
    const first = await ask(ctx.url, { tools, messages: ask1 });
    expect(first.reply.stopReason).toBe('tool_use');
    expect(first.reply.message.content).toEqual([{ type: 'tool_use', id: 'toolu_1_a', name: 'get_shot', input: { shot: 'latest' } }]);
    const second = await ask(ctx.url, {
      tools,
      messages: [...ask1, first.reply.message, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1_a', content: '{"peak":9.1}' }] }],
    });
    expect(second.reply.text).toBe('Tool results: get_shot => {"peak":9.1}');
    expect(second.reply.stopReason).toBe('end_turn');
  });

  it('copes with a tool call that arrives before its message ends', async () => {
    ctx.env.FAKE_CLAUDE_EARLY_CALL = '1';
    try {
      const tools = [TOOL('get_phase_stats')];
      const ask1 = [user('USE_TOOL:get_phase_stats:{"shot":"previous"}')];
      const first = await ask(ctx.url, { tools, messages: ask1 });
      expect(first.reply.stopReason).toBe('tool_use');
      const second = await ask(ctx.url, {
        tools,
        messages: [...ask1, first.reply.message, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1_a', content: 'early' }] }],
      });
      expect(second.reply.text).toBe('Tool results: get_phase_stats => early');
    } finally {
      delete ctx.env.FAKE_CLAUDE_EARLY_CALL;
    }
  });

  it('answers two tool calls from one message, in order, with an error flag kept', async () => {
    const tools = [TOOL('get_a'), TOOL('get_b')];
    const ask1 = [user('TWO_TOOLS:get_a:get_b')];
    const first = await ask(ctx.url, { tools, messages: ask1 });
    expect(first.reply.message.content.map((b) => b.id)).toEqual(['toolu_1_a', 'toolu_1_b']);
    const second = await ask(ctx.url, {
      tools,
      messages: [
        ...ask1,
        first.reply.message,
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1_a', content: 'A' },
            { type: 'tool_result', tool_use_id: 'toolu_1_b', content: 'nope', is_error: true },
          ],
        },
      ],
    });
    expect(second.reply.text).toBe('Tool results: get_a => A ; get_b (error) => nope');
  });

  it('sends text that came with a tool result along with it', async () => {
    const tools = [TOOL('ask_user')];
    const ask1 = [user('USE_TOOL:ask_user:{}')];
    const first = await ask(ctx.url, { tools, messages: ask1 });
    const second = await ask(ctx.url, {
      tools,
      messages: [
        ...ask1,
        first.reply.message,
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1_a', content: '{"answered":false,"note":"The user typed a message instead."}' },
            { type: 'text', text: 'It was sour.' },
          ],
        },
      ],
    });
    expect(second.reply.text).toBe(
      'Tool results: ask_user => {"answered":false,"note":"The user typed a message instead."} | The user\'s next message:\nIt was sour.',
    );
  });

  it('starts over with a replay when the tool results do not match the held calls', async () => {
    const tools = [TOOL('get_shot')];
    const ask1 = [user('USE_TOOL:get_shot:{"shot":"x"}')];
    const first = await ask(ctx.url, { tools, messages: ask1 });
    const second = await ask(ctx.url, {
      tools,
      messages: [...ask1, first.reply.message, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_other', content: 'stray' }] }],
    });
    // A new process replays everything; the fake sees USE_TOOL in the transcript and calls again.
    expect(second.reply.stopReason).toBe('tool_use');
  });

  it("passes a photo through to Claude Code's first message", async () => {
    const photo = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } };
    const { reply } = await ask(ctx.url, { messages: [{ role: 'user', content: [photo, { type: 'text', text: 'Read the bag.' }] }] });
    expect(reply.text).toMatch(/^pid \d+ turn 1 images 1: Read the bag\.$/);
  });

  it('says how to fix a signed-out Claude Code, streamed or not', async () => {
    const streamed = await ask(ctx.url, { messages: [user('FAIL_AUTH one')] });
    expect(streamed.response.status).toBe(200);
    expect(streamed.reply.error).toEqual({ type: 'authentication_error', message: expect.stringContaining('sign in with /login') });
    const plain = await ask(ctx.url, { stream: false, messages: [user('FAIL_AUTH two')] });
    expect(plain.response.status).toBe(401);
    expect(plain.json.error.type).toBe('authentication_error');
  });

  it('says when the plan cannot use the model', async () => {
    const { reply } = await ask(ctx.url, { model: 'claude-nonexistent-9', messages: [user('FAIL_MODEL')] });
    expect(reply.error).toEqual({ type: 'not_found_error', message: expect.stringContaining('cannot use claude-nonexistent-9') });
  });

  it('returns one Message for stream: false', async () => {
    const { response, json } = await ask(ctx.url, { stream: false, messages: [user('plain please')] });
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: expect.stringContaining('plain please') }] });
  });

  it('rejects requests the API would reject', async () => {
    const noModel = await ask(ctx.url, { model: undefined, messages: [user('x')] });
    expect(noModel.response.status).toBe(400);
    const lastAssistant = await ask(ctx.url, { messages: [user('x'), { role: 'assistant', content: 'y' }] });
    expect(lastAssistant.json.error.message).toContain('last message must be from the user');
    const flagLike = await ask(ctx.url, { model: '--dangerously-skip-permissions', messages: [user('x')] });
    expect(flagLike.response.status).toBe(400);
  });

  it('refuses MCP calls without the run secret', async () => {
    const response = await fetch(`${ctx.url}/mcp/0123456789abcdef`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
  });

  it('logs requests without their content', () => {
    const log = ctx.lines.join('\n');
    expect(log).toContain('POST /v1/messages claude-opus-5-5');
    expect(log).not.toContain('hello one');
    expect(log).not.toContain('Read the bag');
  });
});

describe('CafAI Bridge limits', () => {
  it('ends the run, and its Claude Code, when CafAI stops the request', async () => {
    const ctx = await start();
    try {
      expect((await status(ctx.url)).body.runs.live).toBe(0);
      const controller = new AbortController();
      const pending = ask(ctx.url, { messages: [user('HANG until stopped')] }, { signal: controller.signal }).catch((error) => error);
      await vi.waitFor(async () => expect((await status(ctx.url)).body.runs.live).toBe(1), { timeout: 5000 });
      controller.abort();
      await pending;
      await vi.waitFor(async () => expect((await status(ctx.url)).body.runs.live).toBe(0), { timeout: 5000 });
      expect(ctx.lines.join('\n')).toContain('closed: CafAI stopped the request');
    } finally {
      await ctx.bridge.close();
    }
  });

  it('does not lose a slot when a run cannot be prepared', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'cafai-bridge-blocked-'));
    const ctx = await start({ maxRuns: 1, workDir });
    try {
      // A file where the work folder should be: the run's files cannot be written.
      rmSync(workDir, { recursive: true, force: true });
      writeFileSync(workDir, 'not a folder');
      const broken = await ask(ctx.url, { messages: [user('first')] });
      expect(broken.response.status).toBe(500);
      expect(broken.json.error.message).toContain('could not prepare the conversation');
      expect((await status(ctx.url)).body.runs.live).toBe(0);
      rmSync(workDir, { force: true });
      mkdirSync(workDir);
      const fine = await ask(ctx.url, { tools: [TOOL('get_shot')], messages: [user('second')] });
      expect(fine.reply.text).toMatch(/turn 1: second$/);
    } finally {
      await ctx.bridge.close();
    }
  });

  it("names when the plan's limit resets, and Test forgets it once a turn answers again", async () => {
    const ctx = await start();
    try {
      const { reply } = await ask(ctx.url, { tools: [TOOL('get_shot')], messages: [user('LIMIT')] });
      expect(reply.error).toMatchObject({ type: 'rate_limit_error', message: expect.stringMatching(/usage limit is reached; it resets (at|on) /) });
      const limited = (await status(ctx.url)).body;
      expect(limited.usage.status).toBe('rejected');
      expect(limited.problems).toContain("Your Claude plan's usage limit is reached. Try again when it resets.");
      const probed = (await status(ctx.url, '?probe=1')).body;
      expect(probed).toMatchObject({ ok: true, problems: [], usage: { status: 'allowed' }, probe: { ok: true } });
      expect((await status(ctx.url)).body.problems).toEqual([]);
    } finally {
      await ctx.bridge.close();
    }
  });

  it('stops reporting the limit once its reset time has passed', async () => {
    const ctx = await start({ env: { FAKE_CLAUDE_RESET_IN_S: '-10' } });
    try {
      await ask(ctx.url, { tools: [TOOL('get_shot')], messages: [user('LIMIT')] });
      const body = (await status(ctx.url)).body;
      expect(body.usage.status).toBe('allowed');
      expect(body.problems).toEqual([]);
    } finally {
      await ctx.bridge.close();
    }
  });

  it('gives up on a Claude Code that never answers', async () => {
    const ctx = await start({ timing: { ...TIMING, firstEventMs: 700 } });
    try {
      const { reply } = await ask(ctx.url, { messages: [user('HANG')] });
      expect(reply.error).toEqual({ type: 'api_error', message: expect.stringContaining('did not answer') });
    } finally {
      await ctx.bridge.close();
    }
  });

  it('closes an idle conversation for a new one, and says busy when none is idle', async () => {
    const ctx = await start({ maxRuns: 1 });
    try {
      const done = await ask(ctx.url, { messages: [user('one conversation')] });
      expect(done.reply.stopReason).toBe('end_turn');
      const controller = new AbortController();
      const hanging = ask(ctx.url, { messages: [user('HANG second conversation')] }, { signal: controller.signal }).catch((error) => error);
      await vi.waitFor(async () => expect((await status(ctx.url)).body.runs.live).toBe(1), { timeout: 5000 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const busy = await ask(ctx.url, { messages: [user('third conversation')] });
      expect(busy.response.status).toBe(503);
      expect(busy.json.error.type).toBe('overloaded_error');
      controller.abort();
      await hanging;
    } finally {
      await ctx.bridge.close();
    }
  });

  it('locks a device out after five wrong codes', async () => {
    const ctx = await start();
    try {
      for (let i = 0; i < 5; i++) expect((await ask(ctx.url, { messages: [user('x')] }, { code: 'NOPE' })).response.status).toBe(401);
      const locked = await ask(ctx.url, { messages: [user('x')] });
      expect(locked.response.status).toBe(429);
      expect(Number(locked.response.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await ctx.bridge.close();
    }
  });

  it('stops when asked from its own computer', async () => {
    const onShutdownRequest = vi.fn();
    const ctx = await start({ onShutdownRequest });
    const response = await fetch(`${ctx.url}/v1/shutdown`, { method: 'POST', headers: { 'x-api-key': CODE } });
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(onShutdownRequest).toHaveBeenCalled(), { timeout: 5000 });
    await expect(fetch(`${ctx.url}/health`)).rejects.toThrow();
  });
});

describe('createCodeLimiter', () => {
  it('locks for a minute, then doubles', () => {
    let now = 0;
    const limiter = createCodeLimiter({ now: () => now });
    for (let i = 0; i < 5; i++) limiter.fail('a');
    expect(limiter.lockedFor('a')).toBe(60_000);
    now = 61_000;
    expect(limiter.lockedFor('a')).toBe(0);
    for (let i = 0; i < 5; i++) limiter.fail('a');
    expect(limiter.lockedFor('a')).toBe(120_000);
    limiter.succeed('a');
    expect(limiter.lockedFor('a')).toBe(0);
  });
});

describe('parseMessagesBody', () => {
  it('reads what CafAI sends and ignores what Claude Code cannot take', () => {
    const parsed = parseMessagesBody({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }],
      messages: [user('hi')],
      tools: [{ ...TOOL('save_bag_details'), strict: true }],
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
      stream: true,
    });
    expect(parsed).toEqual({
      ok: true,
      stream: true,
      request: {
        model: 'claude-opus-5-5',
        maxTokens: 16000,
        system: 'A\n\nB',
        messages: [user('hi')],
        tools: [{ name: 'save_bag_details', description: 'The save_bag_details tool.', input_schema: TOOL('x').input_schema }],
        effort: 'medium',
      },
    });
    expect(parseMessagesBody({ model: 'm', messages: [user('x')], tools: [{ name: 'a'.repeat(53) }] }).ok).toBe(false);
  });
});
