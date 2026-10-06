# Fix workstream: fix-shot-timer-sim-docs (found against Decaid 0.8.7's simulator)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own").

CafAI was run end to end against Decaid 0.8.7+2847's simulator on
2026-10-05 (coach-only mode, normal mode, and inside Decaid's window). It
worked; two things need fixing.

## 1. The machine panel's "Last shot" time includes Decaid's "stopping" phase

Pulling a shot on the simulator, the shot card said 63 s and Decaid's log
shows the pour ran 61.6 s (preinfusion 19:51:01.71 to "pouringDone"
19:52:03.31), but the machine panel showed "Last shot 66.6 s" (66.8 s on a
second run). Cause: `src/api/telemetry.ts` (~line 212) ends the shot only when
Decaid reports `finished` or `idle`, and the real Decaid stays in `stopping`
for about 4-5 s, until it has stored the shot. The built-in mock's stopping
phase lasts 1.6 s (`mock/decaid/shotPlayer.ts`), so the e2e tests never show
the gap.

Fix: the timer stops when the pour ends (Decaid's `stopping` shot state, or
the machine substate `pouringDone`, whichever comes first), while the live
graph may keep plotting until the shot is finished. Keep the shot lifecycle
events the engine relies on (`started`, `finished` with the shot id) exactly as
they are: the engine fetches the record on `finished`. Make the mock's
stopping phase last about 4 s, like the real Decaid, and make sure the e2e
timeouts still hold (they wait up to 60 s for a shot card). Read the relevant
Decaid source at `E:\source\cafai\.ref\decaid` (shot_sequencer.dart) to
confirm when `stopping` starts. Unit tests: the timer value at stopping and at
finished; the mock's stopping duration.

## 2. docs/SIMULATOR.md: what actually happened

Apply these corrections (line numbers are approximate; keep the rest):
- L10-11: "Decaid has not been installed or run on this computer, so every
  Decaid step is source only." -> "Decaid 0.8.7+2847 (Windows release,
  commit b6e1d3f0) was run here on 2026-10-05; parts marked *Tried* were
  checked against it."
- L19: "There is no installer." -> "There is no installer, and the zip has no
  top-level folder: unzip it into its own folder."
- L28: `.\Decaid.exe --bypass-onboarding` -> `.\Decaid.exe --bypass-onboarding
  --no-account`, and add: "`--no-account` also skips the account screen and
  Decent's credential store."
- L37: "ports 8080 (its API) and 3000 (its skin entry) free" -> "ports 8080
  (its API), 3000 (its skin entry, a redirect to the skin's own port) and 4001
  (its API docs) free".
- After the PowerShell block (~L66): "Decaid answers `null`, and the devices
  show as "discovered" until a scan: `Invoke-RestMethod
  http://localhost:8080/api/v1/devices/scan` (about 15 s) connects both.
  After a restart they connect by themselves within about 20 s."
- L83: "Not tried." -> "Tried (0.8.7): the POST, the scan and the JSON above."
- After ~L116: "Close other CafAI tabs first (such as `npm run dev` on
  localhost:5173). An open CafAI page joins the simulator as soon as Decaid
  starts, copies its bags into the simulator's backup (fresh pages then restore
  them), and notes every simulator shot in its own active bag."
- L131: after "the simulator's Decaid version", add "(`Decaid 0.8.7+2847`)".
- L139: "Not tried: CafAI against a running Decaid." -> "Tried: the full loop
  against Decaid 0.8.7 (new bag, v1 loaded, a simulator shot, a taste chip, v2
  loaded, notes on the shot), in coach-only and normal mode."
- Section 4, under "Or serve the build folder": "Tried: no clicks needed.
  CafAI's console goes to Decaid's `logs\webview_console.log`, labelled with
  the default skin's id."
- After "**Disabled** (the default) opens Decaid's own shot screen": "(Not
  seen with the default skin: a shot started over the API left streamline.js on
  screen. Not tried with CafAI.)"
- L190-191: "Espresso that follows the profile and stops at the target weight
  on the simulated scale." -> "Espresso that follows the profile on the
  simulated scale; it stops at the target weight only if the cup gets there
  first (Blooming Espresso v1 ran out of steps at 47 g of 50 g, stopReason
  "machineEnded")."
- Section 1: "Closing the window ends Decaid within seconds. 0.8.7 exits with
  code 0xC000041D but keeps settings, shots and CafAI's backup."
Check each against the doc's current text; if a line moved or reads
differently, apply the intent and say so.

## You own (create or modify only these)

`src/api/telemetry.ts` (+ test), the machine panel's timer
(`src/ui/machine/**` if the timer lives there), `mock/decaid/shotPlayer.ts`
(+ test), `docs/SIMULATOR.md`. Everything else is read-only.

## Verify and report

Run and report exit codes (capture with `cmd > "$TEMP/x.log" 2>&1; echo
exit=$?`, never through `| tail`): `npm ci` (first), `npx tsc -p
tsconfig.json --noEmit`, `npx eslint .`, `npx vitest run`. No Playwright, no
Decaid. Final message (at most 40 lines): worktree path and branch, files
changed, tests added, commands with exit codes.
