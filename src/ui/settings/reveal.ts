/**
 * Bring part of a scrolling column into view by scrolling that column only.
 *
 * The page itself never scrolls (AppShell): each column scrolls inside
 * itself. Element.scrollIntoView would also move any scrollable ancestor,
 * the shell's own containers included, so the column's scrollTop is set
 * directly instead.
 */

/**
 * Scroll `column` just far enough that the span from the top of `first` to
 * the bottom of `last` (or of `first`) is inside it, `margin` px clear of its
 * edges. A span taller than the column shows from the top of `first`.
 */
export function revealInColumn(column: HTMLElement, first: Element, last: Element | null = null, margin = 16): void {
  const view = column.getBoundingClientRect();
  const top = first.getBoundingClientRect().top - margin;
  const bottom = (last ?? first).getBoundingClientRect().bottom + margin;
  let by = 0;
  if (bottom > view.bottom) by = bottom - view.bottom;
  if (top - by < view.top) by = top - view.top;
  if (by !== 0) column.scrollTop += by;
}
