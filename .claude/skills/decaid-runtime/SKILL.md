---
name: decaid-runtime
description: Use when CafAI work needs a running Decaid - calling its REST API or WebSockets by hand, starting or driving the simulator (MockDe1, Mock Scale), smoke-testing a change against Decaid or a tablet, reading Decaid's own agent skill in contract/decaid/skill/, or checking how Decaid behaves beyond its spec.
---

# Decaid at runtime, from CafAI

CafAI is a skin: a client of Decaid's REST and WebSocket API, never a change to Decaid. `contract/decaid/skill/` is Decaid's own agent skill and `contract/decaid/doc/AI_API_NOTES.md` its API notes, verbatim at the commit in `contract/decaid/PIN.json`. They are written for people changing Decaid's Flutter code: use their facts, not their workflow.

## Reading Decaid's skill from CafAI

| Decaid's skill says | In CafAI |
|---|---|
| `scripts/sb-dev.sh`, `flutter run`, reload | Not here (and POSIX-only): the Windows simulator, below and docs/SIMULATOR.md |
| `assets/api/rest_v1.yml`, `websocket_v1.yml` | `contract/decaid/spec/`, the pinned copies |
| `lib/src/...`, `doc/...`, root `AGENTS.md` | Decaid at the pinned commit: `git -C <main checkout>\.ref\decaid show <commit>:<path>` (a gitignored clone, so only in the main checkout that `git worktree list` names first, and often at another commit), else `https://github.com/decentespresso/decaid/blob/<commit>/<path>` |
| Update the spec in the same commit | Never edit `contract/decaid/spec/`, `skill/` or `doc/`: `npm run typecheck` fails. A wrong spec, per contract/decaid/README.md: CafAI's types, readers and fixtures follow what Decaid sends, `drift.ts` records the spec's error with the Dart line (a type fragment, or a `SPEC_EXCEPTIONS` entry), and docs/upstream/decaid-spec-fixes.md gets an entry |
| `curl ... \`, `$BASE`, `\| jq` | Bash: run its `curl` lines in Git Bash, `127.0.0.1` for `localhost`, and drop `\| jq` when jq is missing. In PowerShell use `Invoke-RestMethod` |
| `websocat` | Usually missing on Windows: Node, below |
| `lifecycle.md`, `verification.md`, `troubleshooting.md`, scenario postconditions | Decaid's dev loop: skip |

## Where to look

| Need | Read |
|---|---|
| REST calls, gotchas the spec leaves out, Decaid's log (`/api/v1/logs`) | `contract/decaid/skill/rest.md` |
| WebSocket channels | `contract/decaid/skill/websocket.md` |
| Simulated devices: ids vs names, scale weight, an empty first scan | `contract/decaid/skill/simulated-devices.md` |
| How a feature behaves (CORS, ETags, shotState, stop-at-weight, default profiles, API limits) | `contract/decaid/skill/scenarios/README.md`, then that scenario's expected output |
| Envelopes, ETags, PATCH and explicit nulls | `contract/decaid/doc/AI_API_NOTES.md` |

## On Windows

A Decaid may already run for someone else's work, with a CafAI page in its window that notes shots in its active bag. Check with a command that prints `True` or `False` (a found process can print as a blank row when a table came first):

```powershell
[bool](Get-Process Decaid -ErrorAction SilentlyContinue)
```

`True`: only read; do not close it, scan, write or start shots without asking. `False`: start your own from the folder it was unzipped into (docs/SIMULATOR.md part 1 suggests `C:\Tools\Decaid`: `Get-ChildItem C:\Tools -Directory -Filter Decaid*`), wait for its API, and close only yours when done:

```powershell
$decaid = Start-Process <folder>\Decaid.exe -ArgumentList '--bypass-onboarding','--no-account' -PassThru
do { Start-Sleep 1 } until ($(try { Invoke-RestMethod http://127.0.0.1:8080/api/v1/devices -TimeoutSec 5 | Out-Null; $true } catch { $false }))
$decaid.CloseMainWindow()
```

Use `127.0.0.1`, not `localhost` (IPv6 first costs seconds). Three frames from a channel with Node's own WebSocket (PowerShell or Git Bash; it gives up after 5 s, and says so when nothing listens). Some channels send only on change: shotState sends one frame, then nothing until a shot runs.

```bash
node -e "const ws=new WebSocket('ws://127.0.0.1:8080/ws/v1/machine/snapshot');let n=0;ws.onerror=()=>{console.error('no connection');process.exitCode=1};ws.onmessage=(e)=>{console.log(e.data);if(++n===3)ws.close()};setTimeout(()=>ws.close(),5000).unref()"
```

## Proving a CafAI change

- `npm run test:decaid` with `DECAID_URL` (reads only). `DECAID_WRITE=1` and `DECAID_SIM=1` only on a Decaid you started (`False` above): docs/SIMULATOR.md part 6.
- `npm run e2e:real`: after `npm run build`, with Decaid started with `'--skin-path','<this checkout>\dist'`, not another checkout's (a running Decaid's flags: `(Get-CimInstance Win32_Process -Filter "Name='Decaid.exe'").CommandLine`).
- `npm run typecheck`: CafAI's types against the pinned specs.

## When Decaid's docs change

They move only with the pin: `npm run decaid:update -- <tag>` replaces specs and docs together, and the drift watch lists their changes in its `decaid-read` issue (contract/decaid/README.md). Then check that these tables still fit.
