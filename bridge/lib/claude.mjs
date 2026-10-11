// Finding, starting and asking the user's own Claude Code.
//
// The bridge only ever runs the unmodified `claude` binary the user installed
// and signed in to. It never reads Claude Code's credentials: sign-in stays
// between Claude Code and Anthropic.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';

/** The MCP server name the coach's tools are served under; the model sees `mcp__cafai__<tool>`. */
export const MCP_SERVER = 'cafai';
export const TOOL_PREFIX = `mcp__${MCP_SERVER}__`;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * @typedef {object} ClaudeInstall
 * @property {string} path     The file found (what `doctor` shows).
 * @property {string} version  e.g. "2.1.251", or "unknown" for an explicit path that would not say.
 * @property {string} command  What to spawn.
 * @property {string[]} args   Arguments before ours (the cli.js of an npm install run with node).
 */

/** Look up an environment variable the way the OS does (case-insensitive on Windows). */
export function envValue(env, name, platform = process.platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * The file system as discovery reads it. Tests pass their own, so the Windows
 * layouts are checked on any OS (CI runs on Linux).
 */
export const realDisk = {
  listDir(dir) {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  isFile(file) {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  },
  read: (file) => readFileSync(file, 'utf8'),
  realpath: (file) => realpathSync(file),
};

/**
 * Every place Claude Code may live, PATH first, then the usual install
 * folders, in the order a tie in version is broken. A LaunchAgent or a
 * Startup-folder start has a thin PATH, hence the fixed list.
 */
export function candidatePaths({ env = process.env, platform = process.platform, home = osHomedir(), disk = realDisk } = {}) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const out = [];
  const pathVar = envValue(env, 'PATH', platform) ?? '';
  const names = win ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'];
  for (const dir of pathVar.split(win ? ';' : ':')) {
    if (dir.trim() === '') continue;
    for (const name of names) out.push(p.join(dir.trim().replace(/^"|"$/g, ''), name));
  }
  if (win) {
    const profile = envValue(env, 'USERPROFILE', platform) ?? home;
    const local = envValue(env, 'LOCALAPPDATA', platform) ?? p.join(profile, 'AppData', 'Local');
    const roaming = envValue(env, 'APPDATA', platform) ?? p.join(profile, 'AppData', 'Roaming');
    const programData = envValue(env, 'ProgramData', platform) ?? 'C:\\ProgramData';
    out.push(p.join(profile, '.local', 'bin', 'claude.exe'));
    out.push(p.join(local, 'Microsoft', 'WinGet', 'Links', 'claude.exe'));
    const packages = p.join(local, 'Microsoft', 'WinGet', 'Packages');
    for (const entry of disk.listDir(packages)) {
      if (entry.startsWith('Anthropic.ClaudeCode')) out.push(p.join(packages, entry, 'claude.exe'));
    }
    out.push(p.join(roaming, 'npm', 'claude.cmd'));
    out.push(p.join(profile, '.claude', 'local', 'claude.exe'));
    out.push(p.join(profile, '.claude', 'local', 'claude.cmd'));
    out.push(p.join(profile, 'scoop', 'shims', 'claude.exe'));
    out.push(p.join(programData, 'chocolatey', 'bin', 'claude.exe'));
    out.push(p.join(profile, '.bun', 'bin', 'claude.exe'));
    out.push(...desktopAppCopies(p.join(roaming, 'Claude', 'claude-code'), 'claude.exe', p, disk));
  } else {
    out.push(p.join(home, '.local', 'bin', 'claude'));
    out.push(p.join(home, '.claude', 'local', 'claude'));
    out.push('/opt/homebrew/bin/claude');
    out.push('/usr/local/bin/claude');
    out.push('/usr/bin/claude');
    out.push(p.join(home, '.npm-global', 'bin', 'claude'));
    out.push(p.join(home, '.bun', 'bin', 'claude'));
    out.push(p.join(home, '.volta', 'bin', 'claude'));
    const nvm = p.join(home, '.nvm', 'versions', 'node');
    for (const version of disk.listDir(nvm).sort().reverse()) out.push(p.join(nvm, version, 'bin', 'claude'));
    const appSupport = platform === 'darwin' ? p.join(home, 'Library', 'Application Support') : p.join(home, '.config');
    out.push(...desktopAppCopies(p.join(appSupport, 'Claude', 'claude-code'), 'claude', p, disk));
  }
  const seen = new Set();
  return out.filter((file) => {
    const key = win ? file.toLowerCase() : file;
    if (seen.has(key) || isDesktopApp(file)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The Claude desktop app keeps its own Claude Code up to date in
 * `<app data>/Claude/claude-code/<version>/<build>/claude[.exe]`: someone with
 * only the app can use the bridge too.
 */
function desktopAppCopies(root, name, p, disk) {
  const out = [];
  for (const version of disk.listDir(root)) {
    out.push(p.join(root, version, name));
    for (const build of disk.listDir(p.join(root, version))) out.push(p.join(root, version, build, name));
  }
  return out;
}

/**
 * The desktop app's own executable is also called claude.exe (Windows,
 * `%LOCALAPPDATA%\AnthropicClaude`), and on a Mac `Claude` inside Claude.app
 * matches `claude` on a case-insensitive disk. Asking either for `--version`
 * would open the app, so they are never candidates.
 */
export function isDesktopApp(file) {
  return /[\\/]AnthropicClaude[\\/]/i.test(file) || /\.app[\\/]Contents[\\/]/i.test(file);
}

/**
 * The target of an npm cmd-shim (`claude.cmd`): Node refuses to spawn a .cmd
 * without a shell, and a shell would have to quote JSON and paths through
 * cmd.exe. The shim names its script relative to its own folder (`%dp0%`).
 */
export function shimTarget(shimFile, disk = realDisk) {
  let text;
  try {
    text = disk.read(shimFile);
  } catch {
    return null;
  }
  const dir = path.win32.dirname(shimFile);
  const matches = [...text.matchAll(/"?%~?dp0%?\\?([^"%\r\n]+?\.(?:js|cjs|mjs|exe))"?/gi)];
  for (const match of matches) {
    // The shim also names a node.exe beside itself, which it prefers when present.
    if (/(?:^|\\)node\.exe$/i.test(match[1])) continue;
    const target = path.win32.join(dir, match[1]);
    if (disk.isFile(target)) return target;
  }
  const fallback = path.win32.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  return disk.isFile(fallback) ? fallback : null;
}

/**
 * How to start a found file: a script runs with this Node, a Windows shim is
 * resolved to what it wraps, anything else is spawned as is.
 * @returns {{ command: string, args: string[] } | null}
 */
export function resolveSpawn(file, { platform = process.platform, execPath = process.execPath, disk = realDisk } = {}) {
  const lower = file.toLowerCase();
  if (/\.(?:js|cjs|mjs)$/.test(lower)) return { command: execPath, args: [file] };
  if (platform === 'win32' && /\.(?:cmd|bat)$/.test(lower)) {
    const target = shimTarget(file, disk);
    if (!target) return null;
    return /\.exe$/i.test(target) ? { command: target, args: [] } : { command: execPath, args: [target] };
  }
  if (platform !== 'win32') {
    // npm's global `claude` is a symlink to cli.js with a `#!/usr/bin/env node`
    // line, which needs node on PATH; a LaunchAgent's PATH may not have it.
    try {
      const real = disk.realpath(file);
      if (/\.(?:js|cjs|mjs)$/i.test(real)) return { command: execPath, args: [real] };
    } catch {
      // Spawn it as found.
    }
  }
  return { command: file, args: [] };
}

/** "2.1.251" from "2.1.251 (Claude Code)", or null. */
export function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''));
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number(n) || 0);
  const pb = String(b).split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function run(command, args, { env, cwd, timeoutMs, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      { env, cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: error?.code ?? 0 }),
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Ask one install its version. */
export async function claudeVersion(spawnSpec, { env = process.env, timeoutMs = 20000 } = {}) {
  const result = await run(spawnSpec.command, [...spawnSpec.args, '--version'], { env: childEnv(env), timeoutMs });
  return parseVersion(result.stdout) ?? parseVersion(result.stderr);
}

/**
 * Find Claude Code. An explicit path (`--claude`, CAFAI_CLAUDE) wins; else
 * every install found is asked its version and the newest is used: a stale
 * copy first on PATH (WinGet's, say) can hang on every request.
 * @returns {Promise<{ chosen: ClaudeInstall | null, found: Array<{ path: string, version: string | null }> }>}
 */
export async function findClaude({
  explicit = null,
  env = process.env,
  platform = process.platform,
  home = osHomedir(),
  execPath = process.execPath,
  versionOf = claudeVersion,
  disk = realDisk,
} = {}) {
  const wanted = explicit ?? envValue(env, 'CAFAI_CLAUDE', platform) ?? null;
  if (wanted) {
    const file = path.resolve(wanted);
    const spec = existsSync(file) && !isDesktopApp(file) ? resolveSpawn(file, { platform, execPath, disk }) : null;
    if (!spec) return { chosen: null, found: [{ path: file, version: null }] };
    const version = (await versionOf(spec, { env })) ?? 'unknown';
    return { chosen: { path: file, version, ...spec }, found: [{ path: file, version }] };
  }

  const files = candidatePaths({ env, platform, home, disk }).filter((file) => disk.isFile(file));
  const checked = await Promise.all(
    files.map(async (file) => {
      const spec = resolveSpawn(file, { platform, execPath, disk });
      const version = spec ? await versionOf(spec, { env }) : null;
      return { file, spec, version };
    }),
  );
  let chosen = null;
  for (const entry of checked) {
    if (!entry.spec || !entry.version) continue;
    if (!chosen || compareVersions(entry.version, chosen.version) > 0) {
      chosen = { path: entry.file, version: entry.version, ...entry.spec };
    }
  }
  return { chosen, found: checked.map((entry) => ({ path: entry.file, version: entry.version })) };
}

/** Claude Code variables that are the user's own setup and must reach the child. */
const KEEP_CLAUDE_CODE_VARS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
]);

/**
 * The environment for a coach run. Started from inside a Claude Code session
 * (its terminal, an IDE), the bridge inherits that session's variables, which
 * would make the child think it is nested in it; an ANTHROPIC_API_KEY would
 * make Claude Code bill the key instead of the plan.
 */
export function childEnv(baseEnv = process.env, { allowApiKey = false } = {}) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper === 'CLAUDECODE' || upper === 'CLAUDE_PID' || upper === 'CLAUDE_AGENT_SDK_VERSION') continue;
    if (upper.startsWith('CLAUDE_CODE_') && !KEEP_CLAUDE_CODE_VARS.has(upper)) continue;
    if (!allowApiKey && (upper === 'ANTHROPIC_API_KEY' || upper === 'ANTHROPIC_AUTH_TOKEN')) continue;
    env[key] = value;
  }
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  // A held tool call waits for a tap on the tablet: minutes, not seconds.
  env.MCP_TOOL_TIMEOUT = String(60 * 60 * 1000);
  return env;
}

/**
 * The flags for one conversation: stream-json both ways, Claude Code's own
 * prompt, tools, settings, hooks, plugins, skills and session files all off,
 * the coach's prompt from a file (Windows caps a command line at 32 767
 * characters) and the coach's tools from our MCP endpoint only.
 */
export function buildRunArgs({ model, effort = null, systemPromptFile, mcpConfigFile = null }) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', model,
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--system-prompt-file', systemPromptFile,
  ];
  if (effort && EFFORTS.includes(effort)) args.push('--effort', effort);
  if (mcpConfigFile) args.push('--mcp-config', mcpConfigFile, '--allowedTools', `mcp__${MCP_SERVER}`);
  return args;
}

/** Start Claude Code for one conversation. */
export function spawnClaude(install, args, { cwd, env }) {
  return spawn(install.command, [...install.args, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

/** Stop a run's process, with whatever it started (Windows does not do that by itself). */
export function killProcess(child, platform = process.platform) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
    return;
  }
  child.kill('SIGTERM');
  // A Claude Code that hangs may not stop on SIGTERM; its slot is already free.
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 3000);
  force.unref?.();
  child.once('exit', () => clearTimeout(force));
}

function firstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Whether Claude Code is signed in, and how. `claude auth status` also prints
 * the email and organisation; they are dropped here and never leave the bridge.
 */
export async function claudeAuthStatus(install, { env = process.env, allowApiKey = false, timeoutMs = 20000 } = {}) {
  if (!install) return null;
  const result = await run(install.command, [...install.args, 'auth', 'status'], { env: childEnv(env, { allowApiKey }), timeoutMs });
  const parsed = firstJsonObject(result.stdout);
  if (!parsed || typeof parsed.loggedIn !== 'boolean') return null;
  return {
    loggedIn: parsed.loggedIn,
    authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : null,
    subscriptionType: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : null,
  };
}

/**
 * One tiny real turn, so a Claude Code that starts but never answers (an old
 * version, a broken sign-in) shows up in Settings and `doctor`.
 */
export async function probeClaude(
  install,
  { env = process.env, workDir, model = 'claude-haiku-4-5', timeoutMs = 60000, allowApiKey = false } = {},
) {
  if (!install) return { ok: false, error: 'Claude Code is not installed on this computer.' };
  const started = Date.now();
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--system-prompt', 'You are a connection check. Reply with OK.',
  ];
  const result = await run(install.command, [...install.args, ...args], {
    env: childEnv(env, { allowApiKey }),
    cwd: workDir,
    timeoutMs,
    input: 'Reply with OK.',
  });
  const ms = Date.now() - started;
  if (result.error?.killed || (result.error && ms >= timeoutMs)) {
    return { ok: false, error: `Claude Code did not answer within ${Math.round(timeoutMs / 1000)} s. Update it (claude update) and try again.` };
  }
  const parsed = firstJsonObject(result.stdout);
  if (parsed && parsed.type === 'result' && !parsed.is_error) return { ok: true, ms, model };
  const said = parsed && typeof parsed.result === 'string' && parsed.result.trim() !== '' ? parsed.result.trim() : result.stderr.trim().slice(0, 300);
  if (!said) return { ok: false, error: `Claude Code stopped with exit code ${result.code}.` };
  // Claude Code's own words; the server turns them into the bridge's sentences.
  return { ok: false, error: said, said, status: typeof parsed?.api_error_status === 'number' ? parsed.api_error_status : null };
}
