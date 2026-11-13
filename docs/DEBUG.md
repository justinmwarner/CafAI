# CafAI's DEBUG flag

A switch for chasing a problem on a real tablet, such as a start that hangs after the
tablet slept. It is off unless someone turns it on from a computer on the same network.
Nothing in CafAI's own screens turns it on. Everything it collects stays on the LAN: it
goes to CafAI Bridge on your computer and to Decaid's own store, never to Anthropic or
Clarity.

## Turning it on and off

- **Decaid's store.** Set `cafai-debug/flags` on the tablet's Decaid:

  ```sh
  curl -X POST http://<tablet>:8080/api/v1/store/cafai-debug/flags \
    -H 'content-type: application/json' -d '{"enabled": true}'
  ```

  The next page that starts reads it, a moment after its start. The device keeps that
  answer in its own storage (`cafai.debug`), so every page after has the flag from its
  first line. Turn it off with `-d '{"enabled": false}'`, or delete the key.
- **A debug build.** `VITE_CAFAI_DEBUG=1 npm run release:zip` builds a zip with the flag on
  from the first page, whatever Decaid's store says.
- **One page.** `?debug=1` in the address turns it on for that page only, for a desktop
  browser or the mocks.

## What it does while on

From the page's first line:

- It lists every IndexedDB transaction in flight: the database, mode and stores, and how
  long it has been open. Every page keeps that list (`src/storage/openTransactions.ts`)
  and aborts what is on it as it is put away (`src/storage/pageExit.ts`, D284). With the
  flag on, the list also has the stack that opened each transaction. It also notes every
  request waiting on an answer (`src/debug/watch.ts`).
- It notes the page's lifecycle: hidden, visible, `pagehide` and `pageshow` with
  `persisted`, plus `freeze`, `resume`, online and offline. It also notes how the page
  came: navigation type, history length (`src/debug/lifecycle.ts`).
- It keeps the console's last 300 lines.

At each of these moments it writes a `[CafAI] debug:` line to the console with what the
page has open:

- when the page is hidden or shown;
- when the page is put away;
- when a report goes.

It also sends a report.

**Reports** go to CafAI Bridge when the coach runs on a computer. The bridge adds each to
`debug-reports.jsonl` beside its `bridge.log`, one JSON line per report. On Windows that
is `%APPDATA%\CafAI Bridge`; on a Mac, `~/Library/Application Support/CafAI Bridge`; on
Linux, `~/.config/cafai-bridge`. Each report also leaves a copy in Decaid's store as
`cafai-debug/last-<kind>`, the last of each kind. A report is sent:

- **hidden**, **pagehide**: as a beacon, which goes out even if the page stops right
  after.
- **visible**, **pageshow**: when the page comes back.
- **slow-start**: by itself when the start is slow (8 s). It goes after the IndexedDB
  probe and before the start's one automatic retry.
- **manual**: by hand, from "Send debug report" on the start screen ("Starting CafAI…"
  and "CafAI could not start"). The button shows only while the flag is on. It runs the
  probe first. The sentence under the button says where the report went.

**The IndexedDB probe** (`src/debug/probe.ts`) tries CafAI's databases one by one, each on
a connection of its own and given 3 s: read-only, then read-write, then a database of its
own. A write held up by a transaction another page left open shows as reads that answer
and writes that time out. The read-write probes only read, and a database that is not
there is not made.

## Reading what came

- The bridge's file: one report per line, as `{receivedAt, from, report}`.
- Decaid's store: `GET http://<tablet>:8080/api/v1/store/cafai-debug/last-slow-start`
  (and `last-manual`, `last-pagehide`, …).
- Decaid's WebView log, which has every `[CafAI]` line:
  `GET http://<tablet>:8080/api/v1/webview/logs`. Decaid stamps each line when it reads
  it, which can be long after the page wrote it. Each `debug:` line carries the page's own
  time too.
