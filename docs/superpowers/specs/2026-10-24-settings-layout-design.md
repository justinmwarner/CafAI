# Settings, regrouped, and the coach's cost: design

Date: 2026-10-24. Status: the owner chose every option below in one form
(2026-10-24): layout A, the seven groups in this order, each drink in one
card, everything applying at once, the coach's usage with its totals, a
bar a day and what it went on, a budget that warns with a switch to pause
the coach, the Claude plan's use while the coach runs on the computer, and
ten of eleven offered gaps (all but "reset a group"). The four layouts
offered are drawn in `2026-10-24-settings-layout.mockup.html` beside this
file (the chosen one, A, is section 3 here). Decisions D232-D248.

## 1. The ask

From the owner: "Can we work to clean up and make the settings page more
managable, organized, easy to view, etc. Right now it's just a list of all
the options the user can do, it's annoying to use. Can we clean it up and
fill in any gaps we can see (IE: It could be useful to give a token count +
est. cost for the coach)."

What stood on 2026-10-24 (main at f49b4b6):

- **Eleven cards in one column** at most 760 px wide (SettingsScreen.tsx):
  Appearance, Where the coach runs, Anthropic API key, Coach, Steam, hot
  water and flush, Drink screens, Sleep and wake, Screensaver, Machine care,
  About, Log. About 4,300 px tall on the 1280x800 tablet (five and a half
  screens, the right half of the screen empty) and 8,000 px on a phone. The
  order grew one decision at a time (D99, D124, D135, D139, D152, D157, D198,
  D212, D222, D225); none decided the whole. D172 already worried about an
  eleventh card.
- **Two ways of saving.** The Coach card (model, fun facts, grinder) has a
  Save button; every other card applies a change at once.
- **The coach's token use is read and dropped.** Every streamed reply's
  `usage` is assembled (src/llm/assemble.ts: input, output, cache reads and
  writes, web searches) and lands on `LlmAssistantTurn.usage`; the runner
  keeps only the content. The only consumer is the in-memory traffic log.
  The bridge forwards tokens too (bridge/lib/translate.mjs `pickUsage`), and
  the Claude plan's 5-hour and weekly use (`/v1/status`, shown only after
  Settings > Test).
- **Settings is one route**, `#/settings`; `#/settings/x` falls back to the
  coach. Care's "Set it in Settings" brings its section into view with an
  in-memory flag; a drink's Go back returns to the remembered route.

## 2. What changes

- **Two panes on a tablet** (D232): Settings' own list of seven groups on the
  left, each saying how it stands, the chosen group on the right. On a phone
  the list is a page and a group opens over it with a back arrow.
- **Seven groups**, each with its own address (D233): Coach, Grinder,
  Drinks, Machine, Display, Data and privacy, About.
- **Everything applies at once** (D234): the Coach card's Save goes.
- **Each drink in one card** (D235): its machine settings, then its screen.
- **Status in the list and search** (D236): a line per group, a dot when
  something needs the barista, and a search over every setting.
- **The coach's usage and cost** (D237-D240): tokens and an estimated cost,
  kept per day, shared through Decaid, a monthly budget that warns and can
  pause the coach, and the Claude plan's use on the computer.
- **Gaps** (D241-D248): which way is finer on the grinder, Sonnet 5.5 and
  Haiku 5.5, how hard the coach thinks, Export in Data and privacy, a
  12-hour clock, a switch for the TDS cell, the screensaver's wait and
  brightness, and About's What's new and Report a problem.

## 3. The layout (D232)

### Tablet (layout.ts says tablet: width 800 or more, height 500 or more)

| Part | Rule |
|---|---|
| List column | 300 px from 1200 px of window width, 280 px under it (962x602: 280 + 682). Its own scroll. At the top the h1 "Settings" (19 px, 700) and the search field (section 6). Then the seven group rows. |
| Group row | 64 px or taller, a `ButtonBase` as History's rows: a 40 px rounded icon tile, the group's name (15 px, 600) and its status line (13 px, ink-muted, one line, ellipsis). A dot (warning colour, 8 px) at the end when the status says something needs the barista; the words say it too (colour is never the only signal). The chosen row is accent on accent-wash, as `nav-item-active`, never a side stripe; its icon tile turns accent. Arrow keys move between rows (roving tab stop, as CareSegments). |
| Group pane | Its own scroll. The group's name as an h2 (19 px, 700) and one line under it saying what the group holds, then its cards (the `Section` card, unchanged: surface, radius 16, padding 16, subtitle1 at 700 titles, `aria-label` from the title). Two columns from 840 px of the pane's own width (`useOwnLayout`, as Care does; Chromium 91 has no container queries), one column of at most 760 px under that. |
| No group in the address | `#/settings` on a tablet shows the group opened last in this page's life, else Coach, and replaces the address with that group's (`replaceRoute`, so Back is not a trap). |

### Phone (layout.ts says phone)

| Part | Rule |
|---|---|
| `#/settings` | The list alone, full width: the h1, the search field, the seven rows, each with a chevron. |
| `#/settings/<group>` | The group's page: a 57 px header as Care's (a back arrow to `#/settings`, labelled "Settings", and the group's name as the h1), then its cards in one column. The bottom tabs stay; Settings stays the current place. |

A window that crosses the breakpoint keeps its route: a phone's group page
becomes the tablet's pane with that group chosen, a tablet's pane becomes the
phone's group page.

**Why this layout.** Every setting is one tap from the list, the list
answers "how does it stand" without opening anything, and the tablet's right
half is used. It is Settings' own first column, not an app-wide sidebar
(PRODUCT.md's anti-references), and it opens a group as History opens a bag.

## 4. The groups and what moves where (D233, D235)

Addresses: `#/settings/coach`, `/grinder`, `/drinks`, `/machine`,
`/display`, `/data`, `/about`. An unknown group is `#/settings`.

| Group | Cards, in order | Status line |
|---|---|---|
| Coach | Where the coach runs (today's, with the bridge's fields); Anthropic API key (while the coach runs on Anthropic, D140); Model and replies (Model, How the coach replies (D243), Fun facts); Usage and cost (section 7) | Anthropic: "Opus 5.5 · $1.84 this month"; no key: "No key yet" (dot). Computer: "On your computer · Opus 5.5"; no address or code: "Not set up yet" (dot). Paused by the budget: "Paused: budget reached" (dot). |
| Grinder | Your grinder: the picker or the name, Current grinder setting, Finer is (D241), Add a grinder, Edit grinders in DYE2, the line on what the coach does with it | "Niche Zero · 14"; "Not set yet" |
| Drinks | Steam, Hot water, Flush: one card each (D235). One status line over the three, kept at its height, as today's | "Steam 50 s · Water 50 ml · Flush 10 s" once Decaid answered, else "Steam, hot water and flush" |
| Machine | Sleep and wake; Machine care (the guide's button, Your water, Intake filter, reminders) | "Sleeps after 30 min · Next wake 06:30"; a care step due and reminders on: "Descale due" (dot) |
| Display | Appearance (Mode, Tint, Custom hue); Units (Temperatures, Clock (D245)); Shot cards (Show TDS, D246); Screensaver (switch, Which, Starts after and Dims to (D247), Preview) | "Dark · Crema · °C" (and " · 12-hour") |
| Data and privacy | Backup in Decaid (today's backup line from About, and what the copy holds); Your data (Export, D244); Share usage with CafAI's developer (from About); Log (from the end of the page) | "Backed up 5 min ago"; "Backup paused" (dot); "Not backed up yet" |
| About | CafAI and Decaid (versions, the verified line, the drift report); What's new in this version; Report a problem (D248) | "CafAI 0.1.3 · Decaid 0.9.0"; older Decaid or a drift report: "Decaid 0.8.6 is older than checked" (dot) |

**Each drink in one card (D235).** Steam's card holds its temperature, time
and flow (Decaid's, held while the machine runs or is not connected, as
today), then "On screen": its Animation, Go back by itself and After
(CafAI's, live whatever the machine does). The page's line names the reason
the machine's fields are held ("Not while the machine is running."), so the
screen fields, which are never held, read as apart. Three cards side by side
from 840 px of pane width, stacked under it, each field one row with its
control at the end on a narrow pane. D222 kept the two halves in two cards
because one is Decaid's and one CafAI's; the line and the "On screen" heading
keep that difference visible while the barista finds a drink in one place.

**Links into Settings** (D233):

| From | To |
|---|---|
| The top bar's and the tabs' Settings | `#/settings` (the list on a phone; the last group on a tablet) |
| The coach screen's "Open Settings" card | `#/settings/coach` |
| Care's back arrow | `#/settings/machine` |
| Care's "Set it in Settings" | `#/settings/machine`, then the care fields brought into view (careReveal, as today) |
| A drink view's Go back | The route it came from, group included |
| The budget's pause card (section 7) | `#/settings/coach`, the usage card brought into view |
| Words in the app | "Settings > About turns it off" becomes "Settings > Data and privacy"; "Settings > Log" becomes "Settings > Data and privacy > Log"; the chat's error lines name the Coach group |

README's 43 "Settings >" references, DESIGN.md's Settings rules and the
screenshots follow.

## 5. Saving (D234)

Every control applies when it changes, as Appearance and the drinks always
have. The Coach card's Save button goes.

| Control | Applies |
|---|---|
| Model, How the coach replies, Fun facts | On change. The coach re-reads its settings (`coach.refresh()`), as Save did. |
| Grinder from Decaid | On change (`grinderPatch`, as Save did), so a pick links at once. |
| Grinder (typed name), Current grinder setting | On blur and on Enter, as the drinks' steppers take a typed value; an unchanged value saves nothing. |
| Finer is | On change. |

A card says what a save did in one line under it that keeps its height
("Saved." for 3 s, or the error in error colour, with what to do). A pasted
key taken out of a typed field still says KEY_TAKEN_OUT (D37). The reveal
that brings the setting and its line into view after a grinder pick stays.

## 6. Status and search (D236)

**Status lines** are read from what the screens already read: the coach's
readiness and source, the settings, the spend store (section 7), the drink
presets (only once Decaid answered; never a read of its own), presence
(sleep, wake times), the care service (a step due), the appearance and
temperature stores, the mirror's backup status, the Decaid version and the
drift log. A line that has nothing to say yet says the group's plain
contents. Dots: no API key on Anthropic, the bridge not set up, the coach
paused by the budget, a care step due with reminders on, the backup paused,
Decaid older than verified or a drift report.

**Search.** A field over the list (44 px, raised background, "Search
settings"). Typing filters a static index (`settingsIndex.ts`) of every
setting: its words as shown, extra words people use ("theme", "dark mode",
"key", "Claude", "bridge", "units", "Fahrenheit", "wake", "alarm",
"brightness", "cost", "tokens", "budget", "export", "backup"), its group and
its anchor. Matches replace the rows, best first (start of a word, then
anywhere), each "Tint" over "Display"; Enter or a tap opens the group and
brings the setting into view and focuses it, with the accent-wash on its
card for 1.2 s (none under reduced motion). No match: "No setting matches
"<words>"." Clearing the field puts the rows back. The index is checked by a
unit test against the anchors each card renders, so a renamed setting cannot
drift out of search.

## 7. The coach's usage and cost (D237-D240)

### What is counted (D237)

Every response the coach is billed for, as Anthropic reports it at the end
of the stream (`usage` on `message_done`): each request of a reply's tool
loop (one reply is one to six requests), a retry that reached the API, the
bag photo. Counted where every call already passes, a wrapper around the two
providers in `createLlmPort` (as the live tests' `withCallBudget`), with what
the call was for passed down from the engine:

| Kind | Calls |
|---|---|
| Replies to you | Typed text, intake, bean and photo confirm, template pick, option answers, confirm or decline, add or decline a grinder, undo, Retry, the replies sent once a key or a restore arrives |
| Replies after a shot | The automatic reply after each credited shot (`sendUser(..., 'shot')`) |
| Bag photos | `readBagPhoto` |
| Web searches | Counted from `webSearchRequests` on any of the above, priced on their own |

A stream that fails before `message_done` is not counted (its tokens are
unknown); the card says the count is an estimate.

**Prices** sit in the model catalog (`src/llm/models.ts`): input, output,
cache write (5-minute, 1.25x input), cache read (per model: 0.05x on Opus
5.5, 0.025x on Fable 5.1, 0.1x on the others), and web search at $10 per
1,000, with the date they were taken from Anthropic's pricing page (the
cache read rates are checked there when the catalog is written, not taken
from memory). Haiku 5.5 is priced in two tiers: a request whose prompt
(input plus cache reads and writes) passes 100K tokens is priced at $0.50 /
$2.50. The cost of a
request is worked out when it is counted and stored in millionths of a
dollar, so a later price change never rewrites a past month. A model id
typed by hand (price 0, unknown) counts its tokens and shows "Price not
known for <id>" instead of dollars.

### Where it is kept (D238)

- **On the device:** a new IndexedDB database `cafai-spend` (the `cafai`
  database is pinned at version 1; D189 added `cafai-care` the same way),
  one store of day records keyed by day, device, source, model and kind:
  requests, input, output, cache read and cache write tokens, web searches,
  cost in millionths of a dollar. The day is the device's local calendar
  day. The device is a random id kept in localStorage.
- **Shared through Decaid:** KV namespace `cafai-spend`, one key per month
  (`2026-10`) holding every device's records for it. A device writes its
  own records into the month's value, debounced 2 s after a count, merged
  with what is there (per record, the larger request count wins: a device's
  counts only grow); it reads the whole namespace at start and when the
  Coach group opens, and merges it in. Unreachable Decaid: kept, written
  when it is back.
- **Totals add every device's records.** The bill is the key's, whichever
  device spent it, so the budget means what the bill means; and an iPad's
  Decaid update, which moves CafAI's origin and empties its storage (D231),
  brings the month back from Decaid instead of starting it at zero. The
  owner left "every device added together" unticked as an extra view; this
  is the count itself, for those two reasons, and with one device it is the
  same number. Not in the main mirror (`cafai`): its copy is one device's
  snapshot, last writer wins, which would drop a second device's spend.
- Not in the export file, never a secret: token counts and dollars, no text.

### The card (D239)

On the Coach page, "Usage and cost", as the mockup draws it:

| Part | Shows |
|---|---|
| Headline | This month's estimated cost, large ("$1.84"), with "estimated this month · 412 k tokens · 63 replies" |
| Days | A bar for each day of the month so far, today in ink, the rest in accent; each bar names its day and cost for assistive tech; the tallest bar is the scale; "Each day this month" under it |
| Periods | Today, Last month, All time |
| What it went on | Replies to you, Replies after shots, Bag photos, Web searches: cost and a thin meter of the month's share each |
| Budget | Section below |
| Footnote | "Counted on every device that uses this Decaid, at Anthropic's prices of <date>. Your bill is in Anthropic's Console." |

Tokens shown are everything sent and received (input, cache reads and
writes, output), in k and M. Empty month: "Nothing yet this month." The
Coach row's status line carries the month's cost.

The dollars are the API key's: replies through the bridge never add to
them. A month that also used the computer adds a line under the headline,
"Also 230 k tokens on your computer (≈ $0.80 on the API)".

**While the coach runs on the computer** (the owner's choice): the card is
"Usage". It says the plan pays ("The coach runs on your Claude plan, so
there is nothing to pay per reply."), the plan's use this 5 hours and this
week as meters (from `/v1/status` without a probe, read when the card shows
and every 60 s while it stays, with when Claude Code last reported it), and
the month's tokens, today's, and what the same replies would cost on the API
("≈ $1.84 on the API"). A month that also spent on the API key adds "Also
$1.20 on your API key this month". The bridge
starts forwarding the web search count (`server_tool_use`) and the usage of
the turns around Claude Code's own WebSearch, which it drops today; the
owner's running bridge picks that up when restarted.

### The budget (D240)

A setting, `coachBudget: { monthlyUsd: number | null, pauseAtBudget: boolean }`,
absent until chosen (no budget, no pause). In the card: "Monthly budget"
(a stepper of dollars, 1 to 1,000, 1 a tap, any whole dollar typed; empty
for none), a meter of the month's spend against it (success, then warning
from 80 %, error at 100 %), and the switch "Pause the coach at the budget".

- **Counts only what costs money:** replies on the API key. Replies through
  the bridge (the plan's) never count toward it.
- **Warns** with a quiet notice in the chat, once a month at each step:
  "The coach has used $4.02 of your $5 budget this month." at 80 %, and
  "This month's coach spend reached your $5 budget." at 100 %.
- **Pauses**, while the switch is on and the month's spend is at or over the
  budget: the coach sends nothing. Its next reply is a card instead,
  "The coach is paused: this month's spend reached your $5.00 budget. Raise
  it in Settings, or it starts again on 1 November.", with Open Settings
  (`#/settings/coach`, the card in view). Shots still save and show; the
  coach reads them when it is back. It comes back when the budget is raised
  or cleared, the switch is turned off, or a month begins, and then sends
  the reply that waited, as a reply waiting for a key is sent once one is
  saved.
- A request already running finishes; the budget is checked before each
  reply and before each further request of a tool loop.

## 8. The gaps (D241-D248)

| D | Gap | Rule |
|---|---|---|
| D241 | Which way is finer | Grinder > "Finer is": Lower numbers (the default, D62) or Higher numbers, kept per grinder (Decaid's grinder id, or the typed name when not linked) in `grinderFinerHigher?: string[]`, the grinders whose higher numbers are finer. The coach's grind steps, the change card's "finer"/"coarser" and a preset list's order follow it, and the coach is told the direction. Answers QUESTIONS 2. |
| D242 | Newer, cheaper models | Sonnet 5.5 ($2 / $10) and Haiku 5.5 ($0.10 / $0.50, two tiers) replace Sonnet 5 and Haiku 4.5 in the list; a device that chose one of those keeps it, listed as no longer offered, as today. Requests checked against each model's rules (no disabled thinking on Sonnet 5.5; effort on both). |
| D243 | How the coach replies | Coach > Model and replies: "Quicker", "Balanced" (the default, today's medium, D30), "Thorough", the request's `effort` low, medium or high. The line under it says what the chosen one trades ("Thorough thinks longer: better on a hard dial-in, and it costs more."; the usage card shows by how much). Held, with a line, on a model without effort. The bag photo stays low. On the bridge, passed to Claude Code if it takes an effort; else the line says it does not apply there. `coachEffort?` absent until chosen. |
| D244 | Export in Data and privacy | Your data: Export, the same file and dialog as History's (one shared component); History keeps its button. |
| D245 | 12-hour clock | Display > Units > Clock: "24-hour" (today's, the default) or "12-hour", `clock?` absent until chosen. Every clock time shown follows it (wake times and the next wake, the log's summary and entries, History and chat times); the wake time dialog takes times that way. Decaid keeps "HH:MM" either way. |
| D246 | TDS on shot cards | Display > Shot cards > "Show TDS and extraction", on by default (`showTds?` absent reads as on). Off hides the "TDS · Add" cell and the extraction on shot cards and in History; a TDS already given stays stored and the coach still reads it. Answers QUESTIONS 21. |
| D247 | The screensaver's wait and brightness | Display > Screensaver: "Starts after" 1, 2, 5, 10 or 15 minutes (default 1, D223) and "Dims the screen to" 10 to 60 % in tens (default 30, D224). Kept in the screensaver setting. Turns QUESTIONS 30 and 31 into choices. |
| D248 | What's new and Report a problem | About: "What's new in 0.1.3", the running version's CHANGELOG section, taken in at build time and shown in a dialog; "Report a problem", GitHub's new-issue page with CafAI's, Decaid's and the host's versions filled in, and a reminder to attach the log (Data and privacy > Log > Share). Inside Decaid, where a link may not open, the address shows with Copy. |

## 9. What stays

Every control's behaviour, its Decaid writes, its test id and its words,
unless a row above changes them. New settings follow the rule every recent
one follows: absent until chosen on this device, so a restore can fill it
(D171, D198). The mirror, the export format and the API key's handling do
not change.

## 10. Testing

- **Unit:** the router's settings routes; the settings index against the
  anchors; each status line; pricing (tiers, cache, web search, unknown
  model); the spend store and the month merge; the budget gate; each new
  setting's normalising and merging; each new control.
- **e2e:** `goTo(page, 'settings', group?)` and `saveApiKey` (Coach) carry
  the move for most specs; a new `settings-layout.spec.ts` (tablet panes,
  phone list and back, deep links from Care, the coach's card and a drink's
  Go back, search), `coach-spend.spec.ts` (the mock's usage on the card, the
  80 % notice, the pause card and the resume) and a spec per gap, phone
  projects included where the layout differs.
- Chromium 91 smoke; the README's settings pictures retaken.
- Checked at 962x602, 1280x800, 1180x820, 390x844 and 844x390, dark and
  light, Crema, Matcha and Tamper (DESIGN.md).

## 11. Build order

1. **Settings fields** first (types, schema, normalising, merging, tests),
   so the parallel steps never touch the same lines.
2. **In parallel**, on disjoint files: the layout (routes, the shell, the
   groups, saving at once, status and search, the moves, deep links, e2e
   helpers); the spend core (counting, prices, the store and its Decaid
   copy, the budget gate, the bridge's fixes); the grinder's direction, the
   models and effort in the coach; the clock, the TDS switch and the
   screensaver's timing where they act; export, What's new and Report a
   problem as components.
3. **Into the groups**: the usage card and each gap's control placed in its
   group, on the new layout.
4. One review, fixes, the full verify (typecheck, lint, unit, build, the
   release zip, e2e, Chromium 91), DESIGN, README, DECISIONS, QUESTIONS and
   MORNING, then into main.
