/**
 * Where the chat thread scrolls as messages arrive and grow.
 *
 * While the reader follows the thread, the newest message stays in view: its
 * end, or, when it is taller than the view, its start (template cards are
 * listed best first, and a long reply reads from the top). A message shown
 * from its start then stays put while it grows, until something newer
 * arrives or the reader scrolls to its end. Scrolling up stops following;
 * scrolling back to the bottom, sending or tapping a card resumes it.
 *
 * A new thread that opens on a card to answer first (the bean card, 6.1) is
 * shown from that card's top instead, and stays there while the rows below
 * it grow (the card's own rows arriving, the stats card's numbers), until
 * something newer arrives, the reader scrolls to the end, or acts. "Newer"
 * is told by the thread's newest row as the app has it, not by the
 * scroller's elements: x-chat draws a new thread a moment after it is
 * handed over, so the elements at first are the old thread's. A reader who
 * scrolls the card meanwhile is reading it: the thread stops following
 * until they act or reach the end.
 *
 * Our own scrolls are told apart from the reader's by position, not by
 * "is it at the bottom": the scroll event can be dispatched after more
 * content rendered, which made a programmatic scroll look like the reader
 * scrolling away (the taste chips then landed below the fold).
 */

/** Within this many px of the bottom counts as "at the newest message". */
export const STICK_THRESHOLD_PX = 96;
/** How much of the conversation above stays visible when a tall message shows its start. */
export const REVEAL_MARGIN_PX = 12;

/** The scrolling element, as far as following needs it. */
export interface ScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface NewestMessage {
  /** Identity (its element), so a tall message is shown from its start only once. */
  readonly key: unknown;
  /** Its top within the scrolled content, in px. */
  readonly top: number;
  readonly height: number;
}

export interface FollowNewest {
  /** Bring the newest message into view if the reader follows the thread. Call after content changes. */
  update(): void;
  /** The reader acted (sent, tapped a card): follow again. */
  resume(): void;
  /** A new thread replaced the old one: follow it from scratch. */
  reset(): void;
  /**
   * A new thread that opens on a card to answer first: show the thread from
   * its start, the card's top, and stay there while its newest row (newestRow) stays the same.
   */
  showStart(): void;
  /** Call from the scroller's scroll listener. */
  onScroll(): void;
  readonly following: boolean;
}

/**
 * `newestRow` names the thread's newest row as the app has it (its id),
 * which the scroller may draw a moment later; by default the newest element.
 */
export function createFollowNewest(
  scroller: ScrollBox,
  newest: () => NewestMessage | null,
  newestRow: () => unknown = () => newest()?.key ?? null,
): FollowNewest {
  let following = true;
  /** The view shows the end of the thread (as opposed to a tall message's start). */
  let atEnd = true;
  let revealed: unknown = null;
  /** While a new thread is shown from its start (showStart): its newest row then, whose successor ends the hold. */
  let held: { row: unknown } | null = null;
  let expectedTop: number | null = null;
  let lastTop = scroller.scrollTop;

  function scrollTo(top: number): void {
    scroller.scrollTop = Math.max(0, top);
    // Read back: the browser clamps to the scrollable range.
    expectedTop = scroller.scrollTop;
    lastTop = scroller.scrollTop;
  }

  return {
    get following() {
      return following;
    },
    update() {
      if (!following) return;
      if (held) {
        // At the start until something newer arrives, also when the thread
        // itself is drawn only now, or grows from its first rows to all of them.
        if (newestRow() === held.row) {
          scrollTo(0);
          return;
        }
        held = null;
      }
      const message = newest();
      if (message && message.height > scroller.clientHeight - REVEAL_MARGIN_PX) {
        if (message.key !== revealed) {
          revealed = message.key;
          atEnd = false;
          scrollTo(message.top - REVEAL_MARGIN_PX);
          return;
        }
        // Being read from its start: let it grow below the fold.
        if (!atEnd) return;
      }
      atEnd = true;
      scrollTo(scroller.scrollHeight - scroller.clientHeight);
    },
    resume() {
      following = true;
      held = null;
    },
    reset() {
      following = true;
      atEnd = true;
      revealed = null;
      held = null;
    },
    showStart() {
      following = true;
      atEnd = false;
      held = { row: newestRow() };
      scrollTo(0);
    },
    onScroll() {
      const top = scroller.scrollTop;
      if (expectedTop !== null && Math.abs(top - expectedTop) <= 1) {
        // Our own scroll, however late its event arrives.
        expectedTop = null;
        lastTop = top;
        return;
      }
      expectedTop = null;
      if (scroller.scrollHeight - top - scroller.clientHeight < STICK_THRESHOLD_PX) {
        following = true;
        atEnd = true;
        held = null;
      } else {
        // Up, or anywhere in a card held at its start: the reader is reading.
        if (top < lastTop - 1 || held) following = false;
        held = null;
        atEnd = false;
      }
      lastTop = top;
    },
  };
}
