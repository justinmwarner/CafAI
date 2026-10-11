import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  REG_DELETE_ARGS,
  REG_QUERY_ARGS,
  RUN_KEY,
  SHORTCUT_SCRIPT,
  TASK_DELETE_ARGS,
  TASK_QUERY_ARGS,
  autostartStatus,
  buildLaunchAgentPlist,
  buildSystemdTimer,
  buildSystemdUnit,
  buildTaskXml,
  installAutostart,
  macPaths,
  parsePlistSchedule,
  parseTaskXml,
  pmsetWakeCommand,
  quoteSystemdArg,
  quoteWindowsArg,
  regAddArgs,
  runCommand,
  serviceSearchPath,
  shortcutCommand,
  systemdTimerPath,
  systemdUnitPath,
  taskCreateArgs,
  uninstallAutostart,
  utf16WithBom,
  windowsCommandLine,
  windowsShortcutPath,
  windowsUserId,
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
    read: (file) => {
      if (!store.has(file)) throw new Error(`ENOENT ${file}`);
      return String(store.get(file));
    },
    remove: (file) => {
      store.delete(file);
    },
  };
}

/** A task's XML as built for `start --window 05:00-10:00 --keep-awake` (what schtasks /Query /XML gives back). */
const taskXml = (overrides = {}) =>
  buildTaskXml({
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    script: 'E:\\source\\cafai\\bridge\\cafai-bridge.mjs',
    flags: ['--window', '05:00-10:00', '--keep-awake'],
    configDir: 'C:\\Users\\me\\AppData\\Roaming\\CafAI Bridge',
    window: '05:00-10:00',
    userId: 'PC\\me',
    now: new Date(2026, 9, 11, 14, 3),
    ...overrides,
  });

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
  it('makes the shortcut with PowerShell and clears an old Run value and schedule', async () => {
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
    expect(exec.mock.calls[2]).toEqual(['schtasks.exe', TASK_DELETE_ARGS]);
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

  it('removes the shortcut, the Run value and the scheduled task', async () => {
    const fs = memoryFs({ [LNK]: 'shortcut' });
    const exec = fakeExec();
    const result = await uninstallAutostart({ ...WIN, exec, fs });
    expect(result.removed).toEqual(['shortcut', 'registry', 'task']);
    expect(fs.exists(LNK)).toBe(false);
    expect(exec).toHaveBeenCalledWith('reg.exe', REG_DELETE_ARGS);
    expect(exec).toHaveBeenCalledWith('schtasks.exe', TASK_DELETE_ARGS);
  });

  it('reports nothing removed when none is there', async () => {
    const result = await uninstallAutostart({ ...WIN, exec: fakeExec(() => ({ code: 1 })), fs: memoryFs() });
    expect(result.removed).toEqual([]);
  });

  it('finds the task, else the shortcut, else the Run value', async () => {
    const only = (wanted) => fakeExec((command) => ({ code: command === wanted ? 0 : 1, stdout: command === 'schtasks.exe' ? taskXml() : '' }));
    expect(await autostartStatus({ ...WIN, exec: only('schtasks.exe'), fs: memoryFs({ [LNK]: '' }) })).toEqual({
      installed: true,
      method: 'task',
      location: 'CafAI Bridge',
      schedule: { window: '05:00-10:00', weekdays: false, keepAwake: true, wake: true, enabled: true },
    });
    expect(await autostartStatus({ ...WIN, exec: only('none'), fs: memoryFs({ [LNK]: '' }) })).toEqual({
      installed: true,
      method: 'shortcut',
      location: LNK,
    });
    expect(await autostartStatus({ ...WIN, exec: only('reg.exe'), fs: memoryFs() })).toMatchObject({ installed: true, method: 'registry' });
    expect(await autostartStatus({ ...WIN, exec: only('none'), fs: memoryFs() })).toMatchObject({ installed: false });
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

describe('the Task Scheduler task (a schedule on Windows)', () => {
  it('is exactly this XML for --window 05:00-10:00 --keep-awake', () => {
    expect(taskXml()).toBe(
      [
        '<?xml version="1.0" encoding="UTF-16"?>',
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
        '  <RegistrationInfo>',
        '    <Description>Starts CafAI Bridge every day at 05:00, and at sign-in; it runs only within 05:00-10:00.</Description>',
        '  </RegistrationInfo>',
        '  <Triggers>',
        '    <CalendarTrigger>',
        '      <StartBoundary>2026-10-11T05:00:00</StartBoundary>',
        '      <Enabled>true</Enabled>',
        '      <ScheduleByDay>',
        '        <DaysInterval>1</DaysInterval>',
        '      </ScheduleByDay>',
        '    </CalendarTrigger>',
        '    <LogonTrigger>',
        '      <Enabled>true</Enabled>',
        '      <UserId>PC\\me</UserId>',
        '    </LogonTrigger>',
        '  </Triggers>',
        '  <Principals>',
        '    <Principal id="Author">',
        '      <UserId>PC\\me</UserId>',
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
        '    <WakeToRun>true</WakeToRun>',
        '    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>',
        '  </Settings>',
        '  <Actions Context="Author">',
        '    <Exec>',
        '      <Command>C:\\Program Files\\nodejs\\node.exe</Command>',
        '      <Arguments>E:\\source\\cafai\\bridge\\cafai-bridge.mjs start --window 05:00-10:00 --keep-awake</Arguments>',
        '      <WorkingDirectory>C:\\Users\\me\\AppData\\Roaming\\CafAI Bridge</WorkingDirectory>',
        '    </Exec>',
        '  </Actions>',
        '</Task>',
        '',
      ].join('\r\n'),
    );
  });

  it('starts Monday to Friday with --weekdays, and does not wake the computer with --no-wake', () => {
    const xml = taskXml({ weekdays: true, wake: false, flags: ['--window', '05:00-10:00', '--weekdays'] });
    expect(xml).toContain(
      [
        '      <ScheduleByWeek>',
        '        <DaysOfWeek>',
        '          <Monday />',
        '          <Tuesday />',
        '          <Wednesday />',
        '          <Thursday />',
        '          <Friday />',
        '        </DaysOfWeek>',
        '        <WeeksInterval>1</WeeksInterval>',
        '      </ScheduleByWeek>',
      ].join('\r\n'),
    );
    expect(xml).not.toContain('ScheduleByDay');
    expect(xml).toContain('<WakeToRun>false</WakeToRun>');
    expect(xml).toContain('Starts CafAI Bridge Monday to Friday at 05:00');
  });

  it('XML-escapes the paths and the quoted command line', () => {
    const xml = taskXml({ nodePath: 'C:\\Tools & Co\\node.exe', script: 'C:\\R&D Team\\cafai\\bridge\\cafai-bridge.mjs', configDir: 'C:\\Users\\<me>\\CafAI', userId: 'PC\\a&b' });
    expect(xml).toContain('<Command>C:\\Tools &amp; Co\\node.exe</Command>');
    expect(xml).toContain('<Arguments>&quot;C:\\R&amp;D Team\\cafai\\bridge\\cafai-bridge.mjs&quot; start --window 05:00-10:00 --keep-awake</Arguments>');
    expect(xml).toContain('<WorkingDirectory>C:\\Users\\&lt;me&gt;\\CafAI</WorkingDirectory>');
    expect(xml).toContain('<UserId>PC\\a&amp;b</UserId>');
  });

  it('reads the schedule back from a task, as schtasks /Query /XML prints it', () => {
    expect(parseTaskXml(taskXml())).toEqual({ window: '05:00-10:00', weekdays: false, keepAwake: true, wake: true, enabled: true });
    expect(parseTaskXml(taskXml({ wake: false, flags: ['--window', '22:00-02:00', '--weekdays'] }))).toEqual({
      window: '22:00-02:00',
      weekdays: true,
      keepAwake: false,
      wake: false,
      enabled: true,
    });
    const disabled = taskXml().replace('    <Enabled>true</Enabled>\r\n    <WakeToRun>', '    <Enabled>false</Enabled>\r\n    <WakeToRun>');
    expect(parseTaskXml(disabled).enabled).toBe(false);
  });

  it('is written as UTF-16LE with a byte order mark, and runs as USERDOMAIN\\USERNAME', () => {
    const bytes = utf16WithBom('<a/>');
    expect([...bytes]).toEqual([0xff, 0xfe, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e, 0]);
    expect(windowsUserId({ USERDOMAIN: 'PC', USERNAME: 'me' })).toBe('PC\\me');
    expect(windowsUserId({ USERNAME: 'me' })).toBe('me');
  });

  it('creates the task with schtasks from that file, deletes the file, and replaces the shortcut and Run value', async () => {
    const fs = memoryFs({ [LNK]: 'old shortcut' });
    let written = null;
    const exec = fakeExec((command, args) => {
      if (command === 'schtasks.exe' && args[0] === '/Create') written = fs.store.get(args[4]);
      return { code: 0 };
    });
    const now = new Date(2026, 9, 11, 14, 3);
    const target = { ...WIN_TARGET, flags: ['--window', '05:00-10:00', '--keep-awake'], window: '05:00-10:00', wake: true };
    const env = { ...WIN.env, USERDOMAIN: 'PC', USERNAME: 'me' };
    const result = await installAutostart(target, { ...WIN, env, exec, fs, now: () => now });
    expect(result).toEqual({ ok: true, method: 'task', location: 'CafAI Bridge', wake: true });
    const file = path.win32.join(WIN_TARGET.configDir, 'cafai-bridge-task.xml');
    expect(exec.mock.calls[0]).toEqual(['schtasks.exe', taskCreateArgs(file)]);
    expect(taskCreateArgs(file)).toEqual(['/Create', '/TN', 'CafAI Bridge', '/XML', file, '/F']);
    expect([...written.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(written.subarray(2).toString('utf16le')).toBe(buildTaskXml({ ...target, userId: 'PC\\me', now }));
    expect(fs.exists(file)).toBe(false);
    expect(fs.exists(LNK)).toBe(false);
    expect(exec).toHaveBeenCalledWith('reg.exe', REG_DELETE_ARGS);
  });

  it('reports what schtasks said when it fails, and leaves the shortcut alone', async () => {
    const fs = memoryFs({ [LNK]: 'old shortcut' });
    const exec = fakeExec(() => ({ code: 1, stderr: 'ERROR: Access is denied.\r\n' }));
    const result = await installAutostart({ ...WIN_TARGET, window: '05:00-10:00' }, { ...WIN, exec, fs, now: () => new Date(2026, 9, 11) });
    expect(result).toEqual({ ok: false, method: 'task', location: 'CafAI Bridge', error: 'ERROR: Access is denied.' });
    expect(fs.exists(LNK)).toBe(true);
    expect([...fs.store.keys()]).toEqual([LNK]);
  });

  it('asks schtasks for the task by name', () => {
    expect(TASK_QUERY_ARGS).toEqual(['/Query', '/TN', 'CafAI Bridge', '/XML']);
    expect(TASK_DELETE_ARGS).toEqual(['/Delete', '/TN', 'CafAI Bridge', '/F']);
  });
});

describe('a schedule on macOS and Linux', () => {
  const scheduled = { ...MAC_TARGET, flags: ['--window', '05:00-10:00', '--keep-awake'], window: '05:00-10:00', home: '/Users/me' };

  it('adds a daily StartCalendarInterval to the LaunchAgent, which runs serve --window', () => {
    const plist = buildLaunchAgentPlist(scheduled);
    expect(plist).toContain(
      ['  <key>StartCalendarInterval</key>', '  <dict>', '    <key>Hour</key>', '    <integer>5</integer>', '    <key>Minute</key>', '    <integer>0</integer>', '  </dict>'].join('\n'),
    );
    expect(plist).toContain('    <string>serve</string>\n    <string>--window</string>\n    <string>05:00-10:00</string>');
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    expect(buildLaunchAgentPlist({ ...MAC_TARGET, home: '/Users/me' })).not.toContain('StartCalendarInterval');
  });

  it('starts Monday to Friday with five calendar entries, Weekday 1 to 5', () => {
    const plist = buildLaunchAgentPlist({ ...scheduled, window: '06:30-09:00', weekdays: true });
    const weekdays = [...plist.matchAll(/<key>Weekday<\/key>\s*<integer>(\d)<\/integer>\s*<key>Hour<\/key>\s*<integer>6<\/integer>\s*<key>Minute<\/key>\s*<integer>30<\/integer>/g)];
    expect(weekdays.map((match) => match[1])).toEqual(['1', '2', '3', '4', '5']);
    expect(plist).toMatch(/<key>StartCalendarInterval<\/key>\s*<array>/);
  });

  it('reads the schedule back from the LaunchAgent', async () => {
    expect(parsePlistSchedule(buildLaunchAgentPlist(scheduled))).toEqual({ window: '05:00-10:00', weekdays: false, keepAwake: true });
    expect(parsePlistSchedule(buildLaunchAgentPlist({ ...MAC_TARGET, home: '/Users/me' }))).toBeNull();
    const fs = memoryFs({ [PLIST]: buildLaunchAgentPlist(scheduled) });
    expect(await autostartStatus({ ...MAC, exec: fakeExec(), fs })).toEqual({
      installed: true,
      method: 'launchagent',
      location: PLIST,
      schedule: { window: '05:00-10:00', weekdays: false, keepAwake: true },
    });
  });

  it('prints the pmset line for waking from sleep a minute before the start', () => {
    expect(pmsetWakeCommand({ window: '05:00-10:00' })).toBe('sudo pmset repeat wakeorpoweron MTWRFSU 04:59:00');
    expect(pmsetWakeCommand({ window: '05:00-10:00', weekdays: true })).toBe('sudo pmset repeat wakeorpoweron MTWRF 04:59:00');
    // A minute before Monday 00:00 is Sunday 23:59.
    expect(pmsetWakeCommand({ window: '00:00-04:00', weekdays: true })).toBe('sudo pmset repeat wakeorpoweron MTWRU 23:59:00');
    expect(pmsetWakeCommand({ window: '00:00-04:00' })).toBe('sudo pmset repeat wakeorpoweron MTWRFSU 23:59:00');
  });

  it('builds a systemd timer: every day or Monday to Friday, and Persistent', () => {
    expect(buildSystemdTimer({ window: '05:00-10:00' })).toBe(
      [
        '[Unit]',
        'Description=Start CafAI Bridge every day at 05:00',
        '',
        '[Timer]',
        'OnCalendar=*-*-* 05:00:00',
        'Persistent=true',
        '',
        '[Install]',
        'WantedBy=timers.target',
        '',
      ].join('\n'),
    );
    expect(buildSystemdTimer({ window: '05:00-10:00', weekdays: true })).toContain('OnCalendar=Mon..Fri *-*-* 05:00:00\n');
  });

  it('prints the service and the timer on Linux, and finds the timer once saved', async () => {
    const target = { ...LINUX_TARGET, flags: ['--window', '05:00-10:00', '--weekdays'], window: '05:00-10:00', weekdays: true };
    const result = await installAutostart(target, { ...LINUX, exec: fakeExec(), fs: memoryFs() });
    expect(result.timerLocation).toBe('/home/me/.config/systemd/user/cafai-bridge.timer');
    expect(systemdTimerPath({ env: {}, home: '/home/me' })).toBe(result.timerLocation);
    expect(result.unit).toContain(' serve --window 05:00-10:00 --weekdays');
    expect(result.timer).toContain('OnCalendar=Mon..Fri *-*-* 05:00:00');
    const fs = memoryFs({ [result.location]: result.unit, [result.timerLocation]: result.timer });
    expect(await autostartStatus({ ...LINUX, exec: fakeExec(), fs })).toEqual({
      installed: true,
      method: 'systemd',
      location: result.timerLocation,
      schedule: { window: '05:00-10:00', weekdays: true, keepAwake: false },
    });
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
