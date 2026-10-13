/**
 * A tiny hash router.
 *
 * Decaid serves skins with no SPA fallback, so a deep path would 404 on
 * reload; the hash never reaches the server. The WebView also loads skins as
 * `/?_=<ms>` and drops the hash after a background unload, so an unknown or
 * missing route is simply the coach, never an error screen.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { DrinkKind } from './drinks/kinds.ts';

export type Route =
  | { name: 'coach' }
  | { name: 'history'; bagId?: string }
  | { name: 'settings' }
  | { name: 'shot' }
  /** A drink's view while it runs: the app's to open (useDrinkFocus.ts), never a place in the navigation. */
  | { name: 'drink'; drink: DrinkKind };

export type RouteName = Route['name'];

const COACH: Route = { name: 'coach' };

/** Each drink's view by its path: `#/steam`, `#/hot-water`, `#/flush`. */
const DRINK_PATHS: Readonly<Record<DrinkKind, string>> = { steam: 'steam', hotWater: 'hot-water', flush: 'flush' };
const DRINK_OF_PATH: ReadonlyMap<string, DrinkKind> = new Map(
  (Object.keys(DRINK_PATHS) as DrinkKind[]).map((drink) => [DRINK_PATHS[drink], drink]),
);

/** Parse `location.hash` (with or without the leading `#`). */
export function parseRoute(hash: string): Route {
  let path = hash.startsWith('#') ? hash.slice(1) : hash;
  // A query inside the hash (e.g. a cache buster) is never part of the route.
  const query = path.indexOf('?');
  if (query >= 0) path = path.slice(0, query);
  if (path.startsWith('/')) path = path.slice(1);
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (path === '') return COACH;

  const segments = path.split('/');
  const screen = segments[0]!.toLowerCase();
  if (segments.length === 1) {
    if (screen === 'history') return { name: 'history' };
    if (screen === 'settings') return { name: 'settings' };
    if (screen === 'shot') return { name: 'shot' };
    const drink = DRINK_OF_PATH.get(screen);
    if (drink) return { name: 'drink', drink };
    return COACH;
  }
  if (screen === 'history' && segments.length === 2 && segments[1]) {
    try {
      return { name: 'history', bagId: decodeURIComponent(segments[1]) };
    } catch {
      return { name: 'history' };
    }
  }
  return COACH;
}

/** The `#/...` link for a route. */
export function routeHref(route: Route): string {
  switch (route.name) {
    case 'coach':
      return '#/';
    case 'history':
      return route.bagId ? `#/history/${encodeURIComponent(route.bagId)}` : '#/history';
    case 'settings':
      return '#/settings';
    case 'shot':
      return '#/shot';
    case 'drink':
      return `#/${DRINK_PATHS[route.drink]}`;
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.name === 'history' && b.name === 'history') return (a.bagId ?? null) === (b.bagId ?? null);
  if (a.name === 'drink' && b.name === 'drink') return a.drink === b.drink;
  return a.name === b.name;
}

/**
 * Whether the app may reopen on this route after Decaid reloads it (App.tsx
 * remembers the last route): not a drink's view, which belongs to a run that
 * is over by then. A reload opens the screen under it instead.
 */
export function isRemembered(route: Route): boolean {
  return route.name !== 'drink';
}

/** Go to a route (a normal hash change, so useRoute() picks it up). */
export function navigate(route: Route, win: Window = window): void {
  const href = routeHref(route);
  if (win.location.hash !== href) win.location.hash = href;
}

/**
 * Go to a route without a new history entry: the app's own switches (a shot
 * starting, its outcome arriving), so Back in a browser goes where the
 * barista went, not where the app went.
 */
export function replaceRoute(route: Route, win: Window = window): void {
  const href = routeHref(route);
  if (win.location.hash === href) return;
  win.location.replace(`${win.location.pathname}${win.location.search}${href}`);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = () => window.location.hash;
const serverHash = () => '';

/** The current route; re-renders only when the hash changes. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  return useMemo(() => parseRoute(hash), [hash]);
}
