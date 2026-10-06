# Coach conversation protocol (engine <-> model)

The coach engine (`src/app/engine`, written by the integrator) talks to the
model through `runConversation()` (`src/llm/runner.ts`). This file fixes the
exact turn conventions so the scripted fake model in `mock/anthropic/` and the
real engine agree. Tool names and input schemas: `src/coach/contract.ts`.

## Every request

- `system`: `buildSystemPrompt(TEMPLATES)` from `src/coach/prompt.ts`,
  byte-identical across turns (cacheable).
- `tools`: all nine contract tools, in `TOOL` declaration order, strict
  schemas, `tool_choice: {type: "auto"}`.
- `messages`: the bag's append-only transcript. Assistant turns are replayed
  exactly as received, thinking blocks and signatures included.

## Template ids and lever ids (fixed)

| Template id | Levers |
|---|---|
| `blooming-espresso` | `temp`, `yield`, `bloom`, `piExit`, `flow` |
| `d-flow` | `temp`, `yield`, `soak`, `soakWeight`, `pourFlow`, `pourPmax` |
| `londonium` | `temp`, `yield`, `soak`, `peak`, `declineEnd` |
| `allonge` | `temp`, `yield`, `flow`, `maxPressure` |
| `gentle-and-sweet` | `temp`, `yield`, `peak`, `declineEnd`, `hold` |

Bounds, granularity and max change per iteration:
`docs/verified/03-profiles.md` section 9.

## User turns the engine sends

All JSON payloads are compact `JSON.stringify` output.

1. **Bag intake** (first user turn of a bag). The UI shows a local placeholder
   message asking for origin, roast, process and notes; it is NOT sent. The
   user's reply is sent as:
   `[{type:"text", text:<user text>}, {type:"text", text:"[context]\n" + JSON}]`
   where JSON = `{"grinder":<grinder>,"scaleConnected":boolean,"doseG":number|null}`.
   `doseG` is Decaid's dose (`context.targetDoseWeight`) when CafAI coaches
   from it (12-25 g, D57), else null (none set, or outside that range).
   `<grinder>` =
   `{"name":string|null,"setting":string|null,"settingType":"numeric"|"preset"|null,"step":number|null,"values":string[]|null,"linked":boolean}`:
   `name` and `setting` as last saved in Settings; `settingType`, `step` (a
   numeric dial's `settingSmallStep`) and `values` (a preset grinder's
   `settingValues`, finest first) describe the grinder linked from Decaid's
   grinder library (D62). They are null when no grinder is linked or Decaid
   has no data for it (`step` is always null on a preset grinder, `values`
   on a numeric one). `linked` is true when Settings links a grinder from
   Decaid's library, also when Decaid no longer lists it or has no step data
   for it: then `step` and `values` are null and the coach gives directions
   only (no setting), as Settings tells the user. The engine reads the
   linked grinder at start, after `refresh()`, with every shot (when it
   starts and when it finishes) and when the page comes back into view.
2. **Template picked**: one user message with the held auto-tool results of
   that turn (e.g. `save_bag_details`) followed by
   `{type:"tool_result", tool_use_id:<propose_templates id>, content:JSON}`
   with JSON = `{"picked":"<templateId>","version":1,"title":"<Bag> v1","yieldG":number,"doseG":number|null,"uploaded":true|false,"onMachine":true|false|null,"loadError":string|null,"note":string|null}`.
   `onMachine` is true once the machine holds v1 (Decaid's barrier confirmed
   it, or an older Decaid without the barrier with the machine connected);
   false only while the machine is not connected (saved; Decaid loads it on
   connect); null otherwise: the load failed (`uploaded` false, see `note`)
   or the connected machine has not confirmed it. `loadError` is the reason
   the machine did not confirm the version although it is connected
   (Decaid's barrier failed, D55; the banner offers Retry), else null.
   `yieldG` is where v1 stops (its `target_weight` and the workflow's
   `targetYield`): the template's start ratio times the dose CafAI read from
   Decaid at the pick, or times 18 g when that dose is unknown or outside
   12-25 g (D57). `doseG` is the dose used when it is known, else null.
   v1 is posted to Decaid's library with the template's bundled default as
   `parentId` (D59); when Decaid answers 400 for it, v1 is posted again
   without a parent.
3. **Shot completed**: a text block
   `"[event:shot_completed]\n" + JSON` with JSON =
   `{"shotRef":"latest","shotId":string,"version":number,"templateId":string,"levers":{"<leverId>":number,...},"doseG":number|null,"targetYieldG":number|null,"grinder":<grinder>,"summary":<ShotSummary without "series">}`.
   `grinder` (fields as in rule 1) is what the user last saved (Settings or
   a confirmed grind move); it supersedes the intake context.
   If UI tool calls are still pending, their tool_results come first in the
   same message (rule 7).
4. **Feedback**: tool_result for `ask_user` with JSON
   `{"selected":["<option>",...],"other":string|null}`.
5. **Adjustment decision**: tool_result for `propose_adjustment` with JSON
   `{"applied":true,"variable":"profile"|"grind"|"dose"|"none","version":number|null,"title":string|null,"onMachine":boolean|null,"loadError":string|null}`
   (`onMachine` and `loadError` as in rule 2, for the new version;
   `onMachine` is also null when no profile changed: grind, dose, none)
   or `{"applied":false,"reason":"The user declined."}`
   or `{"applied":false,"error":"<upload error sentence>"}`.
6. **Undo**: text `"[event:undo]\n" + JSON` with JSON
   `{"from":number,"to":number,"title":"<Bag> v<to>"}`.
7. **Free text while UI calls are pending**: a tool_result for each pending
   call with JSON `{"answered":false,"note":"The user typed a message instead."}`,
   then the user's text block.
8. **Plain free text** otherwise: one text block.

Auto tools (`save_bag_details`, `get_shot_summary`, `get_shot_series`,
`get_phase_stats`, `compare_shots`, `get_bag_history`) are executed by the
runner immediately; their results are JSON objects. `save_bag_details`
answers `{"saved":true}`. Invalid tool input (schema or coach bounds) is
answered with `is_error: true` and the validation sentences, so the model can
retry.

## Scripted fake model (mock/anthropic/scenario.ts)

Decide from the LAST user message (first matching rule wins). Map each
tool_result to its tool name through the previous assistant turn's tool_use
ids. Every reply starts with a `thinking` block (empty text, deterministic
signature), streams text in small deltas, and streams tool inputs as several
`input_json_delta` pieces. Every payload field above is accepted; the ones a
rule does not name (e.g. `yieldG`, `doseG`) leave its reply unchanged.

The texts below are the default, terse voice, which the tests rely on. The
demo (D76) passes `voice: 'demo'` (mock/anthropic/demoVoice.ts): fuller
coaching prose, and in rule 2 a short text before `propose_adjustment`, with
every tool call unchanged. It also paces the stream like the real model
(`firstEventDelayMs`, `eventDelayMs`, `jitterMs`, `sentencePauseMs` in
mock/anthropic/handlers.ts).

1. tool_result for `propose_adjustment` with `is_error` (CafAI rejected it)
   -> text "That one is outside what this profile allows. Here is another
   change." + a new `propose_adjustment`: the grind move below, or
   `{variable:"none"}` when the rejected one was already a grind move.
   tool_result for `propose_adjustment`:
   `applied:true` -> text "Done. v{version} is on the machine. Pull another
   shot and tell me how it tastes." (with a `loadError`: "Saved v{version},
   but the machine has not confirmed it. Tap Retry above, then pull another
   shot."; else with `onMachine:false`: "Saved v{version}. Decaid loads it
   when the machine connects; pull another shot after that."; for
   grind/dose: "Make that change, then pull another shot."). Otherwise ->
   text "OK, we keep v{n} as it is. Tell me what you would like to try
   instead." End turn.
2. tool_result for a query tool (`get_shot_series`, `get_shot_summary`,
   `get_phase_stats`, `compare_shots`, `get_bag_history`) -> `propose_adjustment`
   chosen from the most recent `ask_user` answer and the most recent
   `[event:shot_completed]` payload's `levers`:
   - contains "Sour" -> `{variable:"profile", lever:"temp", value: levers.temp + 1}`
     (if that exceeds the template max, use `yield` +2 instead);
   - contains "Bitter" -> temp -1;
   - contains "Weak" -> yield -2; contains "Strong" -> yield +2 (a yield
     move only inside the template's yield range, else the grind move);
   - contains "Balanced" -> `{variable:"none"}`;
   - otherwise -> `{variable:"grind", grind:{direction:"finer", amount:1, setting}}`,
     where setting comes from the latest grinder object (the latest shot
     event's or, before any shot, the intake context's): with a numeric
     `step`, the current setting minus that step, printed on the dial's grid
     the way CafAI's validator prints it (`"15"` with step 0.5 is `"14.5"`,
     `"14.25"` is `"13.75"`); with `values`, the entry before the current
     setting in the list; with neither, null for a linked grinder (`linked`
     true: directions only), else the current setting minus 1 when it is a
     plain number. null when none applies (no setting, a setting off the
     dial or not in the list, or a move below 0 or past the first entry).
   Fill summary/rationale/expectedEffect/tips with short plausible text.
3. tool_result for `ask_user` -> text "Thanks. Let me look at the pressure
   curve." + tool_use `get_shot_series` `{shot:"latest", metric:"pressure", fromS:null, toS:null}`.
4. text starting `[event:shot_completed]` -> text "Got it: {durationS} s,
   {yieldG} g out." + tool_use `ask_user` `{question:"How did it taste?",
   options:["Sour / sharp","Bitter / harsh","Balanced, sweet","Weak / watery"],
   multiSelect:false}`.
5. tool_result for `propose_templates` -> text "Loaded {title}. Pull a shot
   when you are ready; I will read the curves." (`uploaded:false`: "I saved
   {title}, but it did not load on the machine. Tap Retry above, then pull a
   shot."; else with a `loadError`: "I saved {title}, but the machine has not
   confirmed it. Tap Retry above, then pull a shot."; else `onMachine:false`:
   "Saved {title}. Decaid loads it when the machine connects; pull a shot
   after that.") A result marked `answered:false` is no pick. End turn.
6. text starting `[event:undo]` -> text "Back on v{to}. Pull a shot when you
   are ready." End turn.
7. Plain user text and no `save_bag_details` call anywhere earlier in the
   transcript -> text "Lovely. Here is where I would start." + tool_use
   `save_bag_details` (name = user text up to the first comma, trimmed, at most
   40 chars; roastLevel from the words light / medium-light / medium /
   medium-dark / dark; process from washed / natural / honey / anaerobic;
   origin and notes null or simple guesses) + tool_use `propose_templates`
   with suggestions ranked by roast: light -> blooming-espresso high, allonge
   medium, d-flow low; dark -> londonium high, gentle-and-sweet medium,
   d-flow low; otherwise d-flow high, gentle-and-sweet medium,
   blooming-espresso medium, londonium low.
7b. Plain user text, bag details saved, but no `propose_templates` result
   that picked a template (the suggestions were set aside) -> text "Here are
   the starting profiles again. Tap one to begin." + tool_use
   `propose_templates` with the rule 7 ranking for the saved roast level (or
   the roast words of the bag description).
8. Anything else -> text "Got it. Pull a shot when you are ready, or tell me
   more about the coffee." End turn.

The fake also checks the request and answers HTTP 400 with an Anthropic-style
error body when the client breaks the protocol: missing or wrong headers,
`stream !== true`, `tool_choice` not `auto`, a tool without `strict: true`, a
tool_use not answered by a tool_result in the next user message, or an
assistant turn it remembers producing that was modified on replay (unknown
assistant turns, e.g. after a page reload, are not checked). API key
`sk-ant-invalid` -> 401; `sk-ant-overloaded` -> 529 overloaded_error.
