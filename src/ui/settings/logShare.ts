/**
 * Getting the traffic log off the device (D139), and whether the log view is
 * open.
 *
 * Share uses the Web Share API, a .txt file where the browser takes files
 * and the text otherwise. It exists only on a secure page (localhost or
 * https) and never in Android's WebView, which is Decaid's own, so Settings
 * shows Share only where it is there. Email is a mailto: link, which Decaid's
 * WebView refuses (it opens only http and https links), so it is left out
 * inside Decaid. Copy is copyText (src/ui/history/exportFile.ts), the same
 * as About's Copy report: it works over plain http on the local network too.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useServices } from '../../app/services.tsx';
import type { LogContext } from '../../traffic/format.ts';
import { knownDecaidVersion } from './decaidVersion.ts';

type ShareNavigator = Navigator & { canShare?: (data: ShareData) => boolean };

/** Whether this browser has the Web Share API. */
export function canShare(nav: Navigator = navigator): boolean {
  return typeof (nav as Partial<Navigator>).share === 'function';
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

/**
 * Share `text` as a file named `fileName` where the browser can share files,
 * as text where it cannot. Called in the tap itself: the browser shares only
 * from one.
 */
export async function shareText(text: string, title: string, fileName: string, nav: Navigator = navigator): Promise<ShareOutcome> {
  const share = nav as ShareNavigator;
  try {
    const file = typeof File === 'function' ? new File([text], fileName, { type: 'text/plain' }) : null;
    if (file && share.canShare?.({ files: [file] })) await share.share({ title, text: title, files: [file] });
    else await share.share({ title, text });
    return 'shared';
  } catch (error) {
    // Closing the share sheet rejects with AbortError: nothing went wrong.
    return (error as { name?: unknown } | null)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** "962 x 602, pixel ratio 1.33 (screen 1280 x 800)". */
export function screenText(win: Window = window): string {
  const ratio = Math.round(win.devicePixelRatio * 100) / 100;
  return `${win.innerWidth} x ${win.innerHeight}, pixel ratio ${ratio} (screen ${win.screen.width} x ${win.screen.height})`;
}

/** The shared text's header facts, read when asked: the time and the Decaid version are those of the tap. */
export function useLogContext(): () => LogContext {
  const { appVersion, decaid, host } = useServices();
  return useCallback(
    () => ({
      appVersion,
      decaidVersion: host.hostVersion ?? knownDecaidVersion(decaid),
      decaidOrigin: decaid.httpOrigin,
      userAgent: navigator.userAgent,
      screen: screenText(),
      now: new Date(),
    }),
    [appVersion, decaid, host.hostVersion],
  );
}

// ---- whether the log view is open ----------------------------------------------------
// App-wide, not Settings' own: the view stays open when a shot starting takes the
// screen under it to the Shot view.

let viewOpen = false;
const viewListeners = new Set<() => void>();

function setViewOpen(next: boolean): void {
  if (viewOpen === next) return;
  viewOpen = next;
  for (const listener of [...viewListeners]) listener();
}

export const openLogView = (): void => setViewOpen(true);
export const closeLogView = (): void => setViewOpen(false);

function subscribeView(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}

export function useLogViewOpen(): boolean {
  return useSyncExternalStore(
    subscribeView,
    () => viewOpen,
    () => false,
  );
}
