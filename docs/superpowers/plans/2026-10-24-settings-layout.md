# Settings regrouped and the coach's cost: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings as two panes of seven groups with status and search, everything applying at once, the coach's token use and estimated cost with a budget, and ten gaps filled, as `docs/superpowers/specs/2026-10-24-settings-layout-design.md` (D232-D248) describes.

**Architecture:** A foundation commit (settings fields, settings routes) first; then five worktree agents on disjoint files (layout, spend core, grinder direction, clock/TDS/screensaver, export/About), each cherry-picked onto `feat/settings-layout`; then two agents (status and search, the usage card) and the placing of each gap's control in its group; then one review, the full verify and the docs.

**Tech stack:** React 19, MUI 9, TypeScript, Vite, IndexedDB (idb), Decaid's KV store, Vitest, Playwright, Chromium 91 smoke. No new dependencies.

---

## Ground rules for every task

- **Worktree.** Each agent works in its own worktree (Agent `isolation: "worktree"`). First command: `git reset --keep <BASE>` (the base commit named in the brief), then `npm ci`. Never `cd` out of the worktree. Never touch `E:\source\cafai` or another worktree.
- **TDD.** For each behaviour: write the failing test, run it and see it fail, write the code, run it and see it pass. Unit tests beside the code (`*.test.ts(x)`), e2e in `e2e/`.
- **Commands** (always capture the exit code: `cmd > .verify/x.log 2>&1; echo "exit=$?"`):
  - one test file: `npx vitest run <path>`
  - typecheck: `npm run typecheck`
  - lint: `npx eslint <paths>` (the whole tree: `npm run lint`)
  - e2e for a spec, on the task's own port: `E2E_PORT=<port> npx playwright test e2e/<spec>.ts` (ports: L 4181, S 4182, G1 4183, G2 4184, G3 4185, A2 4186, U 4187). Never two Playwright runs from one checkout at once.
- **Owned files only.** Each task lists the files it owns. Do not edit anything else; if something outside your list must change, say so in your report and stop short of editing it.
- **Docs.** Do not edit DECISIONS.md, QUESTIONS.md, MORNING.md, README.md or CHANGELOG.md (written at the end, from your report). Cite the spec's decision numbers (D232-D248) in comments; never invent a new number. A new decision of your own: write it as `D-FIX-n` in your report.
- **The code's voice.** Match the surrounding code: comment density, the doc comment at the top of each file saying what it is and why, plain sentences, British spelling as the files use ("colour"). UI words: sentence case, no em dashes, no exclamation marks; DESIGN.md rules (48 px touch targets, nothing under 13 px, theme colours only, no shadows, `cafai.raised` tracks, no `oklch()` or container queries: Chromium 91).
- **Commits.** Small, each with a long descriptive message in the repo's style (`feat: ...`, `fix: ...`, `test: ...`), tests passing. Use `git commit -m`, never `--no-verify`.
- **Report** at the end: commits (sha and subject), what you built, decisions you made beyond the spec, anything you could not finish, anything another task must know, the commands you ran and their results.

## File structure

New:

| File | Responsibility | Task |
|---|---|---|
| `src/ui/settings/groupIds.ts` | The seven group ids, the router's to read | 0 (done) |
| `src/ui/settings/groups.tsx` | Each group's name, line, icon and plain contents | L |
| `src/ui/settings/SettingsList.tsx` | The list: h1, search slot, group rows | L (search: A2) |
| `src/ui/settings/GroupPage.tsx` | A group's pane (tablet) or page (phone) | L |
| `src/ui/settings/groups/{Coach,Grinder,Drinks,Machine,Display,Data,About}Group.tsx` | Each group's cards | L |
| `src/ui/settings/{ApiKeySection,ModelCard,GrinderCard,DrinkCard,UnitsCard,BackupCard,AboutCard}.tsx` | Cards moved out of SettingsScreen.tsx or new | L |
| `src/ui/settings/groupStatus.ts` | Each row's status line and dot | L (plain), A2 (live) |
| `src/ui/settings/settingsIndex.ts`, `SettingsSearch.tsx` | Search | A2 |
| `src/spend/{types,pricing,store,sync,service,budget}.ts`, `src/spend/useSpend.ts` | Counting, prices, storage, the Decaid copy, the budget | S |
| `src/ui/chat/parts/BudgetPausedCard.tsx` | The pause card in the chat | S |
| `src/ui/settings/{UsageCard,BudgetControls,EffortRow}.tsx` | The usage card, the budget's controls, How the coach replies | U |
| `src/ui/settings/GrinderDirectionRow.tsx` | Finer is | G1 |
| `src/app/displayPrefs.ts`, `src/ui/clock.ts`, `src/ui/settings/{ClockRow,ShowTdsRow}.tsx` | The clock and the TDS switch | G2 |
| `src/ui/data/ExportData.tsx`, `src/ui/settings/{ExportCard,WhatsNew,ReportProblem}.tsx`, `src/ui/settings/whatsNew.ts` | Export, What's new, Report a problem | G3 |

---

## Task 0: settings fields and settings routes (done by the coordinator)

**Files:** `src/storage/{types,settings,schema}.ts`, `src/storage/settings.test.ts`, `src/ui/router.ts`, `src/ui/router.test.ts`, `src/ui/settings/groupIds.ts`, `src/ui/testing/fakeServices.ts`.

- [x] New Settings fields, each absent until chosen: `coachEffort?: 'low'|'medium'|'high'` (DEFAULT_COACH_EFFORT medium), `coachBudget?: { monthlyUsd: number|null; pauseAtBudget: boolean }` (DEFAULT_BUDGET; patched field by field; BUDGET_USD 1-1000), `grinderFinerHigher?: string[]` (keys from `grinderDirectionKey`; helpers `finerIsHigher`, `withGrinderDirection`), `clock?: '24h'|'12h'` (DEFAULT_CLOCK 24h), `showTds?: boolean` (absent reads on), `ScreensaverSetting.startAfterMinutes?` (SAVER_START_AFTER_MINUTES 1, 2, 5, 10, 15) and `dimTo?` (SAVER_DIM_TO 10-60 by 10). Normalised, patched, merged (a choice made here wins), in the schema, exported, mirrored; tests.
- [x] Routes: `{ name: 'settings'; group?: SettingsGroupId }`, `#/settings/<group>`, an unknown group is the list, `sameRoute` compares groups; tests.

---

## Task L: the layout (wave 1)

**Goal:** spec sections 3, 4 (without the new controls), 5, the deep links, and the e2e and unit tests that follow from moving every control.

**Owns:** `src/ui/settings/SettingsScreen.tsx` (becomes the shell), every new file in the table marked L, `AppearanceSection.tsx` (Temperatures leaves it for the Units card), `DrinkSettingsSection.tsx` and `DrinkScreensSection.tsx` (replaced by DrinkCard; delete them and their tests once DrinkCard's tests cover the same), `AboutDecaid.tsx` (the backup line moves to BackupCard), `CareSection.tsx`, `UsageRow.tsx` (moves), `Section.tsx`, `src/ui/App.tsx`, `src/ui/chat/CoachScreen.tsx` (the Open Settings link only), `src/ui/care/CareScreen.tsx`, `src/ui/care/StepCare.tsx`, `src/ui/care/careReveal.ts`, `src/ui/drinks/drinkFocus.ts`, `src/ui/usage/screens.ts`, `src/ui/usage/UsagePrompt.tsx` (its words), `src/llm/errors.ts` and `src/app/coachAccess.ts` and `src/coach/diff.ts` (only their "Settings" words, if they name a place that moved), `src/ui/testIds.ts`, `src/ui/shell/**` (only if needed), `e2e/helpers.ts`, every `e2e/*.spec.ts` that reaches Settings, `e2e/screenshots/*.shots.ts` (settings scenes), new `e2e/settings-layout.spec.ts`, the settings unit tests (`SettingsScreen.test.tsx` and the moved sections' tests), DESIGN.md's Settings rules.

**Must not touch:** `src/llm/**` (but the words above), `src/app/engine/**`, `src/app/adapters.ts`, `src/app/createServices.ts`, `src/app/services.tsx`, `src/spend/**`, `bridge/**`, `src/coach/**` (but diff.ts's words), `src/ui/saver/**`, the internals of `ScreensaverSection.tsx`, `SleepWakeSection.tsx`, `wakeSchedule.ts`, `WakeTimeDialog.tsx`, `LogSection.tsx`, `LogView.tsx`, `src/traffic/**`, `src/ui/chat/parts/**`, `src/ui/history/**`, `GrinderFields.tsx`, `src/ui/testing/fakeServices.ts`. Place those sections by importing them.

**Interfaces it provides** (wave 2 builds on these names):

```ts
// src/ui/settings/groups.tsx
export interface SettingsGroup {
  id: SettingsGroupId;
  /** The row's and the page's name: "Data and privacy". */
  name: string;
  /** The one line under the page's title: what the group holds. */
  lede: string;
  icon: ReactElement;
  /** The status line while there is nothing live to say: the group's contents ("Where it runs, model, usage"). */
  contents: string;
}
export const SETTINGS_GROUPS: readonly SettingsGroup[]; // in SETTINGS_GROUP_IDS order
export function settingsGroup(id: SettingsGroupId): SettingsGroup;

// src/ui/settings/groupStatus.ts
export interface GroupStatus { line: string; attention: boolean }
/** Wave 1: the group's contents and no dot; A2 makes it live. */
export function useGroupStatus(id: SettingsGroupId): GroupStatus;

// src/ui/testIds.ts additions
settingsList, settingsGroupRow(id), settingsPane(id), settingsBack, settingsSearch, settingsSearchResult(id)
```

Each card keeps `Section` (title, `aria-label`), so e2e can still find a card by its region name.

**Steps:**

- [ ] **L1. Groups' metadata and the list.** `groups.tsx` with the seven groups (names and ledes from spec section 4; icons from `@mui/icons-material`: ChatBubbleRounded, a grinder-like (TuneRounded), LocalCafeRounded or AirRounded for Drinks, PowerSettingsNewRounded, ContrastRounded, ShieldRounded, InfoRounded). `SettingsList.tsx`: h1 "Settings", an empty search slot (a prop `search?: ReactNode`, A2 fills it), the rows (spec section 3: 64 px `ButtonBase` rows, icon tile, name, status line from `useGroupStatus`, dot when `attention`, chosen row accent on accent-wash, roving tab stop with arrows/Home/End, a chevron on the phone). Tests first: rows in order, the chosen row marked (`aria-current="page"`), arrows move focus, a tap navigates to `#/settings/<id>`.
- [ ] **L2. The shell.** `SettingsScreen.tsx` reads the route's group and the layout (`useLayout` or what AppShell uses: tablet if width 800+ and height 500+). Tablet: list column (280 px under 1200 px window width, 300 px from 1200) and `GroupPage` side by side, each scrolling itself; `#/settings` with no group shows the group opened last in this page's life (a module-level variable), else Coach, and replaces the address (`replaceRoute`). Phone: `#/settings` is the list; `#/settings/<group>` is `GroupPage` with a 57 px header as `CareScreen`'s (back arrow labelled "Settings" to `#/settings`, the group's name as the h1). `GroupPage`: h2 (tablet) or h1 (phone) and the lede, then the group's cards; two columns from 840 px of its own width (`useOwnLayout`, `src/ui/machine/useOwnLayout.ts`), one column of at most 760 px under that. Tests first: tablet shows list and pane, phone shows list then page, the address is replaced on a tablet, the last group is remembered, the page keeps its scroll inside itself.
- [ ] **L3. The groups and the moves** (spec section 4). `CoachGroup`: `CoachSourceSection`, `ApiKeySection` (moved out of SettingsScreen.tsx with `KeyInDecaidSwitch`, unchanged, shown while `useShowsApiKey()`), `ModelCard` (Model, Fun facts). `GrinderGroup`: `GrinderCard` (GrinderFields, AddGrinder, the line). `DrinksGroup`: one status line over three `DrinkCard`s (spec D235). `MachineGroup`: `SleepWakeSection`, `CareSection`. `DisplayGroup`: `AppearanceSection` (Mode, Tint, Custom hue), `UnitsCard` (`TemperatureUnitRow`), `ScreensaverSection`. `DataGroup`: `BackupCard` (the backup line from AboutDecaid, and one sentence on what the copy in Decaid holds: "CafAI copies your bags, versions, shots and settings to Decaid, so a new device or a Decaid update gets them back. Never the API key."), `UsageRow` (in a card "Share usage"), `LogSection`. `AboutGroup`: `AboutCard` (CafAI's version and `AboutDecaid`). Tests: each group renders its cards (by region name) and the controls' test ids.
- [ ] **L4. Saving at once** (spec section 5). `ModelCard`: Model and Fun facts save on change (`storage.settings.update`, then `coach.refresh()`), Fun facts only once chosen here (D198), the price line as today; the line under the card ("Saved." for 3 s, or the error) keeps its height. `GrinderCard`: a pick saves at once (`grinderPatch`), the typed name and setting save on blur and on Enter, unchanged values save nothing; the reveal after a pick stays (`revealInColumn` on the pane's own scroll); KEY_TAKEN_OUT when storage took a pasted key out. No Save button anywhere. Tests: each control saves on its event, a failed save says so, a key pasted in the setting is taken out and said.
- [ ] **L5. Each drink in one card** (D235). `DrinkCard` per drink: the machine row's icon and name; the drink's preset fields (`DrinkFieldsGrid` with `useDrinkPresets`, held as today with the reason in the page's line); a subheading "On screen"; Animation, Go back by itself and After (`useDrinkScreenChoices`, `useDrinkScreensStore`), as DrinkScreensSection drew them. Three across from 840 px of the pane's width, stacked under it (own width, not the viewport: the `sm` breakpoints in DrinkFields.tsx and GrinderFields.tsx are viewport breakpoints; give the cards an own-width layout prop or wrap them so a 682 px pane stacks). Keep every test id (`drinkSettings`, `drinkScreens`, `drinkScene(kind)`, `drinkGoBackSwitch(kind)`, the steppers'). Tests: carried over from the two old sections.
- [ ] **L6. Links** (spec section 4's table): the coach screen's "Open Settings" → `#/settings/coach`; Care's back arrow → `#/settings/machine`; "Set it in Settings" → `#/settings/machine` with `requestReveal('settings-care')` working on the new page; a drink view's Go back returns to its origin route with its group; analytics screen names for the list and each group (`src/ui/usage/screens.ts`); UsagePrompt's "Settings > About" becomes "Settings > Data and privacy"; any other "Settings > X" words in the files listed as owned. Tests: each link's href; the care reveal on the Machine page.
- [ ] **L7. e2e.** `e2e/helpers.ts`: keep `goTo(page, 'settings')`; add `openSettingsGroup(page, group)` (taps the row, on tablet and phone, and waits for the group's page); `saveApiKey` opens Coach. Update every spec that reaches a moved control (the shell report lists them: sleep-wake, computer-coach, settings-grinder, traffic-log, appearance, drink-screens, decaid-safety, baseline, care-reminders, settings-privacy, fahrenheit, screensaver, care, drink-views, grinder-flow, fun-facts, usage, decaid-writes, decaid-features, restore, chat-first, phone-baseline) and the screenshot scenes. New `e2e/settings-layout.spec.ts`: tablet list and pane, the address replaced, phone list then page then back, a reload on `#/settings/display` opens Display, Care's link opens Machine with care in view, a drink's Go back returns to its group. Run the touched specs on port 4181, tablet and phone projects.
- [ ] **L8. DESIGN.md.** Rewrite the Settings parts (the Cards bullet, Appearance controls, Drink screens, Sleep and wake, The key switch, About, The log, Machine care, Screensaver) for the new layout: the list and pane, rows, the page header on a phone, the group pages, saving at once.
- [ ] **L9.** `npm run typecheck`, `npm run lint`, the settings unit tests, the touched e2e specs; commit; report.

---

## Task S: the spend core, the models, effort (wave 1)

**Goal:** spec section 7 but the card and the budget's controls (D237, D238, D240's gate and notices), D242, and D243's plumbing.

**Owns:** `src/spend/**` (new), `src/llm/models.ts`, `src/llm/types.ts`, `src/llm/runner.ts`, `src/llm/extractBag.ts`, `src/llm/anthropic.ts` (only if a new model needs a request change), `src/app/coachAccess.ts` (but L's words), `src/app/adapters.ts` (`createLlmPort` only), `src/app/createServices.ts`, `src/app/services.tsx`, `src/app/engine/engine.ts` (runModel, sendUser's call, readBagPhoto, the budget gate, notices, effort), `src/app/types.ts` (the pause card's part), `src/ui/chat/ChatSurface.tsx` (rendering the new part only), `src/ui/chat/parts/BudgetPausedCard.tsx`, `src/ui/testing/fakeServices.ts`, `bridge/**`, `mock/**`, and their tests.

**Must not touch:** `src/ui/settings/**`, `src/coach/**`, `src/ui/saver/**`, `src/ui/history/**`, `src/traffic/**`, `e2e/**` but a new `e2e/coach-spend.spec.ts` is U's, so none.

**Interfaces it provides:**

```ts
// src/spend/types.ts
import type { LlmUsage } from '../llm/types.ts';
export type SpendKind = 'reply' | 'shot' | 'photo';
export type SpendSource = 'anthropic' | 'computer';
export interface SpendCount { at: Date; source: SpendSource; model: string; kind: SpendKind; call: number; usage: LlmUsage }
export interface SpendRecord {
  day: string; device: string; source: SpendSource; model: string; kind: SpendKind;
  requests: number; replies: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  webSearches: number;
  /** Estimated cost in millionths of a dollar, web searches included; requests of an unknown price count 0 here and in `unpriced`. */
  costMicros: number; webSearchMicros: number; unpriced: number;
}
export interface SpendTotals { costMicros: number; tokens: number; requests: number; replies: number; webSearches: number }
export interface SpendPeriod extends SpendTotals {
  /** Each day of the period that has records, oldest first. */
  days: Array<{ day: string; costMicros: number; tokens: number }>;
  /** Cost by what it went on; web searches apart from the kinds. */
  byKind: { reply: number; shot: number; photo: number; web: number };
}
export interface SpendSummary {
  /** 'YYYY-MM', local. */
  month: string;
  /** Today, this month, last month and all time, for each source: dollars for the API key, the API price of the same tokens for the computer. */
  anthropic: { today: SpendTotals; month: SpendPeriod; lastMonth: SpendTotals; allTime: SpendTotals };
  computer: { today: SpendTotals; month: SpendPeriod; lastMonth: SpendTotals; allTime: SpendTotals };
  /** Models counted this month whose price is not known (typed by hand). */
  unpricedModels: string[];
}
export interface BudgetState {
  budgetMicros: number | null; spentMicros: number; ratio: number | null;
  step: 'none' | 'under' | 'near' | 'over'; // near: 80 % or more
  paused: boolean; // over and pauseAtBudget
  /** The first day of next month, 'YYYY-MM-DD', when a pause lifts by itself. */
  resumesOn: string;
}
export interface SpendService {
  count(entry: SpendCount): void; // never throws, never waits
  summary(now?: Date): SpendSummary;
  budget(budget: CoachBudget | undefined, now?: Date): BudgetState;
  subscribe(listener: () => void): () => void;
  /** Read Decaid's copy and merge it in. Resolves when done or failed (never rejects). */
  refresh(): Promise<void>;
}
// src/spend/useSpend.ts
export function useSpendSummary(): SpendSummary | null; // null without a spend service
// services: `spend?: SpendService`
// src/llm/types.ts: LlmRequest.purpose?: SpendKind; LlmRequest.call?: number; RunRequest.purpose?: SpendKind
// ModelInfo: cacheReadPerMTok, cacheWritePerMTok, longPrompt?: { aboveTokens; inputPerMTok; outputPerMTok; cacheReadPerMTok; cacheWritePerMTok }
// src/llm/models.ts: WEB_SEARCH_USD_PER_1000 = 10; PRICES_AS_OF: 'YYYY-MM-DD'
// src/spend/pricing.ts: requestCost(model: ModelInfo | undefined, usage: LlmUsage): { costMicros: number; webSearchMicros: number; priced: boolean }
```

**Steps:**

- [ ] **S1. Prices and the catalog** (D242). Fetch Anthropic's pricing page (the claude-api skill's `shared/live-sources.md` has the URL; WebFetch it) and write each model's input, output, cache write (5-minute) and cache read prices, and Haiku 5.5's long-prompt tier, into `MODELS` with `PRICES_AS_OF`. Replace Sonnet 5 with Sonnet 5.5 ($2/$10) and Haiku 4.5 with Haiku 5.5 ($0.10/$0.50); notes say what each suits ("Fastest and cheapest; for a simple dial-in."). A saved older id still resolves and shows "(no longer offered)" (ModelCard does that from the list). Check each new model against `buildAnthropicRequest` (no disabled thinking on Sonnet 5.5; effort on both; `supportsEffort` true) and against the bridge's model id check (`bridge/lib/server.mjs` MODEL_ID) and the mock. Tests: the catalog's prices; requests built for each model.
- [ ] **S2. Pricing.** `requestCost`: input, cache read and cache write tokens at their prices, output at its price, the long-prompt tier when input + cache tokens pass `aboveTokens`, web searches at $10 per 1,000 whatever the model, millionths rounded once per request; an unknown model (price 0 or not in the list) is `priced: false`, its tokens counted, its web searches still priced. Tests with exact numbers for Opus 5.5, Fable 5.1, Haiku 5.5 under and over 100K, an unknown id.
- [ ] **S3. What each request is for.** `RunRequest.purpose` passed by the runner into each `LlmRequest` with `call` (0 for the first model call of the run); `extractBag` sends `purpose: 'photo', call: 0`; the engine's `runModel(purpose = 'reply')`, sendUser passing `'shot'` for a shot's turn (`setAsideFor === 'shot'`, check the reason's values) and `'reply'` otherwise; retries and resumes are replies. Tests: the runner sets purpose and call on every request of a loop; the engine passes 'shot' after a credited shot.
- [ ] **S4. The meter.** `createCoachProvider` takes `spend?: Pick<SpendService, 'count'>`; at each `message_done` it counts `{ at, source: source.kind === 'computer' ? 'computer' : 'anthropic', model: request.model, kind: request.purpose ?? 'reply', call: request.call ?? 0, usage: event.turn.usage }`; a stream that ends without `message_done` counts nothing. `createLlmPort(secrets, coachSource, spend?)` passes it to both providers (the photo's too). Tests: one count per finished request, none for a failed stream, the source right for each.
- [ ] **S5. The store.** IndexedDB database `cafai-spend` (version 1, store `days`, key `${day}|${device}|${source}|${model}|${kind}`), as `careDb.ts` opens `cafai-care`; `add(count)` adds to the day's record (day in the device's time zone), `list()`, `merge(records)` (per key, the record with more requests wins; returns whether anything changed). Device id: a random 8-character id in localStorage `cafai.spend.device`, made once. Tests: counts add up per day and key; a new day starts a new record; merge keeps the larger.
- [ ] **S6. The Decaid copy** (D238). KV namespace `cafai-spend`, key per month `YYYY-MM`, value `{ v: 1, records: SpendRecord[] }`. After a count, debounced 2 s: read the month's value, merge this device's records into it (per key, more requests wins), write it if it changed. `refresh()`: `getAll('cafai-spend')`, merge every month into the store. Decaid unreachable: keep going, try again at the next count or refresh, at most once a minute. Never throws into the coach. Tests with a fake KvClient: two devices' writes both survive; a new origin (empty store, new device id) gets the month back after `refresh()`; an unreachable Decaid writes later.
- [ ] **S7. The service and the hook.** `createSpendService({ store, kv, deviceId, now, models })`: `count` (store, then schedule the copy, then notify), `summary(now)` (sums by source, periods as `SpendSummary` says, unpriced models), `budget(budget, now)` (the month's API-key spend against `monthlyUsd`; steps at 80 % and 100 %; `paused` when over and `pauseAtBudget`; `resumesOn` the 1st of next month), `subscribe`, `refresh`. Wire it in `createServices.ts` as `services.spend` (refresh at start once Decaid answers), into `createLlmPort`, and `useSpendSummary()`. A fake in `fakeServices.ts` using the same pure functions with an in-memory store. Tests: summary sums; month boundaries in local time; budget steps; the fake.
- [ ] **S8. The budget in the coach** (D240). In `runModel`, after the key check: while the coach runs on Anthropic and `spend.budget(settings.coachBudget).paused`, send nothing; add the pause card (`BudgetPausedCard`: "The coach is paused: this month's spend reached your $5.00 budget. Raise it in Settings, or it starts again on 1 November.", Open Settings to `#/settings/coach`), remember the reply waits, and send it once a refresh (settings saved) or a new month finds it no longer paused, as a reply waiting for a key is sent once one is saved. After each counted reply on the API key, a notice once a month at each step (a device's own note in localStorage `cafai.spend.noticed`): "The coach has used $4.02 of your $5 budget this month." at 80 %, "This month's coach spend reached your $5 budget." at 100 %. Replies through the bridge never count toward the budget and never pause. Tests (engine and card): paused sends nothing and shows the card; raising the budget sends the waiting reply; a new month lifts it; the notices once each; the bridge never paused.
- [ ] **S9. Effort** (D243's plumbing). The engine's effort is `settings.coachEffort ?? DEFAULT_COACH_EFFORT` at each reply (the photo stays low); a model without effort leaves it out as today. The bridge: find whether Claude Code takes an effort (run `claude --help` on this PC; Claude Code is installed); if it does, pass the request's effort through (`bridge/lib/claude.mjs`, `translate.mjs`); if not, write that in your report (the card says it does not apply there). Tests: the request carries the chosen effort; the bridge's args (if supported).
- [ ] **S10. The bridge's counts.** `pickUsage` forwards `server_tool_use.web_search_requests`; the usage of the turns around Claude Code's own WebSearch is added to the turn's instead of dropped (`translate.mjs` 276-286, 356-362). Tests in the bridge's suite. Note in your report that the owner's running bridge needs a restart to pick this up.
- [ ] **S11.** typecheck, lint, the touched unit suites, the bridge's tests (`npx vitest run bridge` or its config), an e2e smoke of the coach (`e2e/chat-first.spec.ts`, `e2e/full-loop.spec.ts` on port 4182); commit; report.

---

## Task G1: which way is finer (wave 1)

**Goal:** D241.

**Owns:** `src/coach/grinder.ts`, `src/coach/diff.ts` (its grind words), `src/coach/types.ts` (GrinderInfo), `src/app/engine/protocol.ts` (GrinderPayload), the coach's rules or prompt text where it says lower numbers are finer (find it: `src/coach/**`, `src/app/engine/**` prompt files), `src/app/engine/engine.ts` (only where the grinder's payload and info are built), `src/ui/settings/GrinderDirectionRow.tsx` (new) and their tests.

**Must not touch:** `src/ui/settings/**` but the new row, `src/llm/**`, `src/spend/**`, `src/storage/**` (Task 0 gives you the helpers), anything S owns but the engine lines named.

**Steps:**

- [ ] **G1-1.** Tests first, then: `GrinderInfo` (or the grind functions) take `finerIsHigher`; a numeric "finer" move goes up a step on such a grinder and down on the others; a preset list is read coarsest first on such a grinder (its finest first order reversed); clamping and the grid check follow. `GrinderPayload` always carries `finer: 'lower' | 'higher'` and its `values` finest first; the coach's rules say to read `finer` (replace any "lower is finer" wording). The change card's words name the direction right ("finer, to 16"). The engine computes `finerIsHigher(settings)` (src/storage/settings.ts) where it builds the grinder's payload and info, for linked and typed grinders.
- [ ] **G1-2.** `GrinderDirectionRow` (props: `grinderKey: string | null`, `disabled: boolean`): label "Finer is", a Mode-style two-way control "Lower numbers" | "Higher numbers" (48 px, `cafai.raised` track, as AppearanceSection's Mode), the line "So the coach turns the dial the right way." or, with no grinder, the control held and "Name your grinder first."; reads `grinderFinerHigher` from `storage.settings`, saves `withGrinderDirection(...)` at once, then `coach.refresh()`; a failed save says so under it. Test ids: `grinderFinerLower`, `grinderFinerHigher` (add them to `src/ui/testIds.ts`? No: L owns testIds.ts; export your own ids from the row's file as `GRINDER_DIRECTION_TID` and the coordinator moves them). Tests: reads and saves, held without a grinder, error line.
- [ ] **G1-3.** typecheck, lint, the coach and engine suites; commit; report.

---

## Task G2: the clock, the TDS switch, the screensaver's wait and brightness (wave 1)

**Goal:** D245, D246, D247.

**Owns:** `src/app/displayPrefs.ts` (new store for `clock` and `showTds`, as `src/app/temperatureUnit.ts` is for the unit), its wiring in `src/app/createServices.ts` and `src/app/services.tsx` (only the lines for this store and its hooks `useClockFormat()`, `useShowTds()`), `src/ui/clock.ts` (new), `src/traffic/format.ts`, `src/ui/chat/format.ts`, `src/ui/settings/wakeSchedule.ts`, `src/ui/settings/WakeTimeDialog.tsx`, `src/ui/settings/SleepWakeSection.tsx`, `src/ui/settings/LogSection.tsx`, `src/ui/settings/LogView.tsx`, `src/ui/history/HistoryScreen.tsx` (dates and the TDS cells only), `src/ui/chat/parts/ShotCard.tsx`, `src/ui/chat/parts/ShotTds.tsx`, `src/ui/chat/CoachScreen.tsx` (the bag list's dates only), `src/app/screensaverSetting.ts`, `src/ui/saver/**`, `src/ui/settings/ScreensaverSection.tsx`, `src/ui/settings/{ClockRow,ShowTdsRow}.tsx` (new), their tests. Also the words "Settings > Log" in `src/traffic/format.ts` become "Settings > Data and privacy > Log".

**Must not touch:** anything else under `src/ui/settings/**`, `src/llm/**`, `src/spend/**`, `src/app/engine/**`, `src/storage/**`.

**Steps:**

- [ ] **G2-1. The clock.** `clock.ts`: `formatClock(h, m, format)` ("14:30" or "2:30 pm"), `formatTime(date, format)`, `parseClockText(text, format)` for typed times; the store and `useClockFormat()`; every clock time shown follows it (wake rows and the next wake, the log's summary and entries, History's and the chat's dates, the coach screen's bag list), passing the format down from the hook (no module-level state); the wake time dialog takes 12-hour times with am/pm when chosen, and still saves Decaid's "HH:MM". `ClockRow`: label "Clock", a Mode-style control "24-hour" (subtitle "14:30") | "12-hour" ("2:30 pm"), saving at once; test ids exported from the file (`CLOCK_TID`). Tests for each site in both formats.
- [ ] **G2-2. The TDS switch.** `useShowTds()`; shot cards and History hide the TDS cell and the extraction when off (a TDS given stays stored; the coach still reads it); `ShowTdsRow`: switch "Show TDS and extraction" with the line "On shot cards and in History, for a refractometer's reading."; test id exported (`SHOW_TDS_TID`). Tests: hidden and shown.
- [ ] **G2-3. The screensaver.** The store keeps `startAfterMinutes` and `dimTo` (whole objects: `{ ...current, ...change }`); the policy waits `startAfterMinutes` (default its minute) and dims to `dimTo` (default its 30); `ScreensaverSection` gains "Starts after" (native select: 1, 2, 5, 10, 15 minutes; 48 px) and "Dims the screen to" (native select: 10 % to 60 %), each applying at once, and its help line says the chosen minutes. Tests: the policy reads them; the controls save.
- [ ] **G2-4.** typecheck, lint, the touched suites, `e2e/sleep-wake.spec.ts`, `e2e/screensaver.spec.ts`, `e2e/traffic-log.spec.ts`, `e2e/tds-ey.spec.ts` on port 4184 (before L's moves land they still open Settings as today); commit; report.

---

## Task G3: Export, What's new, Report a problem (wave 1)

**Goal:** D244, D248.

**Owns:** `src/ui/data/ExportData.tsx` (new, taken out of `HistoryScreen.tsx`), `src/ui/history/HistoryScreen.tsx` (its export part only), `src/ui/settings/{ExportCard,WhatsNew,ReportProblem}.tsx`, `src/ui/settings/whatsNew.ts` (new), their tests, and `vite.config.ts` only if the changelog needs it.

**Must not touch:** everything else.

**Steps:**

- [ ] **G3-1. Export.** Move History's export (the button's work and the "Your CafAI data" dialog) into `ExportData.tsx` (`useExportData()` or an `ExportDataButton` with the dialog), History unchanged on screen and in its tests; `ExportCard`: Section "Your data", the line "Your bags, versions and shots, as a file to keep or move to another device. Never your API key.", the Export button (test id exported: `EXPORT_CARD_TID`). Tests: History's export as before; the card exports the same.
- [ ] **G3-2. What's new.** `whatsNew.ts`: the running version's section of CHANGELOG.md, taken in at build time (`import changelog from '../../../CHANGELOG.md?raw'`, check Vite's `?raw` works in the build and in Vitest), split into paragraphs and bullet lines (no markdown library). `WhatsNew`: a tonal button "What's new in 0.1.3" opening a dialog with the section; hidden when the version has no section. Tests: the section found and rendered; none hides the button.
- [ ] **G3-3. Report a problem.** `ReportProblem`: a button "Report a problem" opening GitHub's new issue page (`https://github.com/justinmwarner/CafAI/issues/new` with `title` empty and `body` holding CafAI's version, Decaid's version and the host, and "Attach the log: Settings > Data and privacy > Log > Share."); find how CafAI opens an outside page today inside Decaid (search `window.open`, `target="_blank"`, `host`), and inside Decaid, where a link may not open, show the address with Copy (`copyText`). Tests: the address built; Copy inside Decaid.
- [ ] **G3-4.** typecheck, lint, the History suite and its e2e (`e2e/restore.spec.ts`, whichever exports) on port 4185; commit; report.

---

## Wave 2

After the five are cherry-picked onto `feat/settings-layout` and the suites pass there.

### Task P: placing the gaps' controls (the coordinator)

- [ ] `GrinderDirectionRow` in `GrinderCard` (its key from the card's form: `grinderDirectionKey`), `ClockRow` in `UnitsCard`, a "Shot cards" card with `ShowTdsRow` in `DisplayGroup`, `ExportCard` in `DataGroup`, `WhatsNew` and `ReportProblem` in `AboutGroup`; their test ids moved into `testIds.ts`; tests.

### Task A2: status lines and search

**Owns:** `groupStatus.ts`, `SettingsList.tsx` (the search slot), `settingsIndex.ts`, `SettingsSearch.tsx`, a reveal helper for search (bring a card into view in the pane, focus the control, the accent-wash on its card for 1.2 s, none under reduced motion), their tests, search cases in `e2e/settings-layout.spec.ts`.

- [ ] Live status lines and dots, spec section 6 and section 4's table, from the services the screens read (never a read of their own beyond what the screens already do; the drinks' line only once their presets are read).
- [ ] The index: every setting's words, extra words, its group and its control's test id; a unit test renders each group with fake services and checks every indexed test id is on its page.
- [ ] The search field and results, spec section 6.

### Task U: the usage card, the budget's controls, How the coach replies

**Owns:** `UsageCard.tsx`, `BudgetControls.tsx`, `EffortRow.tsx`, `CoachGroup.tsx` and `ModelCard.tsx` (placing them), their tests, new `e2e/coach-spend.spec.ts`.

- [ ] `UsageCard` (spec section 7's card, both sources), reading `useSpendSummary()`, refreshing the Decaid copy when it mounts, the plan's use from `getBridgeStatus` without a probe (read when shown and every 60 s); `BudgetControls` (the stepper, the meter, the pause switch; `coachBudget` patched field by field; then `coach.refresh()` so a waiting reply goes); `EffortRow` (spec D243: three-way control "Quicker" | "Balanced" | "Thorough", the line, held on a model without effort, the bridge's line from S's report). e2e: the mock's usage shows on the card after a reply; a $1 budget with the pause on shows the 80 % notice, then the pause card, and raising the budget sends the waiting reply.

## Wave 3

- [ ] One combined review of the branch (correctness, the spec's rules, DESIGN.md's), fixes.
- [ ] The full verify alone on this PC: `npm run verify` (typecheck, lint, unit, build, release zip, e2e) and the Chromium 91 smoke (`tools/chrome91` in the main checkout, `--dist` this worktree's `dist-mock`, the settings route).
- [ ] Docs: DECISIONS.md D232-D248 (and any D-FIX-n renumbered after them), QUESTIONS.md (2 and 21 answered by settings; 30 and 31 now settings; new questions from the reports), README's Settings references and pictures (`npm run screenshots`), CHANGELOG, MORNING.md.
- [ ] Into local `main` (feedback-land-in-main), the owner told; no push.
