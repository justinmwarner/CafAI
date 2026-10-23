/**
 * The screen in the page's address (D-USAGE-4). CafAI routes by hash, and
 * Clarity starts a page view only when the rest of the address changes, so
 * while the device shares, the open screen also sits in the query as
 * `screen`, set with history.replaceState: no reload, no hash change, no new
 * history entry, and every other parameter (Decaid's `?_=<ms>`, the mock
 * switches) as it was. The router reads only the hash.
 */
export const SCREEN_PARAM = 'screen';

/** The address with `screen` set to `screen`, or taken out for null. */
export function withScreen(href: string, screen: string | null): string {
  const url = new URL(href);
  if (screen === null) url.searchParams.delete(SCREEN_PARAM);
  else url.searchParams.set(SCREEN_PARAM, screen);
  return url.toString();
}

/** Put the screen in the address; whether the address changed. */
export function mirrorScreen(win: Pick<Window, 'location' | 'history'>, screen: string | null): boolean {
  const next = withScreen(win.location.href, screen);
  if (next === win.location.href) return false;
  try {
    win.history.replaceState(win.history.state, '', next);
    return true;
  } catch {
    // A page that may not rewrite its address keeps it: the screen stays out of it.
    return false;
  }
}
