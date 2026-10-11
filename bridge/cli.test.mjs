import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VERSION,
  addressList,
  bannerLines,
  connectLines,
  firstOnPath,
  main,
  parseArgs,
  readPidFile,
  serveFlags,
  signInState,
  stamp,
} from './cafai-bridge.mjs';
import { windowsCommandLine } from './lib/autostart.mjs';
import { formatCode, loadConfig, paths } from './lib/config.mjs';

const HEALTH = { ok: true, app: 'cafai-bridge', version: '0.1.0', protocol: 1 };
const PLAN = { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' };
const INSTALL = { path: '/home/me/.local/bin/claude', version: '2.1.251', command: '/home/me/.local/bin/claude', args: [] };
const STATUS = {
  ok: true,
  app: 'cafai-bridge',
  version: '0.1.0',
  protocol: 1,
  claude: { found: true, version: '2.1.251', path: '/home/me/.local/bin/claude' },
  account: PLAN,
  usage: { status: 'allowed', fiveHour: { utilization: 0.08, resetsAt: null }, sevenDay: { utilization: 0.3, resetsAt: null } },
  runs: { live: 0, max: 3 },
  problems: [],
};
const WIN = {
  platform: 'win32',
  home: 'C:\\Users\\me',
  env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
  execPath: 'C:\\Program Files\\nodejs\\node.exe',
};
const LNK = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\CafAI Bridge.lnk';

let root;
let dir;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'cafai-bridge-cli-'));
  dir = path.join(root, 'config');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Files in memory, for autostart: nothing real is touched. */
function memoryFs(files = {}) {
  const store = new Map(Object.entries(files));
  return {
    store,
    exists: (file) => store.has(file),
    mkdir: () => {},
    writeFile: (file, text) => {
      store.set(file, text);
    },
    remove: (file) => {
      store.delete(file);
    },
  };
}

/** A fetch answering `METHOD host:port/path` from a table; anything else is refused like a closed port. */
function fakeFetch(routes = {}) {
  return vi.fn(async (url, init = {}) => {
    const { host, pathname } = new URL(url);
    const route = routes[`${init.method ?? 'GET'} ${host}${pathname}`];
    const answer = typeof route === 'function' ? route(init) : route;
    if (!answer) throw new TypeError('fetch failed');
    const status = answer.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => answer.body };
  });
}

function fakeChild(pid = 5555) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

function makeDeps(overrides = {}) {
  const out = [];
  const err = [];
  const deps = {
    platform: 'linux',
    env: {},
    home: '/home/me',
    cwd: path.join(root, 'repo'),
    execPath: '/usr/bin/node',
    script: path.join(root, 'repo', 'bridge', 'cafai-bridge.mjs'),
    nodeVersion: 'v24.13.1',
    pid: 4321,
    uid: 501,
    isTTY: false,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    fetch: fakeFetch(),
    spawn: vi.fn(() => fakeChild()),
    exec: vi.fn(async () => ({ code: 1, stdout: '', stderr: '' })),
    fs: memoryFs(),
    exists: () => false,
    // A real turn of the event loop, so a child's exit event can arrive between polls.
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    now: () => new Date(2026, 9, 11, 14, 3, 22),
    networkInterfaces: () => ({ Ethernet: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] }),
    isAlive: () => false,
    kill: vi.fn(),
    onSignal: vi.fn(),
    exit: vi.fn(),
    portState: vi.fn(async () => 'free'),
    startBridgeServer: vi.fn(),
    findClaude: vi.fn(async () => ({ chosen: null, found: [] })),
    claudeAuthStatus: vi.fn(async () => PLAN),
    probeClaude: vi.fn(async () => ({ ok: true, ms: 2400, model: 'claude-haiku-4-5' })),
    ...overrides,
  };
  return { deps, stdout: () => out.join(''), stderr: () => err.join('') };
}

const codeShown = () => `Code:    ${formatCode(loadConfig(dir).code)}`;

describe('parseArgs', () => {
  it('runs serve when no command is given', () => {
    expect(parseArgs([])).toEqual({ command: 'serve', options: {} });
  });

  it('reads every flag, with a space or an equals sign', () => {
    const argv = ['start', '--port', '9000', '--host=192.168.1.20', '--claude', '/opt/claude', '--max-runs', '2', '--idle-minutes=5'];
    argv.push('--allow-api-key', '--config-dir', 'cfg', '--no-start', '--no-probe', '--new');
    expect(parseArgs(argv)).toEqual({
      command: 'start',
      options: {
        port: 9000,
        host: '192.168.1.20',
        claude: '/opt/claude',
        maxRuns: 2,
        idleMinutes: 5,
        allowApiKey: true,
        configDir: 'cfg',
        noStart: true,
        noProbe: true,
        new: true,
      },
    });
  });

  it('reads the model for the doctor test turn, and refuses one that is not a model id', () => {
    expect(parseArgs(['doctor', '--model', 'claude-opus-5-5']).options).toEqual({ model: 'claude-opus-5-5' });
    expect(parseArgs(['doctor', '--model', 'not a model']).error).toBe('--model needs a model id such as claude-haiku-4-5, not "not a model".');
  });

  it('turns --help and --version into commands', () => {
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['start', '-h']).command).toBe('help');
    expect(parseArgs(['--version']).command).toBe('version');
  });

  it('rejects unknown flags and commands, and missing or bad values', () => {
    expect(parseArgs(['--bogus']).error).toBe('Unknown option --bogus.');
    expect(parseArgs(['--port']).error).toBe('--port needs a port number from 1 to 65535.');
    expect(parseArgs(['--port', '--host', 'x']).error).toBe('--port needs a port number from 1 to 65535.');
    expect(parseArgs(['--port', 'abc']).error).toBe('--port needs a port number from 1 to 65535, not "abc".');
    expect(parseArgs(['--port', '70000']).error).toMatch(/not "70000"/);
    expect(parseArgs(['--max-runs', '0']).error).toMatch(/^--max-runs needs/);
    expect(parseArgs(['--idle-minutes', '1.5']).error).toMatch(/^--idle-minutes needs/);
    expect(parseArgs(['--new=yes']).error).toBe('Unknown option --new=yes.');
    expect(parseArgs(['launch']).error).toBe('Unknown command "launch".');
    expect(parseArgs(['start', 'stop']).error).toBe('Unexpected "stop" after start.');
  });

  it('hands the flags start and autostart pass on to serve, with absolute paths', () => {
    expect(serveFlags({ port: 9000, host: '0.0.0.0', claude: 'rel/claude', maxRuns: 2, idleMinutes: 5, allowApiKey: true, configDir: 'cfg', noStart: true })).toEqual([
      '--port',
      '9000',
      '--host',
      '0.0.0.0',
      '--claude',
      path.resolve('rel/claude'),
      '--max-runs',
      '2',
      '--idle-minutes',
      '5',
      '--allow-api-key',
      '--config-dir',
      path.resolve('cfg'),
    ]);
    expect(serveFlags({})).toEqual([]);
  });
});

describe('main', () => {
  it('prints the error and the help, and exits 2, on a bad command line', async () => {
    const { deps, stderr } = makeDeps();
    expect(await main(['--bogus'], deps)).toBe(2);
    expect(stderr()).toContain('Unknown option --bogus.');
    expect(stderr()).toContain('Usage: node bridge/cafai-bridge.mjs [command] [options]');
  });

  it('prints the help and the version', async () => {
    const help = makeDeps();
    expect(await main(['help'], help.deps)).toBe(0);
    expect(help.stdout()).toContain('Commands:');
    const version = makeDeps();
    expect(await main(['--version'], version.deps)).toBe(0);
    expect(version.stdout()).toBe('0.1.0\n');
    expect(VERSION).toBe('0.1.0');
  });

  it('turns an unexpected failure into a sentence and exit 1', async () => {
    const { deps, stderr } = makeDeps({ findClaude: vi.fn(async () => Promise.reject(new Error('boom'))) });
    expect(await main(['doctor', '--config-dir', dir], deps)).toBe(1);
    expect(stderr()).toBe('CafAI Bridge: boom\n');
  });
});

describe('what the bridge shows', () => {
  it('names Claude Code, the plan, where to go in CafAI, every address and the code', () => {
    const lines = bannerLines({ install: INSTALL, auth: PLAN, host: '0.0.0.0', port: 8877, lan: ['192.168.1.20', '10.0.0.8'], code: 'K7QM2XWD' });
    expect(lines).toEqual([
      'Claude Code 2.1.251: /home/me/.local/bin/claude',
      'Signed in with your Claude plan (max).',
      '',
      'In CafAI: Settings > Where the coach runs > Claude on my computer',
      '  Address: 192.168.1.20',
      '  Address: 10.0.0.8',
      '  Address: 127.0.0.1   (if Decaid runs on this computer)',
      '  Code:    K7QM-2XWD',
    ]);
  });

  it('never shows the email or organisation of the sign-in', () => {
    const auth = { ...PLAN, email: 'me@example.com', orgName: 'Me Inc' };
    const text = bannerLines({ install: INSTALL, auth, host: '0.0.0.0', port: 8877, lan: [], code: 'K7QM2XWD' }).join('\n');
    expect(text).not.toContain('me@example.com');
    expect(text).not.toContain('Me Inc');
  });

  it('adds the port to every address when it is not 8877', () => {
    expect(addressList({ host: '0.0.0.0', port: 9000, lan: ['192.168.1.20'] })).toEqual([
      { address: '192.168.1.20:9000' },
      { address: '127.0.0.1:9000', note: 'if Decaid runs on this computer' },
    ]);
  });

  it('lists only the address it listens on when --host is given', () => {
    expect(addressList({ host: '192.168.1.20', port: 8877, lan: ['192.168.1.20', '10.0.0.8'] })).toEqual([{ address: '192.168.1.20' }]);
    expect(addressList({ host: '127.0.0.1', port: 8877, lan: ['192.168.1.20'] })).toEqual([{ address: '127.0.0.1', note: 'only from this computer' }]);
  });

  it('says so when the computer has no network address', () => {
    expect(connectLines({ host: '0.0.0.0', port: 8877, lan: [], code: 'K7QM2XWD' })).toContain(
      '  (No network address found: connect this computer to your Wi-Fi or network.)',
    );
  });

  it('tells how to get Claude Code when it is missing', () => {
    expect(bannerLines({ install: null, auth: null, host: '0.0.0.0', port: 8877, lan: [], code: 'K7QM2XWD' })[0]).toBe(
      'Claude Code: not found. Install it from https://claude.com/claude-code, then run claude once and sign in with /login.',
    );
  });

  it('rates the sign-in: plan ok, signed out or API key a problem, anything else a warning', () => {
    expect(signInState(PLAN)).toEqual({ level: 'ok', text: 'Signed in with your Claude plan (max).' });
    expect(signInState({ loggedIn: false, authMethod: null, subscriptionType: null })).toEqual({
      level: 'problem',
      text: 'Claude Code is not signed in. Open a terminal, run claude and sign in with /login.',
    });
    expect(signInState({ loggedIn: true, authMethod: 'api_key', subscriptionType: null }).text).toContain(
      'Claude Code is signed in with an API key, so the coach would be billed to that key.',
    );
    expect(signInState({ loggedIn: true, authMethod: 'oauth_token', subscriptionType: null }).level).toBe('warning');
    expect(signInState(null).level).toBe('warning');
  });

  it('stamps log lines with the local date and time', () => {
    expect(stamp(new Date(2026, 9, 11, 9, 5, 7))).toBe('2026-10-11 09:05:07');
  });

  it('reads the pid file, old style or new', () => {
    loadConfig(dir);
    const file = paths(dir).pidFile;
    writeFileSync(file, '123\n');
    expect(readPidFile(file)).toEqual({ pid: 123 });
    writeFileSync(file, '{"pid":124,"port":9000,"host":"0.0.0.0"}\n');
    expect(readPidFile(file)).toEqual({ pid: 124, port: 9000, host: '0.0.0.0' });
    writeFileSync(file, 'nonsense');
    expect(readPidFile(file)).toBeNull();
    expect(readPidFile(path.join(dir, 'missing.pid'))).toBeNull();
  });
});

describe('serve', () => {
  const handleOf = (overrides = {}) => ({ port: 8877, host: '0.0.0.0', claude: INSTALL, close: vi.fn(async () => {}), ...overrides });

  it('starts the server with the code, writes the pid file and shows the banner', async () => {
    const handle = handleOf();
    const { deps, stdout } = makeDeps({ startBridgeServer: vi.fn(async () => handle), isTTY: true });
    expect(await main(['--config-dir', dir], deps)).toBeNull();
    const options = deps.startBridgeServer.mock.calls[0][0];
    expect(options).toMatchObject({
      code: loadConfig(dir).code,
      port: 8877,
      host: '0.0.0.0',
      claudePath: null,
      maxRuns: 3,
      idleMinutes: 30,
      allowApiKey: false,
      workDir: paths(dir).workDir,
      version: '0.1.0',
    });
    expect(readPidFile(paths(dir).pidFile)).toEqual({ pid: 4321, port: 8877, host: '0.0.0.0' });
    expect(deps.claudeAuthStatus).toHaveBeenCalledWith(INSTALL, { env: deps.env, allowApiKey: false });
    const text = stdout();
    expect(text.startsWith('CafAI Bridge 0.1.0\n')).toBe(true);
    expect(text).toContain('Claude Code 2.1.251: /home/me/.local/bin/claude\nSigned in with your Claude plan (max).\n');
    expect(text).toContain('In CafAI: Settings > Where the coach runs > Claude on my computer\n  Address: 192.168.1.20\n');
    expect(text).toContain('  Address: 127.0.0.1   (if Decaid runs on this computer)\n');
    expect(text).toContain(codeShown());

    options.log('POST /v1/messages claude-sonnet-4-6, 3 messages, 2.1 s');
    expect(stdout().endsWith(`${stamp(deps.now())} POST /v1/messages claude-sonnet-4-6, 3 messages, 2.1 s\n`)).toBe(true);
  });

  it('keeps the code out of the log when its output is not a terminal (start, or at sign-in)', async () => {
    const { deps, stdout } = makeDeps({ startBridgeServer: vi.fn(async () => handleOf()) });
    expect(await main(['--config-dir', dir], deps)).toBeNull();
    const text = stdout();
    expect(text).not.toContain(formatCode(loadConfig(dir).code));
    expect(text).toContain('  Code:    not written to the log; node bridge/cafai-bridge.mjs code shows it\n');
  });

  it('passes its flags on to the server', async () => {
    const { deps, stdout } = makeDeps({ startBridgeServer: vi.fn(async () => handleOf({ port: 9000 })) });
    await main(['--port', '9000', '--claude', '/opt/claude', '--max-runs', '2', '--idle-minutes', '10', '--allow-api-key', '--config-dir', dir], deps);
    expect(deps.startBridgeServer.mock.calls[0][0]).toMatchObject({ port: 9000, claudePath: '/opt/claude', maxRuns: 2, idleMinutes: 10, allowApiKey: true });
    expect(stdout()).toContain('Address: 192.168.1.20:9000\n');
    expect(stdout()).toContain('--allow-api-key is on');
  });

  it('closes the server, removes the pid file and exits 0 on Ctrl+C', async () => {
    const handle = handleOf();
    const { deps } = makeDeps({ startBridgeServer: vi.fn(async () => handle) });
    await main(['--config-dir', dir], deps);
    expect(deps.onSignal.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM', 'SIGHUP']));
    await deps.onSignal.mock.calls.find((call) => call[0] === 'SIGINT')[1]();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(existsSync(paths(dir).pidFile)).toBe(false);
  });

  it('leaves at once on a second Ctrl+C while the server is still closing', async () => {
    let finishClose;
    const handle = handleOf({ close: vi.fn(() => new Promise((resolve) => (finishClose = resolve))) });
    const { deps } = makeDeps({ startBridgeServer: vi.fn(async () => handle) });
    await main(['--config-dir', dir], deps);
    const onInt = deps.onSignal.mock.calls.find((call) => call[0] === 'SIGINT')[1];
    const first = onInt();
    await onInt();
    expect(deps.exit.mock.calls).toEqual([[1, true]]);
    finishClose();
    await first;
    expect(deps.exit.mock.calls).toEqual([[1, true], [0]]);
  });

  it('exits 0 without closing twice when stop has shut the server down', async () => {
    const handle = handleOf();
    const { deps } = makeDeps({ startBridgeServer: vi.fn(async () => handle) });
    await main(['--config-dir', dir], deps);
    await deps.startBridgeServer.mock.calls[0][0].onShutdownRequest();
    expect(handle.close).not.toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(existsSync(paths(dir).pidFile)).toBe(false);
  });

  it('shows how to get Claude Code when the server found none', async () => {
    const { deps, stdout } = makeDeps({ startBridgeServer: vi.fn(async () => handleOf({ claude: null })) });
    await main(['--config-dir', dir], deps);
    expect(stdout()).toContain('Install it from https://claude.com/claude-code');
    expect(deps.claudeAuthStatus).not.toHaveBeenCalled();
  });

  it('explains a port in use', async () => {
    const inUse = Object.assign(new Error('listen EADDRINUSE: address already in use 0.0.0.0:8877'), { code: 'EADDRINUSE' });
    const { deps, stderr } = makeDeps({ startBridgeServer: vi.fn(async () => Promise.reject(inUse)) });
    expect(await main(['--config-dir', dir], deps)).toBe(1);
    expect(stderr()).toBe(
      'Something already uses port 8877. Maybe CafAI Bridge is already running (check with: node bridge/cafai-bridge.mjs status), ' +
        'or pick another port with --port.\n',
    );
    expect(existsSync(paths(dir).pidFile)).toBe(false);
  });

  it('exits 0 when the port is held by the bridge itself', async () => {
    const inUse = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    const { deps, stdout } = makeDeps({
      startBridgeServer: vi.fn(async () => Promise.reject(inUse)),
      fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { body: HEALTH } }),
    });
    expect(await main(['--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toContain('CafAI Bridge is already running on port 8877.');
  });
});

describe('start', () => {
  it('says so when the bridge already runs, without starting another', async () => {
    const { deps, stdout } = makeDeps({ fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { body: HEALTH } }) });
    expect(await main(['start', '--config-dir', dir], deps)).toBe(0);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stdout()).toContain('CafAI Bridge is already running on port 8877.');
    expect(stdout()).toContain(codeShown());
  });

  it('finds a running bridge on the port its pid file names', async () => {
    loadConfig(dir);
    writeFileSync(paths(dir).pidFile, JSON.stringify({ pid: 999, port: 9000, host: '0.0.0.0' }));
    const { deps, stdout } = makeDeps({ isAlive: (pid) => pid === 999, fetch: fakeFetch({ 'GET 127.0.0.1:9000/health': { body: HEALTH } }) });
    expect(await main(['start', '--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toContain('already running on port 9000 (process 999)');
    expect(stdout()).toContain('Address: 192.168.1.20:9000\n');
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('starts a hidden serve with its flags, waits for it, and shows the address, code, Claude Code and log', async () => {
    let up = false;
    const child = fakeChild();
    const spawn = vi.fn(() => {
      up = true;
      return child;
    });
    const { deps, stdout } = makeDeps({
      spawn,
      fetch: fakeFetch({
        'GET 127.0.0.1:9000/health': () => (up ? { body: HEALTH } : null),
        'GET 127.0.0.1:9000/v1/status': (init) => (init.headers['x-api-key'] === loadConfig(dir).code ? { body: STATUS } : { status: 401, body: {} }),
      }),
    });
    expect(await main(['start', '--port', '9000', '--config-dir', dir], deps)).toBe(0);
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('/usr/bin/node');
    expect(args).toEqual([deps.script, 'serve', '--port', '9000', '--config-dir', path.resolve(dir)]);
    expect(options).toMatchObject({ cwd: paths(dir).dir, detached: true, windowsHide: true });
    expect(options.stdio[0]).toBe('ignore');
    expect(typeof options.stdio[1]).toBe('number');
    expect(options.stdio[2]).toBe(options.stdio[1]);
    expect(child.unref).toHaveBeenCalled();
    const text = stdout();
    expect(text).toContain('CafAI Bridge is running in the background on port 9000 (process 5555).');
    expect(text).toContain('  Address: 192.168.1.20:9000\n  Address: 127.0.0.1:9000   (if Decaid runs on this computer)\n');
    expect(text).toContain(codeShown());
    expect(text).toContain('Claude Code 2.1.251: /home/me/.local/bin/claude\nSigned in with your Claude plan (max).\n');
    expect(text).toContain('Plan usage: 8% of the 5-hour limit, 30% of the weekly limit used.');
    expect(text).toContain(`Log: ${paths(dir).logFile}\n`);
  });

  it('shows the end of this start in the log, and exits 1, when the bridge does not come up', async () => {
    loadConfig(dir);
    writeFileSync(paths(dir).logFile, 'an earlier run\n');
    const child = fakeChild();
    const { deps, stderr } = makeDeps({
      spawn: vi.fn(() => {
        appendFileSync(paths(dir).logFile, 'Something already uses port 8877.\n');
        setImmediate(() => child.emit('exit', 1, null));
        return child;
      }),
    });
    expect(await main(['start', '--config-dir', dir], deps)).toBe(1);
    expect(stderr()).toContain('CafAI Bridge did not start: it stopped with exit code 1.');
    expect(stderr()).toContain('Something already uses port 8877.');
    expect(stderr()).not.toContain('an earlier run');
  });

  it('refuses a port another program holds', async () => {
    const { deps, stderr } = makeDeps({ fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { status: 404, body: { error: 'not here' } } }) });
    expect(await main(['start', '--config-dir', dir], deps)).toBe(1);
    expect(stderr()).toContain('Another program uses port 8877.');
    expect(deps.spawn).not.toHaveBeenCalled();
  });
});

describe('stop', () => {
  it('asks the bridge to shut down, with the code, and waits until it is gone', async () => {
    const { code } = loadConfig(dir);
    let running = true;
    const { deps, stdout } = makeDeps({
      fetch: fakeFetch({
        'GET 127.0.0.1:8877/health': () => (running ? { body: HEALTH } : null),
        'POST 127.0.0.1:8877/v1/shutdown': (init) => {
          if (init.headers['x-api-key'] !== code) return { status: 401, body: {} };
          running = false;
          return { status: 202, body: { ok: true } };
        },
      }),
    });
    expect(await main(['stop', '--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toBe('CafAI Bridge stopped.\n');
    expect(deps.kill).not.toHaveBeenCalled();
  });

  it('ends the process in the pid file when the bridge refuses the code', async () => {
    loadConfig(dir);
    writeFileSync(paths(dir).pidFile, JSON.stringify({ pid: 999, port: 8877, host: '0.0.0.0' }));
    let alive = true;
    const { deps, stdout } = makeDeps({
      isAlive: (pid) => pid === 999 && alive,
      kill: vi.fn(() => {
        alive = false;
      }),
      fetch: fakeFetch({
        'GET 127.0.0.1:8877/health': () => (alive ? { body: HEALTH } : null),
        'POST 127.0.0.1:8877/v1/shutdown': { status: 401, body: {} },
      }),
    });
    expect(await main(['stop', '--config-dir', dir], deps)).toBe(0);
    expect(deps.kill).toHaveBeenCalledWith(999, 'SIGTERM');
    expect(stdout()).toContain('did not accept the code');
    expect(stdout()).toContain('so its process (999) was ended');
    expect(existsSync(paths(dir).pidFile)).toBe(false);
  });

  it('ends no process when no pid file is about this bridge', async () => {
    const { deps, stderr } = makeDeps({
      fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { body: HEALTH }, 'POST 127.0.0.1:8877/v1/shutdown': { status: 401, body: {} } }),
    });
    expect(await main(['stop', '--config-dir', dir], deps)).toBe(1);
    expect(deps.kill).not.toHaveBeenCalled();
    expect(stderr()).toContain('CafAI Bridge on port 8877 did not stop');
  });

  it('says so when nothing runs, and clears a pid file left by a crash', async () => {
    loadConfig(dir);
    writeFileSync(paths(dir).pidFile, '999\n');
    const { deps, stdout } = makeDeps();
    expect(await main(['stop', '--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toBe('CafAI Bridge is not running (nothing answers on port 8877).\n');
    expect(existsSync(paths(dir).pidFile)).toBe(false);
  });
});

describe('status', () => {
  it('shows a running bridge: process, addresses, code, Claude Code, autostart, log', async () => {
    loadConfig(dir);
    writeFileSync(paths(dir).pidFile, JSON.stringify({ pid: 999, port: 8877, host: '0.0.0.0' }));
    const { deps, stdout } = makeDeps({
      isAlive: (pid) => pid === 999,
      fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { body: HEALTH }, 'GET 127.0.0.1:8877/v1/status': { body: STATUS } }),
    });
    expect(await main(['status', '--config-dir', dir], deps)).toBe(0);
    const text = stdout();
    expect(text).toContain('CafAI Bridge 0.1.0 is running on port 8877 (process 999).');
    expect(text).toContain('  Address: 192.168.1.20\n');
    expect(text).toContain(codeShown());
    expect(text).toContain('Claude Code 2.1.251: /home/me/.local/bin/claude');
    expect(text).toContain('Starts at sign-in: no (node bridge/cafai-bridge.mjs install starts it at sign-in)');
    expect(text).toContain(`Log: ${paths(dir).logFile}\n`);
    expect(text).toContain(`Config folder: ${paths(dir).dir}\n`);
  });

  it('shows a stopped bridge and the Startup shortcut, and exits 1', async () => {
    const { deps, stdout } = makeDeps({ ...WIN, fs: memoryFs({ [LNK]: '' }) });
    expect(await main(['status', '--config-dir', dir], deps)).toBe(1);
    expect(stdout()).toContain('CafAI Bridge is not running. Start it with: node bridge/cafai-bridge.mjs start\n');
    expect(stdout()).toContain(codeShown());
    expect(stdout()).toContain(`Starts at sign-in: yes, a shortcut in your Startup folder (${LNK})`);
  });
});

describe('code', () => {
  it('shows the code', async () => {
    const { deps, stdout } = makeDeps();
    expect(await main(['code', '--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toBe(`Code: ${formatCode(loadConfig(dir).code)}\n`);
  });

  it('makes and saves a new code, and says CafAI and the running bridge need it', async () => {
    const old = loadConfig(dir).code;
    const { deps, stdout } = makeDeps({ fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { body: HEALTH } }) });
    expect(await main(['code', '--new', '--config-dir', dir], deps)).toBe(0);
    const fresh = loadConfig(dir).code;
    expect(fresh).not.toBe(old);
    expect(stdout()).toContain(`New code: ${formatCode(fresh)}\n`);
    expect(stdout()).toContain('CafAI needs the new code: enter it in Settings > Where the coach runs.');
    expect(stdout()).toContain('run node bridge/cafai-bridge.mjs stop, then node bridge/cafai-bridge.mjs start');
  });
});

describe('install', () => {
  const powershellMakes = (fs) =>
    vi.fn(async (command, args, options) => {
      if (command === 'powershell.exe') fs.writeFile(options.env.CAFAI_LNK, 'shortcut');
      return { code: 0, stdout: '', stderr: '' };
    });

  it('makes the Startup shortcut with the flags it was given, then starts the bridge', async () => {
    const fs = memoryFs();
    const exec = powershellMakes(fs);
    let up = false;
    const { deps, stdout } = makeDeps({
      ...WIN,
      fs,
      exec,
      spawn: vi.fn(() => {
        up = true;
        return fakeChild();
      }),
      fetch: fakeFetch({ 'GET 127.0.0.1:9000/health': () => (up ? { body: HEALTH } : null) }),
    });
    expect(await main(['install', '--port', '9000', '--config-dir', dir], deps)).toBe(0);
    const { env } = exec.mock.calls[0][2];
    expect(env.CAFAI_LNK).toBe(LNK);
    expect(env.CAFAI_TARGET).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(env.CAFAI_ARGS).toBe(windowsCommandLine([deps.script, 'start', '--port', '9000', '--config-dir', path.resolve(dir)]));
    expect(env.CAFAI_DIR).toBe(paths(dir).dir);
    expect(stdout()).toContain(`CafAI Bridge will start whenever you sign in to Windows (a shortcut in your Startup folder: ${LNK}).`);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(stdout()).toContain('CafAI Bridge is running in the background on port 9000');
  });

  it('does not start it with --no-start', async () => {
    const fs = memoryFs();
    const { deps, stdout } = makeDeps({ ...WIN, fs, exec: powershellMakes(fs) });
    expect(await main(['install', '--no-start', '--config-dir', dir], deps)).toBe(0);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stdout()).toContain('It was not started now (--no-start).');
  });

  it('writes a LaunchAgent on macOS, with Claude Code on its PATH, and waits for launchd to start the bridge', async () => {
    const fs = memoryFs();
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const plistFile = '/Users/me/Library/LaunchAgents/com.cafai.bridge.plist';
    const { deps, stdout } = makeDeps({
      platform: 'darwin',
      home: '/Users/me',
      fs,
      exec,
      findClaude: vi.fn(async () => ({ chosen: { ...INSTALL, path: '/opt/claude/bin/claude' }, found: [] })),
      fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { body: HEALTH } }),
    });
    expect(await main(['install', '--config-dir', dir], deps)).toBe(0);
    const plist = fs.store.get(plistFile);
    expect(plist).toContain('<string>serve</string>');
    expect(plist).toContain('/opt/claude/bin:');
    expect(exec).toHaveBeenCalledWith('launchctl', ['bootstrap', 'gui/501', plistFile]);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stdout()).toContain('CafAI Bridge is running on port 8877.');
    expect(stdout()).toContain(codeShown());
  });

  it('prints a systemd unit on Linux, alone on stdout, and starts nothing', async () => {
    const { deps, stdout, stderr } = makeDeps();
    expect(await main(['install', '--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toMatch(/^\[Unit\]\n/);
    expect(stdout()).toContain(' serve --config-dir ');
    expect(stderr()).toContain('On Linux nothing is installed');
    expect(stderr()).toContain('systemctl --user enable --now cafai-bridge');
    expect(deps.spawn).not.toHaveBeenCalled();
  });
});

describe('uninstall', () => {
  it('removes the Startup shortcut and says a running bridge keeps running', async () => {
    const fs = memoryFs({ [LNK]: 'shortcut' });
    const { deps, stdout } = makeDeps({ ...WIN, fs });
    expect(await main(['uninstall'], deps)).toBe(0);
    expect(fs.exists(LNK)).toBe(false);
    expect(stdout()).toContain('CafAI Bridge will no longer start at sign-in (removed the Startup shortcut).');
    expect(stdout()).toContain('If it is running now, it keeps running until you stop it');
  });

  it('says when there was nothing to remove', async () => {
    const { deps, stdout } = makeDeps({ ...WIN });
    expect(await main(['uninstall'], deps)).toBe(0);
    expect(stdout()).toContain('CafAI Bridge was not set to start at sign-in.');
  });
});

describe('doctor', () => {
  const OLD = { path: '/old/bin/claude', version: '2.1.126' };
  const NEW = { path: '/new/bin/claude', version: '2.1.251', command: '/new/bin/claude', args: [] };
  const doctorDeps = (overrides = {}) =>
    makeDeps({
      env: { PATH: '/old/bin:/new/bin' },
      exists: (file) => file === '/old/bin/claude' || file === '/new/bin/claude',
      findClaude: vi.fn(async () => ({ chosen: NEW, found: [OLD, { path: NEW.path, version: NEW.version }] })),
      ...overrides,
    });

  it('lists the installs, marks the one used, warns about an older one first on PATH, and passes', async () => {
    const { deps, stdout } = doctorDeps();
    expect(await main(['doctor', '--config-dir', dir], deps)).toBe(0);
    const text = stdout();
    expect(text).toMatch(/ {3}2\.1\.126 +\/old\/bin\/claude\n/);
    expect(text).toMatch(/ {2}\* 2\.1\.251 +\/new\/bin\/claude {3}\(used\)\n/);
    expect(text).toContain('An older Claude Code (2.1.126, /old/bin/claude) comes first on PATH.');
    expect(text).toContain('ok       Signed in with your Claude plan (max).');
    expect(text).toContain('it uses a tiny bit of your plan');
    expect(text).toContain('ok       Claude Code answered in 2.4 s (claude-haiku-4-5).');
    expect(text).toContain('ok       Port 8877 is free.');
    expect(text).toContain("ok       This computer's address on the network: 192.168.1.20.");
    expect(text).toContain('sudo ufw allow 8877/tcp');
    expect(text).toContain(`Config folder: ${paths(dir).dir}\n`);
    expect(text.endsWith('No problems found (1 warning above).\n')).toBe(true);
    expect(deps.findClaude).toHaveBeenCalledWith({ explicit: null, env: deps.env, platform: 'linux', home: '/home/me' });
    expect(deps.probeClaude).toHaveBeenCalledWith(NEW, { env: deps.env, workDir: paths(dir).workDir, allowApiKey: false });
  });

  it('flags an API-key sign-in and skips the test turn it would pay for', async () => {
    const { deps, stdout } = doctorDeps({ claudeAuthStatus: vi.fn(async () => ({ loggedIn: true, authMethod: 'api_key', subscriptionType: null })) });
    expect(await main(['doctor', '--config-dir', dir], deps)).toBe(1);
    expect(stdout()).toContain('PROBLEM  Claude Code is signed in with an API key, so the coach would be billed to that key.');
    expect(deps.probeClaude).not.toHaveBeenCalled();
    expect(stdout().endsWith('1 problem found.\n')).toBe(true);
  });

  it('flags a signed-out Claude Code', async () => {
    const { deps, stdout } = doctorDeps({ claudeAuthStatus: vi.fn(async () => ({ loggedIn: false, authMethod: null, subscriptionType: null })) });
    expect(await main(['doctor', '--config-dir', dir], deps)).toBe(1);
    expect(stdout()).toContain('PROBLEM  Claude Code is not signed in. Open a terminal, run claude and sign in with /login.');
    expect(deps.probeClaude).not.toHaveBeenCalled();
  });

  it('flags a missing Claude Code with where to get it', async () => {
    const { deps, stdout } = makeDeps();
    expect(await main(['doctor', '--config-dir', dir], deps)).toBe(1);
    expect(stdout()).toContain('PROBLEM  Claude Code was not found. Install it from https://claude.com/claude-code');
    expect(deps.claudeAuthStatus).not.toHaveBeenCalled();
  });

  it('warns that ANTHROPIC_API_KEY is set and removed for coach runs, and skips the turn with --no-probe', async () => {
    const { deps, stdout } = doctorDeps({ env: { PATH: '/new/bin', ANTHROPIC_API_KEY: 'sk-ant-test' } });
    expect(await main(['doctor', '--no-probe', '--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toContain('warning  ANTHROPIC_API_KEY is set here. The bridge removes it for coach runs (unless --allow-api-key)');
    expect(stdout()).not.toContain('sk-ant-test');
    expect(deps.probeClaude).not.toHaveBeenCalled();
  });

  it('flags a failed test turn and a port another program holds', async () => {
    const { deps, stdout } = doctorDeps({
      probeClaude: vi.fn(async () => ({ ok: false, error: 'Claude Code did not answer within 60 s. Update it (claude update) and try again.' })),
      fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { status: 404, body: {} } }),
    });
    expect(await main(['doctor', '--config-dir', dir], deps)).toBe(1);
    expect(stdout()).toContain('PROBLEM  The test turn failed: Claude Code did not answer within 60 s.');
    expect(stdout()).toContain('PROBLEM  Another program uses port 8877.');
    expect(stdout().endsWith('2 problems found.\n')).toBe(true);
  });

  it('runs the test turn on the model given with --model', async () => {
    const { deps } = doctorDeps();
    expect(await main(['doctor', '--model', 'claude-opus-5-5', '--config-dir', dir], deps)).toBe(0);
    expect(deps.probeClaude).toHaveBeenCalledWith(NEW, { env: deps.env, workDir: paths(dir).workDir, allowApiKey: false, model: 'claude-opus-5-5' });
  });

  it("says which install is the Claude desktop app's own", async () => {
    const app = { path: '/Users/me/Library/Application Support/Claude/claude-code/2.1.290/a1b2/claude', version: '2.1.290', command: 'x', args: [] };
    const { deps, stdout } = makeDeps({ platform: 'darwin', findClaude: vi.fn(async () => ({ chosen: app, found: [OLD, app] })) });
    await main(['doctor', '--no-probe', '--config-dir', dir], deps);
    expect(stdout()).toContain(`* 2.1.290    ${app.path}   (the Claude desktop app keeps it up to date; used)`);
  });

  it('is happy to find the bridge itself on the port', async () => {
    const { deps, stdout } = doctorDeps({ fetch: fakeFetch({ 'GET 127.0.0.1:8877/health': { body: HEALTH } }) });
    expect(await main(['doctor', '--no-probe', '--config-dir', dir], deps)).toBe(0);
    expect(stdout()).toContain('ok       CafAI Bridge 0.1.0 is running on port 8877.');
    expect(deps.portState).not.toHaveBeenCalled();
  });

  it('gives the Windows firewall hints', async () => {
    const { deps, stdout } = doctorDeps({ platform: 'win32' });
    await main(['doctor', '--no-probe', '--config-dir', dir], deps);
    expect(stdout()).toContain('Windows Defender Firewall asks about Node.js: allow it on Private networks.');
    expect(stdout()).toContain('If your network is marked Public, mark it Private');
  });
});

describe('firstOnPath', () => {
  it('follows PATH and PATHEXT on Windows, as a terminal does', () => {
    const exists = (file) => ['C:\\WinGet\\Links\\claude.exe', 'C:\\Users\\me\\.local\\bin\\claude.exe'].includes(file);
    const env = { Path: 'C:\\Windows;"C:\\WinGet\\Links";C:\\Users\\me\\.local\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    expect(firstOnPath({ platform: 'win32', env, exists })).toBe('C:\\WinGet\\Links\\claude.exe');
  });

  it('follows PATH on macOS and Linux', () => {
    expect(firstOnPath({ platform: 'linux', env: { PATH: '/a:/b' }, exists: (file) => file === '/b/claude' })).toBe('/b/claude');
    expect(firstOnPath({ platform: 'darwin', env: {}, exists: () => true })).toBeNull();
  });
});
