import { describe, expect, it } from 'vitest';
import { KEEP_AWAKE_SCRIPT, keepAwakeCommand } from './awake.mjs';

describe('keeping the computer awake', () => {
  it('on Windows, runs a hidden PowerShell that holds the system awake until the bridge process ends', () => {
    expect(keepAwakeCommand({ platform: 'win32', pid: 4321 })).toEqual({
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', KEEP_AWAKE_SCRIPT],
      env: { CAFAI_PID: '4321' },
    });
  });

  it('has a script with no double quotes, ES_CONTINUOUS | ES_SYSTEM_REQUIRED, and a wait on CAFAI_PID', () => {
    expect(KEEP_AWAKE_SCRIPT).not.toContain('"');
    expect(KEEP_AWAKE_SCRIPT).toContain('kernel32.dll');
    expect(KEEP_AWAKE_SCRIPT).toContain('SetThreadExecutionState([uint32]2147483649)');
    expect(0x80000001).toBe(2147483649);
    expect(KEEP_AWAKE_SCRIPT.endsWith('Wait-Process -Id $env:CAFAI_PID')).toBe(true);
  });

  it('on macOS, runs caffeinate until the bridge process ends', () => {
    expect(keepAwakeCommand({ platform: 'darwin', pid: 4321 })).toEqual({ command: 'caffeinate', args: ['-i', '-w', '4321'] });
  });

  it('on Linux, runs systemd-inhibit when there is one, and nothing otherwise', () => {
    expect(keepAwakeCommand({ platform: 'linux', pid: 4321, hasSystemdInhibit: true })).toEqual({
      command: 'systemd-inhibit',
      args: ['--what=idle', '--who=CafAI-Bridge', '--why=coach', '--mode=block', 'tail', '--pid=4321', '-f', '/dev/null'],
    });
    expect(keepAwakeCommand({ platform: 'linux', pid: 4321 })).toBeNull();
    expect(keepAwakeCommand({ platform: 'freebsd', pid: 4321, hasSystemdInhibit: true })).toBeNull();
  });
});
