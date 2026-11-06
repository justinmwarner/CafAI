# A long wait for the coach: design

Status: building (2026-11-06), branch `feat/coach-long-wait`. Asked by the
owner after a morning reply on the computer failed: "we need error handling
… gracefully handle. Add a longer-loading UX so that the user knows we're
waiting for the server. And increase timeout too." Approved the same day:
about 3 minutes with one restart, up to 5 while Claude Code is visibly
retrying; a Stop button from 45 s; land in main and update the bridge on the
owner's PC.

## What happened

On 2026-11-06 at 06:30 (and on 11-04 at 06:56) CafAI Bridge started Claude
Code for a reply, and Claude Code wrote nothing for 90 s. The bridge's one
timer (`firstEventMs`, bridge/lib/runs.mjs) closed the run with "Claude Code
on your computer did not answer. Update it (claude update) and try again.":
wrong advice, after 90 s of "Thinking… N s" that said nothing of what CafAI
waited on. The bridge kept no trace of what Claude Code had been doing (its
stderr is logged only when it exits by itself; no session is persisted).

What Claude Code tells the bridge while a reply has not begun, in
stream-json (2.1.317, checked on 2026-11-06 against a local server that
answered every request 529):

```
{"type":"system","subtype":"init", ...}                               started, MCP connected
{"type":"system","subtype":"status","status":"requesting", ...}       the request is sent
{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,
 "retry_delay_ms":578,"error_status":529,"error":"overloaded", ...}   the API failed; it tries again
```

So a silent Claude Code is one that is stuck (a hung connection, a start
that never finished), and one that writes `api_retry` is alive and waiting
on Anthropic. A fresh process mends the first; only time mends the second.

## The bridge (works with any CafAI)

Timers per request, from the moment a run takes it (`attach`), until the
reply begins (`message_start`):

- **Quiet, 90 s** (`quietMs`): no line at all from Claude Code. The first
  time, the bridge restarts it: the run is closed without failing the
  request, and a new run starts on the same request (the conversation
  replayed, as any new run does), attached to the same HTTP reply. Nothing
  had reached CafAI, so nothing shows twice. The second time, the request
  fails: "Claude Code on your computer stopped answering, even after a
  restart. Try again; if it keeps happening, restart CafAI Bridge." Any line
  from Claude Code (init, status, api_retry, anything) re-arms the timer.
- **Cap, 5 min** (`maxWaitMs`), from the request, across the restart: the
  request fails with a sentence from the last `api_retry`: overloaded (529)
  "Claude is overloaded right now. Try again in a few minutes." as
  `overloaded_error`; 429 "Claude is limiting requests right now. Try again
  in a few minutes."; 5xx "Claude is having trouble right now. Try again in a
  few minutes."; no status "Claude Code on your computer could not reach
  Claude. Check the computer's internet connection, then try again."; no
  retry seen "Claude Code on your computer did not answer in 5 minutes. Try
  again." (the others `api_error`).
- Once the reply has begun, the stall timer (180 s between stream events)
  goes on as before. Claude Code's own final failures (its retries spent, a
  plan's limit) still come through `mapCliFailure` as before.

`firstEventMs` goes. "Update it (claude update)" stays only where an old
Claude Code is the known cause (the version check).

**Reports.** On a streamed request the bridge writes, beside its pings, a
CafAI-only event whenever what it waits on changes:

```
event: cafai_wait
data: {"type":"cafai_wait","stage":"starting"}
data: {"type":"cafai_wait","stage":"requesting"}
data: {"type":"cafai_wait","stage":"retrying","attempt":3,"of":10,"reason":"overloaded"}
data: {"type":"cafai_wait","stage":"restarting"}
```

`starting`: Claude Code spawned (a new run, or a restart), no `init` yet.
`requesting`: `status: requesting` seen. `retrying`: an `api_retry`, with its
attempt, `max_retries` as `of`, and `reason` from `error_status`:
`overloaded` (529), `rate_limited` (429), `server` (5xx), `network` (none),
`other`. `restarting`: the bridge restarts a quiet Claude Code (`starting`
follows). Only before the reply begins; never on a plain (`stream: false`)
request. CafAI's assembler drops event types it does not know
(`src/llm/assemble.ts`), so CafAI 0.1.5 ignores them.

**Log.** A restart and a give-up each write one line: what Claude Code last
reported and when, how long the request waited, and the last 300 characters
of Claude Code's stderr; e.g. `run 02b728: Claude Code went quiet for 90 s
(last: requesting, 92 s ago); starting it again`.

## CafAI

**The provider** (`src/llm/anthropic.ts`) yields a new stream event,
`{ type: 'waiting', note: string }`, the sentence to show under "Thinking…":

- at the start of each request: `wording.waiting` ("Waiting for Anthropic."
  or "Waiting for Claude on your computer.");
- for each `cafai_wait`: `wording.reported(report)` (computer only):
  - starting: "Claude Code is starting on your computer."
  - requesting: "Your computer is waiting for Claude to answer."
  - retrying: "Claude is busy right now. Trying again (3 of 10)." (overloaded);
    "Claude is limiting requests right now. Trying again (3 of 10).";
    "Claude is having trouble right now. Trying again (3 of 10).";
    "Your computer could not reach Claude. Trying again (3 of 10).";
    "Trying Claude again (3 of 10)." (other)
  - restarting: "Claude Code went quiet. Starting it again."
- before each of its own retries: `wording.retrying(kind)`, e.g. "Anthropic is
  busy right now. Trying again." / "Could not reach your computer. Trying
  again."

A `waiting` event never counts as part of a turn (`state.yielded` stays
false), so the provider's retry rules are unchanged. The runner passes it on
(`onWaiting`); the engine keeps the latest as `state.waitNote` (null when a
reply starts streaming, ends, or fails).

**The row** (`ThinkingView`, src/ui/chat/ChatSurface.tsx):

- 0 to 10 s: "Thinking…", with the seconds from 3 s, as now.
- From 10 s: a second, muted line with `waitNote`.
- From 45 s: the first line reads "Taking longer than usual… 52 s", and a
  **Stop** button shows.

**Stop** (`actions.stopReply`) aborts the reply's request (each `runModel`
has its own AbortController, passed to the runner as `signal`). The
barista's message stays; the banner says "You stopped waiting for the coach.
Tap Retry to ask again." with Retry. On the bridge the closed request closes
its run, which ends Claude Code ("CafAI stopped the request"). A stop is not
counted as a coach error.

Timeouts on CafAI's side stay: the bridge pings every 10 s, so CafAI waits as
long as the bridge does; Anthropic's 60 s to the first byte and 90 s between
chunks are unchanged.

## Not changed

The machine screen's "Done. Reading the shot…" note; the chat's error banner
and its Retry; Anthropic's path beyond its wait sentences.

## Tests

- Bridge (`bridge/lib/*.test.mjs`, `npm run test:bridge`), with the fake
  Claude Code's new markers: `SILENT` (writes nothing, not even `init`),
  `QUIET_ONCE` (silent in the first process only, a marker file in its work
  folder), `RETRYING` (`requesting`, then an `api_retry` every 200 ms, never
  answering): a quiet Claude Code is restarted once and the reply comes
  through with `starting`, `restarting`, `starting` reported first; a second
  silence fails with the restart sentence; retries keep the request alive
  past the quiet time and are reported, and the cap fails with the
  overloaded sentence as `overloaded_error`; the log lines.
- CafAI: the provider's `waiting` events (start, `cafai_wait`, its own
  retries, an unknown stage ignored, nothing counted as yielded); the
  runner's `onWaiting`; the engine's `waitNote` and Stop; the row's stages
  with fake timers.
