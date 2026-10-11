#!/usr/bin/env node
// CafAI Bridge: the CafAI coach answers through this computer's own Claude
// Code, signed in with the owner's Claude Pro or Max plan, instead of a
// metered Anthropic API key (docs/superpowers/specs/2026-10-11-local-claude-design.md).
//
// `setup` walks through everything (the first `npm run bridge` in a terminal
// runs it); `serve` (the default after setup) runs the bridge in this terminal
// and shows the address and pairing code to type into CafAI; `start`, `stop`
// and `status` run it in the background; `install` and `uninstall` start it by
// itself, at sign-in or every morning in a window (--window 05:00-10:00);
// `doctor` checks Claude Code, its sign-in and one real turn; `firewall` lets
// the bridge through Windows Defender Firewall; `code` shows or renews the
// code. The server is lib/server.mjs; this file is the command line around it.
// Every command gets what it touches (fetch, spawn, the server and Claude Code
// helpers, output, questions, the clock) in one `deps` object, so tests pass fakes.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autostartStatus, installAutostart, macPaths, nodeFs, pmsetWakeCommand, runCommand, TASK_NAME, uninstallAutostart } from './lib/autostart.mjs';
import { keepAwakeCommand } from './lib/awake.mjs';
import { configDir, formatCode, generateCode, loadConfig, paths, saveConfig } from './lib/config.mjs';
import { elevatedFirewallScript, firewallVerdict, readFirewall, runElevated } from './lib/firewall.mjs';
import { lanAddresses, vpnAdapters } from './lib/net.mjs';
import { askChoice, askTime, askYesNo, pressEnter, SetupQuit, terminalPrompt } from './lib/prompt.mjs';
import { armWindowEnd, describeWhen, describeWindow, formatTime, inWindow, nextStart, parseTime, parseWindow } from './lib/window.mjs';

export const VERSION = '0.1.0';
export const DEFAULT_PORT = 8877;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_WINDOW = '05:00-10:00';
const CLAUDE_DOWNLOAD = 'https://claude.com/claude-code';
const SCRIPT = fileURLToPath(import.meta.url);
const CAFAI_SETTING = 'In CafAI: Settings > Where the coach runs > Claude on my computer';
const SETUP_AGAIN = 'npm run bridge -- setup';
const API_KEY_SIGN_IN = /api.?key|console/i;
// The Claude desktop app's own copy: %APPDATA%\Claude\claude-code\<version>\..., ~/Library/Application Support/Claude/claude-code/...
const DESKTOP_APP_CLAUDE_CODE = /[\\/]Claude[\\/]claude-code[\\/]/i;

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

const COMMANDS = ['setup', 'serve', 'start', 'stop', 'status', 'install', 'uninstall', 'doctor', 'firewall', 'code', 'help'];

const wholeNumber = (min, max) => (text) => (/^\d+$/.test(text) && Number(text) >= min && Number(text) <= max ? Number(text) : undefined);
const nonEmpty = (text) => (text.trim() === '' ? undefined : text);
// The model ids the server accepts too.
const modelId = (text) => (/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/.test(text) ? text : undefined);
const windowText = (text) => parseWindow(text)?.text;

/** Flags with a value: [option, parser (undefined = invalid), what a valid value is]. */
const VALUE_FLAGS = {
  '--port': ['port', wholeNumber(1, 65535), 'a port number from 1 to 65535'],
  '--host': ['host', nonEmpty, 'an address'],
  '--claude': ['claude', nonEmpty, 'the path of a Claude Code program'],
  '--max-runs': ['maxRuns', wholeNumber(1, 20), 'a whole number from 1 to 20'],
  '--idle-minutes': ['idleMinutes', wholeNumber(1, 1440), 'a whole number of minutes from 1 to 1440'],
  '--config-dir': ['configDir', nonEmpty, 'a folder'],
  '--model': ['model', modelId, 'a model id such as claude-haiku-4-5'],
  '--window': ['window', windowText, 'a daily window of two different times, such as 05:00-10:00'],
  '--schedule': ['schedule', windowText, 'a daily window of two different times, such as 05:00-10:00'],
};

/** Flags without a value: [option, value]. */
const SWITCHES = {
  '--allow-api-key': ['allowApiKey', true],
  '--no-start': ['noStart', true],
  '--no-probe': ['noProbe', true],
  '--new': ['new', true],
  '--weekdays': ['weekdays', true],
  '--keep-awake': ['keepAwake', true],
  '--no-keep-awake': ['keepAwake', false],
  '--no-wake': ['wake', false],
  '--yes': ['yes', true],
  '-y': ['yes', true],
  '--always': ['mode', 'always'],
  '--manual': ['mode', 'manual'],
  '--firewall': ['firewall', true],
  '--help': ['help', true],
  '-h': ['help', true],
  '--version': ['version', true],
};

/**
 * Split the command line into the command and its options. `bare` is true
 * when no command (and no option but --config-dir) was given: in a terminal,
 * before the first setup, that runs setup instead of serve.
 * @param {string[]} argv  The arguments after the script.
 * @returns {{ command: string, options: Record<string, any>, bare: boolean, error?: string }}
 */
export function parseArgs(argv) {
  const options = {};
  const setBy = {};
  let command = null;
  const fail = (error) => ({ command: 'help', options, bare: false, error });
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
      const name = eq > 0 ? arg.slice(0, eq) : arg;
      const flag = VALUE_FLAGS[name];
      if (flag) {
        const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
        if (value === undefined || (eq < 0 && value.startsWith('--'))) return fail(`${name} needs ${flag[2]}.`);
        const parsed = flag[1](value);
        if (parsed === undefined) return fail(`${name} needs ${flag[2]}, not "${value}".`);
        options[flag[0]] = parsed;
        setBy[flag[0]] = name;
      } else if (SWITCHES[name] && eq < 0) {
        const [key, value] = SWITCHES[name];
        if (key in options && options[key] !== value) return fail(`Use only one of ${setBy[key]} and ${name}.`);
        options[key] = value;
        setBy[key] = name;
      } else {
        return fail(`Unknown option ${arg}.`);
      }
    } else if (command === null) {
      if (!COMMANDS.includes(arg)) return fail(`Unknown command "${arg}".`);
      command = arg;
    } else {
      return fail(`Unexpected "${arg}" after ${command}.`);
    }
  }
  if (options.help) return { command: 'help', options, bare: false };
  if (options.version) return { command: 'version', options, bare: false };
  const chosen = command ?? 'serve';
  for (const key of ['schedule', 'mode', 'firewall']) {
    if (key in options && chosen !== 'setup') return fail(`${setBy[key]} only works with setup.`);
  }
  if (options.yes && chosen !== 'setup' && chosen !== 'firewall') return fail(`${setBy.yes} only works with setup and firewall.`);
  if (chosen === 'setup') {
    if (options.mode && (options.schedule || options.window)) return fail('Use only one of --schedule, --always and --manual.');
    if (options.weekdays && options.mode) return fail('--weekdays goes with a schedule (--schedule 05:00-10:00).');
  } else if (options.weekdays && !options.window) {
    return fail('--weekdays goes with --window (for example --window 05:00-10:00 --weekdays).');
  }
  return { command: chosen, options, bare: command === null && Object.keys(options).every((key) => key === 'configDir') };
}

/** How to run this script from the current folder, for hints: "node bridge/cafai-bridge.mjs". */
function selfCommand(deps) {
  const relative = path.relative(deps.cwd, deps.script);
  const shown = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : deps.script;
  return `node ${/\s/.test(shown) ? `"${shown}"` : shown}`;
}

/** The help text. */
export function helpText(deps) {
  const self = selfCommand(deps);
  return `CafAI Bridge ${VERSION}: the CafAI coach answers through this computer's own Claude Code
and your Claude Pro or Max plan, so no API tokens are billed.

Usage: ${self} [command] [options]
       npm run bridge -- [command] [options]

The first \`npm run bridge\` in a terminal runs setup; after that, no command means serve.

Commands:
  setup       Set it up step by step: Claude Code, where CafAI runs, when the bridge runs, the firewall
  serve       Run the bridge here and show the address and code for CafAI
  start       Run it in the background
  stop        Stop it
  status      Whether it is running, its addresses, code, schedule and log
  install     Start it whenever you sign in; with --window, every morning on a schedule
  uninstall   Stop starting it by itself (at sign-in or on a schedule)
  doctor      Check Claude Code, its sign-in, one real turn, the port, the firewall and the schedule
  firewall    Windows: check the firewall and let the bridge in (Windows asks for permission)
  code        Show the pairing code (--new makes a new one)
  help        Show this help

Options:
  --window <from-to>    Run only within this daily window, such as 05:00-10:00 (serve, start, install)
  --weekdays            Only Monday to Friday (with --window)
  --keep-awake          Keep the computer from sleeping while the bridge runs
  --no-wake             install --window: do not wake the computer from sleep at the start (Windows)
  --port <n>            Port to listen on (default ${DEFAULT_PORT})
  --host <address>      Address to listen on (default ${DEFAULT_HOST}: every network of this computer)
  --claude <path>       Use this Claude Code (default: the newest one found)
  --max-runs <n>        Conversations kept running at once (default 3)
  --idle-minutes <n>    Close a conversation after this many idle minutes (default 30)
  --allow-api-key       Let coach runs use ANTHROPIC_API_KEY, billed to that key
  --config-dir <dir>    Keep the code, the log and the work folder in <dir>
  --no-start            install: do not start it now
  --no-probe            doctor, setup: skip the real turn
  --model <id>          doctor: the model for the real turn (default claude-haiku-4-5)
  --new                 code: make a new code
  --version             Show the version

Setup without questions (for scripts):
  setup --yes --schedule 05:00-10:00 [--weekdays] [--keep-awake | --no-keep-awake] [--no-wake]
        [--host <address>] [--port <n>] [--no-probe] [--firewall]
  setup --yes --always [--keep-awake]
  setup --yes --manual
  firewall --yes        adds the firewall rule for Private networks if it is missing

install remembers --window, --weekdays, --keep-awake, --port, --host, --claude, --max-runs,
--idle-minutes, --allow-api-key and --config-dir for every start.
`;
}

// ---------------------------------------------------------------------------
// The real world, and small helpers
// ---------------------------------------------------------------------------

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists, it is just not ours to signal.
    return error?.code === 'EPERM';
  }
}

/** Could a server listen on this port? 'free', 'in-use', 'denied', or the error code. */
function portState(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') resolve('in-use');
      else if (error?.code === 'EACCES') resolve('denied');
      else resolve(String(error?.code ?? 'error'));
    });
    server.listen({ port, host }, () => server.close(() => resolve('free')));
  });
}

/**
 * Leave with this exit code, normally by letting the event loop empty (which
 * also lets output reach a pipe): process.exit() after two requests to the
 * bridge aborts Node 24 on Windows with a libuv assertion (src\win\async.c).
 * Should something keep the loop alive anyway, leave after a moment.
 * `now`: leave at once (a second Ctrl+C).
 */
function leave(code, now = false) {
  if (now) process.exit(code);
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3000).unref();
}

/** What the commands use outside of tests. */
export function defaultDeps() {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    cwd: process.cwd(),
    execPath: process.execPath,
    script: SCRIPT,
    nodeVersion: process.version,
    pid: process.pid,
    uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
    isTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    prompt: () => terminalPrompt(),
    fetch: (url, init) => fetch(url, init),
    spawn,
    exec: runCommand,
    fs: nodeFs,
    exists: existsSync,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    // The bridge's own handles keep the process alive; these timers must not.
    setTimer: (fn, ms) => setTimeout(fn, ms).unref(),
    clearTimer: (timer) => clearTimeout(timer),
    networkInterfaces: () => os.networkInterfaces(),
    isAlive,
    kill: (pid, signal) => process.kill(pid, signal),
    onSignal: (signal, handler) => process.on(signal, handler),
    exit: leave,
    portState,
    // The server and Claude Code helpers load only when a command needs them.
    startBridgeServer: async (options) => (await import('./lib/server.mjs')).startBridgeServer(options),
    findClaude: async (options) => (await import('./lib/claude.mjs')).findClaude(options),
    claudeAuthStatus: async (install, options) => (await import('./lib/claude.mjs')).claudeAuthStatus(install, options),
    probeClaude: async (install, options) => (await import('./lib/claude.mjs')).probeClaude(install, options),
  };
}

function filesOf(options, deps) {
  return paths(configDir({ explicit: options.configDir ?? null, platform: deps.platform, env: deps.env, home: deps.home }));
}

/** Where this computer reaches a bridge listening on `host`: every-network means loopback. */
function localHost(host) {
  if (!host || host === '0.0.0.0' || host === '::' || host === 'localhost') return '127.0.0.1';
  return host.includes(':') ? `[${host}]` : host;
}

function onlyLocal(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** An environment variable, case-insensitive on Windows like the OS. */
function envGet(env, name, platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/** "2026-10-11 14:03:22", local time, for log lines. */
export function stamp(date) {
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Poll `ok` every quarter second until it holds, `gaveUp()` says stop, or `ms` pass. */
async function waitFor(deps, ok, gaveUp, ms) {
  const deadline = deps.now().getTime() + ms;
  for (let attempt = 0; attempt <= Math.ceil(ms / 250); attempt++) {
    if (await ok()) return true;
    if (gaveUp() || deps.now().getTime() >= deadline) return false;
    await deps.sleep(250);
  }
  return false;
}

/**
 * One HTTP request to a bridge on this computer. Never throws:
 * `{ status, ok, json }`, or `{ error, timedOut }` when nothing answered.
 */
async function request(deps, url, { method = 'GET', headers = {}, timeoutMs = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await deps.fetch(url, { method, headers, signal: controller.signal });
    let json = null;
    try {
      json = await response.json();
    } catch {
      // Not JSON: not the bridge.
    }
    return { status: response.status, ok: response.ok, json };
  } catch (error) {
    return { error, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What answers on host:port: 'bridge' (with its /health reply in `info`),
 * 'other' (another program), 'timeout' (something holds the port but does not
 * answer) or 'none' (nothing listens).
 */
async function probeHealth(deps, host, port, timeoutMs = 1500) {
  const reply = await request(deps, `http://${host}:${port}/health`, { timeoutMs });
  if (reply.error) return { state: reply.timedOut ? 'timeout' : 'none' };
  if (reply.json?.app === 'cafai-bridge') return { state: 'bridge', info: reply.json };
  return { state: 'other' };
}

/** The pid file a running bridge writes: `{ pid, port, host }` (a bare number is read too). */
export function readPidFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
  if (/^\d+$/.test(text)) return { pid: Number(text) };
  try {
    const info = JSON.parse(text);
    return Number.isInteger(info?.pid) && info.pid > 0 ? info : null;
  } catch {
    return null;
  }
}

/** Remove the pid file, unless another bridge has written its own since. */
function removePidFile(file, pid) {
  const info = readPidFile(file);
  if (!info || info.pid === pid) rmSync(file, { force: true });
}

/**
 * The bridge a command is about: the port and host given, else those in the
 * pid file of a bridge still running (one installed with --port 9000 is found
 * without repeating it), else the defaults. `pid` only when the pid file is
 * about that port.
 */
function targetOf(options, files, deps) {
  const info = readPidFile(files.pidFile);
  const recorded = info && deps.isAlive(info.pid) ? info : null;
  const port = options.port ?? recorded?.port ?? DEFAULT_PORT;
  const same = recorded && (recorded.port ?? DEFAULT_PORT) === port;
  return { port, host: options.host ?? (same ? recorded.host : undefined) ?? DEFAULT_HOST, pid: same ? recorded.pid : null, recorded };
}

/**
 * The flags `start` and autostart hand on to `serve`, the window first. Paths
 * become absolute: an autostart runs from another folder.
 */
export function serveFlags(options) {
  const flags = [];
  if (options.window !== undefined) flags.push('--window', options.window);
  if (options.weekdays) flags.push('--weekdays');
  if (options.keepAwake) flags.push('--keep-awake');
  if (options.port !== undefined) flags.push('--port', String(options.port));
  if (options.host !== undefined) flags.push('--host', String(options.host));
  if (options.claude !== undefined) flags.push('--claude', path.resolve(options.claude));
  if (options.maxRuns !== undefined) flags.push('--max-runs', String(options.maxRuns));
  if (options.idleMinutes !== undefined) flags.push('--idle-minutes', String(options.idleMinutes));
  if (options.allowApiKey) flags.push('--allow-api-key');
  if (options.configDir !== undefined) flags.push('--config-dir', path.resolve(options.configDir));
  return flags;
}

/** The window given with --window (and --weekdays), or null. */
function windowOf(options) {
  return options.window ? parseWindow(options.window, { weekdays: Boolean(options.weekdays) }) : null;
}

function outsideLine(window) {
  return `Outside ${window.text}${window.weekdays ? ' (Monday to Friday)' : ''}: not starting.`;
}

/** The code to print: setup run without a terminal (a script, a log) keeps it out of its output. */
function codeFor(options, config) {
  return options.hideCode ? null : config.code;
}

function fileSize(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** The last lines a log got since `offset` (its size before this start). */
function logTail(file, offset = 0, count = 20) {
  try {
    const bytes = readFileSync(file);
    return bytes
      .subarray(Math.min(offset, bytes.length))
      .toString('utf8')
      .trimEnd()
      .split(/\r?\n/)
      .slice(-count)
      .join('\n');
  } catch {
    return '';
  }
}

/** Keep the log from growing without end: past 5 MB it becomes bridge.log.old. */
function rotateLog(file) {
  try {
    if (statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.old`);
  } catch {
    // No log yet, or it is in use: keep appending.
  }
}

/**
 * The helper that keeps this computer awake while this process lives
 * (--keep-awake), logged in one line. Returns `{ stop }`, or null.
 */
function startKeepAwake(deps, log) {
  const hasSystemdInhibit =
    deps.platform === 'linux' && Boolean(firstOnPath({ env: deps.env, platform: deps.platform, exists: deps.exists, name: 'systemd-inhibit' }));
  const spec = keepAwakeCommand({ platform: deps.platform, pid: deps.pid, hasSystemdInhibit });
  if (!spec) {
    log('Keeping this computer awake is not supported here (it needs systemd-inhibit).');
    return null;
  }
  let child;
  try {
    child = deps.spawn(spec.command, spec.args, { env: { ...deps.env, ...(spec.env ?? {}) }, stdio: 'ignore', windowsHide: true });
  } catch (error) {
    log(`Could not keep this computer awake: ${error?.message ?? error}`);
    return null;
  }
  child.on('error', (error) => log(`Could not keep this computer awake: ${error?.message ?? error}`));
  // It ends with this process anyway; it must not keep this process alive.
  child.unref();
  log(`Keeping this computer awake while the bridge runs (${spec.command}).`);
  return {
    stop: () => {
      try {
        child.kill();
      } catch {
        // Gone already.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// What the commands print
// ---------------------------------------------------------------------------

/**
 * How Claude Code is signed in, as a level and a sentence: a plan is 'ok', an
 * API key a 'problem' (the coach would be billed to it), anything else, or no
 * answer, a 'warning'. Email and organisation are never part of it.
 * @param {{ loggedIn: boolean, authMethod: string | null, subscriptionType: string | null } | null} auth
 * @returns {{ level: 'ok' | 'warning' | 'problem', text: string }}
 */
export function signInState(auth) {
  if (!auth) return { level: 'warning', text: 'Could not check the sign-in: claude auth status did not answer.' };
  if (!auth.loggedIn) return { level: 'problem', text: 'Claude Code is not signed in. Open a terminal, run claude and sign in with /login.' };
  if (auth.authMethod === 'claude.ai') {
    return { level: 'ok', text: `Signed in with your Claude plan${auth.subscriptionType ? ` (${auth.subscriptionType})` : ''}.` };
  }
  if (API_KEY_SIGN_IN.test(auth.authMethod ?? '')) {
    return {
      level: 'problem',
      text: 'Claude Code is signed in with an API key, so the coach would be billed to that key. Run claude and sign in with /login with your Claude plan.',
    };
  }
  return {
    level: 'warning',
    text: `Claude Code is signed in${auth.authMethod ? ` (${auth.authMethod})` : ''}, but not with a Claude plan through /login.`,
  };
}

/**
 * The addresses to type into CafAI for a bridge on host:port, the port left
 * out when it is 8877 (CafAI adds it).
 * @returns {Array<{ address: string, note?: string }>}
 */
export function addressList({ host = DEFAULT_HOST, port = DEFAULT_PORT, lan = [] }) {
  const suffix = port === DEFAULT_PORT ? '' : `:${port}`;
  const local = { address: `127.0.0.1${suffix}`, note: 'if Decaid runs on this computer' };
  if (host === '0.0.0.0' || host === '::' || host === '') return [...lan.map((ip) => ({ address: ip + suffix })), local];
  if (host === '127.0.0.1' || host === 'localhost') return [{ ...local, note: 'only from this computer' }];
  return [{ address: (host.includes(':') ? `[${host}]` : host) + suffix }];
}

/** Where to go in CafAI, one Address line per address, and the code. */
export function connectLines({ host = DEFAULT_HOST, port = DEFAULT_PORT, lan = [], code }) {
  const lines = [CAFAI_SETTING];
  if ((host === '0.0.0.0' || host === '::') && lan.length === 0) {
    lines.push('  (No network address found: connect this computer to your Wi-Fi or network.)');
  }
  for (const { address, note } of addressList({ host, port, lan })) lines.push(`  Address: ${address}${note ? `   (${note})` : ''}`);
  // No code given: the output goes to a log, which must not hold it (a log gets attached to bug reports).
  lines.push(code ? `  Code:    ${formatCode(code)}` : '  Code:    not written to the log; node bridge/cafai-bridge.mjs code shows it');
  return lines;
}

/**
 * What `serve` shows once the bridge listens: Claude Code and its sign-in,
 * then where to enter the address and code in CafAI.
 * @param {{ install: { path: string, version: string } | null, auth: object | null, host: string, port: number, lan: string[], code: string, allowApiKey?: boolean }} state
 */
export function bannerLines({ install, auth, host, port, lan, code, allowApiKey = false }) {
  const lines = install
    ? [`Claude Code ${versionText(install.version)}: ${install.path}`, signInState(auth).text]
    : [`Claude Code: not found. Install it from ${CLAUDE_DOWNLOAD}, then run claude once and sign in with /login.`];
  if (allowApiKey) lines.push('--allow-api-key is on: when ANTHROPIC_API_KEY is set, coach runs are billed to that key.');
  return [...lines, '', ...connectLines({ host, port, lan, code })];
}

/** findClaude reports "unknown" for a --claude program that would not say its version. */
function versionText(version) {
  return !version || version === 'unknown' ? '(version unknown)' : version;
}

/** Claude Code, its sign-in and the plan's usage as a running bridge sees them (GET /v1/status). */
async function claudeSummary(deps, host, port, code) {
  const reply = await request(deps, `http://${host}:${port}/v1/status`, { headers: { 'x-api-key': code }, timeoutMs: 15_000 });
  const status = reply.ok ? reply.json : null;
  if (!status || typeof status !== 'object') return [];
  const lines = [];
  if (status.claude?.found) lines.push(`Claude Code ${versionText(status.claude.version)}: ${status.claude.path}`);
  if (Array.isArray(status.problems) && status.problems.length > 0) {
    for (const problem of status.problems) lines.push(`Problem: ${problem}`);
  } else if (status.account) {
    lines.push(signInState(status.account).text);
  }
  const used = [];
  const percent = (window) => (typeof window?.utilization === 'number' ? Math.round(window.utilization * 100) : null);
  if (percent(status.usage?.fiveHour) !== null) used.push(`${percent(status.usage.fiveHour)}% of the 5-hour limit`);
  if (percent(status.usage?.sevenDay) !== null) used.push(`${percent(status.usage.sevenDay)}% of the weekly limit`);
  if (used.length > 0) lines.push(`Plan usage: ${used.join(', ')} used.`);
  return lines;
}

function osName(platform) {
  return { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[platform] ?? platform;
}

function firewallHints(platform, port) {
  if (platform === 'win32') {
    return [
      'Firewall: the first time the bridge starts, Windows Defender Firewall asks about Node.js: allow it on Private networks.',
      'If your network is marked Public, mark it Private (Settings > Network & internet) or allow Node.js on Public networks too.',
    ];
  }
  if (platform === 'darwin') {
    return [
      'Firewall: if macOS asks whether node may accept incoming network connections, click Allow.',
      'To check later: System Settings > Network > Firewall > Options.',
    ];
  }
  return [`Firewall: if one runs (ufw, firewalld), allow TCP port ${port} from your network, e.g. sudo ufw allow ${port}/tcp.`];
}

function vpnNote(deps) {
  const vpns = vpnAdapters(deps.networkInterfaces());
  if (vpns.length === 0) return null;
  return (
    `A VPN is connected (${vpns.join(', ')}). Allow LAN connections in the VPN app ` +
    '("allow LAN" or "local network sharing"), or the tablet cannot reach the bridge.'
  );
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function samePath(a, b, platform) {
  if (!a || !b) return false;
  if (platform === 'win32') return path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
  return path.posix.normalize(a) === path.posix.normalize(b);
}

/**
 * The program a terminal runs for `name` (default `claude`): the first match
 * on PATH (with PATHEXT's extensions on Windows), or null.
 * @param {{ env: Record<string, string | undefined>, platform: string, exists: (file: string) => boolean, name?: string }} where
 */
export function firstOnPath({ env, platform, exists, name = 'claude' }) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const extensions = win ? (envGet(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const raw of (envGet(env, 'PATH', platform) ?? '').split(win ? ';' : ':')) {
    const dir = raw.trim().replace(/^"|"$/g, '');
    if (dir === '') continue;
    for (const extension of extensions) {
      const file = p.join(dir, `${name}${extension.toLowerCase()}`);
      if (exists(file)) return file;
    }
  }
  return null;
}

/** How the bridge starts by itself, for status. */
function autostartText(auto, self) {
  if (!auto.installed) return `Starts by itself: no (${self} install starts it at sign-in; ${SETUP_AGAIN} sets a schedule)`;
  const where = {
    task: `the Task Scheduler task "${TASK_NAME}"`,
    shortcut: `a shortcut in your Startup folder (${auto.location})`,
    registry: `your Run registry key (${auto.location})`,
    launchagent: `a LaunchAgent (${auto.location})`,
  }[auto.method] ?? `the systemd unit you saved (${auto.location})`;
  if (auto.schedule?.window) return `Starts by itself: on a schedule, from ${where}`;
  return `Starts at sign-in: yes, from ${where}`;
}

/**
 * The schedule an autostart holds, and whether the bridge should be running
 * now. `wake` is known for a Windows task only.
 */
function scheduleLines(auto, deps) {
  const window = auto.schedule?.window ? parseWindow(auto.schedule.window, { weekdays: auto.schedule.weekdays }) : null;
  if (!window) return [];
  const now = deps.now();
  const lines = [`Schedule: ${describeWindow(window)}${auto.schedule.keepAwake ? ', keeping the computer awake' : ''}; it also starts at sign-in within the window.`];
  if (auto.method === 'task') {
    lines.push(auto.schedule.wake ? 'The task wakes the computer from sleep at the start time.' : 'The task does not wake the computer; it runs when the computer is next awake.');
    if (auto.schedule.enabled === false) lines.push('The task is disabled in Task Scheduler, so it does not run.');
  }
  lines.push(
    inWindow(window, now)
      ? `Right now: inside the window, so it should be running until ${formatTime(window.end)}.`
      : `Right now: outside the window; it starts ${describeWhen(nextStart(window, now), now)}.`,
  );
  return lines;
}

/** One connected network as the firewall sees it, for people. */
function networkLine(network) {
  const label = network.name && network.name !== network.alias ? `${network.alias} ("${network.name}")` : network.alias;
  const state = network.allowed
    ? 'the firewall lets the bridge in'
    : network.blockedBy.length > 0
      ? `a firewall rule blocks Node.js ("${network.blockedBy[0]}")`
      : 'no firewall rule lets the bridge in';
  return `  ${label}: ${network.category}; ${state}.`;
}

// ---------------------------------------------------------------------------
// The commands. Each resolves with an exit code.
// ---------------------------------------------------------------------------

async function startFailure(error, { port, host }, deps) {
  const self = selfCommand(deps);
  if (error?.code === 'EADDRINUSE') {
    if ((await probeHealth(deps, localHost(host), port)).state === 'bridge') {
      // Exit 0, so launchd does not start a second copy again and again.
      deps.out(`CafAI Bridge is already running on port ${port}. See its address and code with: ${self} status\n`);
      return 0;
    }
    deps.err(
      `Something already uses port ${port}. Maybe CafAI Bridge is already running (check with: ${self} status), ` +
        'or pick another port with --port.\n',
    );
    return 1;
  }
  if (error?.code === 'EACCES') {
    deps.err(`This computer does not let CafAI Bridge use port ${port}. Pick another one with --port (above 1024).\n`);
    return 1;
  }
  if (error?.code === 'EADDRNOTAVAIL') {
    deps.err(`This computer has no address ${host}. Leave --host out to listen on all of its networks.\n`);
    return 1;
  }
  deps.err(`CafAI Bridge could not start: ${error?.message ?? error}\n`);
  return 1;
}

/**
 * Run the bridge in this process. Resolves with an exit code when it does not
 * start (outside its --window that is 0, so launchd leaves it be), or with
 * null once it listens: it then runs until Ctrl+C, a signal, `stop` or the
 * window's end, and exits from there.
 */
export async function cmdServe(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const allowApiKey = Boolean(options.allowApiKey);
  const window = windowOf(options);
  const log = (line) => deps.out(`${stamp(deps.now())} ${line}\n`);
  let handle = null;
  let closing = false;
  let cancelEnd = null;
  let awake = null;

  if (window && !inWindow(window, deps.now())) {
    deps.out(`${outsideLine(window)}\n`);
    return 0;
  }

  // Ctrl+C, a signal or the window's end (close the server here), or `stop` (the server has closed itself).
  const shutdown = async (serverClosed) => {
    if (closing) {
      // A second Ctrl+C: leave without waiting.
      deps.exit(1, true);
      return;
    }
    closing = true;
    cancelEnd?.();
    awake?.stop();
    if (!serverClosed && handle) {
      log('Stopping CafAI Bridge...');
      await withTimeout(handle.close(), 5000).catch(() => {});
    }
    removePidFile(files.pidFile, deps.pid);
    log('CafAI Bridge stopped.');
    deps.exit(0);
  };

  deps.out(`CafAI Bridge ${VERSION}\n`);
  try {
    handle = await deps.startBridgeServer({
      code: config.code,
      port,
      host,
      claudePath: options.claude ?? null,
      maxRuns: options.maxRuns ?? 3,
      idleMinutes: options.idleMinutes ?? 30,
      allowApiKey,
      workDir: files.workDir,
      version: VERSION,
      env: deps.env,
      log,
      onShutdownRequest: () => shutdown(true),
    });
  } catch (error) {
    return startFailure(error, { port, host }, deps);
  }
  writeFileSync(files.pidFile, `${JSON.stringify({ pid: deps.pid, port: handle.port, host: handle.host })}\n`);
  // SIGHUP: the terminal closed (on Windows, its console window).
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', ...(deps.platform === 'win32' ? ['SIGBREAK'] : [])]) {
    deps.onSignal(signal, () => shutdown(false));
  }
  if (options.keepAwake) awake = startKeepAwake(deps, log);
  if (window) {
    cancelEnd = armWindowEnd(window, deps, () => {
      log(`The window ${window.text} has ended.`);
      void shutdown(false);
    });
  }

  const auth = handle.claude
    ? await withTimeout(deps.claudeAuthStatus(handle.claude, { env: deps.env, allowApiKey }), 25_000).catch(() => null)
    : null;
  const lan = lanAddresses(deps.networkInterfaces());
  // Started by `start` or at login, serve writes to the log: the code stays out of it.
  const banner = bannerLines({ install: handle.claude, auth, host: handle.host, port: handle.port, lan, code: deps.isTTY ? config.code : null, allowApiKey });
  if (window && !closing) banner.push('', `Runs until ${formatTime(window.end)} (window ${window.text}${window.weekdays ? ', Monday to Friday' : ''}).`);
  deps.out(`${banner.join('\n')}\n\n${deps.isTTY ? 'Press Ctrl+C to stop.\n\n' : ''}`);
  return null;
}

/** Run the bridge in the background: a hidden `serve` writing to the log. */
export async function cmdStart(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const self = selfCommand(deps);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const window = windowOf(options);
  const lan = () => lanAddresses(deps.networkInterfaces());

  if (window) {
    const now = deps.now();
    if (!inWindow(window, now)) {
      deps.out(`${outsideLine(window)}\nIt starts ${describeWhen(nextStart(window, now), now)}.\n`);
      return 0;
    }
  }

  // Already running here, or (no --port given) where the pid file says?
  const { recorded } = targetOf({}, files, deps);
  const candidates = [{ port, host }];
  if (options.port === undefined && recorded?.port && recorded.port !== port) {
    candidates.push({ port: recorded.port, host: recorded.host ?? DEFAULT_HOST });
  }
  const probes = [];
  for (const candidate of candidates) probes.push(await probeHealth(deps, localHost(candidate.host), candidate.port));
  const found = probes.findIndex((probe) => probe.state === 'bridge');
  if (found >= 0) {
    const running = candidates[found];
    const pid = recorded && (recorded.port ?? DEFAULT_PORT) === running.port ? recorded.pid : null;
    deps.out(`CafAI Bridge is already running on port ${running.port}${pid ? ` (process ${pid})` : ''}.\n\n`);
    deps.out(`${connectLines({ host: running.host, port: running.port, lan: lan(), code: codeFor(options, config) }).join('\n')}\n`);
    return 0;
  }
  if (probes[0].state === 'timeout') {
    deps.err(`Something holds port ${port} but does not answer, maybe a stuck CafAI Bridge. Run ${self} stop, then start again.\n`);
    return 1;
  }
  if (probes[0].state === 'other') {
    deps.err(`Another program uses port ${port}. Pick another port with --port.\n`);
    return 1;
  }

  rotateLog(files.logFile);
  const offset = fileSize(files.logFile);
  const fd = openSync(files.logFile, 'a');
  let child;
  try {
    child = deps.spawn(deps.execPath, [deps.script, 'serve', ...serveFlags(options)], {
      cwd: files.dir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
  } finally {
    // The child has its own copy of the log's handle.
    closeSync(fd);
  }
  let ended = null;
  child.on('exit', (code, signal) => {
    ended = signal ? `was stopped (${signal})` : `stopped with exit code ${code}`;
  });
  child.on('error', (error) => {
    ended = `could not be started (${error?.message ?? error})`;
  });
  child.unref();

  const up = await waitFor(deps, async () => (await probeHealth(deps, localHost(host), port)).state === 'bridge', () => ended !== null, 10_000);
  if (!up) {
    // The window closed while it was starting: serve said no, as it should.
    if (window && !inWindow(window, deps.now())) {
      deps.out(`${outsideLine(window)}\n`);
      return 0;
    }
    deps.err(`CafAI Bridge did not start${ended ? `: it ${ended}` : ' within 10 seconds'}.\n`);
    const tail = logTail(files.logFile, offset);
    if (tail) deps.err(`The end of its log (${files.logFile}):\n${tail}\n`);
    return 1;
  }
  const until = window ? ` until ${formatTime(window.end)}` : '';
  deps.out(`CafAI Bridge is running in the background on port ${port} (process ${child.pid})${until}.\n\n`);
  deps.out(`${connectLines({ host, port, lan: lan(), code: codeFor(options, config) }).join('\n')}\n`);
  const summary = await claudeSummary(deps, localHost(host), port, config.code);
  if (summary.length > 0) deps.out(`\n${summary.join('\n')}\n`);
  deps.out(`\nLog: ${files.logFile}\nStop it with: ${self} stop\n`);
  return 0;
}

/** Stop a running bridge: ask it to shut down, else end its process. */
export async function cmdStop(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const { port, host, pid, recorded } = targetOf(options, files, deps);
  const local = localHost(host);
  const probe = await probeHealth(deps, local, port);
  if (probe.state === 'none') {
    // A pid file whose process is gone is left over from a crash.
    if (!recorded) rmSync(files.pidFile, { force: true });
    deps.out(`CafAI Bridge is not running (nothing answers on port ${port}).\n`);
    return 0;
  }
  if (probe.state === 'other') {
    deps.err(`Port ${port} is used by another program, not CafAI Bridge. Nothing was stopped.\n`);
    return 1;
  }

  let why = 'it does not answer';
  if (probe.state === 'bridge') {
    const reply = await request(deps, `http://${local}:${port}/v1/shutdown`, {
      method: 'POST',
      headers: { 'x-api-key': config.code },
      timeoutMs: 5000,
    });
    if (reply.ok) {
      const gone = await waitFor(deps, async () => (await probeHealth(deps, local, port)).state === 'none', () => false, 5000);
      if (gone) {
        deps.out('CafAI Bridge stopped.\n');
        return 0;
      }
      why = 'it did not stop within 5 seconds';
    } else if (reply.status === 401) {
      why = 'it did not accept the code (changed with code --new since it started?)';
    } else if (reply.status === 403) {
      why = 'it only takes a stop request from its own computer';
    } else {
      why = reply.status ? `it answered the stop request with HTTP ${reply.status}` : 'the stop request failed';
    }
  }

  // Ending a process by its id is only safe when the pid file is about this
  // bridge (a stale file could name an unrelated process).
  if (!pid) {
    deps.err(
      `CafAI Bridge on port ${port} did not stop: ${why}, and no running process is recorded for it. ` +
        'Stop it where it runs (Ctrl+C), or end its node process.\n',
    );
    return 1;
  }
  try {
    deps.kill(pid, 'SIGTERM');
  } catch {
    // Gone already, or not ours: checked below.
  }
  let gone = await waitFor(deps, async () => !deps.isAlive(pid), () => false, 5000);
  if (!gone && deps.platform !== 'win32') {
    // A busy loop never runs the SIGTERM handler.
    try {
      deps.kill(pid, 'SIGKILL');
    } catch {
      // Checked below.
    }
    gone = await waitFor(deps, async () => !deps.isAlive(pid), () => false, 2000);
  }
  if (!gone) {
    deps.err(`Could not stop CafAI Bridge (process ${pid}). End that process in Task Manager or Activity Monitor.\n`);
    return 1;
  }
  rmSync(files.pidFile, { force: true });
  deps.out(`CafAI Bridge stopped: ${why}, so its process (${pid}) was ended.\n`);
  return 0;
}

/** Whether a bridge runs, where to reach it, the code, autostart and its schedule, the log. Exit 0 when running. */
export async function cmdStatus(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const self = selfCommand(deps);
  const { port, host, pid } = targetOf(options, files, deps);
  const local = localHost(host);
  const probe = await probeHealth(deps, local, port);
  const lines = [];
  if (probe.state === 'bridge') {
    const version = probe.info.version ? ` ${probe.info.version}` : '';
    lines.push(`CafAI Bridge${version} is running on port ${port}${pid ? ` (process ${pid})` : ''}.`);
  } else if (probe.state === 'other') {
    lines.push(`CafAI Bridge is not running: another program uses port ${port}.`);
  } else if (probe.state === 'timeout') {
    lines.push(`Something holds port ${port} but does not answer, maybe a stuck CafAI Bridge: run ${self} stop, then ${self} start.`);
  } else {
    lines.push(`CafAI Bridge is not running. Start it with: ${self} start`);
  }
  lines.push('', ...connectLines({ host, port, lan: lanAddresses(deps.networkInterfaces()), code: config.code }));
  if (probe.state === 'bridge') {
    const summary = await claudeSummary(deps, local, port, config.code);
    if (summary.length > 0) lines.push('', ...summary);
  }
  const auto = await autostartStatus(deps);
  lines.push('', autostartText(auto, self), ...scheduleLines(auto, deps), `Log: ${files.logFile}`);
  if (deps.platform === 'darwin' && auto.installed) lines.push(`Log when started by launchd: ${macPaths(deps).logFile}`);
  lines.push(`Config folder: ${files.dir}`);
  deps.out(`${lines.join('\n')}\n`);
  return probe.state === 'bridge' ? 0 : 1;
}

/** Show the pairing code, or (--new) replace it. */
export async function cmdCode(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  if (!options.new) {
    deps.out(`Code: ${formatCode(config.code)}\n`);
    return 0;
  }
  const code = generateCode();
  saveConfig(files.dir, { ...config, code });
  const self = selfCommand(deps);
  const { port, host } = targetOf(options, files, deps);
  const running = (await probeHealth(deps, localHost(host), port)).state === 'bridge';
  deps.out(`New code: ${formatCode(code)}\n\nCafAI needs the new code: enter it in Settings > Where the coach runs.\n`);
  deps.out(
    running
      ? `The bridge running now still uses the old code until it restarts: run ${self} stop, then ${self} start.\n`
      : `A bridge running elsewhere keeps the old code until it restarts (${self} stop, then ${self} start).\n`,
  );
  return 0;
}

/**
 * Start the bridge by itself: at sign-in, or with --window every morning on a
 * schedule (which replaces the other). Then start it now, unless --no-start
 * or (a schedule) it is outside the window.
 */
export async function cmdInstall(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const self = selfCommand(deps);
  const window = windowOf(options);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  let claudePath = null;
  if (deps.platform !== 'win32') {
    // Its folder goes on the service's PATH.
    try {
      const { chosen } = await deps.findClaude({ explicit: options.claude ?? null, env: deps.env, platform: deps.platform, home: deps.home });
      claudePath = chosen?.path ?? null;
    } catch {
      // The usual folders are on that PATH anyway.
    }
  }
  const macLog = macPaths(deps).logFile;
  const macLogOffset = deps.platform === 'darwin' ? fileSize(macLog) : 0;
  const result = await installAutostart(
    {
      nodePath: deps.execPath,
      script: deps.script,
      flags: serveFlags(options),
      configDir: files.dir,
      claudePath,
      load: !options.noStart,
      window: window?.text ?? null,
      weekdays: Boolean(window?.weekdays),
      wake: options.wake !== false,
    },
    deps,
  );

  if (result.method === 'systemd') {
    // The units alone on stdout, so `install > <file>` saves the one unit of an always-on bridge.
    const steps = window
      ? [
          'On Linux nothing is installed: save these two systemd user units yourself:',
          `the first as ${result.location}, the second as ${result.timerLocation}. Then run:`,
          '  systemctl --user daemon-reload',
          '  systemctl --user enable --now cafai-bridge.timer',
        ]
      : [
          'On Linux nothing is installed: save this systemd user unit yourself.',
          `Save it as ${result.location} (or run: ${self} install > ${result.location}), then run:`,
          '  systemctl --user daemon-reload',
          '  systemctl --user enable --now cafai-bridge',
        ];
    deps.err([...steps, `Until then, ${self} start runs it in the background.`, ''].join('\n'));
    deps.out(window ? `# ${result.location}\n${result.unit}\n# ${result.timerLocation}\n${result.timer}` : result.unit);
    return 0;
  }
  if (!result.ok) {
    deps.err(`Could not set CafAI Bridge to start by itself: ${result.error}\n`);
    if (result.method === 'launchagent') deps.err(`The LaunchAgent is saved (${result.location}), so it should start at your next login.\n`);
    return 1;
  }

  const days = window?.weekdays ? 'Monday to Friday' : 'every day';
  if (result.method === 'task') {
    deps.out(
      `CafAI Bridge will start ${days} at ${formatTime(window.start)} and stop at ${formatTime(window.end)} ` +
        `(the Task Scheduler task "${TASK_NAME}"${result.wake ? ', which wakes the computer from sleep' : ''}). ` +
        'It also starts when you sign in within that window.\n',
    );
  } else if (result.method === 'shortcut') {
    deps.out(`CafAI Bridge will start whenever you sign in to Windows (a shortcut in your Startup folder: ${result.location}).\n`);
  } else if (result.method === 'registry') {
    deps.out(
      'CafAI Bridge will start whenever you sign in to Windows (from your Run registry key: ' +
        `PowerShell could not make a Startup shortcut: ${result.reason}).\n`,
    );
  } else if (window) {
    deps.out(
      `CafAI Bridge will start ${days} at ${formatTime(window.start)} and stop at ${formatTime(window.end)} ` +
        `(LaunchAgent ${result.location}; its log: ${result.logFile}). It also starts when you log in within that window.\n`,
    );
    deps.out(
      'macOS wakes the computer for it only with a wake schedule, which needs admin rights. To set one:\n' +
        `  ${pmsetWakeCommand({ window: window.text, weekdays: window.weekdays })}\n`,
    );
  } else {
    deps.out(`CafAI Bridge will start whenever you log in (LaunchAgent ${result.location}; its log: ${result.logFile}).\n`);
  }
  deps.out("If you move CafAI's folder or change Node, run install again.\n");
  if (options.noStart) {
    deps.out(
      deps.platform === 'darwin'
        ? 'It was not loaded now (--no-start): launchd loads it at your next login.\n'
        : `It was not started now (--no-start). Start it with: ${self} start\n`,
    );
    return 0;
  }
  deps.out('\n');
  const now = deps.now();
  if (window && !inWindow(window, now)) {
    deps.out(`It is outside the window now; it starts ${describeWhen(nextStart(window, now), now)}.\n\n`);
    deps.out(`${connectLines({ host, port, lan: lanAddresses(deps.networkInterfaces()), code: codeFor(options, config) }).join('\n')}\n`);
    return 0;
  }
  if (deps.platform !== 'darwin') return cmdStart(options, deps);

  // launchd has started it already (RunAtLoad).
  const up = await waitFor(deps, async () => (await probeHealth(deps, localHost(host), port)).state === 'bridge', () => false, 10_000);
  if (!up) {
    deps.err('CafAI Bridge did not answer within 10 seconds.\n');
    const tail = logTail(macLog, macLogOffset);
    if (tail) deps.err(`The end of its log (${macLog}):\n${tail}\n`);
    return 1;
  }
  deps.out(`CafAI Bridge is running on port ${port}${window ? ` until ${formatTime(window.end)}` : ''}.\n\n`);
  deps.out(`${connectLines({ host, port, lan: lanAddresses(deps.networkInterfaces()), code: codeFor(options, config) }).join('\n')}\n`);
  return 0;
}

/** Stop starting the bridge by itself (at sign-in or on a schedule). */
export async function cmdUninstall(options, deps) {
  const self = selfCommand(deps);
  const result = await uninstallAutostart(deps);
  if (result.method === 'systemd') {
    deps.out(
      result.saved
        ? 'On Linux the bridge installs nothing itself. To remove what you saved: ' +
            `systemctl --user disable --now cafai-bridge.timer cafai-bridge, then delete ${result.location} and ${result.timerLocation}.\n`
        : 'On Linux the bridge installs nothing itself, so there is nothing to remove.\n',
    );
    return 0;
  }
  if (result.removed.length === 0) {
    deps.out('CafAI Bridge was not set to start by itself.\n');
  } else if (result.method === 'launchagent') {
    deps.out(`CafAI Bridge will no longer start by itself (removed ${result.location}).\n`);
  } else {
    const names = { shortcut: 'the Startup shortcut', registry: 'the Run registry value', task: `the scheduled task "${TASK_NAME}"` };
    deps.out(`CafAI Bridge will no longer start by itself (removed ${result.removed.map((item) => names[item]).join(' and ')}).\n`);
  }
  deps.out(
    deps.platform === 'darwin' && result.unloaded
      ? `launchd has stopped the bridge it ran; one started with start keeps running until: ${self} stop\n`
      : `If it is running now, it keeps running until you stop it: ${self} stop\n`,
  );
  return 0;
}

/**
 * The firewall step (Windows): show what the firewall does on each connected
 * network, offer to mark a Public one Private, and add the CafAI Bridge rule
 * where none lets the bridge in, both in one elevated call (Windows asks for
 * permission). Without `ask`, nothing is asked: `fix` adds the rule for
 * Private networks only. Resolves with `{ ok, reachable }`.
 */
async function firewallStep({ port, ask = null, fix = false }, deps) {
  const say = (line = '') => deps.out(`${line}\n`);
  const label = (network) => (network.name && network.name !== network.alias ? `"${network.name}" (${network.alias})` : `"${network.alias}"`);
  const state = await readFirewall({ program: deps.execPath, port }, deps);
  if (!state.ok) {
    say(`Could not read the firewall settings: ${state.error}`);
    for (const line of firewallHints('win32', port)) say(line);
    return { ok: false, reachable: false };
  }
  const verdict = firewallVerdict(state);
  if (verdict.networks.length === 0) {
    say('No network is connected, so there is nothing to let in yet.');
    return { ok: true, reachable: false };
  }
  for (const network of verdict.networks) say(networkLine(network));

  const markPrivate = [];
  const publicOnes = verdict.networks.filter((network) => network.profile === 'Public');
  if (publicOnes.length > 0) {
    say();
    for (const network of publicOnes) {
      say(`Your network ${label(network)} is marked Public: Windows treats it as a network you do not trust, like a coffee shop's Wi-Fi.`);
    }
    if (ask) {
      say('Private is for a network you trust, such as your home: other devices on it may find and reach this computer.');
      for (const network of publicOnes) if (await askYesNo(ask, `Mark ${label(network)} as Private?`, false)) markPrivate.push(network.alias);
    } else {
      say('To mark it Private: Settings > Network & internet > your network > Private network.');
    }
  }

  const missing = firewallVerdict(state, { markPrivate }).networks.filter((network) => !network.allowed);
  let addRule = false;
  const profiles = ['Private'];
  if (missing.length > 0) {
    say();
    say(`No firewall rule lets the bridge in on ${missing.map(label).join(' and ')} yet, so a tablet there cannot reach it.`);
    for (const network of missing.filter((n) => n.blockedBy.length > 0)) {
      say(`On ${network.profile} networks a rule blocks Node.js ("${network.blockedBy[0]}"); it wins over any rule allowing it, so marking the network Private is what helps there.`);
    }
    addRule = ask ? await askYesNo(ask, 'Add a firewall rule now? Windows will ask for permission.', true) : fix;
    if (addRule && missing.some((network) => network.profile === 'Public') && ask) {
      if (await askYesNo(ask, 'Let the bridge in on Public networks too? Only if that Public network is your own.', false)) profiles.push('Public');
    }
    if (missing.some((network) => network.profile === 'Domain')) profiles.push('Domain');
  }
  if (!addRule && markPrivate.length === 0) {
    if (missing.length === 0) say('The firewall lets devices on your network reach the bridge.');
    else say(`Nothing changed. Later: ${selfCommand(deps)} firewall`);
    return { ok: true, reachable: missing.length === 0 };
  }

  say('Asking Windows for permission (a Windows prompt opens)...');
  const run = await runElevated(elevatedFirewallScript({ program: addRule ? deps.execPath : null, port, profiles, markPrivate }), deps);
  if (!run.ok) {
    say(run.cancelled ? 'Windows did not get permission, so nothing changed.' : `That did not work: ${run.error}`);
    return { ok: false, reachable: false };
  }
  const again = await readFirewall({ program: deps.execPath, port }, deps);
  if (!again.ok) {
    say(`Done, but the firewall could not be read again: ${again.error}`);
    return { ok: true, reachable: false };
  }
  const after = firewallVerdict(again);
  for (const network of after.networks) say(networkLine(network));
  say(after.reachable ? 'Done: devices on your network can reach the bridge.' : 'Done, but a network above still does not let the bridge in.');
  return { ok: true, reachable: after.reachable };
}

/** Windows: check the firewall, and let the bridge in. Exit 0 when devices on the network can reach it. */
export async function cmdFirewall(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const port = options.port ?? config.setup?.port ?? DEFAULT_PORT;
  const host = options.host ?? config.setup?.host ?? DEFAULT_HOST;
  if (deps.platform !== 'win32') {
    for (const line of firewallHints(deps.platform, port)) deps.out(`${line}\n`);
    return 0;
  }
  if (onlyLocal(host)) {
    deps.out('The bridge listens on this computer only (127.0.0.1), so the firewall does not matter.\n');
    return 0;
  }
  const prompt = !options.yes && deps.isTTY && deps.stdinIsTTY ? deps.prompt() : null;
  try {
    const result = await firewallStep({ port, ask: prompt?.ask ?? null, fix: Boolean(options.yes) }, deps);
    const note = vpnNote(deps);
    if (note) deps.out(`\n${note}\n`);
    return result.ok && result.reachable ? 0 : 1;
  } catch (error) {
    if (error instanceof SetupQuit) {
      deps.out('Stopped; nothing changed.\n');
      return 0;
    }
    throw error;
  } finally {
    prompt?.close();
  }
}

/** Check everything the bridge needs. Exit 0 when nothing is a problem (warnings are fine). */
export async function cmdDoctor(options, deps) {
  const files = filesOf(options, deps);
  loadConfig(files.dir);
  const allowApiKey = Boolean(options.allowApiKey);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  let problems = 0;
  let warnings = 0;
  const say = (line = '') => deps.out(`${line}\n`);
  const ok = (text) => say(`  ok       ${text}`);
  const warn = (text) => {
    warnings++;
    say(`  warning  ${text}`);
  };
  const problem = (text) => {
    problems++;
    say(`  PROBLEM  ${text}`);
  };
  const report = (state) => (state.level === 'ok' ? ok : state.level === 'warning' ? warn : problem)(state.text);

  say(`CafAI Bridge ${VERSION} doctor: Node ${deps.nodeVersion} on ${osName(deps.platform)}`);
  if (Number(/^v?(\d+)/.exec(deps.nodeVersion)?.[1] ?? 0) < 18) problem(`Node ${deps.nodeVersion} is too old: CafAI Bridge needs Node 18 or newer.`);

  say();
  say('Claude Code');
  const { chosen, found } = await deps.findClaude({ explicit: options.claude ?? null, env: deps.env, platform: deps.platform, home: deps.home });
  const listed = [...found];
  if (chosen && !listed.some((entry) => samePath(entry.path, chosen.path, deps.platform))) listed.unshift(chosen);
  for (const entry of listed) {
    const used = chosen && samePath(entry.path, chosen.path, deps.platform);
    const notes = [DESKTOP_APP_CLAUDE_CODE.test(entry.path) ? 'the Claude desktop app keeps it up to date' : '', used ? 'used' : ''].filter(Boolean);
    say(`  ${used ? '*' : ' '} ${(entry.version ?? 'no version').padEnd(10)} ${entry.path}${notes.length > 0 ? `   (${notes.join('; ')})` : ''}`);
  }
  if (!chosen) {
    if (options.claude) problem(`${options.claude} is not a Claude Code program that answers --version.`);
    else if (listed.length > 0) problem(`None of these answers --version. Update Claude Code (claude update) or install it again from ${CLAUDE_DOWNLOAD}.`);
    else problem(`Claude Code was not found. Install it from ${CLAUDE_DOWNLOAD}, then run claude once and sign in with /login.`);
  } else {
    const which = options.claude ? ', given with --claude' : listed.length > 1 ? `, the newest of the ${listed.length} found` : '';
    ok(`Using Claude Code ${versionText(chosen.version)}${which}.`);
    const first = listed.length > 1 ? firstOnPath({ env: deps.env, platform: deps.platform, exists: deps.exists }) : null;
    const onPath = first ? listed.find((entry) => samePath(entry.path, first, deps.platform)) : null;
    if (onPath?.version && chosen.version && compareVersions(onPath.version, chosen.version) < 0) {
      warn(
        `An older Claude Code (${onPath.version}, ${onPath.path}) comes first on PATH. The bridge uses the newest, ` +
          'but claude in a terminal runs the old one: update or remove it.',
      );
    }
  }

  let auth = null;
  if (chosen) {
    say();
    say('Sign-in');
    auth = await deps.claudeAuthStatus(chosen, { env: deps.env, allowApiKey }).catch(() => null);
    report(signInState(auth));
  }
  const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].filter((name) => envGet(deps.env, name, deps.platform));
  if (keys.length > 0) {
    const named = `${keys.join(' and ')} ${keys.length > 1 ? 'are' : 'is'} set`;
    if (allowApiKey) warn(`${named} and --allow-api-key is on, so coach runs may be billed to that key.`);
    else warn(`${named} here. The bridge removes it for coach runs (unless --allow-api-key), so they use your Claude plan.`);
  }
  if (chosen) {
    if (options.noProbe) say('  (No test turn: --no-probe.)');
    else if (auth && !auth.loggedIn) say('  (No test turn until Claude Code is signed in.)');
    else if (API_KEY_SIGN_IN.test(auth?.authMethod ?? '')) say('  (No test turn: it would be billed to the API key.)');
    else {
      say('  One tiny real turn, to see Claude Code answer (it uses a tiny bit of your plan; --no-probe skips it)...');
      const result = await deps
        .probeClaude(chosen, { env: deps.env, workDir: files.workDir, allowApiKey, ...(options.model ? { model: options.model } : {}) })
        .catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
      if (result.ok) ok(`Claude Code answered in ${(result.ms / 1000).toFixed(1)} s (${result.model}).`);
      else problem(`The test turn failed: ${result.error}`);
    }
  }

  say();
  say('Network');
  const probe = await probeHealth(deps, localHost(host), port);
  if (probe.state === 'bridge') {
    ok(`CafAI Bridge${probe.info.version ? ` ${probe.info.version}` : ''} is running on port ${port}.`);
  } else if (probe.state !== 'none') {
    problem(`Another program uses port ${port}. Close it, or run the bridge with --port and another number.`);
  } else {
    const state = await deps.portState(port, host);
    if (state === 'free') ok(`Port ${port} is free.`);
    else if (state === 'in-use') problem(`Another program uses port ${port}. Close it, or run the bridge with --port and another number.`);
    else if (state === 'denied') problem(`This computer does not let programs use port ${port}. Pick another one with --port.`);
    else if (state === 'EADDRNOTAVAIL') problem(`This computer has no address ${host}. Leave --host out.`);
    else warn(`Could not check port ${port} (${state}).`);
  }
  const lan = lanAddresses(deps.networkInterfaces());
  if (lan.length > 0) ok(`This computer's address on the network: ${lan.join(', ')}.`);
  else warn('This computer has no network address: connect it to your Wi-Fi or network (127.0.0.1 works only for Decaid on this computer).');
  const vpn = vpnNote(deps);
  if (vpn && !onlyLocal(host)) warn(vpn);
  const firewall = deps.platform === 'win32' && !onlyLocal(host) ? await readFirewall({ program: deps.execPath, port }, deps) : null;
  if (firewall?.ok) {
    const verdict = firewallVerdict(firewall);
    for (const network of verdict.networks) {
      const line = networkLine(network).trim();
      if (network.allowed) ok(`Firewall: ${line}`);
      else warn(`Firewall: ${line} Fix it with: ${selfCommand(deps)} firewall`);
    }
    if (verdict.networks.length === 0) warn('Firewall: no network is connected.');
  } else if (onlyLocal(host)) {
    say('  (The firewall does not matter: the bridge listens on this computer only.)');
  } else {
    for (const line of firewallHints(deps.platform, port)) say(`  ${line}`);
  }

  say();
  say('Starting by itself');
  const auto = await autostartStatus(deps);
  if (!auto.installed) say(`  Only when you start it (${SETUP_AGAIN} sets a schedule or a start at sign-in).`);
  else {
    ok(autostartText(auto, selfCommand(deps)));
    for (const line of scheduleLines(auto, deps)) say(`  ${line}`);
  }

  say();
  say(`Config folder: ${files.dir}`);
  say();
  if (problems === 0) {
    say(`No problems found${warnings > 0 ? ` (${warnings} warning${warnings > 1 ? 's' : ''} above)` : ''}.`);
    return 0;
  }
  say(`${problems} problem${problems > 1 ? 's' : ''} found.`);
  return 1;
}

// ---------------------------------------------------------------------------
// setup: the guided path
// ---------------------------------------------------------------------------

/** Step a: Claude Code found and signed in, and (if wanted) one test turn. */
async function setupClaude(options, deps, ask, files, say) {
  const allowApiKey = Boolean(options.allowApiKey);
  for (;;) {
    const { chosen } = await deps.findClaude({ explicit: options.claude ?? null, env: deps.env, platform: deps.platform, home: deps.home });
    if (!chosen) {
      say(`  Claude Code was not found on this computer. Install it from ${CLAUDE_DOWNLOAD}, or the Claude desktop app, which brings its own.`);
      if (!ask) {
        say('  Going on: the bridge finds Claude Code once it is installed.');
        return;
      }
      await pressEnter(ask, '  Press Enter to check again (q quits): ');
      continue;
    }
    say(`  ok  Claude Code ${versionText(chosen.version)}: ${chosen.path}`);
    const auth = await deps.claudeAuthStatus(chosen, { env: deps.env, allowApiKey }).catch(() => null);
    if (auth && !auth.loggedIn) {
      say('  Claude Code is not signed in.');
      if (!ask) {
        say('  Going on: sign in later (run claude, then /login).');
        return;
      }
      await pressEnter(ask, '  Open another terminal, run claude, sign in with /login, then press Enter (q quits): ');
      continue;
    }
    if (API_KEY_SIGN_IN.test(auth?.authMethod ?? '')) {
      say('  Claude Code is signed in with an API key, so the coach would be billed to that key.');
      say('  To use your Claude plan instead: run claude, then /login with your Claude account.');
      if (ask && !(await askYesNo(ask, '  Continue anyway?', false))) throw new SetupQuit();
      // No test turn: it would be billed to the key.
      return;
    }
    say(`  ${auth ? 'ok  ' : ''}${signInState(auth).text}`);
    const test = ask ? await askYesNo(ask, '  Run one test turn now? It uses a little of your plan.', true) : !options.noProbe;
    if (test) {
      say('  Asking Claude Code for one tiny real turn...');
      const result = await deps
        .probeClaude(chosen, { env: deps.env, workDir: files.workDir, allowApiKey })
        .catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
      if (result.ok) say(`  ok  Claude Code answered in ${(result.ms / 1000).toFixed(1)} s.`);
      else say(`  The test turn failed: ${result.error}\n  The coach needs that fixed (${selfCommand(deps)} doctor helps); setup goes on.`);
    }
    return;
  }
}

/** The answers, from questions or (with --yes) from the flags and defaults. */
async function setupAnswers(options, deps, ask, previous, say) {
  const win = deps.platform === 'win32';

  say();
  say('2. Where CafAI runs');
  let host = options.host ?? null;
  if (!host) {
    // Without questions (--yes) the defaults hold, not the last setup's answers.
    const choice = ask
      ? await askChoice(ask, 'Where does CafAI run?', ['on a tablet or phone on this network', 'only on this computer'], previous.host === '127.0.0.1' ? 1 : 0)
      : 0;
    host = choice === 1 ? '127.0.0.1' : DEFAULT_HOST;
  }
  // Without questions, say what was taken, so a scripted setup reads like an asked one.
  if (!ask) {
    say(
      onlyLocal(host)
        ? '  Only on this computer (Decaid runs here).'
        : host === DEFAULT_HOST
          ? '  On a tablet or phone on this network.'
          : `  On this network, listening on ${host}.`,
    );
  }

  say();
  say('3. When the bridge runs');
  const modes = ['schedule', 'always', 'manual'];
  const given = options.mode ?? (options.schedule || options.window ? 'schedule' : null);
  const mode = ask
    ? modes[
        await askChoice(
          ask,
          'When should the bridge run?',
          ['every morning on a schedule', 'always, from sign-in', 'only when I start it'],
          modes.indexOf(given ?? previous.mode ?? 'schedule'),
        )
      ]
    : (given ?? 'schedule');
  const same = previous.mode === mode ? previous : {};
  const answers = { host, mode, window: null, weekdays: false, keepAwake: false, wake: false };
  if (mode === 'schedule') {
    const fallback = parseWindow(options.schedule ?? options.window ?? same.window ?? DEFAULT_WINDOW) ?? parseWindow(DEFAULT_WINDOW);
    let start = formatTime(fallback.start);
    let stop = formatTime(fallback.end);
    if (ask) {
      start = await askTime(ask, 'Start at', start);
      // A stop equal to the start is no window: suggest five hours later instead.
      const later = formatTime((parseTime(start) + 300) % 1440);
      let suggestion = stop === start ? later : stop;
      for (;;) {
        stop = await askTime(ask, 'Stop at', suggestion);
        if (stop !== start) break;
        say('The stop time has to differ from the start time.');
        suggestion = later;
      }
      answers.weekdays = (await askChoice(ask, 'Which days?', ['every day', 'Monday to Friday'], (options.weekdays ?? same.weekdays) ? 1 : 0)) === 1;
      answers.keepAwake = await askYesNo(ask, 'Keep this computer awake while the bridge runs?', options.keepAwake ?? same.keepAwake ?? true);
      if (win) answers.wake = await askYesNo(ask, 'Wake this computer from sleep at the start time?', options.wake ?? same.wake ?? true);
    } else {
      answers.weekdays = Boolean(options.weekdays);
      answers.keepAwake = options.keepAwake ?? true;
      answers.wake = win && options.wake !== false;
    }
    answers.window = parseWindow(`${start}-${stop}`, { weekdays: answers.weekdays }).text;
  } else if (mode === 'always') {
    answers.keepAwake = ask
      ? await askYesNo(ask, 'Keep this computer awake while the bridge runs? (all day, while you are signed in)', options.keepAwake ?? same.keepAwake ?? false)
      : Boolean(options.keepAwake);
  }
  if (!ask) {
    const awake = answers.keepAwake ? ', keeping this computer awake' : '';
    if (mode === 'schedule') {
      const wake = answers.wake ? ', waking it from sleep at the start' : '';
      say(`  Every morning on a schedule: ${describeWindow(parseWindow(answers.window, { weekdays: answers.weekdays }))}${awake}${wake}.`);
    } else if (mode === 'always') say(`  Always, from sign-in${awake}.`);
    else say('  Only when you start it.');
  }
  return answers;
}

/**
 * The guided setup: Claude Code, where CafAI runs, when the bridge runs, the
 * firewall; then it installs what was chosen, saves the answers and starts
 * the bridge if it should run now. With --yes nothing is asked.
 */
export async function cmdSetup(options, deps, { firstRun = false } = {}) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  if (!options.yes && !(deps.isTTY && deps.stdinIsTTY)) {
    deps.err(`setup asks a few questions, so it needs a terminal. Without questions: ${selfCommand(deps)} setup --yes (see help).\n`);
    return 2;
  }
  const prompt = options.yes ? null : deps.prompt();
  const ask = prompt?.ask ?? null;
  const say = (line = '') => deps.out(`${line}\n`);
  try {
    say(firstRun ? `Welcome to CafAI Bridge ${VERSION}. A few questions set it up; you can change the answers later.` : `CafAI Bridge ${VERSION} setup`);
    if (ask) say('Press Enter to take the answer in [brackets], or type q to quit.');
    say();
    say('1. Claude Code');
    await setupClaude(options, deps, ask, files, say);
    const answers = await setupAnswers(options, deps, ask, config.setup ?? {}, say);
    const port = options.port ?? config.setup?.port ?? DEFAULT_PORT;

    if (!onlyLocal(answers.host)) {
      say();
      say('4. Firewall');
      if (deps.platform === 'win32') {
        if (ask || options.firewall) await firewallStep({ port, ask, fix: Boolean(options.firewall) }, deps);
        else say(`  Not checked (add --firewall, or run: ${selfCommand(deps)} firewall).`);
      } else {
        for (const line of firewallHints(deps.platform, port)) say(`  ${line}`);
      }
      const note = vpnNote(deps);
      if (note) say(`  ${note}`);
    }

    say();
    say('5. Setting it up');
    const common = {
      configDir: options.configDir,
      claude: options.claude,
      maxRuns: options.maxRuns,
      idleMinutes: options.idleMinutes,
      allowApiKey: options.allowApiKey,
      host: answers.host === DEFAULT_HOST ? undefined : answers.host,
      port: port === DEFAULT_PORT ? undefined : port,
      keepAwake: answers.keepAwake || undefined,
      hideCode: !deps.isTTY,
    };
    let code = 0;
    if (answers.mode === 'schedule') {
      code = await cmdInstall({ ...common, window: answers.window, weekdays: answers.weekdays || undefined, wake: answers.wake }, deps);
    } else if (answers.mode === 'always') {
      code = await cmdInstall(common, deps);
    } else {
      const removed = await uninstallAutostart(deps);
      if (removed.removed?.length > 0) say('  It no longer starts by itself: you start it when you want it.');
      say(`${connectLines({ host: answers.host, port, lan: lanAddresses(deps.networkInterfaces()), code: codeFor(common, config) }).join('\n')}`);
    }
    if (code !== 0) {
      say(`\nSetup did not finish. Fix the problem above, then run it again: ${SETUP_AGAIN}`);
      return code;
    }

    const now = deps.now();
    saveConfig(files.dir, {
      ...loadConfig(files.dir),
      setup: { mode: answers.mode, window: answers.window, weekdays: answers.weekdays, keepAwake: answers.keepAwake, wake: answers.wake, host: answers.host, port, at: now.toISOString() },
    });
    say();
    // Linux: the units were printed for the user to save; nothing runs by itself yet.
    const printedOnly = deps.platform !== 'win32' && deps.platform !== 'darwin';
    if (answers.mode === 'schedule') {
      const window = parseWindow(answers.window, { weekdays: answers.weekdays });
      const when = `${answers.weekdays ? 'Monday to Friday' : 'every day'} at ${formatTime(window.start)} and stops at ${formatTime(window.end)}`;
      if (printedOnly) say(`Done here. Once you save and enable the units above, the bridge starts ${when}.`);
      else {
        say(`Done. The bridge starts ${when}.`);
        say(inWindow(window, now) ? `It is running now, until ${formatTime(window.end)}.` : `Next start: ${describeWhen(nextStart(window, now), now)}.`);
      }
    } else if (answers.mode === 'always') {
      say(
        printedOnly
          ? 'Done here. Once you save and enable the unit above, the bridge starts whenever you log in.'
          : 'Done. The bridge starts whenever you sign in to this computer, and it is running now.',
      );
    } else {
      say('Done. Start the bridge when you want it: npm run bridge -- start (stop it with npm run bridge -- stop).');
    }
    say(`To change this: ${SETUP_AGAIN}`);
    return 0;
  } catch (error) {
    if (error instanceof SetupQuit) {
      say(`\nSetup stopped. Run it again with: ${SETUP_AGAIN}`);
      return 0;
    }
    throw error;
  } finally {
    prompt?.close();
  }
}

const RUN = {
  setup: cmdSetup,
  serve: cmdServe,
  start: cmdStart,
  stop: cmdStop,
  status: cmdStatus,
  install: cmdInstall,
  uninstall: cmdUninstall,
  doctor: cmdDoctor,
  firewall: cmdFirewall,
  code: cmdCode,
};

/**
 * Run one command line. Resolves with the exit code, or with null while the
 * bridge keeps running in this process (`serve`). A bare `npm run bridge` in
 * a terminal runs setup until setup has been done once.
 * @param {string[]} argv
 * @param {ReturnType<typeof defaultDeps>} [deps]
 * @returns {Promise<number | null>}
 */
export async function main(argv, deps = defaultDeps()) {
  const { command, options, bare, error } = parseArgs(argv);
  if (error) {
    deps.err(`${error}\n\n${helpText(deps)}`);
    return 2;
  }
  if (command === 'help') {
    deps.out(helpText(deps));
    return 0;
  }
  if (command === 'version') {
    deps.out(`${VERSION}\n`);
    return 0;
  }
  try {
    if (bare && deps.isTTY && deps.stdinIsTTY && !loadConfig(filesOf(options, deps).dir).setup) {
      return await cmdSetup(options, deps, { firstRun: true });
    }
    return await RUN[command](options, deps);
  } catch (failure) {
    deps.err(`CafAI Bridge: ${failure?.message ?? failure}\n`);
    return 1;
  }
}

/** True when node runs this file, not when a test imports it. */
function isEntry() {
  if (!process.argv[1]) return false;
  try {
    const running = realpathSync(process.argv[1]);
    const self = realpathSync(SCRIPT);
    return process.platform === 'win32' ? running.toLowerCase() === self.toLowerCase() : running === self;
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== null) leave(code);
  });
}
