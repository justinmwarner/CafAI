/**
 * Bringing what a link points at into view on the screen it opens: the stats
 * card's line opens a step of the Care screen, and the Care screen's "Change
 * it in Settings" opens Settings > Machine and its Machine care card (D187,
 * D188, D233), in the group's own scrolling column. The link asks first, the
 * screen takes the ask when it mounts, so a reload or a visit by another way
 * brings nothing into view.
 */
import { revealInColumn } from '../settings/reveal.ts';

/** What to bring into view: a step of the Care screen, by its id, or Settings > Machine care. */
export type RevealTarget = { step: string } | 'settings-care';

let pending: string | null = null;

const keyOf = (target: RevealTarget) => (typeof target === 'string' ? target : `step:${target.step}`);

/** A link to the target was tapped. */
export function requestReveal(target: RevealTarget): void {
  pending = keyOf(target);
}

/** True once, for the target a link asked for. */
export function takeReveal(target: RevealTarget): boolean {
  if (pending !== keyOf(target)) return false;
  pending = null;
  return true;
}

/**
 * How long the target is held in view after the scroll. A section above it
 * can still be waiting for Decaid (Sleep and wake grows by its settings once
 * they come), and the browser's own scroll anchoring cannot help: the margin
 * leaves that section showing at the top, so it is the anchor that grows.
 */
export const HOLD_MS = 2000;

/** The barista taking over: from then on the column is theirs. */
const TAKE_OVER = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;

/**
 * Scroll the element's own scrolling column, never the page (the page never
 * scrolls, and Element.scrollIntoView would move every scrollable ancestor;
 * src/ui/settings/reveal.ts), once the screen has laid itself out, and keep
 * it there while the column's content still changes size: for HOLD_MS, or
 * until the barista touches, scrolls or types.
 */
export function revealInOwnColumn(element: HTMLElement): void {
  requestAnimationFrame(() => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) {
        revealInColumn(parent, element);
        holdInView(parent, element);
        return;
      }
    }
  });
}

function holdInView(column: HTMLElement, element: HTMLElement): void {
  if (typeof ResizeObserver !== 'function') return;
  const observer = new ResizeObserver(() => {
    if (element.isConnected) revealInColumn(column, element);
    else release();
  });
  const timer = window.setTimeout(release, HOLD_MS);
  function release() {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of TAKE_OVER) column.removeEventListener(type, release);
  }
  for (const child of Array.from(column.children)) observer.observe(child);
  for (const type of TAKE_OVER) column.addEventListener(type, release, { passive: true });
}
