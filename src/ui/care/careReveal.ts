/**
 * Bringing what a link points at into view on the screen it opens: the stats
 * card's line opens a step of the Care screen, and the Care screen's "Change
 * it in Settings" opens Settings > Machine care (D-CARE-5, D-CARE-6). The
 * link asks first, the screen takes the ask when it mounts, so a reload or a
 * visit by another way brings nothing into view.
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
 * Scroll the element's own scrolling column, never the page (the page never
 * scrolls, and Element.scrollIntoView would move every scrollable ancestor;
 * src/ui/settings/reveal.ts), once the screen has laid itself out.
 */
export function revealInOwnColumn(element: HTMLElement): void {
  requestAnimationFrame(() => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) {
        revealInColumn(parent, element);
        return;
      }
    }
  });
}
