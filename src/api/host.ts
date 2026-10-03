// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/gateway/client.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: runtime reaHostname override, host detection and exit.
/**
 * Where Decaid is, and how to leave CafAI.
 *
 * Decaid serves each skin from its own port while the API lives on 8080, so
 * the origin is derived rather than assumed same-origin. Inside the app the
 * page host is `localhost`; a LAN browser uses the tablet's IP. A developer
 * points a laptop at a tablet with `localStorage.reaHostname` (the
 * streamline-js / MSL convention: a bare host name; a full origin is accepted
 * too).
 */
import type { HostEnvironment } from './types.ts';

/** Decaid's API port (REST and WebSockets). */
export const GATEWAY_PORT = 8080;

/** The localStorage key streamline-js and MSL use for a developer override. */
export const GATEWAY_OVERRIDE_KEY = 'reaHostname';

export interface LocationLike {
  protocol: string;
  hostname: string;
}

/** The parts of `window` this module reads; Decaid injects the two globals. */
interface HostGlobals {
  location: LocationLike & { assign(url: string): void };
  localStorage?: { getItem(key: string): string | null };
  __DECENT_HOST__?: unknown;
  decentApp?: { exitToDashboard?: unknown };
}

const BARE_HOST_WITH_PORT = /^(?:\[[^\]]+\]|[^:/[\]]+):\d+$/;

/**
 * Where the gateway is.
 *
 * `override` wins, so a developer can point a laptop at a tablet. Otherwise
 * keep the page's host and swap to the API port: that works both for a skin
 * Decaid serves locally and for one loaded across the LAN.
 */
export function resolveGatewayOrigin(location: LocationLike, override?: string | null): string {
  // A page on https cannot call http without being blocked, so mirror the
  // page's scheme and let a misconfiguration surface as a clear error.
  const protocol = location.protocol === 'https:' ? 'https:' : 'http:';
  const trimmed = override?.trim().replace(/\/+$/, '');
  if (trimmed) {
    if (trimmed.includes('://')) return trimmed;
    if (BARE_HOST_WITH_PORT.test(trimmed)) return `${protocol}//${trimmed}`;
    return `${protocol}//${trimmed}:${GATEWAY_PORT}`;
  }
  return `${protocol}//${location.hostname}:${GATEWAY_PORT}`;
}

/** WebSocket origin for the same gateway. */
export function toWebSocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http(s?):/, 'ws$1:');
}

/** `localStorage.reaHostname`, or null. Some WebViews throw on storage access. */
export function readGatewayOverride(win: Window): string | null {
  try {
    const value = (win as unknown as HostGlobals).localStorage?.getItem(GATEWAY_OVERRIDE_KEY);
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** The gateway origin for this page, honouring the developer override. */
export function defaultGatewayOrigin(win: Window): string {
  return resolveGatewayOrigin((win as unknown as HostGlobals).location, readGatewayOverride(win));
}

function overrideHostname(override: string): string | null {
  if (override.includes('://')) {
    try {
      return new URL(override).hostname;
    } catch {
      return null;
    }
  }
  if (BARE_HOST_WITH_PORT.test(override)) return override.slice(0, override.lastIndexOf(':'));
  return override;
}

function hostVersionOf(decentHost: unknown): string | null {
  if (typeof decentHost !== 'object' || decentHost === null) return null;
  const version = (decentHost as { version?: unknown }).version;
  if (typeof version === 'string') return version.trim() || null;
  if (typeof version === 'number' && Number.isFinite(version)) return String(version);
  return null;
}

/**
 * Detect whether CafAI runs inside Decaid and how to leave it.
 *
 * `__DECENT_HOST__` is injected by the app's WebView at document start; it is
 * absent in a LAN browser. The settings page always goes through
 * `http://<host>:8080`: inside the app only `http://localhost:8080/api/v1/plugins/*`
 * loads in place, anything else opens the system browser.
 */
export function detectHost(win: Window): HostEnvironment {
  const globals = win as unknown as HostGlobals;
  const decentHost = globals.__DECENT_HOST__;
  const insideDecaid = Boolean(decentHost);
  const override = readGatewayOverride(win);
  const gatewayHost = (override && overrideHostname(override)) || globals.location.hostname;
  const settingsUrl = `http://${gatewayHost}:${GATEWAY_PORT}/api/v1/plugins/settings.reaplugin/ui?backName=CafAI`;

  return {
    insideDecaid,
    hostVersion: insideDecaid ? hostVersionOf(decentHost) : null,
    settingsUrl,
    exitToSkinSwitcher() {
      // Resolved at tap time: skin-api.js is injected by Decaid and may load
      // after CafAI boots. Outside the app exitToDashboard is a no-op, so the
      // settings page (with its skin switcher) is the way out there.
      const app = globals.decentApp;
      if (globals.__DECENT_HOST__ && app && typeof app.exitToDashboard === 'function') {
        (app as { exitToDashboard(): void }).exitToDashboard();
        return;
      }
      globals.location.assign(settingsUrl);
    },
  };
}
