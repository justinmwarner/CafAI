# CafAI roadmap

Things the owner wants next that are not built yet. Each item says why, the
shape of the work, and what has to be checked first. Decisions that put an
item here are in [DECISIONS.md](../DECISIONS.md).

## Claude on your computer: what is left (D130-D136)

Built on 2026-10-11 (D56's item): CafAI Bridge (`bridge/`, its README)
answers the coach through the owner's own Claude Code and plan, on a Mac or
a Windows PC, and CafAI's Settings chooses where the coach runs. It runs
the `claude` command itself rather than the Agent SDK: Claude Code's legal
page sends products built on the SDK to API keys, while signing in to the
unmodified Claude Code with one's own plan is ordinary use; and the command
needs nothing installed beside Claude Code (D130). Left:

- **Re-find a computer whose address changed**, the way Crema sweeps the
  saved address's /24 (`crema/web/src/advice/discover.ts`). Today Settings
  says the bridge cannot be reached and the bridge prints its new address.
- **One file to download** for people who install CafAI from a release zip
  rather than the repository (the bridge is plain Node modules today), and
  perhaps a packaged app with a tray icon instead of a console.
- **The address in Decaid's backup**, so a reinstalled skin keeps it (the
  code would stay on the device, like the API key).
- **Starting at login on Linux** (a systemd user unit; the bridge itself
  runs there).
- **A morning of dial-in on the plan**: how much of the 5-hour window a
  session of Opus 5.5 turns uses, measured on a real machine.

## Smaller items carried from MORNING.md

- Teaching mode, personas, cross-user learning, voice. (Bag photos came
  with the Decaid alignment, 2026-10-10: D120.)
- A screensaver. (Steam, hot water and flush settings, Connect for a
  dropped machine or scale, and the link to Decaid's bean and batch
  entities came with the Decaid alignment: D114, D111, D102.)
