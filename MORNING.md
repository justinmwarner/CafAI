# Good morning: CafAI overnight build

CafAI (skin id `cafai`) is built, committed in small steps on `main`, and
passes everything in "done means". Nothing was pushed anywhere.

## Done means: status

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`) | pass |
| Lint (`npm run lint`) | pass |
| Unit tests (`npm test`) | **1112/1112** in 89 files |
| Playwright (`npm run e2e`) | **21/21** at 962x602, 1280x800, 1920x1200 |
| Full loop against the mock | pass: new bag -> 2-5 templates -> pick -> "<Bean> v1" uploaded -> scripted shot -> taste chips -> one-change diff confirmed -> v2 -> history; undo back to v1 |
| Release zip (`npm run release:zip`) | builds `release/cafai-0.1.0.zip`: `index.html`, `skin-manifest.json`, `manifest.json` at the root, one entry chunk, no mock code |
| Real Chromium 91 | the full loop also runs in HeadlessChrome 91.0.4469.0 with zero page or console errors (`npm run smoke:chrome91:loop`) |
| README | dev setup, tablet install, credits |

## Try it in two minutes

```bash
npm ci
npm run dev:mock
# open http://localhost:5173/?mockSpeed=20
```

Settings -> any key (for example `sk-ant-demo`; the mock accepts anything
except `sk-ant-invalid` and `sk-ant-overloaded`) -> Coach -> New bag -> type
"Kiambu AA, light roast, washed" -> tap a template -> Espresso -> tap "Sour /
sharp" -> Confirm -> History. Everything you see is the real app; only Decaid
and Claude are scripted (MSW).

## What works

- **Baseline skin:** machine and scale link state from `ws/v1/devices`,
  machine state in plain words, group/steam temperatures, water, scale;
  espresso, steam, flush, hot water, stop, sleep/wake, tare (with the
  group-head-controller rule); a uPlot live shot graph fed imperatively;
  Exit to Decaid's dashboard (Skins page) and Decaid's settings UI on every
  screen; heartbeat on real input; safe-area handling; hash routes that
  survive Decaid's background reload.
- **Coach loop (chat first):** bag intake, 2-5 template suggestions with
  confidence, "<Bean> v1" created and activated (full ten-key profile plus
  `context.targetYield` in one `PUT /workflow`), shot summary (aggregates + 1 Hz
  series + decaid-mcp channeling indicators) with five named query tools,
  tappable taste options with "Other" last, one bounded change per iteration
  as a plain-language diff with Confirm, Undo, and the per-bean version
  history with each iteration's shot, feedback, change and outcome.
- **Guard rails:** templates declare levers with bounds, step size and max
  change per iteration; the model cannot touch pump, sensor, exit type, step
  count or order; anything out of bounds is rejected back to the model, never
  clamped. Every model output is schema-validated (zod) before use;
  `tool_choice` is always `auto` with strict tool schemas.
- **Storage:** IndexedDB repositories that commit before returning, JSON
  export (with a copy fallback for the WebView) and import, a debounced backup
  to Decaid's KV store (`cafai` namespace) that restores an empty store. The
  API key lives in a separate local database: never exported, mirrored,
  logged or shown again.
- **LLM:** a browser-safe streaming Anthropic client (fetch + SSE parser that
  works on Chromium 91), retries before the first byte, friendly errors, an
  append-only transcript that replays thinking blocks unchanged, prompt
  caching. Default model `claude-opus-5-5`; Opus 5, Sonnet 5, Haiku 4.5 and
  Fable 5.1 in Settings.
- **Tooling:** Vitest, Playwright, ESLint with Chromium 91 API bans, CI on
  every push (plus an informational Chromium 91 job), a release workflow that
  zips and publishes on a `v*` tag.

## What is stubbed or not done

- **Never run against real hardware or the real API.** Everything was verified
  against the verified-from-source mocks; there was no DE1, no Decaid
  simulator and no API key. First real-world risks are listed in
  QUESTIONS.md (#1 and #2).
- **Coffee knowledge is a placeholder:** the heuristics block in the system
  prompt (`src/coach/heuristics.ts`, marked `placeholder`) and the three-
  template library are first drafts, as planned ("not tonight").
- **Not built (clean seams left):** teaching mode, personas, cross-user
  learning, bag photos (an `image` content block exists in the LLM types),
  voice, other providers in the UI (`LlmProvider` interface; Crema's OpenAI
  path was not ported because it has no streaming or tools), plugins, Crema's
  Mac server and Classic skin.
- **Smaller gaps:** taste feedback is not written back to Decaid's shot record
  (`annotations.enjoyment`); Decaid bean/grinder entities are not linked (only
  coffee name, roaster and grinder strings go into the workflow context); no
  steam/hot-water parameter editors or device-connect screens (the client has
  `connectKind()`); no screensaver.

## What came from Crema (GPL-3.0, headers on every derived file)

- `src/api`: the gateway client (deadlines, error unwrapping, single-device
  connect, required-field fill), devices, the live-socket logic (now frames +
  telemetry with backoff and devices-only link state), the KV client, with
  their tests.
- `src/coach`: profile normalization and plan, curves and phases (shot
  analysis), proposal validation (rewritten as the bounded validator), parts
  of the advisor prompt, the diff headline logic, `last()`, with tests.
- `src/llm`: Anthropic request building and error wording, JSON extraction
  helpers, with tests.
- `src/storage`: settings normalization and the settings mirror, fixed so it
  actually writes (Crema's never fired), with its "key never mirrored" test.
- `src/ui`: safe-area handling (as-is) and the tablet harness
  (`dev/tablet.html`, `dev/vite.probe.config.ts`).
- Release tooling: the manifest validation behind `scripts/release-zip.mjs`.

Credits are in README and NOTICE (Crema by yarneo, and its MimojaCafe
lineage). Because Crema is GPLv3 without "or later", CafAI is GPL-3.0-only.

## Top 5 questions for you

1. **Does a shot pulled right after Confirm run the new profile?** Decaid
   uploads the profile after the workflow PUT returns and never confirms
   success. Needs a timing check on a real DE1; the fix would be a short
   "loading" hold.
2. **Is `claude-opus-5-5` the right default?** Untested against the live API
   (no key here); one line in `src/llm/models.ts` changes it.
3. **Are the lever bounds and starting yields right for your coffee?**
   v1 yields are the templates' own (Blooming 60 g, D-Flow 50 g, Londonium
   42 g) regardless of dose; bounds come from Decaid's profiles and the
   research table.
4. **Is Chromium 91 really the floor?** Verified there; Decaid's sources show
   older engines exist on some tablets without naming a floor.
5. **Should "<Bean> v1" get its own entry in Decaid's profile library?** An
   unchanged template is, by Decaid's content hash, the bundled default; the
   machine shows CafAI's title, the library keeps the bundled one.

More, ranked by the cost of a wrong guess: [QUESTIONS.md](QUESTIONS.md).
Decisions and every place a source contradicted the research:
[DECISIONS.md](DECISIONS.md), [docs/VERIFIED.md](docs/VERIFIED.md).
