# Workstream: restore-e2e (end-to-end test of restoring from the Decaid backup)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own").

## Goal

CafAI mirrors its non-secret records to Decaid's key-value store (namespace
`cafai`, D16, D36) and, when its own IndexedDB starts empty, restores them
(`restoreFromMirrorIfEmpty`, `src/storage/index.ts`). This is unit-tested
only, because the mock Decaid's store resets on every page load (MORNING.md,
"Left as they are"). Make the mock keep its store across a reload, then add a
Playwright spec that proves the restore end to end in the built app.

## You own (create or modify only these)

- `mock/persist.ts` (new) and `mock/persist.test.ts` (new): pure functions
  over the public `MockDecaid` interface (`mock/decaid/state.ts`), e.g.
  `snapshotStore(state)` and `restoreStore(state, snapshot)`, plus the browser
  glue (`startMockPersistence(state)` or similar) that loads the saved
  snapshot into a fresh mock and saves it again as the store changes. It reads
  its own opt-in URL switch `?mockPersist=1`; without the switch it does
  nothing, so every existing spec keeps a fresh store per page load. Document
  the switch in the file's header comment.
- `src/main.tsx`: ONLY the mock-mode branch (`startMocks()`): after
  `startMockWorker()` resolves, start your persistence before the function
  returns, so the snapshot is restored before `createServices()` makes the
  app's first request. Nothing else in the file changes; the production
  bundle must still contain no mock code (the branch is compiled out).
- `e2e/restore.spec.ts` (new).
- `e2e/helpers.ts`: you may ADD helpers (for example an `openApp` variant that
  passes extra URL switches, or a helper that empties CafAI's browser
  storage). Do not change what the existing helpers do; other specs use them.

Read-only for you: everything else, in particular `mock/browser.ts` and all
of `mock/decaid/**` (another workstream is changing them right now: it adds
grinder routes, a machine that holds its own profile, and URL switches), all
of `src/` except the `startMocks()` branch of `src/main.tsx`,
`playwright.config.ts`, `package.json`. If `MockDecaid`'s public API lacks
something you need, work around it with what exists
(`kvKeys/kvAll/kvGet/kvSet/kvDelete`, `getShotIds/getShot/addShot`,
`getWorkflow/updateWorkflow`, `listProfiles/createProfile`, `requests`) and
say so in your report.

## What "keeps its store" means

- With `?mockPersist=1`, the mock saves the parts of its state that a real
  Decaid keeps on disk: the `cafai` KV namespace (all keys), the shot records,
  the current workflow (profile and context) and the profiles CafAI created.
  Live machine state (connection, snapshots, the shot player) is not saved.
- It saves after every request that changed the store and on `pagehide`, to a
  browser storage the test will NOT clear (for example `localStorage` under one
  `cafai-mock:` key, or `sessionStorage`; pick one and say why). On start it
  restores that snapshot into the fresh mock before the app makes its first
  request (the worker starts before `createServices` runs: see `src/main.tsx`).
- The mock's request log (`state.requests`) is a cheap change signal; a
  workflow PUT may soon also start a simulated machine upload in the mock,
  which is fine to trigger on restore.
- Keep the snapshot small enough for the browser's quota with a handful of
  shots; say what the limit is.

## The spec: `e2e/restore.spec.ts`

Run in all three projects like the other specs. Use the scripted model and
mock as `e2e/full-loop.spec.ts` does, with `?mockPersist=1`.

1. Save an API key, start a new bag ("Kiambu AA, light roast, washed"), pick
   a template (v1), pull the scripted shot, tap a taste chip, confirm the
   change (v2). Wait until the mirror holds v2 (`mirroredText` contains
   `Kiambu AA v2`).
2. Simulate lost browser storage: empty CafAI's IndexedDB databases (both the
   data database and the secrets database; names in `src/storage/db.ts` and
   `src/storage/secrets.ts`) and CafAI's own `localStorage` keys, but not the
   mock's saved store. Mind that `indexedDB.deleteDatabase` is blocked while
   the running app holds connections: delete when no page holds them (for
   example from a page on the same origin after navigating the app away, or
   with the Chrome DevTools Protocol `Storage.clearDataForOrigin` limited to
   `indexeddb`), and assert the databases really are empty before reloading.
3. Reload the app. Assert: the bag is back in the bag picker with
   "Kiambu AA v2" active; History shows v1 and v2, the applied change and the
   iteration's taste feedback; the conversation is back (the chat shows the
   earlier messages).
4. Assert the API key was NOT restored (by design: it is never backed up):
   the coach asks for a key, Settings shows no saved key, and nothing the mock
   Decaid saw or stores contains the key (`everythingDecaidSaw`).
5. Save the key again, pull another shot, and assert the shot card and the
   taste chips appear: the restored transcript is still a valid conversation.

Locate new things by role and accessible name, or by the existing ids in
`src/ui/testIds.ts`. Do not edit `src/ui/testIds.ts`. Before tapping the
newest chip or card, wait for it to exist (older chips stay in the DOM,
answered and disabled; `.last()` resolves once and can bind to an old one).

## Tests you must add and how to verify

- `mock/persist.test.ts`: snapshot -> fresh `createMockDecaid()` ->
  restore round-trips the KV namespace, shots, workflow and CafAI's profiles;
  a missing or corrupt snapshot starts a normal fresh store; the restore does
  not duplicate bundled profiles.
- You may NOT run Playwright (the coordinator runs it; port 4174 is shared).
  Write the spec carefully; the coordinator will run it and send failures
  back to you.
- Run and report exit codes (capture with `cmd > log 2>&1; echo exit=$?`,
  never through `| tail`): `npm ci` (first, in your worktree),
  `npx tsc -p tsconfig.json --noEmit`, `npx eslint mock e2e src/main.tsx`,
  `npx vitest run` (whole unit suite), and `npm run build` followed by a
  check that `dist/` contains no mock code (search the bundle for
  `__CAFAI_MOCK__` and `cafai-mock`).
- Reference clones (`.ref/`, `crema/`) are git-ignored, so they are not in
  your worktree: read them from `E:\source\cafai\.ref\...` if you need them.

## Report back (your last message, at most 60 lines)

Files changed; tests added (counts, passing?); every command with its exit
code; the storage you chose for the snapshot and its limits; how the spec
empties IndexedDB; anything in the mock's API you had to work around.
