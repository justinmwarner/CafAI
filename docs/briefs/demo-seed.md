# Workstream: demo-seed (`npm run demo`: a pre-populated CafAI on the mocks)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then read DECISIONS.md D76 (this demo; the owner approved
it), D55, D57, D59, D61, D62, D64-D66, D70 and D74;
`docs/briefs/ENGINE_PROTOCOL.md` (the transcript formats); `docs/SIMULATOR.md`
section 3 (mock mode vs the simulator).

## Why

The owner wants to open CafAI locally and see it as it will look in use: a
chat already filled in with everything the coach can show, and one open
question they can tap to watch a realistic but scripted reply arrive (a
"Thinking…" row, then streaming text, then a change card). No Decaid, no
API key, no tokens. Mock mode already has the pieces: the mock Decaid
(`mock/decaid/`) and the scripted coach (`mock/anthropic/`), started by
`startMocks()` in `src/main.tsx` and chosen by `mock/plan.ts`. What is
missing is the pre-populated state and a way to start it.

A parallel workstream, `demo-coach` (`docs/briefs/demo-coach.md`), is
adding timing and voice options to the scripted coach right now. You do not
touch `mock/anthropic/**`; you pass it options by name (section 2).

## 1. How it runs

- New script in `package.json` (add this one line, nothing else):
  `"demo": "vite --mode mock --port 5175 --strictPort --open \"/?demo=1\""`.
  Its own port gives the demo its own browser storage, apart from
  `npm run dev` / `dev:mock` / `dev:sim` on 5173.
- `/?demo=1` also works on any mock-mode server (`npm run dev:mock`), subject
  to the guard (section 4).
- Each load of a `?demo=1` page starts the same demo from the beginning
  (reload = start over). It opens on the Coach screen whatever route was
  saved.
- The demo needs the built-in mock Decaid. With `?mockDecaid=0` the demo
  flag is ignored, and a `console.info` line says why.

## 2. Plan and wiring (mock/plan.ts, mock/decaid/urlOptions.ts, src/main.tsx)

- `MockPlan` gains `demo: boolean` (`?demo=1` and the mock Decaid runs) and
  `coachOptions`, typed locally in plan.ts as

  ```ts
  export interface CoachMockOptions {
    firstEventDelayMs?: number;
    eventDelayMs?: number;
    jitterMs?: number;
    sentencePauseMs?: number;
    voice?: 'terse' | 'demo';
  }
  ```

  It is `{}` normally and, in the demo, `{ firstEventDelayMs: 1300,
  eventDelayMs: 50, jitterMs: 20, sentencePauseMs: 150, voice: 'demo' }`
  (exported as `DEMO_COACH_OPTIONS`). `coachSpeed` stays as it is, so
  `?mockSpeed` still speeds the coach up (the e2e spec uses it).
- `startMocks()` (change only that function):
  `anthropicHandlers({ speed: plan.coachSpeed, ...plan.coachOptions })`. The
  spread is deliberate: until demo-coach lands, `anthropicHandlers` does not
  know the new names, and spread members are not excess-property checked, so
  this compiles before and after.
- In the demo, the mock Decaid starts without its example shot and example
  profile (as with `?mockExamples=0`), and its profile upload takes 1500 ms
  unless the URL sets `?mockUploadMs` (so "Loading … on the machine…" is
  visible). Put these defaults in `mock/decaid/urlOptions.ts` (it can read
  `demo=1` itself) or pass them through `startMockWorker`; your choice.
- In the demo, `startMocks()` awaits the seeding (section 3) after
  `startMockWorker()` and before it returns (so before `createServices()`),
  and does not start `?mockPersist` persistence (the demo resets each load).

## 3. What the demo contains (mock/demo/**)

Build it as data in TypeScript under `mock/demo/` (for example `story.ts`
for the conversation, `shots.ts` for the shot records, `seed.ts` for the
writes, `guard.ts`, `index.ts` with `startDemo(state, host = window)`). It
is deterministic: fixed ids, and timestamps as fixed offsets from the load
time (the first bag started about a day ago, the last shot a few minutes
ago).

**Settings:** the placeholder key `sk-ant-demo` (in CafAI's secrets store),
the mock's Niche Zero linked from Decaid's grinder library (its fixed id in
`mock/decaid/grinders.ts`) at the setting the story ends on, dose 18 g, and
the active bag.

**Bag 1, active: "Kiambu AA"** (Kenya, washed, light roast). A suggested
story; adjust details to what the engine and the scripted coach really do,
but keep every item of the coverage list below:

1. The engine's new-bag intro; the user describes the bag; the coach replies
   with formatted text and three template cards (Blooming Espresso high, two
   others lower), Blooming picked ("In use").
2. The starting-yield notice for v1 and "Loaded Kiambu AA v1 on the
   machine."; the coach says to pull a shot.
3. Shot 1 card (2 stars). The coach asks "How did it taste?"; answered
   "Sour / sharp". The coach looks at the pressure curve (a hidden
   `get_shot_series` call) and proposes v2, temperature +1 °C; applied and
   loaded.
4. Shot 2 card with a channeling warning (3 stars). The coach asks a
   multi-select question about the puck (for example Pinholes, Wet patches,
   Cracks at the edge, Looks even); two picked. It gives a by-hand grind
   card ("Set the grinder to 14.5 before the next shot (Decaid lists 0.5
   steps for your Niche Zero).", built by the app's own code); applied.
5. One warning notice from the engine's own texts that fits the story (for
   example a shot that ran another profile and is not part of the dial-in).
6. Shot 3 card (4 stars); taste answered with Other ("Sweeter, but a little
   thin"). The coach proposes v3, a shorter yield; the user taps Not now
   (declined). The user types that they want to try it after all; the coach
   proposes it again; applied and loaded; the user taps Undo (undone, and
   "Back on Kiambu AA v2."). The user types a middle way; the coach proposes
   v4; applied and loaded. v4 is the latest applied card, so it shows Undo.
7. Shot 4 card on v4, not rated. The coach's line, then **"How did it
   taste?" with the scripted coach's exact options (Sour / sharp, Bitter /
   harsh, Balanced, sweet, Weak / watery; the engine adds Other), left
   open**. This is the last thing in the chat.

**Bag 2: "Santos"** (Brazil, natural, medium-dark): v1 from the template
the coach ranks first for it, one shot rated 5 stars, answered "Balanced,
sweet", and a short coach reply keeping v1. It appears in the bag picker;
selecting it loads its v1 on the mock machine (the engine does that).

**Coverage list** (each at least once across the two bags): user text; coach
text with a paragraph, **bold** and a bullet list; the engine's local intro;
template cards (one in use); info, success and warning notices; shot cards
with a graph, with stars and without, one with a channeling warning; option
chips answered single, multi-select and Other, plus the open one; change
cards applied (versioned), applied (by hand), declined, undone, and the
latest applied versioned card with Undo.

**Consistency (this is what makes the open question work):**

- The conversation record holds both `uiMessages` and `apiMessages`, exactly
  as the engine would have stored them (ENGINE_PROTOCOL turn formats: event
  turns, `[context]`, tool_use / tool_result pairing, every assistant turn
  starting with a thinking block with a signature). Every card's
  `requestId` is the id of the tool_use that produced it. Every tool_use has
  its tool_result in the next user turn, except the final open `ask_user`,
  whose card must be what the engine rebuilds as a pending call.
- Coach turns are hand-written, natural coaching prose (two to four short
  sentences, the same tone as the demo voice in demo-coach's brief).
  Everything the **engine** writes (intro, notices, "Loaded …", "Back on
  …", the starting-yield line, user bubbles for taps) comes from the
  engine's own builders and strings (`src/app/engine/uiMessages.ts` and
  friends), never retyped, so the demo cannot drift from the app.
- Version profiles come from the coach's own template and adjustment code
  (`src/coach/`); each version is in the mock Decaid's profile library under
  the id the mock gives it, recorded on the version as the engine would
  (D59). The mock machine's loaded workflow is the active version exactly as
  the engine loads it, so that opening the demo adds nothing to the chat and
  raises no banner (`start()` runs `checkMachineProfile`, and the 30 s beat
  repeats it).
- Shot records in the mock Decaid have realistic 5 Hz series (pressure,
  flow, weight) for their profile; each shot card's summary comes from its
  record through the app's own summarizer, and the channeling warning from
  the app's own detector. Each record carries what CafAI would have written
  to it (D61: the taste line in the notes, `extras.cafai`, and `enjoyment`
  for rated shots), built with the app's own code. Iterations reference
  them, so History opens every shot.
- "Sour / sharp" on the open question must lead (through the scripted
  coach) to a "Kiambu AA v5" card raising the temperature 1 °C: keep v4's
  temperature inside the template's bounds.

## 4. The guard (never replace someone's real data)

The demo writes only when this address has no CafAI data, or only data the
demo wrote (a localStorage marker, for example `cafai-demo:seeded`, set
after a successful seed). "CafAI data" is any bag, version, iteration,
conversation, a saved settings record, or an API key other than the demo
placeholder. Otherwise it writes nothing, the normal mock app starts, and a
dismissible note (plain DOM from mock code) says: "The demo did not load:
this address already has CafAI data of its own. Run npm run demo, which
opens its own address (localhost:5175)."

Seeding replaces CafAI's storage at that address (the storage porter's
`importAll(…, 'replace')` or the storage module's own API; never raw
IndexedDB writes that bypass its schema), sets the placeholder key, the
route, and the marker, and closes its storage connection before
`createServices()` opens its own.

## You own (create or modify only these)

`mock/demo/**` (new), `mock/plan.ts` + `mock/plan.test.ts`,
`mock/decaid/urlOptions.ts` + its test, `mock/browser.ts` (only if needed
to pass the demo defaults), `src/main.tsx` (only `startMocks()`),
`package.json` (only the `demo` script), `e2e/demo.spec.ts` (new),
`docs/DEMO.md` (new), `README.md` (one short paragraph). Everything else is
read-only, in particular `mock/anthropic/**` (demo-coach owns it), every
other file in `src/`, `e2e/helpers.ts` and the other specs, the configs and
the lockfile. Do not change product behaviour: if the demo cannot be built
without a change in `src/`, stop and report what and why.

## Tests

Unit (Vitest, next to the code, TDD; Node with fake-indexeddb where storage
is needed):

- `mock/plan.test.ts`: `?demo=1` sets `demo` and the demo coach options;
  `?demo=1&mockDecaid=0` does not; without `?demo` nothing changes;
  `?mockSpeed` still sets `coachSpeed`.
- The story: every item of the coverage list is present; the export passes
  the app's import schema (`src/storage/schema.ts`); the transcript is
  consistent (requestIds equal tool_use ids, tool_use/tool_result pairing,
  roles alternate as ENGINE_PROTOCOL says, the last message is the open
  ask_user with the four options).
- The guard: empty storage seeds; the marker re-seeds and removes what the
  user added in the demo; a bag, a settings record or a real-looking key
  without the marker refuses and writes nothing, in either store.
- The round trip: start the real engine on the seeded storage, with the
  real scripted coach (`mock/anthropic`, default options) and a Decaid
  seeded as the demo seeds it (the mock Decaid through MSW in Node, or the
  app's fakes seeded the same way). Starting adds no message and no banner.
  Answering each of the four options, and Other with text, gets a coach
  reply and no error banner. "Sour / sharp" ends with a pending "Kiambu AA
  v5" card (temperature +1 °C); confirming it creates v5 and loads it. If
  the engine cannot run in Node with reasonable effort, say so and test the
  two halves instead: the scripted coach's `respond()` accepts the seed's
  `apiMessages` plus a tool_result for the open question, and the engine's
  pending-call reconstruction finds the open question.

E2E (`e2e/demo.spec.ts`; write it, do not run it: only the integrator runs
Playwright). Use `e2e/helpers.ts` as it is (local helpers go in the spec)
and locate elements by role, name or existing test ids:

- `./?demo=1&mockSpeed=25#/`: the header shows Kiambu AA and v4; template
  cards with "In use"; at least four shot cards; a change card with Undo, a
  declined one, an undone one and "Back on Kiambu AA v2."; the open
  question's chips are enabled; the bag picker lists both bags; History
  lists the shots.
- Tap "Sour / sharp": a coach reply, then a "Kiambu AA v5" card; Confirm;
  "Loaded Kiambu AA v5 on the machine.".
- Without `mockSpeed`: after the tap, "Thinking…" is visible before the
  reply, and the v5 card arrives within 20 s.
- A reload starts the demo over (v4, the question open again).
- The guard: in a fresh page, make a bag through the normal app
  (`openApp`, `saveApiKey`, New bag), then open `./?demo=1`: the note shows
  and the bag is still there.

## Docs

`docs/DEMO.md`: how to start it (`npm ci`, `npm run demo`), what is on
screen, what each answer to the open question does (from the scripted
coach: sour, bitter, weak, strong, balanced, Other), that a reload starts
over, the guard, that it is the built-in mock (for Decaid's simulator see
docs/SIMULATOR.md), and how to see the states a calm demo does not show,
with the switches that already exist (`sk-ant-overloaded` and
`sk-ant-invalid` keys in Settings, `?mockUploadMs=3000`,
`?mockNoMachineProfile=1`, `window.__CAFAI_MOCK__.state.setMachineConnected(false)`).
README: one short paragraph under mock mode pointing to it.

## Verify and report

Run in your worktree, capturing exit codes with
`cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (never through `| tail`):
`npm ci` (first), `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`,
`npx vitest run`. No Playwright, no dev server. Windows: edit with the
Edit/Write tools (Python writes CRLF; heredocs drop backslashes).

Final message (at most 50 lines): worktree path and branch, files changed,
the story as built (one line per shot and card), how the round-trip test
runs the engine (or why it could not), tests added, commands with exit
codes, deviations from this brief, anything the integrator must do.
