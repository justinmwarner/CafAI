# Fix workstream: fix-undo-iteration (Undo marks the wrong shot's change as undone)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own").

## The defect

Found while building the demo (D76). In `src/app/engine/engine.ts`,
`undo()` (about line 1797) marks as undone "the latest iteration with
outcome `applied` on the parent version":

```ts
const applied = [...iterations].reverse().find((i) => i.outcome === 'applied' && i.profileVersionId === parent.id);
if (applied) await putIteration({ ...applied, outcome: 'undone' });
```

That is not always the iteration whose change made the version being undone.
Repro (the demo's story does exactly this):

1. On v2, shot 2 gets a by-hand grind card; Confirm. Shot 2's iteration:
   outcome `applied`, change `grind`.
2. Shot 3 on v2; the coach proposes v3; Not now. Shot 3's iteration:
   outcome `declined`.
3. The user types that they want it after all; the coach proposes v3 again;
   Confirm. `confirmChange()` finds no pending iteration
   (`latestPendingIteration`), so no iteration records this change.
4. Undo. v3 is undone and v2 is active again, but shot 2's iteration
   becomes `undone`: History now says shot 2's grind change was undone,
   which never happened.

## The fix

Undo marks as undone only the iteration whose applied change produced the
version being undone (`current`): on the parent version, outcome `applied`,
and a change that made a version (a profile change matching
`current.change`: same variable, lever, from and to). When no iteration
produced it (a change confirmed from a typed request, as above), Undo
changes no iteration. A by-hand grind or dose change, or a kept recipe, is
never marked undone by Undo: those make no version. Everything else Undo does
(the versions' statuses, the bag, the diff card's status, "Back on …", the
load, the `[event:undo]` turn) stays as it is.

Check whether anything else reads iteration outcomes in a way that assumed
the old behaviour (History's labels, the coach's bag history tool, the
mirror); report what you find, change only what this fix needs.

## You own (create or modify only these)

`src/app/engine/engine.ts` (only `undo()` and a helper it needs), the
engine's tests (`src/app/engine/*.test.ts`), and `mock/demo/build.test.ts`
(only if an assertion there pinned the old behaviour; the demo's data is
built by playing its story through the engine, so it follows the fix by
itself). Everything else is read-only.

## Tests (TDD: write the failing test first)

- The repro above: after Undo, shot 2's iteration is still `applied` (grind),
  shot 3's is still `declined`, v3 is `undone`, v2 is `active`.
- The common case still works: a shot, a taste answer, a versioned change
  confirmed on that shot's iteration, Undo: that iteration becomes `undone`.
- Two applied versioned changes in a row (v2 from shot 1, v3 from shot 2),
  Undo: only shot 2's iteration becomes `undone`.

## Verify and report

Run in your worktree, capturing exit codes with
`cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (never through `| tail`):
`npm ci` (first), `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`,
`npx vitest run`. No Playwright. Windows: edit with the Edit/Write tools.

Final message (at most 30 lines): worktree path and branch, files changed,
tests added, what else reads iteration outcomes, commands with exit codes.
