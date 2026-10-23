/**
 * Whether the device asks for reduced motion, live: for the screensavers'
 * canvases (D-SAVER-4), which the theme's CSS rule cannot still. Decaid's
 * WebView may never report it; then the screensavers move.
 */
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

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

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
