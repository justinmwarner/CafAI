import { describe, expect, it, vi } from 'vitest';
import {
  ELEVATE_SCRIPT,
  FIREWALL_CHECK_SCRIPT,
  elevateCommand,
  elevatedFirewallScript,
  encodePowerShell,
  firewallCheckCommand,
  firewallVerdict,
  psQuote,
  readFirewall,
  runElevated,
} from './firewall.mjs';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const ALL_PROFILES = 2147483647;
const home = { alias: 'Ethernet', name: 'Home', category: 'Private' };
const cafe = { alias: 'Wi-Fi', name: 'Cafe', category: 'Public' };
const vpn = { alias: 'ProtonVPN', name: 'ProtonVPN', category: 'Public' };
const allow = (profiles, name = 'Node.js JavaScript Runtime') => ({ name, action: 'Allow', profiles });
const block = (profiles, name = 'Node.js JavaScript Runtime') => ({ name, action: 'Block', profiles });

describe('firewallVerdict', () => {
  it('lets the bridge in where an allow rule covers the network, leaving out VPN adapters', () => {
    const verdict = firewallVerdict({ networks: [home, vpn], rules: [allow(2)] });
    expect(verdict).toEqual({
      networks: [{ alias: 'Ethernet', name: 'Home', category: 'Private', profile: 'Private', allowed: true, allowedBy: ['Node.js JavaScript Runtime'], blockedBy: [] }],
      reachable: true,
    });
  });

  it('is not reachable on a Public network with a rule for Private ones only', () => {
    const verdict = firewallVerdict({ networks: [cafe], rules: [allow(2)] });
    expect(verdict.reachable).toBe(false);
    expect(verdict.networks[0]).toMatchObject({ profile: 'Public', allowed: false, allowedBy: [], blockedBy: [] });
  });

  it('lets a block rule win over an allow rule', () => {
    const verdict = firewallVerdict({ networks: [home, cafe], rules: [allow(ALL_PROFILES, 'CafAI Bridge'), block(4)] });
    expect(verdict.networks.map((network) => [network.alias, network.allowed, network.blockedBy])).toEqual([
      ['Ethernet', true, []],
      ['Wi-Fi', false, ['Node.js JavaScript Runtime']],
    ]);
  });

  it('previews marking a network Private, and maps a domain network to the Domain profile', () => {
    expect(firewallVerdict({ networks: [cafe], rules: [allow(2)] }, { markPrivate: ['Wi-Fi'] }).reachable).toBe(true);
    const office = { alias: 'Ethernet 2', name: 'corp.example', category: 'DomainAuthenticated' };
    expect(firewallVerdict({ networks: [office], rules: [allow(1)] }).networks[0]).toMatchObject({ profile: 'Domain', allowed: true });
  });

  it('is not reachable with no network connected', () => {
    expect(firewallVerdict({ networks: [vpn], rules: [allow(ALL_PROFILES)] })).toEqual({ networks: [], reachable: false });
  });
});

describe('the elevated script', () => {
  it('quotes values as PowerShell literals, curly single quotes included', () => {
    expect(psQuote('Wi-Fi')).toBe("'Wi-Fi'");
    expect(psQuote("Bob's Wi-Fi")).toBe("'Bob''s Wi-Fi'");
    const curly = String.fromCharCode(0x2019);
    expect(psQuote(`Bob${curly}s`)).toBe(`'Bob${curly}${curly}s'`);
    expect(psQuote("x'; Remove-Item C:\\ -Recurse; '")).toBe("'x''; Remove-Item C:\\ -Recurse; '''");
  });

  it('marks networks Private and replaces the CafAI Bridge rule for node.exe on the port', () => {
    expect(elevatedFirewallScript({ program: NODE, port: 8877, profiles: ['Private'], markPrivate: ["Bob's Wi-Fi"] })).toBe(
      [
        "$ErrorActionPreference = 'Stop'",
        "Set-NetConnectionProfile -InterfaceAlias 'Bob''s Wi-Fi' -NetworkCategory Private",
        "Get-NetFirewallRule -DisplayName 'CafAI Bridge' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
        "New-NetFirewallRule -DisplayName 'CafAI Bridge' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8877 -Program 'C:\\Program Files\\nodejs\\node.exe' -Profile Private | Out-Null",
      ].join('\n'),
    );
  });

  it('takes only known profiles, in order, and refuses a port that is not one', () => {
    expect(elevatedFirewallScript({ program: NODE, port: 9000, profiles: ['Public', 'bogus; Remove-Item x', 'Private'] })).toContain('-LocalPort 9000 ');
    expect(elevatedFirewallScript({ program: NODE, port: 9000, profiles: ['Public', 'bogus; Remove-Item x', 'Private'] })).toMatch(/-Profile Private,Public \| Out-Null$/);
    expect(() => elevatedFirewallScript({ program: NODE, port: '8877; Remove-Item x' })).toThrow(/Not a port/);
    expect(elevatedFirewallScript({ port: 8877, markPrivate: ['Wi-Fi'] })).not.toContain('New-NetFirewallRule');
  });

  it('travels base64-encoded to an elevated PowerShell started with Start-Process -Verb RunAs -Wait', () => {
    const script = elevatedFirewallScript({ program: NODE, port: 8877 });
    expect(Buffer.from(encodePowerShell(script), 'base64').toString('utf16le')).toBe(script);
    expect(elevateCommand(script)).toEqual({
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ELEVATE_SCRIPT],
      env: { CAFAI_ELEVATED: encodePowerShell(script) },
    });
    expect(ELEVATE_SCRIPT).not.toContain('"');
    expect(ELEVATE_SCRIPT).toContain('Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru');
    expect(ELEVATE_SCRIPT).toContain("'-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $env:CAFAI_ELEVATED");
  });

  it('tells a "no" to Windows apart from a failure', async () => {
    const exec = (answer) => vi.fn(async () => ({ stdout: '', stderr: '', ...answer }));
    expect(await runElevated('x', { env: {}, exec: exec({ code: 0 }) })).toEqual({ ok: true });
    const declined = 'Start-Process : This command cannot be run due to the error: The operation was canceled by the user.';
    expect(await runElevated('x', { env: {}, exec: exec({ code: 1, stderr: declined }) })).toEqual({ ok: false, cancelled: true });
    expect(await runElevated('x', { env: {}, exec: exec({ code: 1, stderr: 'boom\nmore' }) })).toEqual({ ok: false, error: 'boom' });
  });
});

describe('reading the firewall', () => {
  it('runs a script without double quotes that reads rules through the COM API, with values from the environment', () => {
    expect(FIREWALL_CHECK_SCRIPT).not.toContain('"');
    for (const part of ['HNetCfg.FwPolicy2', 'Get-NetConnectionProfile', '$env:CAFAI_PROGRAM', '$env:CAFAI_PORT', 'ConvertTo-Json']) {
      expect(FIREWALL_CHECK_SCRIPT).toContain(part);
    }
    expect(firewallCheckCommand({ program: NODE, port: 8877 })).toEqual({
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', FIREWALL_CHECK_SCRIPT],
      env: { CAFAI_PROGRAM: NODE, CAFAI_PORT: '8877' },
    });
  });

  it('parses its answer, one object or many, with or without a byte order mark', async () => {
    const json = JSON.stringify({ networks: home, rules: [allow(2)] });
    const exec = vi.fn(async () => ({ code: 0, stdout: `${String.fromCharCode(0xfeff)}${json}\r\n`, stderr: '' }));
    expect(await readFirewall({ program: NODE, port: 8877 }, { env: { PATH: 'x' }, exec })).toEqual({ ok: true, networks: [home], rules: [allow(2)] });
    expect(exec.mock.calls[0][2].env).toMatchObject({ PATH: 'x', CAFAI_PROGRAM: NODE, CAFAI_PORT: '8877' });
  });

  it('says why when it cannot read it', async () => {
    const failed = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'New-Object : Access is denied.\r\nAt line:1' }));
    expect(await readFirewall({ program: NODE, port: 8877 }, { env: {}, exec: failed })).toEqual({ ok: false, error: 'New-Object : Access is denied.' });
    const garbled = vi.fn(async () => ({ code: 0, stdout: 'not json', stderr: '' }));
    expect((await readFirewall({ program: NODE, port: 8877 }, { env: {}, exec: garbled })).ok).toBe(false);
  });
});
