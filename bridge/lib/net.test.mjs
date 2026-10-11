import { describe, expect, it } from 'vitest';
import { isVirtualAdapter, isVpnAdapter, lanAddresses, vpnAdapters } from './net.mjs';

const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null });

describe('lanAddresses', () => {
  it('lists IPv4 addresses other devices can reach, without loopback, IPv6 or link-local', () => {
    const list = lanAddresses({
      lo: [v4('127.0.0.1', true), { address: '::1', family: 'IPv6', internal: true }],
      Ethernet: [v4('192.168.1.20'), { address: 'fe80::1', family: 'IPv6', internal: false }],
      'Wi-Fi': [v4('169.254.10.4')],
    });
    expect(list).toEqual(['192.168.1.20']);
  });

  it('puts private ranges first: 192.168, then 10, then 172.16/12, then anything else', () => {
    const list = lanAddresses({
      a: [v4('100.101.102.103')],
      b: [v4('172.20.0.5')],
      c: [v4('10.0.0.8')],
      d: [v4('192.168.0.12')],
      e: [v4('172.32.0.1')],
    });
    expect(list).toEqual(['192.168.0.12', '10.0.0.8', '172.20.0.5', '100.101.102.103', '172.32.0.1']);
  });

  it('puts adapters of virtual machines, WSL and VPNs after the real network', () => {
    const list = lanAddresses({
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
      'vEthernet (WSL)': [v4('172.28.0.1')],
      'Wi-Fi': [v4('10.0.0.8')],
    });
    expect(list).toEqual(['10.0.0.8', '192.168.56.1', '172.28.0.1']);
    // A VPN's address (ProtonVPN's 10.2.0.2 on a Windows PC) is no use to a tablet.
    expect(lanAddresses({ ProtonVPN: [v4('10.2.0.2')], wg0: [v4('10.8.0.2')], 'Wi-Fi': [v4('10.0.0.8')] })).toEqual([
      '10.0.0.8',
      '10.2.0.2',
      '10.8.0.2',
    ]);
  });

  it('reads the numeric family of Node 18.0-18.3 and lists an address once', () => {
    expect(lanAddresses({ en0: [{ address: '192.168.1.5', family: 4, internal: false }], en1: [v4('192.168.1.5')] })).toEqual(['192.168.1.5']);
  });

  it('copes with no interfaces', () => {
    expect(lanAddresses({})).toEqual([]);
  });
});

describe('VPN adapters', () => {
  it('tells VPN adapters by name, and VPNs and virtual machines from real networks', () => {
    for (const name of ['ProtonVPN', 'NordLynx', 'Tailscale', 'wg0', 'utun3', 'OpenVPN Wintun', 'Mullvad']) expect(isVpnAdapter(name)).toBe(true);
    for (const name of ['Ethernet', 'Wi-Fi', 'en0', 'wlan0']) expect(isVpnAdapter(name)).toBe(false);
    expect(isVirtualAdapter('vEthernet (WSL)')).toBe(true);
    expect(isVirtualAdapter('ProtonVPN')).toBe(true);
    expect(isVirtualAdapter('Ethernet')).toBe(false);
  });

  it('lists the VPN adapters that are up (with an IPv4 address)', () => {
    expect(
      vpnAdapters({
        ProtonVPN: [v4('10.2.0.2')],
        Ethernet: [v4('192.168.1.90')],
        utun3: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
        wg0: [v4('169.254.0.9')],
      }),
    ).toEqual(['ProtonVPN']);
    expect(vpnAdapters({ Ethernet: [v4('192.168.1.90')] })).toEqual([]);
  });
});
