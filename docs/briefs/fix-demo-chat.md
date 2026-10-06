# Fix workstream: fix-demo-chat (chat wording and answers the demo's verifier found)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Background: DECISIONS.md D61 (shot notes), D76 (the demo).

A fresh-eyes verifier drove the demo (`/?demo=1` on the mock build) and found
these. They are app defects: the real coach would show them too. Repro any
of them with the demo, or with the ordinary mock app (`npm run dev:mock`).

## 1. The "keep the recipe" card is worded as a change made by hand

When the coach proposes keeping the recipe (`propose_adjustment` with
`variable: "none"`; the scripted coach does it for "Balanced, sweet"), the
pending card says "No new profile: this is a change you make by hand."
(src/ui/chat/parts/DiffCard.tsx ~176) and after Confirm "Confirmed. Make the
change before your next shot." (~75). Fix: a keep card says
"Nothing to change: keep this recipe." while pending and "Kept. Pull the
next shot the same way." once confirmed. If the diff part does not tell a
keep from a by-hand change, add an optional field set by the engine (stored
chats without it render as today).

## 2. A card set aside for another reason says "you answered in the chat instead"

Fresh demo, tap Undo in the header: the open taste question's chips go
disabled with "Set aside: you answered in the chat instead." (OptionChips.tsx
~126), though nothing was typed. A new shot arriving while a question is
open shows the same note. Fix: the engine records why it set a card aside
(typed in the chat, Undo, a new shot, or anything else it does) on the part,
as an optional field, and each card shows a true note: typed: today's
texts; Undo: "Set aside when you tapped Undo."; a new shot: "Set aside: a
new shot came in."; anything else and stored chats without the field: "Set
aside: the conversation moved on." (TemplateCards and DiffCard included;
DiffCard keeps "Nothing changed on the machine."). The tool_result notes to
the model stay as they are.

## 3. Any answer is saved as the shot's taste

The demo's coach asks a multi-select question about the puck (Pinholes, Wet
patches, …). The engine stores that answer as the shot's taste: History
shows "Taste: Pinholes, Wet patches", and the "Taste: …" line in Decaid's
shot notes (src/app/engine/shotNotes.ts, D61) would say so too, replacing a
real taste answer when the coach asks a follow-up. Fix: only an answer to a
taste question is the shot's taste (the iteration's feedback, the notes
line, History's "Taste:"). A question is a taste question when its text
mentions taste ("taste", "tasted", "tasting", any case). Make the coach's
instructions say so: the prompt (src/coach/prompt.ts) and the `ask_user`
tool description (src/coach/tools.ts) ask for the word "taste" in the taste
question (for example "How did it taste?"). Other answers stay in the chat
and go to the coach as today; they do not touch the feedback, the notes or
History. Check what else reads the feedback (the coach's bag history, the
stage that puts "Tap an answer, or say how it tasted" in the composer) and
keep it consistent.

## 4. Coach paragraphs run together

RichText (src/ui/chat/RichText.tsx) renders paragraphs with no space between
them, so they read like line wraps. Give paragraphs (and lists) visible
spacing, as in any chat app, without changing single line breaks.

## 5. While a change loads, the composer still asks to confirm it

While "Loading Kiambu AA v5 on the machine…" shows, the composer's
placeholder is "Confirm the change, or ask a question" (CoachScreen.tsx ~40).
It should not ask for something already done: use the ordinary placeholder
(or a short loading one) while the change is applying or loading.

## 6. Streaming glitches

- Raw markdown shows while a reply streams: "means **under-extraction" is
  on screen for about 100 ms before it turns bold. While a text part is
  streaming, render it without a trailing unclosed `**`, `*` or backtick
  marker (the real model splits deltas anywhere, so the fix belongs in the
  UI, not the mock).
- "Thinking…" flashes for 0.1-0.2 s right after Confirm, before the card's
  own loading bar and notice take over. Do not show the thinking row while a
  change card is applying (it has its own bar).

## You own (create or modify only these)

`src/ui/chat/**`, `src/ui/history/**`, `src/app/engine/engine.ts`,
`src/app/engine/uiMessages.ts`, `src/app/engine/shotNotes.ts`,
`src/app/types.ts` (new optional fields only), `src/coach/prompt.ts`,
`src/coach/tools.ts`, `src/coach/diff.ts` (only if item 1 needs it), the
tests next to them, and existing `e2e/*.spec.ts` only where they assert a
string you changed (say which; you cannot run them). Not `mock/**`: if a
test under `mock/` fails because of your change, leave it, and list it with
the reason in your report. Nothing else.

## Tests (TDD)

One or more failing tests first for each item: the keep card's two texts;
each set-aside reason's note, and the old-data fallback; the puck answer
leaves feedback, notes and History alone while a taste answer still sets
them (and "Other" text on a taste question is still taste); paragraph
spacing (a computed style or class in jsdom); the composer placeholder while
applying; a streaming text with an unclosed `**` renders without it, and
the same text finished renders bold; no thinking row while a card applies.

## Verify and report

Run in your worktree, capturing exit codes with
`cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (never through `| tail`):
`npm ci` (first), `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`,
`npx vitest run` (report any `mock/` failures separately). No Playwright.
Windows: edit with the Edit/Write tools.

Final message (at most 40 lines): worktree path and branch, files changed,
the new texts as built, tests added, e2e strings changed, failing `mock/`
tests with reasons, commands with exit codes.
