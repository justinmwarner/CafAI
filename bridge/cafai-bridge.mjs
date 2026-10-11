#!/usr/bin/env node
// CafAI Bridge: the CafAI coach answers through this computer's own Claude
// Code, signed in with the owner's Claude Pro or Max plan, instead of a
// metered Anthropic API key (docs/superpowers/specs/2026-10-11-local-claude-design.md).
//
// `serve` (the default) runs the bridge in this terminal and shows the address
// and pairing code to type into CafAI; `start`, `stop` and `status` run it in
// the background; `install` and `uninstall` start it at sign-in; `doctor`
// checks Claude Code, its sign-in and one real turn; `code` shows or renews
// the code. The server is lib/server.mjs; this file is the command line around
// it. Every command gets what it touches (fetch, spawn, the server and Claude
// Code helpers, output, the clock) in one `deps` object, so tests pass fakes.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autostartStatus, installAutostart, macPaths, nodeFs, runCommand, uninstallAutostart } from './lib/autostart.mjs';
import { configDir, formatCode, generateCode, loadConfig, paths, saveConfig } from './lib/config.mjs';
import { lanAddresses } from './lib/net.mjs';

export const VERSION = '0.1.0';
export const DEFAULT_PORT = 8877;
const DEFAULT_HOST = '0.0.0.0';
const CLAUDE_DOWNLOAD = 'https://claude.com/claude-code';
const SCRIPT = fileURLToPath(import.meta.url);
const CAFAI_SETTING = 'In CafAI: Settings > Where the coach runs > Claude on my computer';
const API_KEY_SIGN_IN = /api.?key|console/i;
// The Claude desktop app's own copy: %APPDATA%\Claude\claude-code\<version>\..., ~/Library/Application Support/Claude/claude-code/...
const DESKTOP_APP_CLAUDE_CODE = /[\\/]Claude[\\/]claude-code[\\/]/i;

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

const COMMANDS = ['serve', 'start', 'stop', 'status', 'install', 'uninstall', 'doctor', 'code', 'help'];

const wholeNumber = (min, max) => (text) => (/^\d+$/.test(text) && Number(text) >= min && Number(text) <= max ? Number(text) : undefined);
const nonEmpty = (text) => (text.trim() === '' ? undefined : text);
// The model ids the server accepts too.
const modelId = (text) => (/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/.test(text) ? text : undefined);

/** Flags with a value: [option, parser (undefined = invalid), what a valid value is]. */
const VALUE_FLAGS = {
  '--port': ['port', wholeNumber(1, 65535), 'a port number from 1 to 65535'],
  '--host': ['host', nonEmpty, 'an address'],
  '--claude': ['claude', nonEmpty, 'the path of a Claude Code program'],
  '--max-runs': ['maxRuns', wholeNumber(1, 20), 'a whole number from 1 to 20'],
  '--idle-minutes': ['idleMinutes', wholeNumber(1, 1440), 'a whole number of minutes from 1 to 1440'],
  '--config-dir': ['configDir', nonEmpty, 'a folder'],
  '--model': ['model', modelId, 'a model id such as claude-haiku-4-5'],
};

const SWITCHES = {
  '--allow-api-key': 'allowApiKey',
  '--no-start': 'noStart',
  '--no-probe': 'noProbe',
  '--new': 'new',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
};

/**
 * Split the command line into the command and its options.
 * @param {string[]} argv  The arguments after the script.
 * @returns {{ command: string, options: Record<string, any>, error?: string }}
 */
export function parseArgs(argv) {
  const options = {};
  let command = null;
  const fail = (error) => ({ command: 'help', options, error });
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
      } else if (SWITCHES[name] && eq < 0) {
        options[SWITCHES[name]] = true;
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
  if (options.help) return { command: 'help', options };
  if (options.version) return { command: 'version', options };
  return { command: command ?? 'serve', options };
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

Commands:
  serve       Run the bridge here and show the address and code for CafAI (the default)
  start       Run it in the background
  stop        Stop it
  status      Whether it is running, its addresses, code and log
  install     Start it whenever you sign in to this computer, and start it now
  uninstall   Stop starting it at sign-in
  doctor      Check Claude Code, its sign-in, one real turn, the port and the firewall
  code        Show the pairing code (--new makes a new one)
  help        Show this help

Options:
  --port <n>          Port to listen on (default ${DEFAULT_PORT})
  --host <address>    Address to listen on (default ${DEFAULT_HOST}: every network of this computer)
  --claude <path>     Use this Claude Code (default: the newest one found)
  --max-runs <n>      Conversations kept running at once (default 3)
  --idle-minutes <n>  Close a conversation after this many idle minutes (default 30)
  --allow-api-key     Let coach runs use ANTHROPIC_API_KEY, billed to that key
  --config-dir <dir>  Keep the code, the log and the work folder in <dir>
  --no-start          install: do not start it now
  --no-probe          doctor: skip the real turn
  --model <id>        doctor: the model for the real turn (default claude-haiku-4-5)
  --new               code: make a new code
  --version           Show the version

install remembers --port, --host, --claude, --max-runs, --idle-minutes,
--allow-api-key and --config-dir for every start at sign-in.
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
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    fetch: (url, init) => fetch(url, init),
    spawn,
    exec: runCommand,
    fs: nodeFs,
    exists: existsSync,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
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
 * The flags `start` and autostart hand on to `serve`. Paths become absolute:
 * an autostart runs from another folder.
 */
export function serveFlags(options) {
  const flags = [];
  if (options.port !== undefined) flags.push('--port', String(options.port));
  if (options.host !== undefined) flags.push('--host', String(options.host));
  if (options.claude !== undefined) flags.push('--claude', path.resolve(options.claude));
  if (options.maxRuns !== undefined) flags.push('--max-runs', String(options.maxRuns));
  if (options.idleMinutes !== undefined) flags.push('--idle-minutes', String(options.idleMinutes));
  if (options.allowApiKey) flags.push('--allow-api-key');
  if (options.configDir !== undefined) flags.push('--config-dir', path.resolve(options.configDir));
  return flags;
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
 * The `claude` a terminal runs: the first match on PATH (with PATHEXT's
 * extensions on Windows), or null.
 * @param {{ env: Record<string, string | undefined>, platform: string, exists: (file: string) => boolean }} where
 */
export function firstOnPath({ env, platform, exists }) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const extensions = win ? (envGet(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const raw of (envGet(env, 'PATH', platform) ?? '').split(win ? ';' : ':')) {
    const dir = raw.trim().replace(/^"|"$/g, '');
    if (dir === '') continue;
    for (const extension of extensions) {
      const file = p.join(dir, `claude${extension.toLowerCase()}`);
      if (exists(file)) return file;
    }
  }
  return null;
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
 * Run the bridge in this process. Resolves with an exit code when it could
 * not start, or with null once it listens: it then runs until Ctrl+C, a
 * signal or `stop`, and exits from there.
 */
export async function cmdServe(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const allowApiKey = Boolean(options.allowApiKey);
  const log = (line) => deps.out(`${stamp(deps.now())} ${line}\n`);
  let handle = null;
  let closing = false;

  // Ctrl+C or a signal (close the server here), or `stop` (the server has closed itself).
  const shutdown = async (serverClosed) => {
    if (closing) {
      // A second Ctrl+C: leave without waiting.
      deps.exit(1, true);
      return;
    }
    closing = true;
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

  const auth = handle.claude
    ? await withTimeout(deps.claudeAuthStatus(handle.claude, { env: deps.env, allowApiKey }), 25_000).catch(() => null)
    : null;
  const lan = lanAddresses(deps.networkInterfaces());
  // Started by `start` or at login, serve writes to the log: the code stays out of it.
  const banner = bannerLines({ install: handle.claude, auth, host: handle.host, port: handle.port, lan, code: deps.isTTY ? config.code : null, allowApiKey });
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
  const lan = () => lanAddresses(deps.networkInterfaces());

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
    deps.out(`${connectLines({ host: running.host, port: running.port, lan: lan(), code: config.code }).join('\n')}\n`);
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
    deps.err(`CafAI Bridge did not start${ended ? `: it ${ended}` : ' within 10 seconds'}.\n`);
    const tail = logTail(files.logFile, offset);
    if (tail) deps.err(`The end of its log (${files.logFile}):\n${tail}\n`);
    return 1;
  }
  deps.out(`CafAI Bridge is running in the background on port ${port} (process ${child.pid}).\n\n`);
  deps.out(`${connectLines({ host, port, lan: lan(), code: config.code }).join('\n')}\n`);
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

function autostartText(auto, self) {
  if (!auto.installed) return `no (${self} install starts it at sign-in)`;
  if (auto.method === 'shortcut') return `yes, a shortcut in your Startup folder (${auto.location})`;
  if (auto.method === 'registry') return `yes, from your Run registry key (${auto.location})`;
  if (auto.method === 'launchagent') return `yes, a LaunchAgent (${auto.location})`;
  return `yes, with the systemd unit you saved (${auto.location})`;
}

/** Whether a bridge runs, where to reach it, the code, autostart and the log. Exit 0 when running. */
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
  lines.push('', `Starts at sign-in: ${autostartText(auto, self)}`, `Log: ${files.logFile}`);
  if (deps.platform === 'darwin' && auto.installed) lines.push(`Log when started at login: ${macPaths(deps).logFile}`);
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

/** Start the bridge at sign-in, then (unless --no-start) now. */
export async function cmdInstall(options, deps) {
  const files = filesOf(options, deps);
  const config = loadConfig(files.dir);
  const self = selfCommand(deps);
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
    { nodePath: deps.execPath, script: deps.script, flags: serveFlags(options), configDir: files.dir, claudePath, load: !options.noStart },
    deps,
  );

  if (result.method === 'systemd') {
    // The unit alone on stdout, so `install > <file>` saves it.
    deps.err(
      [
        'On Linux nothing is installed: save this systemd user unit yourself.',
        `Save it as ${result.location} (or run: ${self} install > ${result.location}), then run:`,
        '  systemctl --user daemon-reload',
        '  systemctl --user enable --now cafai-bridge',
        `Until then, ${self} start runs it in the background.`,
        '',
      ].join('\n'),
    );
    deps.out(result.unit);
    return 0;
  }
  if (!result.ok) {
    deps.err(`Could not set CafAI Bridge to start at sign-in: ${result.error}\n`);
    if (result.method === 'launchagent') deps.err(`The LaunchAgent is saved (${result.location}), so it should start at your next login.\n`);
    return 1;
  }
  if (result.method === 'shortcut') {
    deps.out(`CafAI Bridge will start whenever you sign in to Windows (a shortcut in your Startup folder: ${result.location}).\n`);
  } else if (result.method === 'registry') {
    deps.out(
      'CafAI Bridge will start whenever you sign in to Windows (from your Run registry key: ' +
        `PowerShell could not make a Startup shortcut: ${result.reason}).\n`,
    );
  } else {
    deps.out(`CafAI Bridge will start whenever you log in (LaunchAgent ${result.location}; its log: ${result.logFile}).\n`);
  }
  deps.out("If you move CafAI's folder or change Node, run install again.\n");
  if (options.noStart) {
    deps.out(`It was not started now (--no-start). Start it with: ${self} start\n`);
    return 0;
  }
  deps.out('\n');
  if (deps.platform !== 'darwin') return cmdStart(options, deps);

  // launchd has started it already (RunAtLoad).
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const up = await waitFor(deps, async () => (await probeHealth(deps, localHost(host), port)).state === 'bridge', () => false, 10_000);
  if (!up) {
    deps.err('CafAI Bridge did not answer within 10 seconds.\n');
    const tail = logTail(macLog, macLogOffset);
    if (tail) deps.err(`The end of its log (${macLog}):\n${tail}\n`);
    return 1;
  }
  deps.out(`CafAI Bridge is running on port ${port}.\n\n`);
  deps.out(`${connectLines({ host, port, lan: lanAddresses(deps.networkInterfaces()), code: config.code }).join('\n')}\n`);
  return 0;
}

/** Stop starting the bridge at sign-in. */
export async function cmdUninstall(options, deps) {
  const self = selfCommand(deps);
  const result = await uninstallAutostart(deps);
  if (result.method === 'systemd') {
    deps.out(
      result.saved
        ? `On Linux the bridge installs nothing itself. To remove the unit you saved: systemctl --user disable --now cafai-bridge, then delete ${result.location}.\n`
        : 'On Linux the bridge installs nothing itself, so there is nothing to remove.\n',
    );
    return 0;
  }
  if (result.removed.length === 0) {
    deps.out('CafAI Bridge was not set to start at sign-in.\n');
  } else if (result.method === 'launchagent') {
    deps.out(`CafAI Bridge will no longer start at login (removed ${result.location}).\n`);
  } else {
    const what = result.removed.map((item) => (item === 'shortcut' ? 'the Startup shortcut' : 'the Run registry value')).join(' and ');
    deps.out(`CafAI Bridge will no longer start at sign-in (removed ${what}).\n`);
  }
  deps.out(
    deps.platform === 'darwin' && result.unloaded
      ? `launchd has stopped the bridge it ran; one started with start keeps running until: ${self} stop\n`
      : `If it is running now, it keeps running until you stop it: ${self} stop\n`,
  );
  return 0;
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
  for (const line of firewallHints(deps.platform, port)) say(`  ${line}`);

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

const RUN = { serve: cmdServe, start: cmdStart, stop: cmdStop, status: cmdStatus, install: cmdInstall, uninstall: cmdUninstall, doctor: cmdDoctor, code: cmdCode };

/**
 * Run one command line. Resolves with the exit code, or with null while the
 * bridge keeps running in this process (`serve`).
 * @param {string[]} argv
 * @param {ReturnType<typeof defaultDeps>} [deps]
 * @returns {Promise<number | null>}
 */
export async function main(argv, deps = defaultDeps()) {
  const { command, options, error } = parseArgs(argv);
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
