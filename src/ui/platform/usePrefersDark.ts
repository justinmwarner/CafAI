/**
 * Whether the device asks for dark mode, live. Decaid's WebView may never
 * report it (docs/HARDWARE_TEST_PLAN.md); then Auto shows light.
 */
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  if (!list) return () => {};
  // Older WebViews have only the deprecated addListener.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

const read = () => query()?.matches ?? false;

export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
