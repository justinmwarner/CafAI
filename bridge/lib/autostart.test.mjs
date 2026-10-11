import { describe, expect, it, vi } from 'vitest';
import {
  REG_DELETE_ARGS,
  REG_QUERY_ARGS,
  RUN_KEY,
  SHORTCUT_SCRIPT,
  autostartStatus,
  buildLaunchAgentPlist,
  buildSystemdUnit,
  installAutostart,
  macPaths,
  quoteSystemdArg,
  quoteWindowsArg,
  regAddArgs,
  runCommand,
  serviceSearchPath,
  shortcutCommand,
  systemdUnitPath,
  uninstallAutostart,
  windowsCommandLine,
  windowsShortcutPath,
  xmlEscape,
} from './autostart.mjs';

/** Files and folders in memory: nothing on disk is touched. */
function memoryFs(files = {}) {
  const store = new Map(Object.entries(files));
  const dirs = new Set();
  return {
    store,
    dirs,
    exists: (file) => store.has(file) || dirs.has(file),
    mkdir: (dir) => {
      dirs.add(dir);
    },
    writeFile: (file, text) => {
      store.set(file, text);
    },
    remove: (file) => {
      store.delete(file);
    },
  };
}

/** An exec that answers by command; every call is recorded. */
function fakeExec(answer = () => ({ code: 0 })) {
  return vi.fn(async (command, args, options) => ({ code: 0, stdout: '', stderr: '', ...answer(command, args, options) }));
}

const WIN = {
  platform: 'win32',
  home: 'C:\\Users\\me',
  env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
};
const LNK = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\CafAI Bridge.lnk';
const WIN_TARGET = {
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  script: 'E:\\source\\cafai\\bridge\\cafai-bridge.mjs',
  flags: ['--port', '9000', '--claude', 'C:\\Program Files\\Claude\\claude.exe'],
  configDir: 'C:\\Users\\me\\AppData\\Roaming\\CafAI Bridge',
};

describe('Windows command lines', () => {
  it('quotes an argument only when it needs it, the way programs split it back', () => {
    expect(quoteWindowsArg('start')).toBe('start');
    expect(quoteWindowsArg('C:\\Program Files\\nodejs\\node.exe')).toBe('"C:\\Program Files\\nodejs\\node.exe"');
    expect(quoteWindowsArg('')).toBe('""');
    // A trailing backslash would escape the closing quote: doubled.
    expect(quoteWindowsArg('C:\\My Dir\\')).toBe('"C:\\My Dir\\\\"');
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsArg('a\\"b c')).toBe('"a\\\\\\"b c"');
    expect(quoteWindowsArg('C:\\no\\spaces')).toBe('C:\\no\\spaces');
  });

  it('joins arguments into one command line', () => {
    expect(windowsCommandLine(['C:\\a b\\node.exe', 'x.mjs', 'start'])).toBe('"C:\\a b\\node.exe" x.mjs start');
  });

  it('puts the shortcut in the Startup folder under %APPDATA%, or under the home folder', () => {
    expect(windowsShortcutPath(WIN)).toBe(LNK);
    expect(windowsShortcutPath({ env: {}, home: 'C:\\Users\\me' })).toBe(LNK);
  });
});

describe('the Startup shortcut command', () => {
  it('runs PowerShell without a profile or prompts, with every path in an environment variable', () => {
    const command = shortcutCommand({ lnk: LNK, nodePath: WIN_TARGET.nodePath, script: WIN_TARGET.script, flags: WIN_TARGET.flags, workingDir: WIN_TARGET.configDir });
    expect(command.command).toBe('powershell.exe');
    expect(command.args).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_SCRIPT]);
    expect(command.env).toEqual({
      CAFAI_LNK: LNK,
      CAFAI_TARGET: 'C:\\Program Files\\nodejs\\node.exe',
      CAFAI_ARGS: 'E:\\source\\cafai\\bridge\\cafai-bridge.mjs start --port 9000 --claude "C:\\Program Files\\Claude\\claude.exe"',
      CAFAI_DIR: WIN_TARGET.configDir,
    });
  });

  it('has a script with nothing to quote that makes a minimized shortcut', () => {
    expect(SHORTCUT_SCRIPT).not.toContain('"');
    for (const name of ['CAFAI_LNK', 'CAFAI_TARGET', 'CAFAI_ARGS', 'CAFAI_DIR']) expect(SHORTCUT_SCRIPT).toContain(`$env:${name}`);
    expect(SHORTCUT_SCRIPT).toContain('WScript.Shell');
    expect(SHORTCUT_SCRIPT).toContain('$link.WindowStyle = 7');
    expect(SHORTCUT_SCRIPT).toContain('$link.Save()');
  });

  it('falls back to a Run value under the user key', () => {
    expect(regAddArgs('"C:\\node.exe" x start')).toEqual([
      'add',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      'CafAI Bridge',
      '/t',
      'REG_SZ',
      '/d',
      '"C:\\node.exe" x start',
      '/f',
    ]);
    expect(REG_QUERY_ARGS).toEqual(['query', RUN_KEY, '/v', 'CafAI Bridge']);
    expect(REG_DELETE_ARGS).toEqual(['delete', RUN_KEY, '/v', 'CafAI Bridge', '/f']);
  });
});

describe('autostart on Windows', () => {
  it('makes the shortcut with PowerShell and clears an old Run value', async () => {
    const fs = memoryFs();
    const exec = fakeExec((command, args, options) => {
      if (command === 'powershell.exe') fs.writeFile(options.env.CAFAI_LNK, 'shortcut');
      return { code: 0 };
    });
    const result = await installAutostart(WIN_TARGET, { ...WIN, exec, fs });
    expect(result).toEqual({ ok: true, method: 'shortcut', location: LNK });
    expect(exec.mock.calls[0][0]).toBe('powershell.exe');
    expect(exec.mock.calls[0][2].env.APPDATA).toBe(WIN.env.APPDATA);
    expect(exec.mock.calls[1]).toEqual(['reg.exe', REG_DELETE_ARGS]);
    expect(fs.dirs.has('C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup')).toBe(true);
  });

  it('adds a Run value when PowerShell fails', async () => {
    const fs = memoryFs();
    const exec = fakeExec((command) => (command === 'powershell.exe' ? { code: 1, stderr: 'Exception calling "Save"\r\nmore' } : { code: 0 }));
    const result = await installAutostart(WIN_TARGET, { ...WIN, exec, fs });
    expect(result).toEqual({ ok: true, method: 'registry', location: `${RUN_KEY}\\CafAI Bridge`, reason: 'Exception calling "Save"' });
    const commandLine =
      '"C:\\Program Files\\nodejs\\node.exe" E:\\source\\cafai\\bridge\\cafai-bridge.mjs start --port 9000 --claude "C:\\Program Files\\Claude\\claude.exe"';
    expect(exec.mock.calls[1]).toEqual(['reg.exe', regAddArgs(commandLine)]);
  });

  it('says why when neither works', async () => {
    const exec = fakeExec(() => ({ code: 1, stderr: 'denied' }));
    const result = await installAutostart(WIN_TARGET, { ...WIN, exec, fs: memoryFs() });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/denied.*reg\.exe: denied/);
  });

  it('removes the shortcut and the Run value', async () => {
    const fs = memoryFs({ [LNK]: 'shortcut' });
    const exec = fakeExec();
    const result = await uninstallAutostart({ ...WIN, exec, fs });
    expect(result.removed).toEqual(['shortcut', 'registry']);
    expect(fs.exists(LNK)).toBe(false);
    expect(exec).toHaveBeenCalledWith('reg.exe', REG_DELETE_ARGS);
  });

  it('reports nothing removed when neither is there', async () => {
    const result = await uninstallAutostart({ ...WIN, exec: fakeExec(() => ({ code: 1 })), fs: memoryFs() });
    expect(result.removed).toEqual([]);
  });

  it('finds the shortcut, else the Run value', async () => {
    expect(await autostartStatus({ ...WIN, exec: fakeExec(() => ({ code: 1 })), fs: memoryFs({ [LNK]: '' }) })).toEqual({
      installed: true,
      method: 'shortcut',
      location: LNK,
    });
    expect(await autostartStatus({ ...WIN, exec: fakeExec(() => ({ code: 0 })), fs: memoryFs() })).toMatchObject({ installed: true, method: 'registry' });
    expect(await autostartStatus({ ...WIN, exec: fakeExec(() => ({ code: 1 })), fs: memoryFs() })).toMatchObject({ installed: false });
  });
});

const MAC = { platform: 'darwin', home: '/Users/me', env: {}, uid: 501 };
const PLIST = '/Users/me/Library/LaunchAgents/com.cafai.bridge.plist';
const MAC_TARGET = {
  nodePath: '/opt/homebrew/bin/node',
  script: '/Users/me/code/caf&ai/bridge/cafai-bridge.mjs',
  flags: ['--port', '9000'],
  configDir: '/Users/me/Library/Application Support/CafAI Bridge',
  claudePath: '/Users/me/.local/bin/claude',
};

describe('the LaunchAgent', () => {
  it('runs serve with the persisted flags, escaped for XML', () => {
    const plist = buildLaunchAgentPlist({ ...MAC_TARGET, home: '/Users/me' });
    expect(plist).toContain('<string>com.cafai.bridge</string>');
    expect(plist).toContain(
      [
        '    <string>/opt/homebrew/bin/node</string>',
        '    <string>/Users/me/code/caf&amp;ai/bridge/cafai-bridge.mjs</string>',
        '    <string>serve</string>',
        '    <string>--port</string>',
        '    <string>9000</string>',
      ].join('\n'),
    );
    expect(plist).not.toContain('caf&ai');
  });

  it('starts at login and again after a crash, but not after a clean exit', () => {
    const plist = buildLaunchAgentPlist({ ...MAC_TARGET, home: '/Users/me' });
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/);
  });

  it('gives launchd a PATH with node, Claude Code and the usual folders, and a log under ~/Library/Logs', () => {
    const plist = buildLaunchAgentPlist({ ...MAC_TARGET, home: '/Users/me' });
    expect(plist).toContain('<string>/opt/homebrew/bin:/Users/me/.local/bin:/usr/local/bin:/usr/bin:/bin</string>');
    expect(plist).toMatch(/<key>WorkingDirectory<\/key>\s*<string>\/Users\/me\/Library\/Application Support\/CafAI Bridge<\/string>/);
    expect(plist).toMatch(/<key>StandardOutPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/CafAI Bridge\/bridge\.log<\/string>/);
    expect(plist).toMatch(/<key>StandardErrorPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/CafAI Bridge\/bridge\.log<\/string>/);
  });

  it('builds the PATH without duplicates, and without Claude Code when it is not known', () => {
    expect(serviceSearchPath({ nodePath: '/usr/local/bin/node', home: '/Users/me' })).toBe('/usr/local/bin:/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin');
  });

  it('escapes the five XML characters', () => {
    expect(xmlEscape(`<a & 'b' "c">`)).toBe('&lt;a &amp; &apos;b&apos; &quot;c&quot;&gt;');
  });
});

describe('autostart on macOS', () => {
  it('writes the agent and bootstraps it into the user session', async () => {
    const fs = memoryFs();
    const exec = fakeExec();
    const result = await installAutostart(MAC_TARGET, { ...MAC, exec, fs });
    expect(result).toEqual({ ok: true, method: 'launchagent', location: PLIST, logFile: macPaths(MAC).logFile, loaded: true });
    expect(fs.store.get(PLIST)).toContain('<string>serve</string>');
    expect(fs.dirs.has('/Users/me/Library/LaunchAgents')).toBe(true);
    expect(fs.dirs.has('/Users/me/Library/Logs/CafAI Bridge')).toBe(true);
    expect(exec.mock.calls).toEqual([['launchctl', ['bootstrap', 'gui/501', PLIST]]]);
  });

  it('falls back to launchctl load -w, and unloads an agent it replaces', async () => {
    const fs = memoryFs({ [PLIST]: 'old' });
    const exec = fakeExec((command, args) => ({ code: args[0] === 'bootstrap' || args[0] === 'bootout' ? 5 : 0 }));
    const result = await installAutostart(MAC_TARGET, { ...MAC, exec, fs });
    expect(result.ok).toBe(true);
    expect(exec.mock.calls.map((call) => call[1][0])).toEqual(['bootout', 'unload', 'bootstrap', 'load']);
    expect(exec.mock.calls[3][1]).toEqual(['load', '-w', PLIST]);
  });

  it('only writes the agent when told not to load it', async () => {
    const fs = memoryFs();
    const exec = fakeExec();
    const result = await installAutostart({ ...MAC_TARGET, load: false }, { ...MAC, exec, fs });
    expect(result.loaded).toBe(false);
    expect(fs.exists(PLIST)).toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports a launchctl failure', async () => {
    const exec = fakeExec(() => ({ code: 5, stderr: 'Bootstrap failed: 5: Input/output error' }));
    const result = await installAutostart(MAC_TARGET, { ...MAC, exec, fs: memoryFs() });
    expect(result).toMatchObject({ ok: false, error: 'Bootstrap failed: 5: Input/output error' });
  });

  it('boots the agent out and deletes it', async () => {
    const fs = memoryFs({ [PLIST]: 'agent' });
    const exec = fakeExec();
    const result = await uninstallAutostart({ ...MAC, exec, fs });
    expect(result).toEqual({ ok: true, method: 'launchagent', location: PLIST, removed: ['launchagent'], unloaded: true });
    expect(exec.mock.calls).toEqual([['launchctl', ['bootout', 'gui/501/com.cafai.bridge']]]);
    expect(fs.exists(PLIST)).toBe(false);
  });

  it('falls back to launchctl unload -w', async () => {
    const exec = fakeExec((command, args) => ({ code: args[0] === 'bootout' ? 3 : 0 }));
    await uninstallAutostart({ ...MAC, exec, fs: memoryFs({ [PLIST]: 'agent' }) });
    expect(exec.mock.calls[1]).toEqual(['launchctl', ['unload', '-w', PLIST]]);
  });

  it('is installed when the agent file is there', async () => {
    expect(await autostartStatus({ ...MAC, exec: fakeExec(), fs: memoryFs({ [PLIST]: '' }) })).toEqual({ installed: true, method: 'launchagent', location: PLIST });
    expect((await autostartStatus({ ...MAC, exec: fakeExec(), fs: memoryFs() })).installed).toBe(false);
  });
});

const LINUX = { platform: 'linux', home: '/home/me', env: {} };
const LINUX_TARGET = {
  nodePath: '/usr/bin/node',
  script: '/home/me/my code/cafai/bridge/cafai-bridge.mjs',
  flags: ['--port', '9000'],
  configDir: '/home/me/.config/cafai-bridge',
};

describe('autostart on Linux', () => {
  it('quotes ExecStart arguments for systemd', () => {
    expect(quoteSystemdArg('/usr/bin/node')).toBe('/usr/bin/node');
    expect(quoteSystemdArg('/home/me/my code/x.mjs')).toBe('"/home/me/my code/x.mjs"');
    expect(quoteSystemdArg('100%')).toBe('100%%');
    expect(quoteSystemdArg('$HOME')).toBe('$$HOME');
    expect(quoteSystemdArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteSystemdArg('')).toBe('""');
  });

  it('builds a user unit that runs serve and restarts it after a crash', () => {
    const unit = buildSystemdUnit({ ...LINUX_TARGET, home: '/home/me' });
    expect(unit).toContain('ExecStart=/usr/bin/node "/home/me/my code/cafai/bridge/cafai-bridge.mjs" serve --port 9000\n');
    expect(unit).toContain('WorkingDirectory=/home/me/.config/cafai-bridge\n');
    expect(unit).toContain('Environment="PATH=/usr/bin:/home/me/.local/bin:/opt/homebrew/bin:/usr/local/bin:/bin"\n');
    expect(unit).toContain('Restart=on-failure\n');
    expect(unit).toContain('WantedBy=default.target\n');
  });

  it('prints the unit instead of installing it', async () => {
    const fs = memoryFs();
    const exec = fakeExec();
    const result = await installAutostart(LINUX_TARGET, { ...LINUX, exec, fs });
    expect(result).toMatchObject({ ok: true, method: 'systemd', location: '/home/me/.config/systemd/user/cafai-bridge.service' });
    expect(result.unit).toContain('[Service]');
    expect(fs.store.size).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });

  it('finds a unit the user saved, under XDG_CONFIG_HOME when it is set', async () => {
    expect(systemdUnitPath({ env: { XDG_CONFIG_HOME: '/xdg' }, home: '/home/me' })).toBe('/xdg/systemd/user/cafai-bridge.service');
    const saved = memoryFs({ '/home/me/.config/systemd/user/cafai-bridge.service': '' });
    expect((await autostartStatus({ ...LINUX, exec: fakeExec(), fs: saved })).installed).toBe(true);
    expect(await uninstallAutostart({ ...LINUX, exec: fakeExec(), fs: saved })).toMatchObject({ removed: [], saved: true });
  });
});

describe('runCommand', () => {
  it('collects the output and the exit code without a shell', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("hi"); process.exitCode = 3']);
    expect(result).toEqual({ code: 3, stdout: 'hi', stderr: '' });
  });

  it('reports a program that does not exist as code -1', async () => {
    const result = await runCommand('cafai-no-such-program-xyz', []);
    expect(result.code).toBe(-1);
  });
});
