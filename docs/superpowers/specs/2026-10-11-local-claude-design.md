# Claude on your computer (CafAI Bridge): design

Status: building (2026-10-11), branch `feat/local-claude`. Roadmap item D56
(docs/ROADMAP.md, QUESTIONS #2): let the coach answer through the user's own
Claude subscription instead of a metered API key, on a Mac **or** a Windows PC.

## What Crema did, and why it was Mac only

`crema/server/advisor` is a Python FastAPI app that shells out to
`claude -p --output-format json` with one flattened prompt. Mac only in four
places: `find_claude()` probes `~/.local/bin`, `/opt/homebrew/bin` and
`/usr/local/bin`; autostart is a macOS LaunchAgent plist; logs go to `/tmp`;
the docs and the provider are "Local Mac server". It is also text only: no
streaming, no tools, no images, one prompt per call. CafAI's coach needs all
four (ten strict tools, streamed turns, the bag photo), so CafAI cannot point
at Crema's server.

## The shape

```
CafAI (tablet / phone / desktop Decaid)                 the user's Mac or PC
  Anthropic provider, baseUrl = http://<computer>:8877  ── LAN ──>  CafAI Bridge (node)
  x-api-key = the bridge's pairing code                                │ spawns, per conversation
                                                                       ▼
                                                     claude -p (the user's own Claude Code,
                                                     signed in with their Pro/Max plan)
                                                        │ tools over MCP (HTTP, loopback)
                                                        └──────────> back into the bridge
```

- **CafAI Bridge** (`bridge/`): a zero-dependency Node program (Node 18+, Mac,
  Windows, Linux). It speaks the Anthropic Messages API (streaming SSE) on the
  LAN, so CafAI's existing provider, assembler, runner, retries and timeouts
  work unchanged with a different base URL and wording.
- Each conversation runs in one long-lived `claude -p` process in stream-json
  mode. CafAI's tools are served to it by the bridge itself as an MCP server
  over HTTP on 127.0.0.1. When the model calls a tool, the bridge ends the
  HTTP response with `stop_reason: "tool_use"` and **holds** the MCP call open
  until CafAI's next request brings the `tool_result`; then the same process
  carries on. A conversation the bridge has no live process for (the bridge
  restarted, yesterday's bag, an idle timeout) starts a new process whose first
  message is the earlier turns replayed as a transcript.
- **Terms.** The bridge runs the unmodified Claude Code binary the user
  installed and signed in to through Anthropic's own flow. It never reads,
  stores or forwards Claude credentials or tokens, and never calls Anthropic's
  API itself (Claude Code legal and compliance page, read 2026-10-11:
  developers "may not collect, store, or intermediate Claude.ai credentials",
  while "an end user signing in to the unmodified Claude Code binary with their
  own Claude subscription" is not restricted). It is for one person's own use
  with their own plan; the README says so. Usage counts against the plan's
  limits ("ordinary, individual usage").

## What the experiments established (Claude Code 2.1.251, Windows 10)

Scripts: `.verify/bridge-exp/exp1-4.mjs` (scratch, not committed).

1. `claude -p --input-format stream-json --output-format stream-json --verbose
   --include-partial-messages` streams `stream_event` lines whose `event` is the
   raw Anthropic SSE event (message_start ... message_stop). Startup to first
   token is about 2-3 s.
2. Isolation: `--setting-sources ""` (no user/project settings, hooks, plugins,
   CLAUDE.md), `--tools ""` (no built-in tools), `--strict-mcp-config` (only our
   MCP server), `--disable-slash-commands` (no skills), `--permission-mode
   dontAsk`, `--no-session-persistence` (nothing written to ~/.claude/projects;
   checked), `--system-prompt-file <file>` (replaces Claude Code's system
   prompt; avoids Windows' 32 767-char command line). The init line then lists
   no tools, plugins or skills, and `apiKeySource: "none"` (the plan's OAuth).
3. An HTTP MCP server listed with `--mcp-config` and allowed with
   `--allowedTools mcp__cafai` works. The model sees `mcp__cafai__<name>`.
   Every `tools/call` carries `_meta["claudecode/toolUseId"]`: the tool_use id
   CafAI will answer, so matching a held call to CafAI's tool_result is exact.
   Claude Code first POSTs a `server/discover` probe (answer -32601), then
   `initialize`, `notifications/initialized`, a GET for a stream (answer 405),
   and `tools/list`.
4. Holding a call: a plain JSON reply held 6 minutes failed in Claude Code with
   "The operation timed out." (~357 s). Answering `tools/call` with
   `text/event-stream` and a `: keepalive` comment every 10 s held 7 minutes
   and delivered the result; the turn carried on. Claude Code emits a
   `tool_progress` heartbeat every 30 s meanwhile.
5. One process keeps the conversation across turns: a second user line on
   stdin after `result` is answered with the earlier turns in context. Earlier
   assistant turns cannot be injected: an `assistant` line on stdin is ignored
   and each `user` line runs its own turn (exp3). Hence the transcript replay.
6. Images: a base64 image block in the stream-json user message works.
   `--effort low` is accepted on every model, Haiku included.
7. Failures come as a synthetic assistant message (`message.model:
   "<synthetic>"`, top-level `error`: `model_not_found`, `invalid_request`...,
   `is_api_error_message: true`) and a `result` with `is_error: true`,
   `api_error_status` (404 for an unknown model, null when signed out) and the
   sentence in `result`. Signed out reads "...login expired · Run /login...".
   Exit code 1.
8. `rate_limit_event` lines carry the plan's usage (`five_hour`/`seven_day`
   utilization and reset times, status `allowed`/`rejected`).
9. `claude auth status` prints JSON: `loggedIn`, `authMethod` (`claude.ai` for
   a plan), `subscriptionType` (`max`), plus email and org (never passed on).
10. Two installs on this PC: WinGet's 2.1.126 first on PATH, the native
    installer's 2.1.251 in `~/.local/bin`. 2.1.126 hangs on every request after
    init (also with an explicit model id). The bridge therefore picks the
    **newest** install it finds, and gives up on a run with no stream event
    within the first-event timeout.
11. Inherited `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`
    and friends (set when the bridge itself is started from a Claude Code
    session) must not reach the child; `ANTHROPIC_API_KEY` must not either, or
    Claude Code bills the key instead of the plan.
12. The first live run (CafAI's own client and tools through the bridge):
    Claude Code 2.1.251 refuses `claude-opus-5-5`, CafAI's default model, with
    "version 2.1.280 or newer is required. Run 'claude update', or update the
    Claude desktop app". The Claude desktop app keeps its own Claude Code,
    kept current by the app: `%APPDATA%\Claude\claude-code\<version>\<build>\claude.exe`
    (2.1.295 on this PC; `~/Library/Application Support/Claude/claude-code/...`
    on a Mac). The bridge counts it among the installs. Careful:
    `%LOCALAPPDATA%\AnthropicClaude\claude.exe` is the desktop app itself (and
    `Claude.app/Contents/MacOS/Claude` on a Mac); asking it `--version` would
    open the app, so the bridge never runs those.

## The bridge's HTTP contract (protocol 1)

Default `0.0.0.0:8877` (`--host`, `--port`). Every response carries
`Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers:
retry-after`. `OPTIONS` answers 204 with `Access-Control-Allow-Methods: GET,
POST, OPTIONS`, the requested headers echoed in `Access-Control-Allow-Headers`,
`Access-Control-Max-Age: 600`, and `Access-Control-Allow-Private-Network: true`
when asked. Errors are Anthropic-shaped:
`{"type":"error","error":{"type":"<anthropic type>","message":"<a sentence a barista can act on>"}}`.

**Pairing code.** Generated at first start: 8 characters from
`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, shown as `ABCD-EFGH` (40 bits), kept in the
bridge's config file. Sent by CafAI as `x-api-key` (what the Anthropic provider
already sends) or `Authorization: Bearer`. Compared after upper-casing and
removing everything but letters and digits, in constant time. Required on every
route except `OPTIONS` and `GET /health`. Five failures from one address within
10 minutes lock that address out for 60 s (doubling to 15 min max): 429 with
`retry-after`. Wrong code: 401 `authentication_error`, "CafAI Bridge did not
accept that code. Check the code it shows on your computer.".

- `GET /health` (no code): `{"ok":true,"app":"cafai-bridge","version":"<v>","protocol":1}`.
  Nothing about the account or the computer.
- `GET /v1/status` (code): what CafAI's Settings shows after Test.
  ```json
  {
    "ok": true, "app": "cafai-bridge", "version": "0.1.0", "protocol": 1,
    "claude": { "found": true, "version": "2.1.251", "path": "C:\\Users\\me\\.local\\bin\\claude.exe" },
    "account": { "loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max" },
    "usage": { "status": "allowed", "fiveHour": { "utilization": 0.08, "resetsAt": "2026-10-11T18:00:00.000Z" }, "sevenDay": { "utilization": 0.3, "resetsAt": "2026-10-15T08:00:00.000Z" } },
    "runs": { "live": 1, "max": 3 },
    "problems": [],
    "probe": { "ok": true, "ms": 2400, "model": "claude-haiku-4-5" }
  }
  ```
  `claude` is `{"found":false}` when no install is found; `account` is null when
  `claude auth status` fails; `usage` is null until a run has reported it;
  `problems` holds sentences (not installed, not signed in, signed in with an
  API key instead of a plan, too old). `probe` is present only for
  `?probe=1[&model=<id>]`: the bridge runs one tiny real turn ("Reply with
  OK", on the named model, Haiku when none, 60 s cap) and reports it, so a CLI
  that starts but never answers, or is too old for the coach's model, shows
  up at Test time. CafAI's Test names the model selected in Settings.
- `POST /v1/messages` (code): the Anthropic Messages API, the subset CafAI uses.
  - Read: `model` (passed to `claude --model` as is), `max_tokens`
    (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`), `system` (string or text blocks),
    `messages` (non-empty, last one `user`), `tools` (`name`, `description`,
    `input_schema`), `stream`, `output_config.effort` (`--effort`).
  - Ignored: `tool_choice` (always auto), `strict`, `cache_control`,
    `fallbacks`, `thinking`, sampling settings, `metadata`, `anthropic-*` headers.
  - Streaming reply: `text/event-stream`; a `ping` event at once and every
    10 s (CafAI's 60 s first-byte and 90 s idle timers see bytes while the
    model thinks); then `message_start`, `content_block_start`,
    `content_block_delta` (`text_delta`, `input_json_delta`),
    `content_block_stop`, `message_delta`, `message_stop`. **Thinking blocks are
    dropped** and the remaining blocks renumbered from 0: their signatures are
    bound to the plan's organisation, so replaying them to the API under a
    Console key could fail, and CafAI never shows them. Tool names lose the
    `mcp__cafai__` prefix; `caller` is dropped. One HTTP response is one
    assistant message: after `message_stop` of a `tool_use` turn the response
    ends while the process waits for the results.
  - Non-streaming reply: one Message object (`id`, `type`, `role`, `model`,
    `content`, `stop_reason`, `stop_sequence`, `usage`).
  - Failures before streaming: HTTP status + error body (400 bad request, 401,
    429, 503 when every run slot is busy). After streaming started: an `error`
    event, then the response ends. Claude Code's failures map as:
    signed out (or text mentioning /login) → `authentication_error` "Claude
    Code on your computer is not signed in. Open a terminal there, run claude
    and sign in with /login."; `model_not_found` → `not_found_error` "Claude
    Code on your computer cannot use <model>. Pick another model in Settings.";
    `rate_limit` or a rejected `rate_limit_event` → `rate_limit_error` "Your
    Claude plan's usage limit is reached; it resets at <time>."; overload →
    `overloaded_error`; no first event within 90 s → `api_error` "Claude Code
    on your computer did not answer. Update it (claude update) and try again.";
    anything else → `api_error` with Claude Code's own sentence.

## Runs (one conversation = one live process)

- **Key.** `config = sha256(model, effort, system, tools)`. A message's
  fingerprint covers its role and blocks: text, tool_use (id, name, input),
  tool_result (id, content, is_error), image (sha256 of the data); thinking and
  unknown blocks are skipped. A run records the fingerprints of the transcript
  it holds, in CafAI's terms (CafAI replays our streamed turns verbatim).
- **Match.** A request continues a live run when `config` matches and the run's
  transcript equals `messages[0..n-2]`:
  - run waiting on tools, last message answers exactly its pending tool_use
    ids: each held MCP call gets its result (`is_error` → MCP `isError`); any
    text or image blocks in that message go in as extra content of the last
    result (rule 7 of ENGINE_PROTOCOL: text typed while a card was open, or a
    shot that finished meanwhile).
  - run idle (its turn ended), last message has no tool_result: the message is
    written to the process's stdin.
  - anything else: a new run.
- **New run.** `messages.length === 1`: that message, blocks as they are
  (images included). Otherwise one user message: a short note, the earlier
  turns as a transcript (`<user>`, `<assistant>`, `<tool_call name id>{json}`,
  `<tool_result for>`), then the latest message. System prompt and tools are the
  same, so the API's prompt cache still matches across runs. The system prompt
  file gets one appended paragraph: tools are named `mcp__cafai__<name>`.
- **Limits.** At most 3 live processes (`--max-runs`); the least recently used
  idle one is closed for a new one, and 503 when all are busy. An idle run, or
  one waiting on tools, closes after 30 minutes (`--idle-minutes`); a run
  without tools (the bag photo) closes once it has answered. A held MCP
  call whose client went away (Claude Code gave up) kills its run; CafAI's
  next request then starts a new run with the replay, so nothing is lost.
  CafAI aborting (closing the response mid-stream) kills the run too, and so
  does a desync: a second `message_start` before the first message ended, an
  `assistant` message that was never streamed, or 180 s without a stream
  event (Claude Code's 30 s tool heartbeats do not count). A run whose files
  cannot be written fails its request and frees its slot.
- **Child process.** cwd = `<config dir>/work` (empty, outside any project);
  env = the bridge's env minus `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`
  (unless `--allow-api-key`) and every inherited Claude Code session variable,
  plus `MCP_TOOL_TIMEOUT=3600000`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`,
  `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. The MCP
  endpoint is `http://127.0.0.1:<port>/mcp/<runId>` with a per-run bearer
  secret in `--mcp-config` (a file, so no JSON on the command line), refused
  from any non-loopback address.
- **Finding Claude Code.** `--claude <path>` or `CAFAI_CLAUDE` first; else every
  `claude` on PATH plus the usual places (Windows: `%USERPROFILE%\.local\bin`,
  WinGet `Links` and `Packages\Anthropic.ClaudeCode_*`, `%APPDATA%\npm`,
  `%USERPROFILE%\.claude\local`, Scoop, Chocolatey; Mac/Linux:
  `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`,
  `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`, nvm), plus the Claude
  desktop app's own copies (finding 12), each asked `--version`; the newest
  wins. An npm `claude.cmd` shim is resolved to its `cli.js` and run with
  `node` (Node refuses to spawn `.cmd` without a shell). A copy that vanished
  (the desktop app updated) makes the next request search again.

## CafAI

- **Setting "Where the coach runs"**: `anthropic` (the default, as today) or
  `computer`. For `computer`: the address (`192.168.1.20` or
  `192.168.1.20:8877`; `http://` and port 8877 are added) and the pairing code.
  Kept on this device in its own IndexedDB database `cafai-coach-source`:
  never mirrored to Decaid, never exported, like the API key.
- **Provider**: the Anthropic provider with `baseUrl` = the address, the code
  as its key, and its own wording (below). The engine's "has a key" check
  means "has what the selected source needs".
- **Settings UI**: a section above the API key: the choice, the address and
  code fields, Save, and Test (`GET /v1/status?probe=1`: "Connected: Claude Code
  2.1.251, Claude Max, 8% of the 5-hour limit used"). Find tries
  `http://127.0.0.1:8877` (Decaid on the same computer). The API key section
  says it is not used while the coach runs on the computer; the model picker's
  prices do not apply then.
- **Wording** (computer): no code: "Add the code CafAI Bridge shows on your
  computer in Settings."; unreachable: "Could not reach CafAI Bridge at
  <address>. Check it is running on your computer and that this device is on
  the same network."; wrong code: "CafAI Bridge did not accept the code. Check
  it in Settings."; timeouts and drops name "your computer"; for 429, 5xx and
  4xx the bridge's own sentence is shown (it is written for baristas).

## Running it

The first `npm run bridge` in a terminal runs `setup`, which asks about
Claude Code, where CafAI runs, when the bridge runs (a daily window such as
05:00-10:00, always, or by hand), keep-awake and, on Windows, the firewall,
and sets it up (`setup --yes ...` for scripts). A schedule is a Task
Scheduler task (no admin: 05:00 daily and at sign-in, wakes the PC, runs a
missed start late), a LaunchAgent with StartCalendarInterval, or printed
systemd units; the bridge itself starts only inside `--window` and stops at
its end, and `--keep-awake` holds off idle sleep meanwhile. After setup,
`npm run bridge` (or `node bridge/cafai-bridge.mjs`) prints the addresses and
the code to type into CafAI. `start`/`stop`/`status` run it in the background;
`install`/`uninstall` start it at login (Windows: a Startup-folder shortcut
that launches `start`, no admin needed; Mac: a LaunchAgent in
`~/Library/LaunchAgents`). `doctor` checks Claude Code, sign-in and a real
turn. `code` shows or renews the pairing code. bridge/README.md has the
firewall prompts (Windows Defender Firewall: allow Node.js on private
networks; macOS: allow incoming connections for node), the same-computer case
(`127.0.0.1`), and troubleshooting.

## Not in this change

A packaged installer or single-file release asset; sweeping the LAN to re-find
a computer whose address changed (Crema's `discover.ts`); mirroring the
address to Decaid; installing the Linux units by itself (setup prints them;
the bridge itself runs on Linux); any run on a Mac.
