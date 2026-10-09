import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * What `choose` makes of an element's own size (its clientWidth and
 * clientHeight), for a component laid out for the room it has rather than
 * for the window: the Chromium 91 WebView has no container queries.
 *
 * Measured before the first paint, so the first frame is already the right
 * arrangement, and again whenever the size changes (ResizeObserver, or window
 * resizes on an engine without it). The component re-renders only when the
 * choice changes, so `choose` returns a primitive and is a module-level
 * function. Before a measurement, and without layout (jsdom), the size is 0
 * by 0.
 */
export function useOwnLayout<T extends string | number | boolean>(
  ref: RefObject<HTMLElement | null>,
  choose: (width: number, height: number) => T,
): T {
  const [choice, setChoice] = useState<T>(() => choose(0, 0));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setChoice(choose(element.clientWidth, element.clientHeight));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(element);
    else window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, choose]);
  return choice;
}
