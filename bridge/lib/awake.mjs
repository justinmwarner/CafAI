// Keep the computer from sleeping while the bridge runs (--keep-awake),
// without admin rights: a small helper process that holds the OS's "the
// system is in use" state for as long as the bridge's own process lives, so it
// ends with the bridge even when the bridge is killed.

/**
 * Windows: SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) holds
 * for as long as the calling thread lives, so the script sets it, then waits
 * for the bridge's process (CAFAI_PID) to end. C# needs a double quote for the
 * DLL name; it is built from [char]34, so the script itself has none and no
 * command line has to escape one.
 */
export const KEEP_AWAKE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$q = [char]34',
  "Add-Type -Namespace CafAI -Name Power -MemberDefinition ('[DllImport(' + $q + 'kernel32.dll' + $q + ')] public static extern uint SetThreadExecutionState(uint flags);')",
  // 0x80000001, written in decimal: PowerShell 5.1 reads that hex literal as a negative Int32.
  '[void][CafAI.Power]::SetThreadExecutionState([uint32]2147483649)',
  'Wait-Process -Id $env:CAFAI_PID',
].join('; ');

/**
 * The helper that keeps this computer awake while process `pid` runs, or null
 * where there is none (Linux without systemd-inhibit).
 * @param {{ platform: string, pid: number, hasSystemdInhibit?: boolean }} where
 * @returns {{ command: string, args: string[], env?: Record<string, string> } | null}
 */
export function keepAwakeCommand({ platform, pid, hasSystemdInhibit = false }) {
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', KEEP_AWAKE_SCRIPT],
      env: { CAFAI_PID: String(pid) },
    };
  }
  if (platform === 'darwin') return { command: 'caffeinate', args: ['-i', '-w', String(pid)] };
  if (platform === 'linux' && hasSystemdInhibit) {
    return {
      command: 'systemd-inhibit',
      args: ['--what=idle', '--who=CafAI-Bridge', '--why=coach', '--mode=block', 'tail', `--pid=${pid}`, '-f', '/dev/null'],
    };
  }
  return null;
}
