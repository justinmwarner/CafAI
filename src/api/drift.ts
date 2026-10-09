/**
 * What Decaid sent that CafAI did not expect (D95, D96).
 *
 * A reader or parser that meets a reply it cannot fully use reports it here,
 * instead of crashing, showing a silent 0 or retrying forever. Settings >
 * About lists the entries and copies them as a report. An entry names a
 * route or channel and a field path, with types and enum values only: never
 * free text, a note or the API key.
 */
export interface DriftReport {
  /** A route or channel: "GET /api/v1/workflow", "ws/v1/machine/shotState". */
  source: string;
  /** A field path and what was wrong: "profile: missing", 'state: unknown value "brewing"'. */
  problem: string;
}

export interface DriftEntry extends DriftReport {
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface DriftLog {
  report(entry: DriftReport): void;
  /** The same array until a new kind arrives (for useSyncExternalStore); counts update in place. */
  list(): readonly DriftEntry[];
  subscribe(listener: () => void): () => void;
  clear(): void;
}

export interface DriftLogOptions {
  now?: () => Date;
  /** Once per new kind; Decaid serves the WebView's console at /api/v1/webview/logs. */
  warn?: (message: string) => void;
  /** Kinds kept; later kinds are dropped. */
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export function createDriftLog(options: DriftLogOptions = {}): DriftLog {
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const limit = options.limit ?? DEFAULT_LIMIT;
  let entries: DriftEntry[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    report({ source, problem }) {
      const at = now().toISOString();
      const known = entries.find((entry) => entry.source === source && entry.problem === problem);
      if (known) {
        known.count += 1;
        known.lastAt = at;
        return;
      }
      if (entries.length >= limit) return;
      entries = [...entries, { source, problem, count: 1, firstAt: at, lastAt: at }];
      warn(`CafAI: Decaid sent something unexpected. ${source}: ${problem}`);
      notify();
    },
    list: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      entries = [];
      notify();
    },
  };
}

/** The app-wide log. A module singleton, like a logger: the frame parsers are pure functions. */
export const driftLog: DriftLog = createDriftLog();

export function reportDrift(source: string, problem: string): void {
  driftLog.report({ source, problem });
}

export interface DriftReportContext {
  appVersion: string;
  decaidVersion: string | null;
  verifiedWith: string;
}

/** The text Settings > About copies. */
export function formatDriftReport(entries: readonly DriftEntry[], context: DriftReportContext): string {
  const head = `CafAI ${context.appVersion} with Decaid ${context.decaidVersion ?? 'version unknown'} (verified with ${context.verifiedWith})`;
  const lines = entries.map(
    (entry) => `${entry.source}: ${entry.problem} (${entry.count} ${entry.count === 1 ? 'time' : 'times'}, first ${entry.firstAt})`,
  );
  return [head, ...lines].join('\n');
}
