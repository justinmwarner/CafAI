// The addresses of this computer that a tablet or phone on the same network can use.
import os from 'node:os';

// Adapters of virtual machines and containers, and of VPNs: their addresses
// are private too, but a tablet on the home network does not come in through
// them, so they go after the real ones.
const VM_ADAPTER = /virtualbox|vmware|vmnet|vboxnet|vethernet|hyper-v|docker|wsl|^br-|^veth|^virbr/i;
const VPN_ADAPTER = /vpn|wireguard|nordlynx|tailscale|zerotier|wintun|tap-windows|mullvad|^wg\d|^utun|^tun|^tap|^ppp/i;

/** Whether an adapter's name says it belongs to a VPN. */
export function isVpnAdapter(name) {
  return VPN_ADAPTER.test(String(name ?? ''));
}

/** Whether an adapter's name says it belongs to a VPN, a virtual machine or a container. */
export function isVirtualAdapter(name) {
  return VM_ADAPTER.test(String(name ?? '')) || isVpnAdapter(name);
}

function rank(name, address) {
  const [a, b] = address.split('.').map(Number);
  let range;
  // Home routers mostly hand out 192.168, offices 10; 172.16/12 is mostly
  // Docker, WSL and Hyper-V.
  if (a === 192 && b === 168) range = 0;
  else if (a === 10) range = 1;
  else if (a === 172 && b >= 16 && b <= 31) range = 2;
  else return 6;
  return isVirtualAdapter(name) ? 3 + range : range;
}

/** Each adapter with an IPv4 address other devices could use, as [name, info]. */
function reachable(interfaces) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces ?? {})) {
    for (const info of list ?? []) {
      // Node 18.0-18.3 reported the family as a number.
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (info.internal || info.address.startsWith('127.') || info.address.startsWith('169.254.')) continue;
      out.push([name, info]);
    }
  }
  return out;
}

/**
 * This computer's IPv4 addresses that other devices can reach, the likeliest
 * first: private ranges (10/8, 172.16/12, 192.168/16) before any other.
 * Loopback, and link-local 169.254/16 (an adapter that got no address from
 * the router), are left out.
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces]
 * @returns {string[]}
 */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, info] of reachable(interfaces)) {
    if (found.some((entry) => entry.address === info.address)) continue;
    found.push({ address: info.address, rank: rank(name, info.address), order: found.length });
  }
  return found.sort((x, y) => x.rank - y.rank || x.order - y.order).map((entry) => entry.address);
}

/**
 * The VPN adapters that are up (they have an IPv4 address). Many VPN apps
 * block the home network while connected unless "allow LAN" is on.
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces]
 * @returns {string[]}
 */
export function vpnAdapters(interfaces = os.networkInterfaces()) {
  return [...new Set(reachable(interfaces).map(([name]) => name).filter(isVpnAdapter))];
}
