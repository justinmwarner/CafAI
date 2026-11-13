/**
 * While the DEBUG flag is on: what happens to the page itself. Decaid on an
 * iPad holds the page in a JavaScript alert() while it is in the background
 * (its "pause timers") and, after ten minutes away, loads CafAI again in the
 * same WebView when it comes back; this says when the page was hidden, shown
 * and put away, and whether WebKit kept it (pagehide's `persisted`).
 */

export interface LifeEvent {
  type: string;
  /** The device's clock, ISO: Decaid's log stamps a line when it reads it, which can be much later. */
  at: string;
  /** performance.now(), the page's own monotonic time: beside `at`, it shows where the device slept or the clock jumped. */
  perfMs: number;
  detail?: Record<string, unknown>;
}

export interface PageFacts {
  /** How this page came: navigate, reload or back_forward (Navigation Timing). */
  navigation: string | null;
  historyLength: number | null;
  referrer: string;
  visibility: string;
  /** When the page started, on the device's clock. */
  startedAt: string | null;
}

export interface LifecycleWatch {
  events(): LifeEvent[];
  stop(): void;
}

const MAX_EVENTS = 100;

type PageScope = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  document: Pick<Document, 'visibilityState' | 'referrer' | 'addEventListener' | 'removeEventListener'>;
  history?: Pick<History, 'length'>;
  performance?: Pick<Performance, 'now' | 'timeOrigin' | 'getEntriesByType'>;
};

export function pageFacts(scope: PageScope): PageFacts {
  let navigation: string | null = null;
  try {
    const entry = scope.performance?.getEntriesByType('navigation')[0] as { type?: string } | undefined;
    navigation = entry?.type ?? null;
  } catch {
    // An engine without Navigation Timing 2.
  }
  const origin = scope.performance?.timeOrigin;
  return {
    navigation,
    historyLength: scope.history?.length ?? null,
    referrer: scope.document.referrer,
    visibility: scope.document.visibilityState,
    startedAt: typeof origin === 'number' && origin > 0 ? new Date(origin).toISOString() : null,
  };
}

/**
 * Note visibilitychange, pagehide, pageshow, freeze and resume (Chromium's
 * Page Lifecycle), online and offline. `onEvent` hears each, at once.
 */
export function watchLifecycle(scope: PageScope, onEvent: (event: LifeEvent) => void, clock: { now(): number } = Date): LifecycleWatch {
  const events: LifeEvent[] = [];
  const perf = () => scope.performance?.now() ?? 0;
  const note = (type: string, detail?: Record<string, unknown>) => {
    const event: LifeEvent = { type, at: new Date(clock.now()).toISOString(), perfMs: Math.round(perf()), ...(detail ? { detail } : {}) };
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    onEvent(event);
  };
  const onVisibility = () => note(scope.document.visibilityState === 'hidden' ? 'hidden' : 'visible');
  const onPageHide = (event: Event) => note('pagehide', { persisted: (event as PageTransitionEvent).persisted });
  const onPageShow = (event: Event) => note('pageshow', { persisted: (event as PageTransitionEvent).persisted });
  const onFreeze = () => note('freeze');
  const onResume = () => note('resume');
  const onOnline = () => note('online');
  const onOffline = () => note('offline');
  scope.document.addEventListener('visibilitychange', onVisibility);
  scope.document.addEventListener('freeze', onFreeze);
  scope.document.addEventListener('resume', onResume);
  scope.addEventListener('pagehide', onPageHide);
  scope.addEventListener('pageshow', onPageShow);
  scope.addEventListener('online', onOnline);
  scope.addEventListener('offline', onOffline);
  return {
    events: () => [...events],
    stop() {
      scope.document.removeEventListener('visibilitychange', onVisibility);
      scope.document.removeEventListener('freeze', onFreeze);
      scope.document.removeEventListener('resume', onResume);
      scope.removeEventListener('pagehide', onPageHide);
      scope.removeEventListener('pageshow', onPageShow);
      scope.removeEventListener('online', onOnline);
      scope.removeEventListener('offline', onOffline);
    },
  };
}
