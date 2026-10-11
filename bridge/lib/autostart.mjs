// Start CafAI Bridge when the user signs in, without admin rights.
//
// Windows: a shortcut in the user's Startup folder that runs `start` (which
// launches a hidden server and exits), made with WScript.Shell through
// PowerShell; when PowerShell fails, a value under the user's Run key.
// macOS: a LaunchAgent that runs `serve` itself and restarts it after a crash
// but not after `stop` (which exits 0). Linux: a systemd user unit, printed
// for the user to save. The builders are pure; files and programs go through
// `deps`, so tests never touch the real Startup folder, LaunchAgents or registry.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'CafAI Bridge';
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const LAUNCH_AGENT_LABEL = 'com.cafai.bridge';
export const SYSTEMD_UNIT = 'cafai-bridge.service';

/**
 * @typedef {object} AutostartTarget
 * @property {string} nodePath   The node that runs the bridge (process.execPath).
 * @property {string} script     Absolute path of bridge/cafai-bridge.mjs.
 * @property {string[]} [flags]  Flags to start it with (--port 9000 ...).
 * @property {string} configDir  The bridge's folder, its working directory.
 * @property {string | null} [claudePath]  macOS/Linux: the Claude Code found, whose folder goes on PATH.
 * @property {boolean} [load]    macOS: load the agent now, which starts the bridge (default true).
 */

/**
 * @typedef {object} AutostartDeps
 * @property {string} platform
 * @property {Record<string, string | undefined>} env
 * @property {string} home
 * @property {(command: string, args: string[], options?: { env?: Record<string, string | undefined> }) => Promise<{ code: number, stdout: string, stderr: string }>} exec
 * @property {number} [uid]  macOS: the user id, for launchctl's gui/<uid> domain.
 * @property {typeof nodeFs} [fs]
 */

/** The file operations autostart needs; tests pass an in-memory stand-in. */
export const nodeFs = {
  exists: (file) => existsSync(file),
  mkdir: (dir) => {
    mkdirSync(dir, { recursive: true });
  },
  writeFile: (file, text) => {
    writeFileSync(file, text);
  },
  remove: (file) => {
    rmSync(file, { force: true });
  },
};

/**
 * Run a program without a shell and collect its output. Never throws: a
 * program that cannot start reports code -1.
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: Record<string, string | undefined>, timeoutMs?: number }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runCommand(command, args, { env = process.env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, stdout, stderr: error?.message ?? String(error) });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function firstLine(text) {
  return (
    String(text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CafAI Bridge.lnk` */
export function windowsShortcutPath({ env = process.env, home = os.homedir() } = {}) {
  const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
  return path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${APP_NAME}.lnk`);
}

/**
 * One argument quoted so a Windows program's C runtime (Node's too) splits
 * it back unchanged: quotes around spaces, backslashes doubled only where
 * they come before a quote.
 * @param {string} arg
 */
export function quoteWindowsArg(arg) {
  const text = String(arg);
  if (text !== '' && !/[\s"]/.test(text)) return text;
  let out = '"';
  let slashes = 0;
  for (const ch of text) {
    if (ch === '\\') {
      slashes++;
      continue;
    }
    out += ch === '"' ? '\\'.repeat(slashes * 2 + 1) + '"' : '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

/** A Windows command line from separate arguments. */
export function windowsCommandLine(args) {
  return args.map(quoteWindowsArg).join(' ');
}

/**
 * Makes the shortcut. Every path comes from an environment variable, so
 * nothing in the script needs quoting; it has no double quotes, which a
 * command line would have to escape.
 */
export const SHORTCUT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:CAFAI_LNK)',
  '$link.TargetPath = $env:CAFAI_TARGET',
  '$link.Arguments = $env:CAFAI_ARGS',
  '$link.WorkingDirectory = $env:CAFAI_DIR',
  // 7 = minimized: `start` hides the server and exits, so only a flash shows.
  '$link.WindowStyle = 7',
  "$link.Description = 'CafAI Bridge'",
  '$link.Save()',
].join('; ');

/**
 * How to make the Startup shortcut: PowerShell, the script, and the variables it reads.
 * @param {{ lnk: string, nodePath: string, script: string, flags?: string[], workingDir: string }} spec
 */
export function shortcutCommand({ lnk, nodePath, script, flags = [], workingDir }) {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_SCRIPT],
    env: {
      CAFAI_LNK: lnk,
      CAFAI_TARGET: nodePath,
      CAFAI_ARGS: windowsCommandLine([script, 'start', ...flags]),
      CAFAI_DIR: workingDir,
    },
  };
}

/** reg.exe arguments that add the Run value (the fallback when PowerShell fails). */
export function regAddArgs(commandLine) {
  return ['add', RUN_KEY, '/v', APP_NAME, '/t', 'REG_SZ', '/d', commandLine, '/f'];
}

export const REG_QUERY_ARGS = ['query', RUN_KEY, '/v', APP_NAME];
export const REG_DELETE_ARGS = ['delete', RUN_KEY, '/v', APP_NAME, '/f'];

async function installWindows(target, deps, fs) {
  const lnk = windowsShortcutPath(deps);
  const flags = target.flags ?? [];
  let reason;
  try {
    fs.mkdir(path.win32.dirname(lnk));
    const shortcut = shortcutCommand({ lnk, nodePath: target.nodePath, script: target.script, flags, workingDir: target.configDir });
    const result = await deps.exec(shortcut.command, shortcut.args, { env: { ...deps.env, ...shortcut.env } });
    if (result.code === 0 && fs.exists(lnk)) {
      // A Run value left by an earlier install would start a second copy.
      await deps.exec('reg.exe', REG_DELETE_ARGS);
      return { ok: true, method: 'shortcut', location: lnk };
    }
    reason = firstLine(result.stderr) || firstLine(result.stdout) || `PowerShell stopped with exit code ${result.code}`;
  } catch (error) {
    reason = error?.message ?? String(error);
  }
  fs.remove(lnk);
  const commandLine = windowsCommandLine([target.nodePath, target.script, 'start', ...flags]);
  const reg = await deps.exec('reg.exe', regAddArgs(commandLine));
  if (reg.code === 0) return { ok: true, method: 'registry', location: `${RUN_KEY}\\${APP_NAME}`, reason };
  const regReason = firstLine(reg.stderr) || firstLine(reg.stdout) || `exit code ${reg.code}`;
  return { ok: false, method: 'shortcut', location: lnk, error: `${reason} (and reg.exe: ${regReason})` };
}

async function uninstallWindows(deps, fs) {
  const lnk = windowsShortcutPath(deps);
  const removed = [];
  if (fs.exists(lnk)) {
    fs.remove(lnk);
    removed.push('shortcut');
  }
  // Exit code 1 when there is no such value: nothing to remove.
  if ((await deps.exec('reg.exe', REG_DELETE_ARGS)).code === 0) removed.push('registry');
  return { ok: true, method: 'shortcut', location: lnk, removed };
}

async function windowsStatus(deps, fs) {
  const lnk = windowsShortcutPath(deps);
  if (fs.exists(lnk)) return { installed: true, method: 'shortcut', location: lnk };
  if ((await deps.exec('reg.exe', REG_QUERY_ARGS)).code === 0) {
    return { installed: true, method: 'registry', location: `${RUN_KEY}\\${APP_NAME}` };
  }
  return { installed: false, method: null, location: lnk };
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

/** The LaunchAgent and the log launchd writes the bridge's output to. */
export function macPaths({ home = os.homedir() } = {}) {
  const logDir = path.posix.join(home, 'Library', 'Logs', APP_NAME);
  return {
    plist: path.posix.join(home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`),
    logDir,
    logFile: path.posix.join(logDir, 'bridge.log'),
  };
}

export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * PATH for a service: launchd and systemd start it with a bare one, and an
 * npm-installed Claude Code needs node (`#!/usr/bin/env node`).
 */
export function serviceSearchPath({ nodePath, claudePath = null, home }) {
  const dirs = [path.posix.dirname(nodePath)];
  if (claudePath) dirs.push(path.posix.dirname(claudePath));
  dirs.push(path.posix.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  return [...new Set(dirs)].join(':');
}

/**
 * The LaunchAgent: runs `serve` at login, and again after a crash, but not
 * after `stop` (a clean exit).
 * @param {AutostartTarget & { home: string }} target
 * @returns {string}
 */
export function buildLaunchAgentPlist({ nodePath, script, flags = [], claudePath = null, configDir, home }) {
  const { logFile } = macPaths({ home });
  const string = (value) => `<string>${xmlEscape(value)}</string>`;
  const args = [nodePath, script, 'serve', ...flags].map((arg) => `    ${string(arg)}`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${string(LAUNCH_AGENT_LABEL)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>PATH</key>',
    `    ${string(serviceSearchPath({ nodePath, claudePath, home }))}`,
    '  </dict>',
    '  <key>WorkingDirectory</key>',
    `  ${string(configDir)}`,
    '  <key>StandardOutPath</key>',
    `  ${string(logFile)}`,
    '  <key>StandardErrorPath</key>',
    `  ${string(logFile)}`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** Unload the agent (which stops a bridge it started): bootout, or the older unload. */
async function unloadMac(plist, deps) {
  if ((await deps.exec('launchctl', ['bootout', `gui/${deps.uid}/${LAUNCH_AGENT_LABEL}`])).code === 0) return true;
  return (await deps.exec('launchctl', ['unload', '-w', plist])).code === 0;
}

async function installMac(target, deps, fs) {
  const files = macPaths(deps);
  fs.mkdir(path.posix.dirname(files.plist));
  fs.mkdir(files.logDir);
  // bootstrap refuses a label that is already loaded: replace the old agent.
  if (fs.exists(files.plist)) await unloadMac(files.plist, deps);
  fs.writeFile(files.plist, buildLaunchAgentPlist({ ...target, home: deps.home }));
  const result = { method: 'launchagent', location: files.plist, logFile: files.logFile };
  if (target.load === false) return { ok: true, ...result, loaded: false };
  const boot = await deps.exec('launchctl', ['bootstrap', `gui/${deps.uid}`, files.plist]);
  if (boot.code === 0) return { ok: true, ...result, loaded: true };
  const load = await deps.exec('launchctl', ['load', '-w', files.plist]);
  if (load.code === 0) return { ok: true, ...result, loaded: true };
  const error = firstLine(boot.stderr) || firstLine(load.stderr) || `launchctl stopped with exit code ${boot.code}`;
  return { ok: false, ...result, loaded: false, error };
}

async function uninstallMac(deps, fs) {
  const files = macPaths(deps);
  const existed = fs.exists(files.plist);
  // Even without the file a loaded agent may remain.
  const unloaded = await unloadMac(files.plist, deps);
  fs.remove(files.plist);
  return { ok: true, method: 'launchagent', location: files.plist, removed: existed ? ['launchagent'] : [], unloaded };
}

// ---------------------------------------------------------------------------
// Linux (the unit is printed, not installed)
// ---------------------------------------------------------------------------

/** Where a systemd user unit lives: ~/.config/systemd/user/cafai-bridge.service. */
export function systemdUnitPath({ env = process.env, home = os.homedir() } = {}) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.config');
  return path.posix.join(base, 'systemd', 'user', SYSTEMD_UNIT);
}

/** systemd expands %specifiers everywhere: a literal % is %%. */
function escapeSpecifiers(text) {
  return String(text).replace(/%/g, '%%');
}

/** One ExecStart argument: quoted when needed, $ and % doubled (systemd expands them). */
export function quoteSystemdArg(arg) {
  const text = String(arg);
  const escaped = escapeSpecifiers(text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')).replace(/\$/g, '$$$$');
  return text === '' || /[\s"'\\]/.test(text) ? `"${escaped}"` : escaped;
}

/**
 * A systemd user unit that runs `serve` and restarts it after a crash.
 * @param {AutostartTarget & { home: string }} target
 * @returns {string}
 */
export function buildSystemdUnit({ nodePath, script, flags = [], claudePath = null, configDir, home }) {
  const searchPath = escapeSpecifiers(serviceSearchPath({ nodePath, claudePath, home }).replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  return [
    '[Unit]',
    'Description=CafAI Bridge (the CafAI coach through your own Claude Code)',
    '',
    '[Service]',
    `ExecStart=${[nodePath, script, 'serve', ...flags].map(quoteSystemdArg).join(' ')}`,
    `WorkingDirectory=${escapeSpecifiers(configDir)}`,
    `Environment="PATH=${searchPath}"`,
    // After a crash, not after `stop` (a clean exit).
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The three actions
// ---------------------------------------------------------------------------

/**
 * Make the bridge start at sign-in. Windows: `{ method: 'shortcut' | 'registry' }`;
 * macOS: `{ method: 'launchagent', loaded }`; Linux: `{ method: 'systemd', unit }`,
 * the unit text to save (nothing is installed). `ok: false` comes with `error`.
 * @param {AutostartTarget} target
 * @param {AutostartDeps} deps
 */
export async function installAutostart(target, deps) {
  const fs = deps.fs ?? nodeFs;
  if (deps.platform === 'win32') return installWindows(target, deps, fs);
  if (deps.platform === 'darwin') return installMac(target, deps, fs);
  return { ok: true, method: 'systemd', location: systemdUnitPath(deps), unit: buildSystemdUnit({ ...target, home: deps.home }) };
}

/**
 * Stop starting the bridge at sign-in. `removed` lists what was there
 * ('shortcut', 'registry', 'launchagent'); on Linux nothing is removed and
 * `saved` says whether the user saved the unit.
 * @param {AutostartDeps} deps
 */
export async function uninstallAutostart(deps) {
  const fs = deps.fs ?? nodeFs;
  if (deps.platform === 'win32') return uninstallWindows(deps, fs);
  if (deps.platform === 'darwin') return uninstallMac(deps, fs);
  const location = systemdUnitPath(deps);
  return { ok: true, method: 'systemd', location, removed: [], saved: fs.exists(location) };
}

/**
 * Whether the bridge starts at sign-in, and how.
 * @param {AutostartDeps} deps
 * @returns {Promise<{ installed: boolean, method: string | null, location: string }>}
 */
export async function autostartStatus(deps) {
  const fs = deps.fs ?? nodeFs;
  if (deps.platform === 'win32') return windowsStatus(deps, fs);
  if (deps.platform === 'darwin') {
    const { plist } = macPaths(deps);
    return { installed: fs.exists(plist), method: 'launchagent', location: plist };
  }
  const location = systemdUnitPath(deps);
  return { installed: fs.exists(location), method: 'systemd', location };
}
