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
  /** Call from the scroller's scroll listener. */
  onScroll(): void;
  readonly following: boolean;
}

export function createFollowNewest(scroller: ScrollBox, newest: () => NewestMessage | null): FollowNewest {
  let following = true;
  /** The view shows the end of the thread (as opposed to a tall message's start). */
  let atEnd = true;
  let revealed: unknown = null;
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
    },
    reset() {
      following = true;
      atEnd = true;
      revealed = null;
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
      } else {
        if (top < lastTop - 1) following = false;
        atEnd = false;
      }
      lastTop = top;
    },
  };
}
