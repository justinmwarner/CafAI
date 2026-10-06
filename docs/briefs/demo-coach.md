# Workstream: demo-coach (the scripted coach's demo timing and voice)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then read DECISIONS.md D76 (the demo this serves), D74 (why
the scripted coach exists in two modes) and `docs/briefs/ENGINE_PROTOCOL.md`.

## Why

The owner wants a demo of CafAI (`npm run demo`, built by the parallel
workstream `demo-seed`, see `docs/briefs/demo-seed.md`): a chat already
filled in, with one open "How did it taste?" question. Tapping an answer goes
to the scripted coach in `mock/anthropic/`. Today it answers about 0.4 s after
the tap and its lines are terse test strings ("Thanks. Let me look at the
pressure curve."). In the demo it must look like the real coach: a visible
"Thinking…" of about 1.5 s, text streaming at reading pace with small natural
pauses, and fuller coaching sentences. Its decisions (which tool it calls,
with which values) must not change. Tests and e2e keep today's fast timing
and terse strings: everything new is opt-in through options.

## What to build

### 1. Timing options (mock/anthropic/handlers.ts)

`AnthropicMockOptions` already has `speed`, `firstEventDelayMs` (400),
`eventDelayMs` (25) and `chunkBytes`; `eventStream()` applies them, scaled by
`1/speed` (speed `Infinity` or <= 0: no delay). Add, with exactly these names
(the demo-seed workstream passes them from `mock/plan.ts` without importing
anything from you):

```ts
/** Each gap between SSE events varies by up to ± this many ms (default 0). Deterministic. */
jitterMs?: number;
/** Extra pause after a text_delta whose text ends a sentence (., ?, ! or :, then optional closing quote/bracket and whitespace). Default 0. */
sentencePauseMs?: number;
/** 'terse' (default): today's strings. 'demo': fuller coaching prose; same decisions. */
voice?: 'terse' | 'demo';
```

- Jitter must be deterministic (a small seeded PRNG, for example mulberry32
  seeded from the request count), never `Math.random()`, and a gap never
  goes below 0. Jitter and the sentence pause scale by `1/speed` like the
  other delays, and vanish at speed `Infinity`.
- The demo will pass `{ firstEventDelayMs: 1300, eventDelayMs: 50, jitterMs:
  20, sentencePauseMs: 150, voice: 'demo' }`. With those at speed 1 the
  first `text_delta` of a reply must arrive about 1.5 s (1.3-1.8 s) after
  the request. If the number of events before the first text makes 1300 the
  wrong first delay, say so in your report with the value that gives 1.5 s;
  do not change the other workstream's numbers yourself.
- Defaults stay exactly as today (no jitter, no pause, terse voice), so the
  existing e2e timings and strings are untouched.

### 2. The demo voice (mock/anthropic/scenario.ts and new files)

Every text the scripted coach writes gets a demo variant, chosen by `voice`.
Thread the option from `anthropicHandlers()` to `respond()` (or however the
code is shaped; keep it simple). Cover every branch of `decide()`:
the template pick (and its uploaded:false / loadError / onMachine:false
variants), shot completed (the line before the taste question), the taste
answer (before `get_shot_series`), the proposal (any text before
`propose_adjustment`, plus the tool input's `summary`, `rationale` and
`expectedEffect`), applied (with its variants), declined, a rejected change
and the fallback offer, undo, the new-bag reply and the cards offered again,
and the fallback line.

The demo voice:

- Sounds like a calm, expert barista coaching a home user: two to four short
  sentences, plain words, an occasional **bold** lever or a short bullet list
  (the chat renders paragraphs, lists, **bold**, *em* and `code`; never
  links or HTML).
- Uses only numbers the request really contains (shot time and yield from
  the `[event:shot_completed]` turn, the temperature, yield and grinder from
  the `[context]` turn or the tool results, the pressure series from a
  `get_shot_series` result). Never invent a measurement. If a number is not
  in the request, write the sentence without it.
- Explains the *why* in one clause (for example, sour on a light roast
  usually means under-extraction, so more heat).
- Keeps every tool call identical to the terse voice: same tool, same
  `variable`, same values, same ask_user question and options ("How did it
  taste?" with Sour / sharp, Bitter / harsh, Balanced, sweet, Weak /
  watery). The demo seed's open question uses those exact options.
- Stays inside the app's limits: check `src/coach/contract.ts` and the
  proposal validator in `src/coach/` for length or shape limits on
  `summary`, `rationale` and `expectedEffect`, and stay well inside them.
- Is deterministic: the same request always gets the same text.

## You own (create or modify only these)

`mock/anthropic/**` (source and tests; new files allowed, for example
`mock/anthropic/demoVoice.ts`). Everything else is read-only, including
`mock/plan.ts`, `src/main.tsx` and `mock/demo/**` (the demo-seed workstream
owns them right now).

## Tests (Vitest, next to the code, TDD)

- Defaults: with no new options, the event times and every text are what
  they are today (a regression test that pins at least the first-event delay,
  the inter-event delay and two terse strings).
- Timing, with fake timers: with the demo options at speed 1, the first
  `text_delta` arrives between 1.3 and 1.8 s; gaps vary but stay within
  `eventDelayMs ± jitterMs`; a sentence-ending delta adds the pause; speed 25
  divides every delay by 25; speed `Infinity` sends everything without delay;
  two runs of the same request produce the same gaps.
- Voice: for every branch of `decide()` above, the demo voice produces
  non-empty text that differs from the terse text, and the tool calls (names
  and inputs other than the free-text fields) are identical between voices.
  The proposal's free-text fields pass the app's own proposal validation.
- `npx vitest run mock/anthropic` and the whole suite pass.

## Verify and report

Run in your worktree, capturing exit codes with
`cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (never through `| tail`):
`npm ci` (first), `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`,
`npx vitest run`. No Playwright, no dev server. Windows: edit with the
Edit/Write tools (Python writes CRLF; heredocs drop backslashes).

Final message (at most 40 lines): worktree path and branch, files changed,
the option names and defaults as built, the first-text time you measured with
the demo options, one example demo-voice reply per branch (one line each),
tests added, commands with exit codes, anything the integrator must do.
