// Windows Defender Firewall and the bridge: can devices on this network reach
// it, and the one elevated step that lets them in (a rule for node.exe on the
// bridge's port, and, if the user agrees, marking the network Private).
// Reading needs no admin rights; the fix asks Windows for permission (UAC)
// once. Every PowerShell script here is free of double quotes and takes its
// values from environment variables, or (the elevated one) from quoted
// literals in a script passed base64-encoded, so nothing can be injected.
import { isVirtualAdapter } from './net.mjs';

export const RULE_NAME = 'CafAI Bridge';
const PROFILES = ['Domain', 'Private', 'Public'];

/**
 * Prints JSON: the connected networks, and the enabled inbound TCP rules that
 * apply to the bridge (rules for node.exe covering the port, and rules for any
 * program, not tied to a service, naming the port). It reads the rules through
 * the firewall's COM API: Get-NetFirewallRule needs admin rights on some
 * computers. CAFAI_PROGRAM is node.exe, CAFAI_PORT the port.
 */
export const FIREWALL_CHECK_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$program = [IO.Path]::GetFullPath($env:CAFAI_PROGRAM)',
  '$port = [int]$env:CAFAI_PORT',
  // A port list ("80,8000-9000") covers ours when it names it or a range around it; "*" counts only for node.exe's own rules.
  "$covers = { param($ports, $any) foreach ($p in ([string]$ports -split ',')) { $s = $p.Trim(); if ($s -eq [string]$port -or ($any -and $s -eq '*')) { return $true }; if ($s -match '^(\\d+)-(\\d+)$' -and [int]$matches[1] -le $port -and $port -le [int]$matches[2]) { return $true } }; return $false }",
  // Direction 1 = inbound; protocol 6 = TCP, 256 = any; action 1 = allow, 0 = block.
  "$found = @(foreach ($r in (New-Object -ComObject HNetCfg.FwPolicy2).Rules) { if ($r.Direction -ne 1 -or -not $r.Enabled -or ($r.Protocol -ne 6 -and $r.Protocol -ne 256)) { continue }; $app = [string]$r.ApplicationName; $forNode = $app -ne '' -and ([Environment]::ExpandEnvironmentVariables($app) -ieq $program); $forPort = $app -eq '' -and -not $r.ServiceName; if (($forNode -and (& $covers $r.LocalPorts $true)) -or ($forPort -and (& $covers $r.LocalPorts $false))) { [pscustomobject]@{ name = [string]$r.Name; action = $(if ($r.Action -eq 1) { 'Allow' } else { 'Block' }); profiles = [int]$r.Profiles } } })",
  '$networks = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ alias = [string]$_.InterfaceAlias; name = [string]$_.Name; category = [string]$_.NetworkCategory } })',
  '[pscustomobject]@{ networks = $networks; rules = $found } | ConvertTo-Json -Depth 3 -Compress',
].join('; ');

/** The PowerShell that reads the firewall state, without admin rights. */
export function firewallCheckCommand({ program, port }) {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', FIREWALL_CHECK_SCRIPT],
    env: { CAFAI_PROGRAM: program, CAFAI_PORT: String(port) },
  };
}

function firstLine(text) {
  return (
    String(text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/**
 * The connected networks and the rules that apply to the bridge:
 * `{ ok: true, networks, rules }`, or `{ ok: false, error }`.
 * @param {{ program: string, port: number }} target
 * @param {{ env: Record<string, string | undefined>, exec: Function }} deps
 */
export async function readFirewall({ program, port }, deps) {
  const spec = firewallCheckCommand({ program, port });
  const result = await deps.exec(spec.command, spec.args, { env: { ...deps.env, ...spec.env }, timeoutMs: 60_000 });
  if (result.code !== 0) return { ok: false, error: firstLine(result.stderr) || `PowerShell stopped with exit code ${result.code}.` };
  try {
    const text = String(result.stdout).trim();
    // Skip a byte order mark, should PowerShell write one.
    const data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return { ok: true, networks: list(data.networks), rules: list(data.rules) };
  } catch {
    return { ok: false, error: 'PowerShell did not answer with the firewall settings.' };
  }
}

// The firewall's profile bits (NET_FW_PROFILE2_*).
const PROFILE_BITS = { Domain: 1, Private: 2, Public: 4 };

/**
 * What the firewall means on each connected network: whether a rule lets the
 * bridge in there and none blocks it (a block rule wins). Networks of virtual
 * machines and VPNs are left out: the tablet does not come through them.
 * `markPrivate` previews networks about to be marked Private.
 * @param {{ networks: Array<{ alias: string, name: string, category: string }>, rules: Array<{ name: string, action: string, profiles: number }> }} state
 * @param {{ markPrivate?: string[] }} [change]
 */
export function firewallVerdict({ networks, rules }, { markPrivate = [] } = {}) {
  const verdicts = networks
    .filter((network) => !isVirtualAdapter(network.alias))
    .map((network) => {
      const category = markPrivate.includes(network.alias) ? 'Private' : network.category;
      const profile = category === 'DomainAuthenticated' ? 'Domain' : category;
      const applies = (rule) => (Number(rule.profiles) & (PROFILE_BITS[profile] ?? 0)) !== 0;
      const allowedBy = rules.filter((rule) => rule.action === 'Allow' && applies(rule)).map((rule) => rule.name);
      const blockedBy = rules.filter((rule) => rule.action === 'Block' && applies(rule)).map((rule) => rule.name);
      return { alias: network.alias, name: network.name, category, profile, allowed: allowedBy.length > 0 && blockedBy.length === 0, allowedBy, blockedBy };
    });
  return { networks: verdicts, reachable: verdicts.length > 0 && verdicts.every((network) => network.allowed) };
}

// PowerShell also takes the curly quotes U+2018-U+201B as single quotes.
const SINGLE_QUOTES = new RegExp(`['${String.fromCharCode(0x2018, 0x2019, 0x201a, 0x201b)}]`, 'g');

/** A PowerShell single-quoted literal: every kind of single quote in it is doubled. */
export function psQuote(text) {
  return `'${String(text).replace(SINGLE_QUOTES, (quote) => quote + quote)}'`;
}

/**
 * The script run with admin rights: mark networks Private, and (with a
 * program) replace the CafAI Bridge rule with one letting node.exe in on the
 * port, on the given profiles.
 * @param {{ program?: string | null, port: number, profiles?: string[], markPrivate?: string[] }} change
 */
export function elevatedFirewallScript({ program = null, port, profiles = ['Private'], markPrivate = [] }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Not a port: ${port}`);
  const lines = ["$ErrorActionPreference = 'Stop'"];
  for (const alias of markPrivate) lines.push(`Set-NetConnectionProfile -InterfaceAlias ${psQuote(alias)} -NetworkCategory Private`);
  if (program) {
    const wanted = PROFILES.filter((profile) => profiles.includes(profile));
    lines.push(`Get-NetFirewallRule -DisplayName ${psQuote(RULE_NAME)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`);
    lines.push(
      `New-NetFirewallRule -DisplayName ${psQuote(RULE_NAME)} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} ` +
        `-Program ${psQuote(program)} -Profile ${(wanted.length > 0 ? wanted : ['Private']).join(',')} | Out-Null`,
    );
  }
  return lines.join('\n');
}

/** A script as PowerShell's -EncodedCommand wants it: base64 of UTF-16LE. */
export function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Starts an elevated PowerShell (Windows asks for permission) and waits for
 * it. The elevated script travels base64-encoded in CAFAI_ELEVATED and from
 * there on the new process's command line: an elevated process does not
 * inherit this one's environment.
 */
export const ELEVATE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $env:CAFAI_ELEVATED)",
  'exit $p.ExitCode',
].join('; ');

/** The PowerShell that runs `script` elevated. */
export function elevateCommand(script) {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ELEVATE_SCRIPT],
    env: { CAFAI_ELEVATED: encodePowerShell(script) },
  };
}

/**
 * Run `script` with admin rights: `{ ok: true }`, `{ ok: false, cancelled: true }`
 * when the user said no to Windows, or `{ ok: false, error }`.
 */
export async function runElevated(script, deps) {
  const spec = elevateCommand(script);
  const result = await deps.exec(spec.command, spec.args, { env: { ...deps.env, ...spec.env }, timeoutMs: 300_000 });
  if (result.code === 0) return { ok: true };
  const said = `${result.stderr}\n${result.stdout}`;
  if (/cancel/i.test(said)) return { ok: false, cancelled: true };
  return { ok: false, error: firstLine(result.stderr) || `the elevated PowerShell stopped with exit code ${result.code}` };
}
