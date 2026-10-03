# Brief: llm

Read `docs/briefs/COMMON.md` first; its rules apply.

**You own:** `src/llm/**` except `src/llm/types.ts` (read-only contract), and
`mock/anthropic/**`.

**Read:** `src/llm/types.ts` (the provider and runner contracts you
implement), `src/coach/contract.ts` (tool schemas; you convert them),
`docs/briefs/ENGINE_PROTOCOL.md` (your scripted fake must follow it
exactly), `DECISIONS.md` D23-D25, `docs/CREMA_PORT_PLAN.md` sections 4 and
10 "[5] LLM".

**Crema to port:** `advice/provider.ts` (headers, endpoint, request building,
`describeHttpError`, `extractErrorDetail`; drop the non-streaming call),
`advice/parse.ts` helpers you still need (`extractJsonObject` as a fallback),
with the Anthropic and error-mapping subset of `provider.test.ts` and the
relevant `parse.test.ts` cases.

## Facts about the Claude API (current, verified)

- `POST https://api.anthropic.com/v1/messages` with headers `content-type:
  application/json`, `x-api-key`, `anthropic-version: 2023-06-01`,
  `anthropic-dangerous-direct-browser-access: true`.
- Models: `claude-opus-5-5` (Opus 5.5, $4/$20 per MTok, DEFAULT),
  `claude-opus-5` ($5/$25), `claude-sonnet-5` ($2/$10), `claude-haiku-4-5`
  ($1/$5), `claude-fable-5-1` ($10/$50). Never append date suffixes.
- Opus 5.5 rejects forced tool use: always `tool_choice: {type: "auto"}`.
- Thinking: do NOT send a `thinking` parameter (Opus 5.5 always thinks;
  Opus 5 / Sonnet 5 / Fable 5.1 default to adaptive; Haiku 4.5 has none).
  Do not send `temperature`/`top_p`.
- Effort: `output_config: {effort: "low"|"medium"|"high"}` (inside
  `output_config`) for every model except Haiku 4.5 (errors there).
  Default `medium`.
- Strict tools: `{name, description, input_schema, strict: true}`. Every
  object needs `additionalProperties: false` and every property in
  `required`; numeric, string-length and array-length constraints are NOT
  supported in strict schemas (strip them; zod enforces them client-side).
  `anyOf` with `{type: "null"}` is supported.
- Prompt caching: top-level `cache_control: {type: "ephemeral"}` on the
  request body caches the last cacheable block. Keep system and tools stable.
- Refusal fallbacks: for `claude-opus-5` and `claude-fable-5-1` only, add
  `fallbacks: "default"` and the header `anthropic-beta:
  server-side-fallback-2026-07-01`. Not for other models.
- SSE events: `message_start` (message id, model, usage),
  `content_block_start` (`text`, `tool_use` {id, name, input:{}},
  `thinking`, `redacted_thinking`, possibly other types),
  `content_block_delta` (`text_delta` {text}, `input_json_delta`
  {partial_json}, `thinking_delta` {thinking}, `signature_delta`
  {signature}), `content_block_stop`, `message_delta` ({delta:{stop_reason},
  usage:{output_tokens}}), `message_stop`, `ping`, `error` ({error:{type,
  message}}, e.g. `overloaded_error`).
- Stop reasons: `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`,
  `refusal`, `pause_turn`.
- Thinking blocks must be replayed unchanged (with `signature`); history is
  append-only; editing earlier turns is rejected.
- Error HTTP statuses: 400 invalid_request_error, 401 authentication_error,
  403 permission_error, 404 not_found_error, 429 rate_limit_error (honor
  `retry-after`), 500 api_error, 529 overloaded_error. Body
  `{type:"error", error:{type, message}}`.

## Build (src/llm)

1. `models.ts`: `MODELS: readonly ModelInfo[]` (labels, one-line notes,
   prices, `supportsEffort`), `DEFAULT_MODEL = 'claude-opus-5-5'`,
   `modelInfo(id)` (unknown ids: a generic entry with `supportsEffort: false`).
2. `schema.ts`: `toToolDefinition(name, description, schema: z.ZodType): ToolDefinition`
   via `z.toJSONSchema` plus a strict post-pass (additionalProperties false,
   all keys required, strip unsupported keywords and `$schema`), and
   `zodValidator(schema): (input: unknown) => ToolValidation` with compact
   error text ("options: expected at most 5 items"). Test every tool schema
   in `src/coach/contract.ts`: no unsupported keyword anywhere, every object
   strict.
3. `sse.ts`: incremental SSE parser over `reader.read()` chunks: TextDecoder
   with `{stream: true}`, CRLF/LF, multi-line `data:`, comments, events split
   across chunks. Test by splitting fixtures at every byte boundary.
4. `anthropic.ts`: `createAnthropicProvider({ getApiKey: () => Promise<string | null>, fetch?, baseUrl?, timeouts?, maxRetries? = 2 }): LlmProvider`.
   - Builds the request per the facts above; `max_tokens` default 16000.
   - Streams and assembles content blocks in order, keeping every block
     exactly as received for replay (thinking text + signature,
     redacted_thinking data, unknown block types preserved as raw objects).
     Tool input: accumulate `partial_json`, `JSON.parse` at block stop (empty
     -> `{}`); unparseable -> keep the raw string so the runner can answer
     with an `INVALID_JSON` error.
   - Yields `message_start`, `text_delta`, `tool_use_start`, `block_stop`
     and finally `message_done` with the assembled `LlmAssistantTurn`.
   - Errors -> `LlmError` with plain sentences (port Crema's wording):
     no key -> `no_api_key` "Add your Anthropic API key in Settings.";
     401/403 -> `auth`; 429 -> `rate_limit`; 529/overloaded -> `overloaded`;
     5xx -> `server`; network -> `network` "Could not reach Anthropic. Check
     the tablet's internet connection."; abort -> `aborted`; bad 400/404 ->
     `bad_request` with the API's own message (e.g. unknown model).
   - Retries with backoff (1 s, 2 s, or `retry-after`) for 429/5xx/529 and
     network errors, only before anything has been yielded; never retry
     mid-stream.
   - Timeouts with AbortController + setTimeout (no `AbortSignal.timeout`):
     60 s to the first byte, 90 s idle between events; merge with the
     caller's signal by hand.
   - Never log or echo the key, not even in errors.
5. `runner.ts`: `runConversation(request: RunRequest): Promise<RunResult>`,
   exactly per the contract comments in `src/llm/types.ts`:
   - call `provider.stream`, forward `onTurnStart`/`onTextDelta`, call
     `onAppend(assistant message)` with the turn's content verbatim;
   - `tool_use` stop: for each tool_use block: unknown tool -> is_error
     result; invalid input (validate) -> is_error result with the
     validation text (INVALID_JSON wrapper for unparseable input); valid auto
     -> `execute`; valid ui -> pending. If any valid UI call is pending, stop
     and return `pendingUiCalls` + `heldResults` (do NOT append a user
     message). Otherwise append ONE user message with all tool_results and
     loop.
   - `max_tokens` with tool_use blocks -> answer them with is_error "Your
     output was cut off; answer again more briefly." and loop (bounded);
   - `refusal` -> do not append the turn; throw `LlmError('refusal', ...)`;
   - `end_turn` / `pause_turn` / `stop_sequence` -> return.
   - More than `maxModelCalls` (default 6) model calls -> throw
     `LlmError('protocol', 'The coach got stuck. Try again.')`.
   - All tool_results of one turn go in ONE user message, in tool_use order.
6. `openai.ts` (optional, last): port Crema's OpenAI / OpenAI-compatible
   provider behind `LlmProvider` only if it ports cleanly (streaming chat
   completions with tool calls translated to our blocks). Not wired to the
   UI. Skip it rather than ship something half-working.
7. `index.ts`: barrel.

## Build (mock/anthropic)

1. `sse.ts`: encoder from content blocks to an SSE event stream (text split
   into small deltas, tool input JSON split into several `input_json_delta`
   pieces, a leading empty thinking block with a deterministic signature,
   `message_start` / `message_delta` / `message_stop`, usage numbers).
2. `scenario.ts`: the scripted fake coach and request validation, EXACTLY as
   specified in `docs/briefs/ENGINE_PROTOCOL.md` ("Scripted fake model").
   Pure function `respond(requestBody, headers, memory) -> { status, events | errorBody }`
   plus a memory of produced assistant turns. Use the template and lever ids
   from the protocol; read the lever values from the last
   `[event:shot_completed]` payload.
3. `handlers.ts`: `anthropicHandlers(options?)` -> MSW
   `http.post('https://api.anthropic.com/v1/messages', ...)` returning a
   streamed `text/event-stream` body (ReadableStream with small delays between
   chunks; a `speed` option) or the JSON error. Also export a
   `resetAnthropicMock()`.

## Tests

SSE parser (byte splits); provider against the MSW handler in Node
(`setupServer` from `msw/node`): text streaming, tool_use assembly, thinking
replay data, every error mapping, retries before first byte, no retry
mid-stream, abort; request shape (headers, strict tools, `tool_choice`,
effort only where supported, fallbacks only for Opus 5 / Fable 5.1, no
thinking param); runner (auto tools loop, UI tool stop with held results,
invalid input -> is_error and retry, unknown tool, parallel tool results in
one message, max_tokens, refusal, loop cap); the scenario's whole script end
to end through the runner with a fake auto-tool executor (intake -> templates
-> shot -> ask_user -> query -> propose_adjustment -> applied).
