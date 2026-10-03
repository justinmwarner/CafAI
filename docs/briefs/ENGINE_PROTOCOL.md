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

Bounds, granularity and max change per iteration:
`docs/verified/03-profiles.md` section 9.

## User turns the engine sends

All JSON payloads are compact `JSON.stringify` output.

1. **Bag intake** (first user turn of a bag). The UI shows a local placeholder
   message asking for origin, roast, process and notes; it is NOT sent. The
   user's reply is sent as:
   `[{type:"text", text:<user text>}, {type:"text", text:"[context]\n" + JSON}]`
   where JSON = `{"grinder":{"name":string|null,"setting":string|null},"scaleConnected":boolean}`.
2. **Template picked**: one user message with the held auto-tool results of
   that turn (e.g. `save_bag_details`) followed by
   `{type:"tool_result", tool_use_id:<propose_templates id>, content:JSON}`
   with JSON = `{"picked":"<templateId>","version":1,"title":"<Bag> v1","uploaded":true|false,"note":string|null}`.
3. **Shot completed**: a text block
   `"[event:shot_completed]\n" + JSON` with JSON =
   `{"shotRef":"latest","shotId":string,"version":number,"templateId":string,"levers":{"<leverId>":number,...},"doseG":number|null,"targetYieldG":number|null,"summary":<ShotSummary without "series">}`.
   If UI tool calls are still pending, their tool_results come first in the
   same message (rule 7).
4. **Feedback**: tool_result for `ask_user` with JSON
   `{"selected":["<option>",...],"other":string|null}`.
5. **Adjustment decision**: tool_result for `propose_adjustment` with JSON
   `{"applied":true,"variable":"profile"|"grind"|"dose"|"none","version":number|null,"title":string|null}`
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
`input_json_delta` pieces.

1. tool_result for `propose_adjustment`:
   `applied:true` -> text "Done. v{version} is on the machine. Pull another
   shot and tell me how it tastes." (for grind/dose: "Make that change, then
   pull another shot."). Otherwise -> text "OK, we keep v{n} as it is. Tell
   me what you would like to try instead." End turn.
2. tool_result for a query tool (`get_shot_series`, `get_shot_summary`,
   `get_phase_stats`, `compare_shots`, `get_bag_history`) -> `propose_adjustment`
   chosen from the most recent `ask_user` answer and the most recent
   `[event:shot_completed]` payload's `levers`:
   - contains "Sour" -> `{variable:"profile", lever:"temp", value: levers.temp + 1}`
     (if that exceeds the template max, use `yield` +2 instead);
   - contains "Bitter" -> temp -1;
   - contains "Weak" -> yield -2; contains "Strong" -> yield +2;
   - contains "Balanced" -> `{variable:"none"}`;
   - otherwise -> `{variable:"grind", grind:{direction:"finer", amount:1, setting:null}}`.
   Fill summary/rationale/expectedEffect/tips with short plausible text.
3. tool_result for `ask_user` -> text "Thanks. Let me look at the pressure
   curve." + tool_use `get_shot_series` `{shot:"latest", metric:"pressure", fromS:null, toS:null}`.
4. text starting `[event:shot_completed]` -> text "Got it: {durationS} s,
   {yieldG} g out." + tool_use `ask_user` `{question:"How did it taste?",
   options:["Sour / sharp","Bitter / harsh","Balanced, sweet","Weak / watery"],
   multiSelect:false}`.
5. tool_result for `propose_templates` -> text "Loaded {title}. Pull a shot
   when you are ready; I will read the curves." End turn.
6. text starting `[event:undo]` -> text "Back on v{to}. Pull a shot when you
   are ready." End turn.
7. Plain user text and no `save_bag_details` call anywhere earlier in the
   transcript -> text "Lovely. Here is where I would start." + tool_use
   `save_bag_details` (name = user text up to the first comma, trimmed, at most
   40 chars; roastLevel from the words light / medium-light / medium /
   medium-dark / dark; process from washed / natural / honey / anaerobic;
   origin and notes null or simple guesses) + tool_use `propose_templates`
   with 3 suggestions ranked by roast: light -> blooming-espresso high, d-flow
   medium, londonium low; dark -> londonium high, d-flow medium,
   blooming-espresso low; otherwise d-flow high, blooming-espresso medium,
   londonium medium.
8. Anything else -> text "Got it. Pull a shot when you are ready, or tell me
   more about the coffee." End turn.

The fake also checks the request and answers HTTP 400 with an Anthropic-style
error body when the client breaks the protocol: missing or wrong headers,
`stream !== true`, `tool_choice` not `auto`, a tool without `strict: true`, a
tool_use not answered by a tool_result in the next user message, or an
assistant turn it remembers producing that was modified on replay (unknown
assistant turns, e.g. after a page reload, are not checked). API key
`sk-ant-invalid` -> 401; `sk-ant-overloaded` -> 529 overloaded_error.
