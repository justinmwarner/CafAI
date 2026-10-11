# CafAI Bridge

CafAI Bridge lets the CafAI coach answer through the Claude Code on your own
computer, signed in with your Claude Pro or Max plan. CafAI then needs no
Anthropic API key and no API tokens are billed: the coach's turns count
against your plan's usage limits instead.

It is a small Node program with no dependencies. It runs on Windows and
macOS, and on Linux without the start-at-login part. CafAI, on the tablet, a
phone or the same computer, reaches it over your home network.

## What you need

- **Claude Code, signed in with your Claude plan.** Install it from
  https://claude.com/claude-code, open a terminal, run `claude` once and sign
  in with `/login`. The Claude desktop app keeps its own Claude Code up to
  date, and the bridge finds that one too. With several on the computer, the
  bridge uses the newest.
- **Node 18 or newer** (https://nodejs.org).
- **CafAI's folder** (this repository) on that computer.
- The tablet and the computer **on the same network**.

## Quick start

In CafAI's folder, run:

```
npm run bridge
```

(or `node bridge/cafai-bridge.mjs`). It shows something like:

```
CafAI Bridge 0.1.0
Claude Code 2.1.290: C:\Users\me\.local\bin\claude.exe
Signed in with your Claude plan (max).

In CafAI: Settings > Where the coach runs > Claude on my computer
  Address: 192.168.1.20
  Address: 127.0.0.1   (if Decaid runs on this computer)
  Code:    K7QM-2XWD
```

In CafAI, open **Settings > Where the coach runs**, choose **Claude on my
computer**, and enter the address and the code. Save, then Test.

The bridge runs while that window is open; Ctrl+C stops it. To keep it
running, see below.

The code keeps other devices on your network out. It is made once and kept;
`node bridge/cafai-bridge.mjs code` shows it again.

**Decaid on the same computer.** When Decaid (and CafAI in it) runs on the
computer the bridge runs on, use the address `127.0.0.1`.

## Keep it running

- `node bridge/cafai-bridge.mjs start` runs the bridge in the background and
  shows the address and code. Its output goes to a log.
- `stop` stops it. `status` says whether it runs, its addresses, the code,
  whether it starts at sign-in, and where its log is.
- `install` starts it whenever you sign in to the computer, and starts it
  now. It needs no admin rights. `uninstall` undoes that; a bridge that is
  running keeps running until `stop`.

`install` remembers the options you give it (`--port`, `--host`, `--claude`,
`--max-runs`, `--idle-minutes`, `--allow-api-key`, `--config-dir`). If you
move CafAI's folder or install another Node, run `install` again.

## Windows

- **Firewall.** The first time the bridge starts, Windows Defender Firewall
  asks whether Node.js may communicate on your networks. Allow it on
  **Private networks**. If your home network is marked Public, mark it
  Private (Settings > Network & internet > your network) or allow Node.js on
  public networks too. Missed the question? Windows Security > Firewall &
  network protection > Allow an app through firewall > Node.js.
- **Start at sign-in.** `install` puts a shortcut named CafAI Bridge in your
  Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`).
  At sign-in a minimized window flashes while it starts the bridge in the
  background. If the shortcut cannot be made, `install` uses your Run
  registry key instead.
- **Several Claude Codes.** A computer can have more than one: the native
  installer's (`%USERPROFILE%\.local\bin`), WinGet's, npm's, the Claude
  desktop app's. The bridge uses the newest. `doctor` lists them all and says
  when an older one comes first on PATH.
- The bridge's folder is `%APPDATA%\CafAI Bridge`; its log is `bridge.log`
  in it.

## macOS

- **Firewall.** If the macOS firewall is on, it asks whether `node` may
  accept incoming network connections: click **Allow**. To check later:
  System Settings > Network > Firewall > Options.
- **Start at login.** `install` adds a LaunchAgent,
  `~/Library/LaunchAgents/com.cafai.bridge.plist`. launchd starts the bridge
  at login, and again after a crash, but not after `stop`. Its log is
  `~/Library/Logs/CafAI Bridge/bridge.log` (Console.app shows it).
- **Signed out only when started at login.** If CafAI's Test or `status`
  says Claude Code is not signed in while `doctor` in Terminal says it is,
  sign in once more in Terminal (`claude`, then `/login`) and restart the
  bridge (`stop`, then `start`). The last resort is Claude Code's own
  `claude setup-token`: it prints a long-lived token, which you add yourself
  as `CLAUDE_CODE_OAUTH_TOKEN` under `EnvironmentVariables` in the plist,
  then reload the agent (`launchctl bootout gui/$(id -u)/com.cafai.bridge`,
  then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cafai.bridge.plist`).
  Running `install` again writes a new plist without it. The bridge never
  reads or stores that token: launchd hands it to Claude Code.
- The bridge's folder is `~/Library/Application Support/CafAI Bridge`.

## Linux

The bridge runs the same way. `install` installs nothing: it prints a
systemd user unit for you to save, then `systemctl --user` starts it:

```
mkdir -p ~/.config/systemd/user
node bridge/cafai-bridge.mjs install > ~/.config/systemd/user/cafai-bridge.service
systemctl --user daemon-reload
systemctl --user enable --now cafai-bridge
```

If a firewall runs (ufw, firewalld), allow TCP port 8877 from your network.
The bridge's folder is `~/.config/cafai-bridge`.

## Commands

Run them in CafAI's folder as `node bridge/cafai-bridge.mjs <command>`, or
`npm run bridge -- <command>`.

| Command | What it does |
| --- | --- |
| `serve` | Runs the bridge in this window and shows the address and code (the default). |
| `start` | Runs it in the background. |
| `stop` | Stops it. |
| `status` | Running or not, the addresses, the code, start at sign-in, the log. |
| `install` | Starts it at sign-in, and now (`--no-start`: not now). |
| `uninstall` | Stops starting it at sign-in. |
| `doctor` | Checks Node, Claude Code, its sign-in, one real turn, the port and the network. |
| `code` | Shows the code. `code --new` makes a new one. |
| `help` | Lists the commands and options. |

| Option | What it does |
| --- | --- |
| `--port <n>` | The port (default 8877). Add any other port to the address in CafAI: `192.168.1.20:9000`. |
| `--host <address>` | Listen on this address only (default: every network of the computer). |
| `--claude <path>` | Use this Claude Code instead of the newest one found. |
| `--max-runs <n>` | Conversations kept running at once (default 3). |
| `--idle-minutes <n>` | Close a conversation idle this long (default 30). |
| `--allow-api-key` | Let coach runs use `ANTHROPIC_API_KEY`, billed to that key. Without it the bridge removes the key from coach runs. |
| `--config-dir <dir>` | Keep the code, the log and the work folder in `<dir>`. |
| `--model <id>` | `doctor`: the model for its test turn (default claude-haiku-4-5). |
| `--no-probe` | `doctor`: skip the test turn. |

The bridge's folder holds `config.json` (the code), `bridge.log`,
`bridge.pid` while it runs, and `work`, the empty folder Claude Code runs in.

## Privacy and terms

- CafAI Bridge is for your own use, with your own Claude plan.
- It runs the unmodified Claude Code you installed and signed in to through
  Anthropic's own sign-in. It never reads, stores or forwards your Claude
  sign-in or tokens, and never calls Anthropic's API itself.
- Coach runs use none of your Claude Code settings, hooks, plugins, skills or
  CLAUDE.md files and none of its built-in tools: only the coach's own tools,
  in an empty folder. Nothing is added to Claude Code's session history.
- The pairing code keeps other devices on your network out. A device that
  sends five wrong codes is locked out for a while.
- The log holds times and sizes, never what you or the coach wrote, and
  never the code (`code` shows it).
- The coach's usage counts against your plan's limits, like any other use of
  Claude.

## Troubleshooting

Start with `node bridge/cafai-bridge.mjs doctor`. It checks Node, every
Claude Code it finds, the sign-in, one real turn, the port and the network,
and says what to do about each problem.

- **CafAI cannot reach the bridge.** Check that the bridge runs (`status`),
  that the tablet is on the same network as the computer (not a guest
  network), and that the firewall lets Node.js in (see Windows or macOS
  above). The computer's address can change when it or the router restarts:
  `status` shows the current one, and your router can keep a fixed address
  for the computer. A computer that sleeps does not answer: keep it awake
  while you brew.
- **Not signed in.** Open a terminal on the computer, run `claude` and sign
  in with `/login`. If Claude Code is signed in with an API key, the coach
  would be billed to that key: sign in with your Claude plan instead.
- **Usage limit reached.** Your plan's limit resets after a few hours; CafAI
  says when. `status` shows how much of it is used.
- **Claude Code is too old for the model.** Run `claude update`, or update
  the Claude desktop app.
- **Claude Code never answers.** An old Claude Code can start and then never
  answer. Run `claude update`. When `doctor` lists several, the bridge uses
  the newest; `--claude <path>` picks one.
- **Port in use.** Another program uses port 8877, or the bridge already runs
  (`status`). Pick another port with `--port 9000` and add it to the address
  in CafAI (`192.168.1.20:9000`).
- **A new code.** `code --new` makes one. Enter it in CafAI, then restart a
  running bridge: `stop`, then `start`.
