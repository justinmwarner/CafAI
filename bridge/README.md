# CafAI Bridge

CafAI Bridge lets the CafAI coach answer through the Claude Code on your own
computer, signed in with your Claude Pro or Max plan. CafAI then needs no
Anthropic API key and no API tokens are billed: the coach's turns count
against your plan's usage limits instead.

It is a small Node program with no dependencies. It runs on Windows and
macOS, and on Linux (there you save the start-by-itself units yourself).
CafAI, on the tablet, a phone or the same computer, reaches it over your home
network.

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

In CafAI's folder, in a terminal:

```
npm install
npm run bridge
```

The first time, `npm run bridge` walks you through the setup. Each question
shows its usual answer in [brackets]: press Enter to take it, or type q to
quit.

1. **Claude Code.** It checks that Claude Code is installed and signed in,
   and waits while you install it or sign in. Then it offers one test turn
   (it uses a little of your plan).
2. **Where CafAI runs:** on a tablet or phone on this network, or only on
   this computer.
3. **When the bridge runs:** every morning on a schedule (05:00 to 10:00
   unless you pick other times), always from sign-in, or only when you start
   it.
4. **The firewall** (Windows): it checks that devices on your network can
   reach the bridge, and offers to let it in (Windows asks for permission).
5. It sets that up, starts the bridge if it should run now, and shows the
   address and the code.

In CafAI, open **Settings > Where the coach runs**, choose **Claude on my
computer**, and enter the address and the code. Save, then Test.

To change your answers later: `npm run bridge -- setup`.

After the first setup, `npm run bridge` runs the bridge in that window
(Ctrl+C stops it) and shows something like:

```
CafAI Bridge 0.1.0
Claude Code 2.1.295: C:\Users\me\AppData\Roaming\Claude\claude-code\2.1.295\...\claude.exe
Signed in with your Claude plan (max).

In CafAI: Settings > Where the coach runs > Claude on my computer
  Address: 192.168.1.20
  Address: 127.0.0.1   (if Decaid runs on this computer)
  Code:    K7QM-2XWD
```

The code keeps other devices on your network out. It is made once and kept;
`npm run bridge -- code` shows it again. The bridge's log never holds it.

**Decaid on the same computer.** When Decaid (and CafAI in it) runs on the
computer the bridge runs on, use the address `127.0.0.1`.

## Every morning on a schedule

With a schedule the bridge starts at the start time and stops by itself at
the end, every day or Monday to Friday. It also starts when you sign in
during the window, and it starts late (within the window only) when the
computer was off or asleep at the start time. Setup asks for the times; or
run `npm run bridge -- install --window 05:00-10:00` (add `--weekdays`,
`--keep-awake`).

Keep this computer awake (setup asks; `--keep-awake`) holds the computer
awake while the bridge runs, without admin rights, and lets it sleep again
when the bridge stops.

The computer has to be on, or asleep with wake timers allowed. A computer
that is shut down does not start.

- **Windows.** The schedule is a Task Scheduler task named "CafAI Bridge"
  (it replaces a start at sign-in). At the start time a console window
  flashes for a few seconds while it starts the bridge in the background.
  - It wakes the computer from sleep at the start time unless you said no
    (`--no-wake`). Wake timers must be allowed: Control Panel > Power Options
    > Change plan settings > Change advanced power settings > Sleep > Allow
    wake timers: Enable. Many laptops allow only "Important wake timers" on
    battery.
  - The task runs only while you are signed in; a locked screen is fine.
    After an overnight Windows Update restart nobody is signed in, so the
    bridge does not start: turn on "Use my sign-in info to automatically
    finish setting up after an update" (Settings > Accounts > Sign-in
    options), or sign in once.
- **macOS.** The schedule lives in the LaunchAgent
  (`~/Library/LaunchAgents/com.cafai.bridge.plist`). launchd starts the
  bridge at the start time, or when the Mac wakes if it slept through it.
  macOS wakes for it only with a wake schedule, which needs admin rights, so
  the bridge prints the command for you to run once, for example
  `sudo pmset repeat wakeorpoweron MTWRFSU 04:59:00`.
- **Linux.** `install --window` prints a systemd user service and timer to
  save in `~/.config/systemd/user/`; then run
  `systemctl --user daemon-reload` and
  `systemctl --user enable --now cafai-bridge.timer`.

`status` and `doctor` show the schedule, whether the Windows task wakes the
computer, and whether the bridge should be running right now.

## Keep it running

- `npm run bridge -- start` runs the bridge in the background and shows the
  address and code. Its output goes to a log. With `--window 05:00-10:00` it
  starts only within that window and stops itself at its end.
- `stop` stops it. `status` says whether it runs, its addresses, the code,
  whether and when it starts by itself, and where its log is.
- `install` starts it whenever you sign in to the computer, and starts it
  now. It needs no admin rights. `install --window` sets a schedule instead.
  `uninstall` removes both; a bridge that is running keeps running until
  `stop`.

`install` remembers the options you give it (`--window`, `--weekdays`,
`--keep-awake`, `--port`, `--host`, `--claude`, `--max-runs`,
`--idle-minutes`, `--allow-api-key`, `--config-dir`). If you move CafAI's
folder or install another Node, run `install` (or setup) again.

## Firewall, Public networks and VPNs

- **Windows Defender Firewall.** The first time the bridge starts, Windows
  may ask whether Node.js may communicate on your networks: allow it on
  **Private networks**. Setup checks this for you, and so does
  `npm run bridge -- firewall`: it shows each connected network and whether
  the firewall lets the bridge in, and offers to add a rule named
  "CafAI Bridge" for Node.js on the bridge's port (Windows asks for
  permission once). Reading the settings needs no admin rights.
- **Public networks.** Windows treats a network marked Public as one you do
  not trust, like a coffee shop's Wi-Fi, and keeps other devices on it from
  reaching this computer. If your home network is marked Public, the
  firewall step offers to mark it Private (you can also do it in Settings >
  Network & internet > your network). Private means a network you trust:
  other devices on it may find and reach this computer. It also offers to
  let the bridge in on Public networks, which you should only do if that
  network is your own.
- **VPNs.** While a VPN is connected, many VPN apps block the home network.
  Turn on "allow LAN" (or "local network sharing") in the VPN app, or the
  tablet cannot reach the bridge. Setup and `doctor` say when a VPN is up.
- **macOS.** If the macOS firewall is on, it asks whether `node` may accept
  incoming network connections: click **Allow**. To check later: System
  Settings > Network > Firewall > Options.
- **Linux.** If a firewall runs (ufw, firewalld), allow TCP port 8877 from
  your network, for example `sudo ufw allow 8877/tcp`.

## Windows

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

- **Start at login.** `install` adds a LaunchAgent,
  `~/Library/LaunchAgents/com.cafai.bridge.plist`. launchd starts the bridge
  at login, and again after a crash, but not after `stop` or the end of a
  schedule's window. Its log is `~/Library/Logs/CafAI Bridge/bridge.log`
  (Console.app shows it).
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

For a schedule, see above. The bridge's folder is `~/.config/cafai-bridge`.

## Commands

Run them in CafAI's folder as `npm run bridge -- <command>`, or
`node bridge/cafai-bridge.mjs <command>`.

| Command | What it does |
| --- | --- |
| `setup` | Sets it up step by step (the first `npm run bridge` in a terminal runs it). |
| `serve` | Runs the bridge in this window and shows the address and code (no command, after setup). |
| `start` | Runs it in the background. |
| `stop` | Stops it. |
| `status` | Running or not, the addresses, the code, how it starts by itself and its schedule, the log. |
| `install` | Starts it at sign-in, or with `--window` on a schedule, and now (`--no-start`: not now). |
| `uninstall` | Stops starting it by itself. |
| `doctor` | Checks Node, Claude Code, its sign-in, one real turn, the port, the network, the firewall and the schedule. |
| `firewall` | Windows: checks the firewall and lets the bridge in. |
| `code` | Shows the code. `code --new` makes a new one. |
| `help` | Lists the commands and options. |

| Option | What it does |
| --- | --- |
| `--window <from-to>` | Run only within this daily window, such as `05:00-10:00` (it may cross midnight). |
| `--weekdays` | Only Monday to Friday (with `--window`). |
| `--keep-awake` | Keep the computer awake while the bridge runs. |
| `--no-wake` | `install --window`: do not wake the computer from sleep at the start (Windows). |
| `--port <n>` | The port (default 8877). Add any other port to the address in CafAI: `192.168.1.20:9000`. |
| `--host <address>` | Listen on this address only (default: every network of the computer). |
| `--claude <path>` | Use this Claude Code instead of the newest one found. |
| `--max-runs <n>` | Conversations kept running at once (default 3). |
| `--idle-minutes <n>` | Close a conversation idle this long (default 30). |
| `--allow-api-key` | Let coach runs use `ANTHROPIC_API_KEY`, billed to that key. Without it the bridge removes the key from coach runs. |
| `--config-dir <dir>` | Keep the code, the log and the work folder in `<dir>`. |
| `--model <id>` | `doctor`: the model for its test turn (default claude-haiku-4-5). |
| `--no-probe` | `doctor`, `setup`: skip the test turn. |

**Setup without questions** (for scripts): `--yes` takes the usual answers
and asks nothing.

```
npm run bridge -- setup --yes --schedule 05:00-10:00 [--weekdays] [--keep-awake | --no-keep-awake] [--no-wake] [--host <address>] [--port <n>] [--no-probe] [--firewall]
npm run bridge -- setup --yes --always [--keep-awake]
npm run bridge -- setup --yes --manual
```

With `--yes` the firewall is checked only with `--firewall`, and the rule it
adds never covers Public networks, nor does it mark any network Private;
`firewall --yes` does the same on its own.

The bridge's folder holds `config.json` (the code and your setup answers),
`bridge.log`, `bridge.pid` while it runs, and `work`, the empty folder
Claude Code runs in.

## Privacy and terms

- CafAI Bridge is for your own use, with your own Claude plan.
- It runs the unmodified Claude Code you installed and signed in to through
  Anthropic's own sign-in. It never reads, stores or forwards your Claude
  sign-in or tokens, and never calls Anthropic's API itself.
- Coach runs use none of your Claude Code settings, hooks, plugins, skills or
  CLAUDE.md files, in an empty folder, with the coach's own tools. Of Claude
  Code's built-in tools they use only WebSearch, and that only when CafAI's
  Settings > Coach > Fun facts includes a web search; its searches stay
  inside Claude Code. Nothing is added to Claude Code's session history.
- The pairing code keeps other devices on your network out. A device that
  sends five wrong codes is locked out for a while.
- The log holds times, message counts, durations, model names and the
  bridge's own events (the address of a device that sent a wrong code,
  Claude Code's version and error output), never what you or the coach
  wrote, and never the code (`code` shows it).
- The coach's usage counts against your plan's limits, like any other use of
  Claude, its web searches included.

## Troubleshooting

Start with `npm run bridge -- doctor`. It checks Node, every Claude Code it
finds, the sign-in, one real turn, the port, the network, the firewall and
the schedule, and says what to do about each problem.

- **CafAI cannot reach the bridge.** Check that the bridge runs (`status`),
  that the tablet is on the same network as the computer (not a guest
  network), that the firewall lets it in (`firewall`), and that a VPN allows
  LAN connections. The computer's address can change when it or the router
  restarts: `status` shows the current one, and your router can keep a fixed
  address for the computer. A computer that sleeps does not answer: keep it
  awake while you brew (`--keep-awake`).
- **The scheduled bridge did not start.** `status` says whether it should be
  running now. On Windows: were you signed in (after an update restart,
  nobody is)? Are wake timers allowed? Is the task enabled in Task
  Scheduler? On a Mac: was the Mac awake, or set to wake with `pmset`?
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
