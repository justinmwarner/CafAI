/**
 * The browser-engine warning (D58), read back from index.html.
 *
 * The inline ES5 script in index.html decides, before the bundle loads,
 * whether this engine is older than CafAI's floor: it has to run where the
 * bundle cannot. This module only reads that verdict, words the warning and
 * remembers a dismissal per engine version, so a different engine warns again.
 */

/** What the inline script records on `window.__CAFAI_ENGINE__`. */
export interface EngineCheck {
  /**
   * Chromium major version, when the engine names one. Decaid's WebView never
   * does: it sets the whole user agent to "Decent".
   */
  chromium: number | null;
  /** False: older than CafAI's floor. Null: unknown, and never warned. */
  supported: boolean | null;
  /** What decided `supported`: the version alone, or the syntax probe. */
  reason: 'version' | 'probe';
}

declare global {
  interface Window {
    /** Written by the inline script in index.html; absent in previews and tests. */
    __CAFAI_ENGINE__?: unknown;
  }
}

/** The oldest engine CafAI is built for and verified on (D3, D40, D50). */
export const CHROMIUM_FLOOR = 91;

/** localStorage: the engine (its version, or "unknown") whose warning was dismissed. */
export const ENGINE_WARNING_KEY = 'cafai.engineWarning';

/** The verdict, or null when there is none or it is malformed (no warning either way). */
export function readEngineCheck(value: unknown): EngineCheck | null {
  if (typeof value !== 'object' || value === null) return null;
  const { chromium, supported, reason } = value as Record<string, unknown>;
  if (supported !== true && supported !== false && supported !== null) return null;
  return {
    chromium: typeof chromium === 'number' && Number.isInteger(chromium) && chromium > 0 ? chromium : null,
    supported,
    reason: reason === 'version' ? 'version' : 'probe',
  };
}

/** The warning for an engine older than the floor; null when there is nothing to say. */
export function engineWarning(check: EngineCheck | null): string | null {
  if (check?.supported !== false) return null;
  const named = check.chromium !== null ? ` (Chromium ${check.chromium})` : '';
  return `This device's browser engine${named} is older than CafAI is built for (Chromium ${CHROMIUM_FLOOR} or newer), so some parts may not work.`;
}

function engineKey(check: EngineCheck): string {
  return check.chromium !== null ? String(check.chromium) : 'unknown';
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function isEngineWarningDismissed(
  check: EngineCheck,
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(ENGINE_WARNING_KEY) === engineKey(check);
  } catch {
    return false;
  }
}

export function dismissEngineWarning(check: EngineCheck, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  try {
    storage?.setItem(ENGINE_WARNING_KEY, engineKey(check));
  } catch {
    // A WebView that refuses storage shows the warning again next time; nothing worse.
  }
}
