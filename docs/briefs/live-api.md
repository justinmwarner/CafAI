# Workstream: live-api (opt-in smoke test against the real Anthropic API)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own").

## Goal

Nothing in CafAI has ever talked to the real Anthropic API (QUESTIONS #2: is
`claude-opus-5-5` the right default; the owner keeps it, the user can pick
another in Settings). Add an **opt-in** smoke test that runs CafAI's own
client, prompt and tools against the live API, so the owner can prove the
real request shape works with one command:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run test:live
```

- The key comes only from the `ANTHROPIC_API_KEY` environment variable.
- With the variable unset the suite is **skipped** (reported as skipped, exit
  code 0), so CI and everyone without a key are unaffected.
- `npm test` (and so `npm run verify`) must never pick the live test up, even
  when `ANTHROPIC_API_KEY` happens to be set: many developer machines set it
  for other tools, and a silent paid call on every unit run is not opt-in.
- The key is never committed, logged, printed, written to a file, or put in
  a test name, snapshot or assertion message.

## You own (create or modify only these)

- `src/llm/live/` (new directory): the live test file(s), named `*.live.ts`
  (NOT `*.test.ts`, so the default Vitest include never matches them), and
  any helper modules they need.
- `vitest.live.config.ts` (new, repo root): a standalone Vitest config whose
  `include` is only `src/**/*.live.ts`, Node environment, generous timeouts
  (e.g. 120 s per test), no retries.
- `package.json`: add the single script `"test:live": "vitest run --config vitest.live.config.ts"`.
  No dependency changes, no other script changes.
- `tsconfig.json`: only add `vitest.live.config.ts` to `include` (next to
  `vite.config.ts`) so it is typechecked.

Everything else is read-only, in particular all existing files under
`src/llm/`, `src/coach/`, `src/app/`, `mock/`, `vite.config.ts` and
`eslint.config.js`. If the client needs a change to run in Node, do not make
it: report it.

## Interfaces to use (do not change them)

- `createAnthropicProvider({ getApiKey, fetch? })` (`src/llm/anthropic.ts`),
  `runConversation()` (`src/llm/runner.ts`), `toToolDefinition`,
  `zodValidator`, `DEFAULT_MODEL`, `MODELS`, `resolveModel` (`src/llm/index.ts`).
- `buildSystemPrompt(TEMPLATES)`, `COACH_TOOL_SPECS`, `TEMPLATES`
  (`src/coach/index.ts`); `TOOL`, `TOOL_INPUTS`, `AUTO_TOOLS`, `TEMPLATE_IDS`
  (`src/coach/contract.ts`).
- `intakeBlocks()`, `toolResult()` (`src/app/engine/protocol.ts`) to build the
  same user turns the engine sends (`docs/briefs/ENGINE_PROTOCOL.md`).
- Build the nine `RunnerTool`s the way `src/app/engine/engine.ts` does
  (strict tool definitions, `kind: 'auto'` for AUTO_TOOLS with a stub
  `execute` that answers `save_bag_details` with `{"saved":true}` and query
  tools with a small "no shots yet" error result, `kind: 'ui'` for the rest).

## What the live suite checks (default: at most 3 API calls)

1. **Intake turn on the default model.** Send a bag description through
   `intakeBlocks()` with `DEFAULT_MODEL`, effort `medium`, CafAI's system
   prompt and all nine strict tools (`tool_choice` auto, as the client always
   sends). Assert: the run completes; every tool input the model produced
   passed zod (the runner already rejects invalid ones; assert none came back
   as an error result if you can observe it, or that the pending
   `propose_templates` input parses with `TOOL_INPUTS` and names 2-5 ids from
   `TEMPLATE_IDS`); a `propose_templates` call is pending.
2. **Replay.** Append the user turn the engine would send after a template
   pick (the held results plus a `tool_result` for `propose_templates` with
   the `TemplatePickedPayload` shape from ENGINE_PROTOCOL rule 2) and run
   again on the stored transcript, unchanged. Assert it completes (the API
   accepted thinking blocks and signatures replayed byte for byte, D25).
3. **Picker ids (only when `LIVE_ALL_MODELS=1`).** One tiny streamed request
   per entry in `MODELS`, so the owner can confirm every id in Settings
   exists on their account and that `supportsEffort` is right for each.

Print nothing but Vitest's own output. When a call fails, the assertion
message may include the API's error type and message (never request headers),
and must pass through a scrubber that replaces the key with `[key]`; test
that scrubber.

## Prove the harness without a key

You cannot reach the real API from here. Add a **dry run**: when
`LIVE_DRY_RUN=1` is set, the same suite runs against CafAI's scripted fake
model (`mock/anthropic`, served in Node through MSW; see `mock/node.ts` and
`mock/anthropic/handlers.ts`) with a dummy key, through the provider's
`fetch` option or MSW's interception. The dry run must pass. It proves the
test logic; a live failure then means a real API difference.

## Tests you must add and how to verify

- The live suite itself, plus a small unit test (`*.live.ts` helpers can be
  covered by a normal `src/llm/live/*.test.ts` if they are pure, e.g. the key
  scrubber and the skip decision).
- Run and report exit codes (capture with `cmd > log 2>&1; echo exit=$?`,
  never through `| tail`):
  - `npm ci` (first, in your worktree)
  - `npx tsc -p tsconfig.json --noEmit`
  - `npx eslint src/llm/live vitest.live.config.ts`
  - `npx vitest run` (the whole unit suite: it must not include the live file)
  - `npm run test:live` with `ANTHROPIC_API_KEY` unset: skipped, exit 0
  - `LIVE_DRY_RUN=1 npm run test:live`: passes
- Do not run Playwright.

## Report back (your last message, at most 60 lines)

Files changed; tests added (counts, passing?); every command above with its
exit code; how the owner runs it live (one line for README); anything in
`src/llm` that blocked a clean Node run; known gaps.
