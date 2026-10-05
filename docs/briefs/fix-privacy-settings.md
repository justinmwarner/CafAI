# Fix workstream: fix-privacy-settings (verifier defects 1, 4b, 9)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then DECISIONS.md D16, D37, D62, and `src/storage/settings.ts`,
`src/storage/redact.ts`, `src/ui/settings/**`.

The fresh-eyes verifier ran the built app (main 5098ef5) end to end and
found these. Its repro specs live outside the repo, in
`E:\source\cafai\.verify\e2e-qa\52-defects.spec.ts` (DEFECT-1, DEFECT-4b),
`49-*.spec.ts` and `44c-*.spec.ts`; read them for the exact steps (read-only;
never edit `.verify`).

## Defect 1 (MAJOR): an API key typed into Settings' grinder fields leaks

Steps: save a key, then type the same key into "Grinder" (with "Not in
Decaid's list") and/or "Current grinder setting", Save. CafAI says
"Settings saved." with no notice, and from then on the key travels in
`PUT /api/v1/workflow` (`context.grinderModel` = the full key,
`grinderSetting` = its first 20 characters), stays in Decaid's workflow and
in every later shot record's `workflow.context` (which Decaid shares with
Visualizer), goes to Anthropic in the coach's `[context]` and shot events,
and sits in IndexedDB. Only the KV mirror and the export were redacted.
README's Privacy section, D16 and D37 all say a key never goes anywhere but
the `x-api-key` header.

Fix it where every path starts, the settings record:

1. `normalizeSettings` (`src/storage/settings.ts`) takes key-shaped text
   (`redactKeyLike`'s pattern, whole or in part) out of `grinderName`,
   `grinderSetting` and `model` (a key is never a model id); a field left
   empty becomes `null` (the model falls back to the default). Because
   normalization runs on every read and write, a record saved before this fix
   is cleaned when it is read. Nothing else in storage changes.
2. The Settings screen tells the user when it took something out, as the
   chat does (D37): "That looked like an API key, so CafAI took it out. Keys
   go in the API key field above." The saved fields show what was really
   saved.
3. Tests: unit (normalize, apply patch, read of an old record holding a key,
   import and mirror paths unaffected); Settings UI (the notice, the cleaned
   fields); and a new e2e spec `e2e/settings-privacy.spec.ts` (you may not
   run it; the coordinator does): type a key into each grinder field and the
   model field, save, then make a bag, pick a template, pull a shot, answer
   the taste question; `everythingDecaidSaw` and every request body to
   Anthropic must not contain the key (see `e2e/full-loop.spec.ts` for the
   pattern; wait for "Loaded … on the machine." before pulling a shot).

## Defect 4b (minor): a link to a grinder Decaid no longer lists, when the library is empty

Steps: link the seeded Niche Zero, then Decaid comes back with no grinders
(`?mockGrinders=0`). Settings hides the picker and shows only "Niche Zero"
and "15", with nothing about the stale link. When Decaid answers and the
linked id is not in the list (an empty library included), show the
existing "Decaid no longer lists this grinder, so the coach gives directions
only." line with the link kept, as for a grinder missing from a non-empty
list (D62). When Decaid cannot be reached, say "Decaid can't be reached right
now, so CafAI can't show this grinder's steps." instead of nothing.

## Defect 9 (polish): Settings at 962x602

After picking a grinder, the setting field and "Save settings" end up below
the fold (top at about 698 px), and for a preset grinder the setting field
shows as free text for about 200 ms before it becomes the list. Bring the
setting field into view after a pick (scroll it into view within the
Settings column), and render the setting control only once its kind is known
(a disabled placeholder while the library loads). The page itself must
still never scroll (each column scrolls inside itself).

## You own (create or modify only these)

- `src/storage/settings.ts` and `src/storage/settings.test.ts` (other
  storage files read-only).
- `src/ui/settings/**`.
- New: `e2e/settings-privacy.spec.ts`.

Read-only: everything else. Another fix workstream is changing `src/app/**`,
`src/coach/**`, `src/ui/machine/**`, `mock/anthropic/**` and
`src/llm/live/**` right now.

## Verify and report

Run and report exit codes (capture with `cmd > "$TEMP/x.log" 2>&1; echo
exit=$?`, never through `| tail`): `npm ci` (first, in your worktree), `npx
tsc -p tsconfig.json --noEmit`, `npx eslint .`, `npx vitest run` (whole
suite). No Playwright. Final message (at most 50 lines): your worktree path
and branch, files changed, tests added (passing?), commands with exit codes,
anything you left open.
