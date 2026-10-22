#!/usr/bin/env node
// A stand-in for `claude` in the bridge's tests: the same stream-json lines
// and MCP calls as Claude Code 2.1.251 (see the design doc's experiments),
// driven by markers in the user's text.
//
//   USE_TOOL:<name>:<json>   one coach-tool call, then a reply quoting its result
//   TWO_TOOLS:<a>:<b>        two calls in one message, answered in order
//   WEB_SEARCH               first a sentence and Claude Code's own search, as 2.1.301 streamed
//                            them (claude-web-search.jsonl), when --tools and --allowedTools
//                            have WebSearch (else "(no WebSearch)" in the reply); then as above
//   FAIL_AUTH                a signed-out failure
//   FAIL_MODEL               an unknown-model failure
//   LIMIT                    the plan's usage limit (a rejected rate limit, then the failure)
//   RESTART                  a reply that breaks off and starts again mid-stream
//   NOT_STREAMED             a whole message with no stream events (a plain-request fallback)
//   HANG                     never answers
//   anything else            "pid <pid> turn <n>: <the text>"
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const out = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

if (argv.includes('--version')) {
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? '9.9.9'} (Claude Code)\n`);
  process.exit(0);
}

if (argv[0] === 'auth' && argv[1] === 'status') {
  const mode = process.env.FAKE_CLAUDE_AUTH ?? 'in';
  const status =
    mode === 'out'
      ? { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }
      : { loggedIn: true, authMethod: mode === 'apikey' ? 'api_key' : 'claude.ai', email: 'someone@example.com', orgId: 'org-1', subscriptionType: 'max' };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  process.exit(mode === 'out' ? 1 : 0);
}

const model = flag('--model') ?? 'claude-test';
const listed = (name) => (flag(name) ?? '').split(/[\s,]+/).includes('WebSearch');
const webSearchOn = listed('--tools') && listed('--allowedTools');

/** The capture's search: from the request after init through the search's result, before the coach's tool call. */
function searchLines() {
  const capture = readFileSync(new URL('./claude-web-search.jsonl', import.meta.url), 'utf8').split('\n').filter((line) => line.trim() !== '');
  return capture.slice(1, capture.findIndex((line) => line.includes('"api_message_id":"msg_fact"')));
}

if (flag('--output-format') === 'json') {
  // The connection probe.
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    if (process.env.FAKE_CLAUDE_PROBE === 'hang') {
      setInterval(() => {}, 1000);
      return;
    }
    const failed = process.env.FAKE_CLAUDE_PROBE === 'fail';
    out({ type: 'result', subtype: 'success', is_error: failed, result: failed ? 'Claude AI usage limit reached' : 'OK', echoed: input.length });
    process.exit(failed ? 1 : 0);
  });
} else {
  await streamJson();
}

async function streamJson() {
  let mcp = null;
  const configFile = flag('--mcp-config');
  if (configFile) {
    const server = JSON.parse(readFileSync(configFile, 'utf8')).mcpServers.cafai;
    mcp = { url: server.url, headers: server.headers ?? {}, nextId: 1, tools: [] };
    await rpc(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake-claude', version: '9.9.9' } });
    await notify(mcp, 'notifications/initialized');
    mcp.tools = (await rpc(mcp, 'tools/list', {})).tools;
  }
  if (process.env.FAKE_CLAUDE_SYSTEM_ECHO === '1') {
    process.stderr.write(readFileSync(flag('--system-prompt-file'), 'utf8'));
  }

  const queue = [];
  let busy = false;
  let turn = 0;
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (line.trim() === '') return;
    queue.push(JSON.parse(line));
    void pump();
  });
  lines.on('close', () => {
    const wait = setInterval(() => {
      if (!busy && queue.length === 0) {
        clearInterval(wait);
        process.exit(0);
      }
    }, 20);
  });

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length > 0) {
      const message = queue.shift();
      turn += 1;
      await answer(message, turn);
    }
    busy = false;
  }

  async function answer(line, n) {
    const content = Array.isArray(line.message.content) ? line.message.content : [{ type: 'text', text: line.message.content }];
    const text = content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    out({
      type: 'system',
      subtype: 'init',
      model,
      tools: [...(webSearchOn ? ['WebSearch'] : []), ...(mcp?.tools ?? []).map((tool) => `mcp__cafai__${tool.name}`)],
      mcp_servers: mcp ? [{ name: 'cafai', status: 'connected' }] : [],
      apiKeySource: 'none',
    });
    if (text.includes('HANG')) return new Promise(() => {});
    if (text.includes('LIMIT')) {
      out({ type: 'rate_limit_event', rate_limit_info: rateLimit('rejected', 1.0) });
      const said = 'Claude AI usage limit reached';
      out({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: said }] }, error: 'rate_limit', is_api_error_message: true });
      out({ type: 'result', subtype: 'success', is_error: true, result: said, api_error_status: 429, terminal_reason: 'api_error' });
      return;
    }
    if (text.includes('RESTART')) {
      event({ type: 'message_start', message: { id: `msg_${n}_a`, type: 'message', role: 'assistant', model, content: [], usage: {} } });
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half a sen' } });
      startMessage(`msg_${n}_b`, [{ kind: 'text', text: 'The whole sentence again.' }]);
      finishMessage('end_turn');
      out({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
      return;
    }
    if (text.includes('NOT_STREAMED')) {
      out({ type: 'assistant', message: { id: `msg_${n}_plain`, model, role: 'assistant', content: [{ type: 'text', text: 'Never streamed.' }] } });
      out({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
      return;
    }
    if (text.includes('FAIL_AUTH') || text.includes('FAIL_MODEL')) {
      const auth = text.includes('FAIL_AUTH');
      const said = auth
        ? 'Anthropic profile login expired · Run /login to use your claude.ai account instead, or re-authenticate the profile'
        : `There's an issue with the selected model (${model}). It may not exist or you may not have access to it. Run --model to pick a different model.`;
      out({
        type: 'assistant',
        message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: said }] },
        error: auth ? 'invalid_request' : 'model_not_found',
        is_api_error_message: true,
      });
      out({ type: 'result', subtype: 'success', is_error: true, result: said, api_error_status: auth ? null : 404, terminal_reason: 'api_error' });
      return;
    }

    const searching = text.includes('WEB_SEARCH');
    if (searching && webSearchOn) {
      // This turn's own ids, so a second search in the process is a message of its own.
      for (const raw of searchLines()) process.stdout.write(`${raw.replace(/"(msg|toolu|srvtoolu)_search"/g, `"$1_search_${n}"`)}\n`);
    }

    const images = content.filter((block) => block.type === 'image').length;
    const tool = /USE_TOOL:([A-Za-z0-9_-]+):(\{.*\})/.exec(text);
    const two = /TWO_TOOLS:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)/.exec(text);
    if (tool || two) {
      const calls = tool
        ? [{ id: `toolu_${n}_a`, name: tool[1], input: JSON.parse(tool[2]) }]
        : [
            { id: `toolu_${n}_a`, name: two[1], input: { which: 'a' } },
            { id: `toolu_${n}_b`, name: two[2], input: { which: 'b' } },
          ];
      const results = [];
      const callAll = async () => {
        for (const call of calls) {
          const meta = process.env.FAKE_CLAUDE_NO_META === '1' ? {} : { 'claudecode/toolUseId': call.id };
          const result = await rpc(mcp, 'tools/call', { name: call.name, arguments: call.input, _meta: meta });
          out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: result.content, is_error: result.isError === true }] } });
          results.push(`${call.name}${result.isError ? ' (error)' : ''} => ${result.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join(' | ')}`);
        }
      };
      startMessage(`msg_${n}_1`, calls.map((call) => ({ kind: 'tool', ...call })));
      if (process.env.FAKE_CLAUDE_EARLY_CALL === '1') {
        // Claude Code calls the tool as soon as its block is complete, before the message ends.
        const calling = callAll();
        await new Promise((resolve) => setTimeout(resolve, 50));
        finishMessage('tool_use');
        await calling;
      } else {
        finishMessage('tool_use');
        await callAll();
      }
      startMessage(`msg_${n}_2`, [{ kind: 'text', text: `Tool results: ${results.join(' ; ')}` }]);
      finishMessage('end_turn');
    } else {
      const said = `pid ${process.pid} turn ${n}${images ? ` images ${images}` : ''}${searching && !webSearchOn ? ' (no WebSearch)' : ''}: ${text}`;
      startMessage(`msg_${n}_1`, [{ kind: 'text', text: said }]);
      finishMessage('end_turn');
    }
    out({ type: 'result', subtype: 'success', is_error: false, result: 'done', stop_reason: 'end_turn' });
  }

  function event(e) {
    out({ type: 'stream_event', event: e, parent_tool_use_id: null, session_id: 'fake' });
  }

  /** The shape Claude Code 2.1.251 sends: the binding window on top, every window below. */
  function rateLimit(status, fiveHour) {
    const resetsAt = Math.floor(Date.now() / 1000) + Number(process.env.FAKE_CLAUDE_RESET_IN_S ?? 3600);
    return {
      status,
      resetsAt,
      rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: fiveHour, resetsAt }, seven_day: { utilization: 0.3, resetsAt: resetsAt + 86400 } },
    };
  }

  function finishMessage(stopReason) {
    event({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
    event({ type: 'message_stop' });
  }

  function startMessage(id, parts) {
    event({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 10, output_tokens: 1 } } });
    out({ type: 'rate_limit_event', rate_limit_info: rateLimit('allowed', 0.12) });
    // Every reply opens with a thinking block, as with the real models.
    event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
    event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } });
    event({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-of-the-plan-org' } });
    event({ type: 'content_block_stop', index: 0 });
    parts.forEach((part, i) => {
      const index = i + 1;
      if (part.kind === 'text') {
        event({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        const half = Math.ceil(part.text.length / 2);
        event({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part.text.slice(0, half) } });
        event({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part.text.slice(half) } });
      } else {
        event({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: part.id, name: `mcp__cafai__${part.name}`, input: {}, caller: { type: 'direct' } } });
        const json = JSON.stringify(part.input);
        event({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(0, 3) } });
        event({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(3) } });
      }
      event({ type: 'content_block_stop', index });
    });
  }
}

async function post(mcp, payload) {
  const response = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...mcp.headers },
    body: JSON.stringify(payload),
  });
  return response;
}

async function rpc(mcp, method, params) {
  const id = mcp.nextId++;
  const response = await post(mcp, { jsonrpc: '2.0', id, method, params });
  if (!response.ok) throw new Error(`MCP ${method} answered ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  const body = await response.text();
  let message;
  if (type.includes('text/event-stream')) {
    const data = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .pop();
    message = JSON.parse(data);
  } else {
    message = JSON.parse(body);
  }
  if (message.error) throw new Error(message.error.message);
  return message.result;
}

async function notify(mcp, method) {
  await post(mcp, { jsonrpc: '2.0', method });
}
