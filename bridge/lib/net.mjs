// The addresses of this computer that a tablet or phone on the same network can use.
import os from 'node:os';

// Adapters of virtual machines, containers and VPNs: their addresses are
// private too, but a tablet cannot reach them, so they go after the real ones.
const VIRTUAL_ADAPTER =
  /virtualbox|vmware|vmnet|vboxnet|vethernet|hyper-v|docker|wsl|vpn|wireguard|nordlynx|tailscale|zerotier|^wg\d|^br-|^veth|^virbr|^utun|^tun|^tap|^ppp/i;

function rank(name, address) {
  const [a, b] = address.split('.').map(Number);
  let range;
  // Home routers mostly hand out 192.168, offices 10; 172.16/12 is mostly
  // Docker, WSL and Hyper-V.
  if (a === 192 && b === 168) range = 0;
  else if (a === 10) range = 1;
  else if (a === 172 && b >= 16 && b <= 31) range = 2;
  else return 6;
  return VIRTUAL_ADAPTER.test(name) ? 3 + range : range;
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
  for (const [name, list] of Object.entries(interfaces ?? {})) {
    for (const info of list ?? []) {
      // Node 18.0-18.3 reported the family as a number.
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (info.internal || info.address.startsWith('127.') || info.address.startsWith('169.254.')) continue;
      if (found.some((entry) => entry.address === info.address)) continue;
      found.push({ address: info.address, rank: rank(name, info.address), order: found.length });
    }
  }
  return found.sort((x, y) => x.rank - y.rank || x.order - y.order).map((entry) => entry.address);
}
