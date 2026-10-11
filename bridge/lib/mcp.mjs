// The coach's tools, served to one Claude Code run as an MCP server over HTTP
// (Streamable HTTP, the subset Claude Code uses). Claude Code reaches it on
// 127.0.0.1 with the run's own secret; nothing else can.
//
// A `tools/call` is answered when CafAI sends the tool_result, which can be
// minutes later (a card waiting for a tap). The answer goes out as a
// one-event SSE stream with a comment every 10 s: Claude Code gave up on a
// plain JSON reply held for about six minutes, but waits on a stream.

export const MCP_KEEPALIVE_MS = 10_000;

function sendRpc(res, id, payload, headers = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, ...payload });
  res.writeHead(200, { 'content-type': 'application/json', ...headers });
  res.end(body);
}

/**
 * @typedef {object} McpTarget
 * @property {string} sessionId
 * @property {string} version
 * @property {Array<{ name: string, description?: string, input_schema?: object }>} tools
 * @property {(call: { name: string, args: unknown, toolUseId: string | null }) => Promise<{ content: object[], isError?: boolean }>} callTool
 * @property {(toolUseId: string | null) => void} onAbandon  Claude Code went away before the answer.
 */

/**
 * Answer one JSON-RPC message POSTed by Claude Code.
 * @param {import('node:http').IncomingMessage} _req
 * @param {import('node:http').ServerResponse} res
 * @param {any} rpc
 * @param {McpTarget} target
 */
export function handleMcpPost(_req, res, rpc, target, { keepaliveMs = MCP_KEEPALIVE_MS } = {}) {
  const session = { 'mcp-session-id': target.sessionId };
  if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) {
    sendRpc(res, null, { error: { code: -32600, message: 'Invalid request' } }, session);
    return;
  }
  // Notifications and responses need no answer.
  if (rpc.id === undefined || rpc.id === null || typeof rpc.method !== 'string') {
    res.writeHead(202, session);
    res.end();
    return;
  }
  const { id, method, params } = rpc;
  switch (method) {
    case 'initialize':
      sendRpc(
        res,
        id,
        {
          result: {
            protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'cafai', title: 'CafAI coach tools', version: target.version },
          },
        },
        session,
      );
      return;
    case 'ping':
      sendRpc(res, id, { result: {} }, session);
      return;
    case 'tools/list':
      sendRpc(
        res,
        id,
        {
          result: {
            tools: target.tools.map((tool) => ({
              name: tool.name,
              description: tool.description ?? '',
              inputSchema: tool.input_schema && typeof tool.input_schema === 'object' ? tool.input_schema : { type: 'object' },
            })),
          },
        },
        session,
      );
      return;
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : '';
      if (!target.tools.some((tool) => tool.name === name)) {
        sendRpc(res, id, { result: { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true } }, session);
        return;
      }
      const meta = params?._meta;
      const toolUseId = meta && typeof meta['claudecode/toolUseId'] === 'string' ? meta['claudecode/toolUseId'] : null;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...session });
      res.write(': waiting for CafAI\n\n');
      const timer = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n');
      }, keepaliveMs);
      let settled = false;
      res.on('close', () => {
        clearInterval(timer);
        if (!settled) {
          settled = true;
          target.onAbandon(toolUseId);
        }
      });
      target
        .callTool({ name, args: params?.arguments ?? {}, toolUseId })
        .then(
          (result) => result,
          (error) => ({ content: [{ type: 'text', text: String(error?.message ?? error) }], isError: true }),
        )
        .then((result) => {
          clearInterval(timer);
          if (settled || res.writableEnded) return;
          settled = true;
          res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`);
        });
      return;
    }
    default:
      // Includes the `server/discover` probe Claude Code sends first.
      sendRpc(res, id, { error: { code: -32601, message: `Method not found: ${method}` } }, session);
  }
}
