// Start CafAI Bridge by itself, without admin rights: at sign-in ("always"),
// or every morning in a window such as 05:00-10:00 (a schedule).
//
// Windows, always: a shortcut in the user's Startup folder that runs `start`
// (which launches a hidden server and exits), made with WScript.Shell through
// PowerShell; when PowerShell fails, a value under the user's Run key.
// Windows, schedule: a Task Scheduler task "CafAI Bridge" that runs
// `start --window ...` at the start time and at sign-in, as the signed-in user.
// macOS: a LaunchAgent that runs `serve` itself and restarts it after a crash
// but not after `stop` or the window's end (both exit 0); a schedule adds
// StartCalendarInterval. Linux: systemd user units, printed for the user to
// save. The builders are pure; files and programs go through `deps`, so tests
// never touch the real Startup folder, Task Scheduler, LaunchAgents or registry.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'CafAI Bridge';
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const LAUNCH_AGENT_LABEL = 'com.cafai.bridge';
export const SYSTEMD_UNIT = 'cafai-bridge.service';
export const SYSTEMD_TIMER = 'cafai-bridge.timer';
export const TASK_NAME = 'CafAI Bridge';

/**
 * @typedef {object} AutostartTarget
 * @property {string} nodePath   The node that runs the bridge (process.execPath).
 * @property {string} script     Absolute path of bridge/cafai-bridge.mjs.
 * @property {string[]} [flags]  Flags to start it with (--window 05:00-10:00 --port 9000 ...).
 * @property {string} configDir  The bridge's folder, its working directory.
 * @property {string | null} [claudePath]  macOS/Linux: the Claude Code found, whose folder goes on PATH.
 * @property {boolean} [load]    macOS: load the agent now, which starts the bridge (default true).
 * @property {string | null} [window]  A schedule: "05:00-10:00" (its flags are in `flags` too).
 * @property {boolean} [weekdays]      A schedule on Monday to Friday only.
 * @property {boolean} [wake]          Windows: the task wakes the computer at the start time (default true).
 */

/**
 * @typedef {object} AutostartDeps
 * @property {string} platform
 * @property {Record<string, string | undefined>} env
 * @property {string} home
 * @property {(command: string, args: string[], options?: { env?: Record<string, string | undefined>, timeoutMs?: number }) => Promise<{ code: number, stdout: string, stderr: string }>} exec
 * @property {number} [uid]  macOS: the user id, for launchctl's gui/<uid> domain.
 * @property {() => Date} [now]  Windows: today's date for the task's first start.
 * @property {typeof nodeFs} [fs]
 */

/** The file operations autostart needs; tests pass an in-memory stand-in. */
export const nodeFs = {
  exists: (file) => existsSync(file),
  mkdir: (dir) => {
    mkdirSync(dir, { recursive: true });
  },
  writeFile: (file, data) => {
    writeFileSync(file, data);
  },
  read: (file) => readFileSync(file, 'utf8'),
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

function readText(fs, file) {
  try {
    return fs.read ? fs.read(file) : '';
  } catch {
    return '';
  }
}

/** What a schedule's flags say: `{ window, weekdays, keepAwake }`, or null without --window. */
function scheduleFromArgs(args) {
  const window = /--window\s+(\d{1,2}:\d{2}-\d{1,2}:\d{2})/.exec(args)?.[1] ?? null;
  return window ? { window, weekdays: /--weekdays\b/.test(args), keepAwake: /--keep-awake\b/.test(args) } : null;
}

// ---------------------------------------------------------------------------
// Windows: the Startup shortcut, the Run value, the scheduled task
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

/** schtasks.exe arguments that create (or replace) the task from an XML file. */
export function taskCreateArgs(xmlFile) {
  return ['/Create', '/TN', TASK_NAME, '/XML', xmlFile, '/F'];
}

export const TASK_QUERY_ARGS = ['/Query', '/TN', TASK_NAME, '/XML'];
export const TASK_DELETE_ARGS = ['/Delete', '/TN', TASK_NAME, '/F'];

/** The account the task runs as: USERDOMAIN\USERNAME. */
export function windowsUserId(env = process.env) {
  const user = env.USERNAME || os.userInfo().username;
  return env.USERDOMAIN ? `${env.USERDOMAIN}\\${user}` : user;
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
 * The Task Scheduler task of a scheduled bridge, as XML for `schtasks /Create
 * /XML`. Two triggers, the start time (daily, or Monday to Friday) and sign-in,
 * both run `start --window ...`, which returns within seconds and starts
 * nothing outside the window; so a start missed while the computer was off
 * may run late (StartWhenAvailable) without starting the bridge at noon. It
 * runs as the signed-in user (InteractiveToken): no password, no admin rights.
 * @param {AutostartTarget & { window: string, userId: string, now: Date }} task
 * @returns {string}
 */
export function buildTaskXml({ nodePath, script, flags = [], configDir, window, weekdays = false, wake = true, userId, now }) {
  const [startTime] = window.split('-');
  const two = (n) => String(n).padStart(2, '0');
  // Local time with no zone: the task follows the computer's clock through daylight saving.
  const firstStart = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${startTime}:00`;
  const user = xmlEscape(userId);
  const days = weekdays
    ? [
        '      <ScheduleByWeek>',
        '        <DaysOfWeek>',
        ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day) => `          <${day} />`),
        '        </DaysOfWeek>',
        '        <WeeksInterval>1</WeeksInterval>',
        '      </ScheduleByWeek>',
      ]
    : ['      <ScheduleByDay>', '        <DaysInterval>1</DaysInterval>', '      </ScheduleByDay>'];
  const description = `Starts CafAI Bridge ${weekdays ? 'Monday to Friday' : 'every day'} at ${startTime}, and at sign-in; it runs only within ${window}.`;
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${xmlEscape(description)}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <CalendarTrigger>',
    `      <StartBoundary>${firstStart}</StartBoundary>`,
    '      <Enabled>true</Enabled>',
    ...days,
    '    </CalendarTrigger>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    `      <UserId>${user}</UserId>`,
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    `      <UserId>${user}</UserId>`,
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    `    <WakeToRun>${wake ? 'true' : 'false'}</WakeToRun>`,
    // The action is `start`, which returns in seconds; the bridge it starts stops itself at the window's end.
    '    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${xmlEscape(nodePath)}</Command>`,
    `      <Arguments>${xmlEscape(windowsCommandLine([script, 'start', ...flags]))}</Arguments>`,
    `      <WorkingDirectory>${xmlEscape(configDir)}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    '',
  ].join('\r\n');
}

/** Text as schtasks wants an XML file: UTF-16LE with a byte order mark. */
export function utf16WithBom(text) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/**
 * The schedule in a task's XML (`schtasks /Query /XML`): `{ window, weekdays,
 * keepAwake, wake, enabled }`; window is null when the task has no --window.
 */
export function parseTaskXml(text) {
  const args = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(text)?.[1] ?? '';
  const settings = /<Settings>([\s\S]*?)<\/Settings>/.exec(text)?.[1] ?? '';
  const schedule = scheduleFromArgs(args) ?? { window: null, weekdays: false, keepAwake: false };
  return { ...schedule, wake: /<WakeToRun>true<\/WakeToRun>/.test(settings), enabled: !/<Enabled>false<\/Enabled>/.test(settings) };
}

async function removeTask(deps) {
  return (await deps.exec('schtasks.exe', TASK_DELETE_ARGS)).code === 0;
}

async function installWindows(target, deps, fs) {
  const lnk = windowsShortcutPath(deps);
  const flags = target.flags ?? [];
  let reason;
  try {
    fs.mkdir(path.win32.dirname(lnk));
    const shortcut = shortcutCommand({ lnk, nodePath: target.nodePath, script: target.script, flags, workingDir: target.configDir });
    const result = await deps.exec(shortcut.command, shortcut.args, { env: { ...deps.env, ...shortcut.env } });
    if (result.code === 0 && fs.exists(lnk)) {
      // A Run value left by an earlier install would start a second copy, and a schedule would stop it.
      await deps.exec('reg.exe', REG_DELETE_ARGS);
      await removeTask(deps);
      return { ok: true, method: 'shortcut', location: lnk };
    }
    reason = firstLine(result.stderr) || firstLine(result.stdout) || `PowerShell stopped with exit code ${result.code}`;
  } catch (error) {
    reason = error?.message ?? String(error);
  }
  fs.remove(lnk);
  const commandLine = windowsCommandLine([target.nodePath, target.script, 'start', ...flags]);
  const reg = await deps.exec('reg.exe', regAddArgs(commandLine));
  if (reg.code === 0) {
    await removeTask(deps);
    return { ok: true, method: 'registry', location: `${RUN_KEY}\\${APP_NAME}`, reason };
  }
  const regReason = firstLine(reg.stderr) || firstLine(reg.stdout) || `exit code ${reg.code}`;
  return { ok: false, method: 'shortcut', location: lnk, error: `${reason} (and reg.exe: ${regReason})` };
}

async function installWindowsTask(target, deps, fs) {
  const now = deps.now ? deps.now() : new Date();
  const xml = buildTaskXml({ ...target, wake: target.wake !== false, userId: windowsUserId(deps.env), now });
  const file = path.win32.join(target.configDir, 'cafai-bridge-task.xml');
  fs.writeFile(file, utf16WithBom(xml));
  let result;
  try {
    result = await deps.exec('schtasks.exe', taskCreateArgs(file));
  } finally {
    fs.remove(file);
  }
  if (result.code !== 0) {
    const error = firstLine(result.stderr) || firstLine(result.stdout) || `schtasks stopped with exit code ${result.code}`;
    return { ok: false, method: 'task', location: TASK_NAME, error };
  }
  // One way to start is enough: the schedule replaces a Startup shortcut or Run value.
  fs.remove(windowsShortcutPath(deps));
  await deps.exec('reg.exe', REG_DELETE_ARGS);
  return { ok: true, method: 'task', location: TASK_NAME, wake: target.wake !== false };
}

async function uninstallWindows(deps, fs) {
  const lnk = windowsShortcutPath(deps);
  const removed = [];
  if (fs.exists(lnk)) {
    fs.remove(lnk);
    removed.push('shortcut');
  }
  // Exit code 1 when there is no such value or task: nothing to remove.
  if ((await deps.exec('reg.exe', REG_DELETE_ARGS)).code === 0) removed.push('registry');
  if (await removeTask(deps)) removed.push('task');
  return { ok: true, method: 'shortcut', location: lnk, removed };
}

async function windowsStatus(deps, fs) {
  const task = await deps.exec('schtasks.exe', TASK_QUERY_ARGS);
  if (task.code === 0) return { installed: true, method: 'task', location: TASK_NAME, schedule: parseTaskXml(task.stdout) };
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

function calendarEntry(hour, minute, indent, weekday = null) {
  const lines = [`${indent}<dict>`];
  if (weekday !== null) lines.push(`${indent}  <key>Weekday</key>`, `${indent}  <integer>${weekday}</integer>`);
  lines.push(`${indent}  <key>Hour</key>`, `${indent}  <integer>${hour}</integer>`, `${indent}  <key>Minute</key>`, `${indent}  <integer>${minute}</integer>`, `${indent}</dict>`);
  return lines;
}

/**
 * The LaunchAgent: runs `serve` at login, and again after a crash, but not
 * after `stop` (a clean exit). A schedule (`window`) adds a start every day,
 * or Monday to Friday (launchd's Weekday 1-5), at the window's start; `serve
 * --window` exits 0 outside the window and at its end.
 * @param {AutostartTarget & { home: string }} target
 * @returns {string}
 */
export function buildLaunchAgentPlist({ nodePath, script, flags = [], claudePath = null, configDir, home, window = null, weekdays = false }) {
  const { logFile } = macPaths({ home });
  const string = (value) => `<string>${xmlEscape(value)}</string>`;
  const args = [nodePath, script, 'serve', ...flags].map((arg) => `    ${string(arg)}`);
  const schedule = [];
  if (window) {
    const [hour, minute] = window.split('-')[0].split(':').map(Number);
    schedule.push('  <key>StartCalendarInterval</key>');
    if (weekdays) schedule.push('  <array>', ...[1, 2, 3, 4, 5].flatMap((day) => calendarEntry(hour, minute, '    ', day)), '  </array>');
    else schedule.push(...calendarEntry(hour, minute, '  '));
  }
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
    ...schedule,
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

/** The schedule in a LaunchAgent written by buildLaunchAgentPlist, or null. */
export function parsePlistSchedule(text) {
  const args = [...String(text).matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1]).join(' ');
  return scheduleFromArgs(args);
}

/**
 * macOS cannot wake for a LaunchAgent by itself; pmset can, with admin rights
 * the bridge never asks for, so this is printed, never run. A minute before
 * the start; at 00:00 that minute falls on the previous day.
 * @param {{ window: string, weekdays?: boolean }} schedule
 */
export function pmsetWakeCommand({ window, weekdays = false }) {
  const [hour, minute] = window.split('-')[0].split(':').map(Number);
  const before = (hour * 60 + minute + 1439) % 1440;
  const time = `${String(Math.floor(before / 60)).padStart(2, '0')}:${String(before % 60).padStart(2, '0')}:00`;
  // pmset's day letters, Monday first; U is Sunday.
  const letters = ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
  let days = weekdays ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  if (hour === 0 && minute === 0) days = days.map((day) => (day + 6) % 7).sort((a, b) => a - b);
  return `sudo pmset repeat wakeorpoweron ${days.map((day) => letters[day]).join('')} ${time}`;
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
// Linux (the units are printed, not installed)
// ---------------------------------------------------------------------------

function systemdUserDir({ env = process.env, home = os.homedir() } = {}) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.config');
  return path.posix.join(base, 'systemd', 'user');
}

/** Where a systemd user unit lives: ~/.config/systemd/user/cafai-bridge.service. */
export function systemdUnitPath(where = {}) {
  return path.posix.join(systemdUserDir(where), SYSTEMD_UNIT);
}

/** Where the schedule's timer lives: ~/.config/systemd/user/cafai-bridge.timer. */
export function systemdTimerPath(where = {}) {
  return path.posix.join(systemdUserDir(where), SYSTEMD_TIMER);
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
 * A systemd user unit that runs `serve` and restarts it after a crash (not
 * after `stop` or the window's end, which exit 0).
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

/**
 * The schedule's timer: starts the service every day (or Monday to Friday) at
 * the window's start, and after a missed start once the computer is back on
 * (Persistent); the service's `serve --window` does nothing outside the window.
 * @param {{ window: string, weekdays?: boolean }} schedule
 */
export function buildSystemdTimer({ window, weekdays = false }) {
  const [startTime] = window.split('-');
  return [
    '[Unit]',
    `Description=Start CafAI Bridge ${weekdays ? 'Monday to Friday' : 'every day'} at ${startTime}`,
    '',
    '[Timer]',
    `OnCalendar=${weekdays ? 'Mon..Fri ' : ''}*-*-* ${startTime}:00`,
    'Persistent=true',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The three actions
// ---------------------------------------------------------------------------

/**
 * Make the bridge start by itself: at sign-in, or (with `window`) on a
 * schedule. Windows: `{ method: 'shortcut' | 'registry' | 'task' }`; macOS:
 * `{ method: 'launchagent', loaded }`; Linux: `{ method: 'systemd', unit }`
 * (plus `timer` for a schedule), the text to save (nothing is installed).
 * `ok: false` comes with `error`.
 * @param {AutostartTarget} target
 * @param {AutostartDeps} deps
 */
export async function installAutostart(target, deps) {
  const fs = deps.fs ?? nodeFs;
  if (deps.platform === 'win32') return target.window ? installWindowsTask(target, deps, fs) : installWindows(target, deps, fs);
  if (deps.platform === 'darwin') return installMac(target, deps, fs);
  const result = { ok: true, method: 'systemd', location: systemdUnitPath(deps), unit: buildSystemdUnit({ ...target, home: deps.home }) };
  return target.window ? { ...result, timerLocation: systemdTimerPath(deps), timer: buildSystemdTimer({ window: target.window, weekdays: target.weekdays }) } : result;
}

/**
 * Stop starting the bridge by itself. `removed` lists what was there
 * ('shortcut', 'registry', 'task', 'launchagent'); on Linux nothing is
 * removed and `saved` says whether the user saved a unit or timer.
 * @param {AutostartDeps} deps
 */
export async function uninstallAutostart(deps) {
  const fs = deps.fs ?? nodeFs;
  if (deps.platform === 'win32') return uninstallWindows(deps, fs);
  if (deps.platform === 'darwin') return uninstallMac(deps, fs);
  const location = systemdUnitPath(deps);
  const timerLocation = systemdTimerPath(deps);
  return { ok: true, method: 'systemd', location, timerLocation, removed: [], saved: fs.exists(location) || fs.exists(timerLocation) };
}

/**
 * Whether the bridge starts by itself, how, and on what schedule:
 * `{ installed, method, location, schedule? }`, where a schedule is
 * `{ window, weekdays, keepAwake }` (plus `wake` and `enabled` for a Windows task).
 * @param {AutostartDeps} deps
 */
export async function autostartStatus(deps) {
  const fs = deps.fs ?? nodeFs;
  if (deps.platform === 'win32') return windowsStatus(deps, fs);
  if (deps.platform === 'darwin') {
    const { plist } = macPaths(deps);
    if (!fs.exists(plist)) return { installed: false, method: 'launchagent', location: plist };
    const schedule = parsePlistSchedule(readText(fs, plist));
    return { installed: true, method: 'launchagent', location: plist, ...(schedule ? { schedule } : {}) };
  }
  const location = systemdUnitPath(deps);
  const timerLocation = systemdTimerPath(deps);
  if (fs.exists(timerLocation)) {
    const schedule = scheduleFromArgs(/^ExecStart=(.*)$/m.exec(readText(fs, location))?.[1] ?? '');
    return { installed: true, method: 'systemd', location: timerLocation, ...(schedule ? { schedule } : {}) };
  }
  return { installed: fs.exists(location), method: 'systemd', location };
}
