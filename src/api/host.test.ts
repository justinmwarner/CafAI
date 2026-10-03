// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/gateway.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest, reaHostname overrides, host detection and exit tests added.
import { describe, expect, it, vi } from 'vitest';
import { defaultGatewayOrigin, detectHost, readGatewayOverride, resolveGatewayOrigin, toWebSocketOrigin } from './host.ts';

// ---- origin (ported) ---------------------------------------------------------

describe('resolveGatewayOrigin', () => {
  it('the gateway is the page host on the API port', () => {
    expect(resolveGatewayOrigin({ protocol: 'http:', hostname: 'localhost' })).toBe('http://localhost:8080');
    expect(resolveGatewayOrigin({ protocol: 'http:', hostname: '10.0.0.18' })).toBe('http://10.0.0.18:8080');
  });

  it('an override wins, so a laptop can point at a tablet', () => {
    const origin = resolveGatewayOrigin({ protocol: 'http:', hostname: 'localhost' }, 'http://10.0.0.42:8080/');
    expect(origin, 'trailing slash trimmed').toBe('http://10.0.0.42:8080');
  });

  it('a bare host name override follows the streamline/MSL reaHostname convention', () => {
    expect(resolveGatewayOrigin({ protocol: 'http:', hostname: 'localhost' }, '10.0.0.42')).toBe('http://10.0.0.42:8080');
    expect(resolveGatewayOrigin({ protocol: 'http:', hostname: 'localhost' }, ' tablet.local ')).toBe('http://tablet.local:8080');
  });

  it('a bare host that already names a port keeps it', () => {
    expect(resolveGatewayOrigin({ protocol: 'http:', hostname: 'localhost' }, '10.0.0.42:9090')).toBe('http://10.0.0.42:9090');
  });

  it('mirrors the page scheme so an https page is not blocked as mixed content', () => {
    expect(resolveGatewayOrigin({ protocol: 'https:', hostname: 'box' })).toBe('https://box:8080');
    expect(resolveGatewayOrigin({ protocol: 'https:', hostname: 'box' }, 'tablet')).toBe('https://tablet:8080');
  });

  it('a blank override is no override', () => {
    expect(resolveGatewayOrigin({ protocol: 'http:', hostname: 'localhost' }, '   ')).toBe('http://localhost:8080');
    expect(resolveGatewayOrigin({ protocol: 'http:', hostname: 'localhost' }, null)).toBe('http://localhost:8080');
  });
});

describe('toWebSocketOrigin', () => {
  it('the websocket origin follows the http scheme', () => {
    expect(toWebSocketOrigin('http://localhost:8080')).toBe('ws://localhost:8080');
    expect(toWebSocketOrigin('https://box:8080')).toBe('wss://box:8080');
  });
});

// ---- host detection and exit -----------------------------------------------------

interface FakeWindowOptions {
  hostname?: string;
  protocol?: string;
  reaHostname?: string | null;
  storageThrows?: boolean;
  decentHost?: unknown;
  decentApp?: unknown;
}

function fakeWindow(options: FakeWindowOptions = {}) {
  const assign = vi.fn();
  const win: Record<string, unknown> = {
    location: { protocol: options.protocol ?? 'http:', hostname: options.hostname ?? 'localhost', assign },
    localStorage: {
      getItem: (key: string) => {
        if (options.storageThrows) throw new Error('SecurityError');
        return key === 'reaHostname' ? (options.reaHostname ?? null) : null;
      },
    },
  };
  if (options.decentHost !== undefined) win.__DECENT_HOST__ = options.decentHost;
  if (options.decentApp !== undefined) win.decentApp = options.decentApp;
  return { win: win as unknown as Window, assign, raw: win };
}

describe('readGatewayOverride and defaultGatewayOrigin', () => {
  it('reads localStorage.reaHostname', () => {
    expect(readGatewayOverride(fakeWindow({ reaHostname: '10.0.0.9' }).win)).toBe('10.0.0.9');
    expect(defaultGatewayOrigin(fakeWindow({ reaHostname: '10.0.0.9' }).win)).toBe('http://10.0.0.9:8080');
  });

  it('survives a WebView that refuses localStorage', () => {
    const { win } = fakeWindow({ storageThrows: true, hostname: 'localhost' });
    expect(readGatewayOverride(win)).toBeNull();
    expect(defaultGatewayOrigin(win)).toBe('http://localhost:8080');
  });
});

describe('detectHost', () => {
  it('in a plain browser: not inside Decaid, settings on the page host, exit opens settings', () => {
    const { win, assign } = fakeWindow({ hostname: '192.168.1.42' });
    const host = detectHost(win);
    expect(host.insideDecaid).toBe(false);
    expect(host.hostVersion).toBeNull();
    expect(host.settingsUrl).toBe('http://192.168.1.42:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI');
    host.exitToSkinSwitcher();
    expect(assign).toHaveBeenCalledWith(host.settingsUrl);
  });

  it('inside Decaid: reports the host version and exits through decentApp', () => {
    const exitToDashboard = vi.fn();
    const { win, assign } = fakeWindow({
      decentHost: { app: 'decent.app', platform: 'android', version: '0.9.0', build: '2950', commit: 'a45961b' },
      decentApp: { exitToDashboard },
    });
    const host = detectHost(win);
    expect(host.insideDecaid).toBe(true);
    expect(host.hostVersion).toBe('0.9.0');
    expect(host.settingsUrl).toBe('http://localhost:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI');
    host.exitToSkinSwitcher();
    expect(exitToDashboard).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('resolves exitToDashboard at call time, because skin-api.js may load after boot', () => {
    const { win, raw } = fakeWindow({ decentHost: { version: '0.9.0' } });
    const host = detectHost(win);
    const exitToDashboard = vi.fn();
    raw.decentApp = { exitToDashboard };
    host.exitToSkinSwitcher();
    expect(exitToDashboard).toHaveBeenCalledTimes(1);
  });

  it('inside Decaid without exitToDashboard, falls back to the settings page', () => {
    const { win, assign } = fakeWindow({ decentHost: { version: '0.9.0' } });
    const host = detectHost(win);
    host.exitToSkinSwitcher();
    expect(assign).toHaveBeenCalledWith('http://localhost:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI');
  });

  it('never calls exitToDashboard outside Decaid, where it is a no-op', () => {
    const exitToDashboard = vi.fn();
    const { win, assign } = fakeWindow({ decentApp: { exitToDashboard } });
    detectHost(win).exitToSkinSwitcher();
    expect(exitToDashboard).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('builds the settings link on the override host, always http on port 8080', () => {
    expect(detectHost(fakeWindow({ reaHostname: '10.0.0.7' }).win).settingsUrl).toBe(
      'http://10.0.0.7:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI',
    );
    expect(detectHost(fakeWindow({ reaHostname: 'https://tablet.local:8443/' }).win).settingsUrl).toBe(
      'http://tablet.local:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI',
    );
    expect(detectHost(fakeWindow({ protocol: 'https:', hostname: 'box' }).win).settingsUrl).toBe(
      'http://box:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI',
    );
  });

  it('tolerates an odd __DECENT_HOST__ value', () => {
    expect(detectHost(fakeWindow({ decentHost: true }).win)).toMatchObject({ insideDecaid: true, hostVersion: null });
    expect(detectHost(fakeWindow({ decentHost: { version: 9 } }).win).hostVersion).toBe('9');
  });
});
