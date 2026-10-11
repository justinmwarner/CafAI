import { describe, expect, it } from 'vitest';
import { REVEAL_MARGIN_PX, createFollowNewest, type ScrollBox } from './followNewest.ts';

/**
 * A thread of stacked messages in a scroller that clamps like a browser.
 * `newestRow` stands in for the app's own newest row (the default: the newest element).
 */
function thread(initialViewport = 400, newestRow?: () => unknown) {
  let messages: Array<{ height: number }> = [];
  let top = 0;
  let viewport = initialViewport;
  const box: ScrollBox = {
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(Math.max(0, value), Math.max(0, this.scrollHeight - this.clientHeight));
    },
    get scrollHeight() {
      return Math.max(viewport, messages.reduce((sum, m) => sum + m.height, 0));
    },
    get clientHeight() {
      return viewport;
    },
  };
  const follower = createFollowNewest(
    box,
    () => {
      const last = messages[messages.length - 1];
      if (!last) return null;
      return { key: last, top: messages.slice(0, -1).reduce((sum, m) => sum + m.height, 0), height: last.height };
    },
    newestRow,
  );
  return {
    box,
    follower,
    add(height: number) {
      const message = { height };
      messages.push(message);
      return message;
    },
    /** The scroller draws another thread in place of this one: new elements, the scroll position kept where the browser can. */
    redraw(heights: number[]) {
      messages = heights.map((height) => ({ height }));
      top = Math.min(top, Math.max(0, box.scrollHeight - box.clientHeight));
      return messages;
    },
    /** The reader drags the thread to `to`; the browser then fires its scroll event. */
    readerScrollsTo(to: number) {
      box.scrollTop = to;
      follower.onScroll();
    },
    /** A banner appears above the chat (or a keyboard opens): the view gets shorter. */
    resizeView(height: number) {
      viewport = height;
      top = Math.min(top, Math.max(0, box.scrollHeight - height)); // the browser re-clamps
    },
    gapToBottom: () => box.scrollHeight - box.scrollTop - box.clientHeight,
    topOf: (index: number) => messages.slice(0, index).reduce((sum, m) => sum + m.height, 0),
  };
}

describe('following the newest message', () => {
  it('keeps short messages in view at the bottom as they arrive', () => {
    const t = thread();
    for (let i = 0; i < 8; i++) {
      t.add(120);
      t.follower.update();
      expect(t.gapToBottom()).toBe(0);
    }
  });

  it('shows a message taller than the view from its start, then lets it grow below the fold', () => {
    const t = thread();
    t.add(300);
    t.add(300);
    t.follower.update();
    const cards = t.add(520); // three template cards, best first
    t.follower.update();
    expect(t.box.scrollTop).toBe(t.topOf(2) - REVEAL_MARGIN_PX);
    t.follower.onScroll(); // the event for our own scroll
    cards.height = 640; // still streaming
    t.follower.update();
    expect(t.box.scrollTop).toBe(t.topOf(2) - REVEAL_MARGIN_PX);
    expect(t.follower.following).toBe(true);
  });

  it('follows the next message after a tall one, once the reader acted', () => {
    const t = thread();
    t.add(200);
    t.add(520);
    t.follower.update();
    t.follower.resume(); // tapped "Use this" on the first card
    t.follower.update(); // the card list re-renders as picked: no jump
    expect(t.box.scrollTop).toBe(t.topOf(1) - REVEAL_MARGIN_PX);
    t.add(60); // "Loaded Kiambu AA v1 on the machine."
    t.follower.update();
    expect(t.gapToBottom()).toBe(0);
  });

  it('is not fooled by the event of its own scroll arriving after more content rendered', () => {
    const t = thread(383);
    t.add(812);
    t.follower.update();
    t.follower.onScroll();
    t.add(24); // the shot card starts to render
    t.follower.update();
    t.add(176); // ...and grows before the scroll event is dispatched
    t.follower.onScroll();
    expect(t.follower.following).toBe(true);
    t.add(218); // the coach's reply with the taste chips
    t.follower.update();
    expect(t.gapToBottom()).toBe(0);
  });

  it('stops following when the reader scrolls up, and resumes at the bottom or when they act', () => {
    const t = thread();
    for (let i = 0; i < 6; i++) t.add(150);
    t.follower.update();
    t.follower.onScroll();
    t.readerScrollsTo(100);
    expect(t.follower.following).toBe(false);
    t.add(150);
    t.follower.update();
    expect(t.box.scrollTop).toBe(100);

    t.readerScrollsTo(t.box.scrollHeight - t.box.clientHeight - 20);
    expect(t.follower.following).toBe(true);
    t.add(150);
    t.follower.update();
    expect(t.gapToBottom()).toBe(0);

    t.readerScrollsTo(0);
    t.follower.resume();
    t.add(80);
    t.follower.update();
    expect(t.gapToBottom()).toBe(0);
  });

  it('follows the growth of a tall message once the reader has scrolled to its end', () => {
    const t = thread();
    t.add(100);
    const reply = t.add(700);
    t.follower.update();
    t.follower.onScroll();
    t.readerScrollsTo(t.box.scrollHeight - t.box.clientHeight);
    reply.height = 900;
    t.follower.update();
    expect(t.gapToBottom()).toBe(0);
  });

  it('a reading position scrolled down but short of the end does not stop following', () => {
    const t = thread();
    t.add(100);
    t.add(1200);
    t.follower.update();
    t.follower.onScroll();
    t.readerScrollsTo(t.box.scrollTop + 200); // reading down the tall message
    expect(t.follower.following).toBe(true);
    t.add(60);
    t.follower.update();
    expect(t.gapToBottom()).toBe(0);
  });

  it('keeps the newest prompt in view when the view shrinks under it', () => {
    const t = thread(400);
    for (let i = 0; i < 5; i++) t.add(150);
    t.follower.update();
    t.follower.onScroll();
    t.resizeView(310); // the "machine is running…" banner appears
    t.follower.update(); // the resize observer fires
    expect(t.gapToBottom()).toBe(0);
    expect(t.follower.following).toBe(true);
  });

  describe('a new thread that opens on a card to answer first (the bean card, 6.1)', () => {
    /** The bean card still looking in Decaid's beans, the coach's question, the stats card (D91). */
    function newBag() {
      const t = thread(400);
      const card = t.add(180);
      t.add(90);
      const stats = t.add(260);
      t.follower.showStart();
      return { t, card, stats };
    }

    it("shows the card from its top, and stays there while its rows arrive and the stats card's numbers move", () => {
      const { t, card, stats } = newBag();
      expect(t.box.scrollTop).toBe(0);
      t.follower.onScroll(); // the event for our own scroll
      card.height = 620; // Decaid's batches arrived
      t.follower.update();
      expect(t.box.scrollTop).toBe(0);
      stats.height = 280; // a readout wrapped
      t.follower.update();
      expect(t.box.scrollTop).toBe(0);
      t.resizeView(330); // a banner above the chat
      t.follower.update();
      expect(t.box.scrollTop).toBe(0);
      expect(t.follower.following).toBe(true);
    });

    it('follows again once something new arrives', () => {
      const { t, card } = newBag();
      card.height = 620;
      t.follower.update();
      t.add(60); // "Reading the bag…"
      t.follower.update();
      expect(t.gapToBottom()).toBe(0);
    });

    it('follows again once the reader acts, or scrolls to the end', () => {
      const acted = newBag();
      acted.card.height = 620;
      acted.t.follower.resume(); // tapped Something else
      acted.t.follower.update();
      expect(acted.t.gapToBottom()).toBe(0);

      const scrolled = newBag();
      scrolled.card.height = 620;
      scrolled.t.follower.update();
      scrolled.t.readerScrollsTo(scrolled.t.box.scrollHeight - scrolled.t.box.clientHeight);
      scrolled.stats.height = 300;
      scrolled.t.follower.update();
      expect(scrolled.t.gapToBottom()).toBe(0);
    });

    it('starts over on the next thread', () => {
      const { t, card } = newBag();
      card.height = 620;
      t.follower.reset();
      t.follower.update();
      expect(t.gapToBottom()).toBe(0);
    });

    it('stays at the start when the scroller draws the new thread only after it opened, as x-chat does', () => {
      // The app's newest row: the new bag's coach question, until something new arrives.
      let row = 'question';
      const t = thread(400, () => row);
      // The old bag's long thread, read to its end.
      for (let i = 0; i < 6; i++) t.add(300);
      t.follower.update();
      expect(t.gapToBottom()).toBe(0);

      t.follower.showStart();
      // Now the new thread is drawn: the bean card, still looking, and the question.
      const [card] = t.redraw([180, 90]);
      t.follower.update();
      expect(t.box.scrollTop).toBe(0);
      card!.height = 620; // Decaid's batches arrived
      t.follower.update();
      expect(t.box.scrollTop).toBe(0);

      row = 'reading'; // "Reading the bag…"
      t.add(60);
      t.follower.update();
      expect(t.gapToBottom()).toBe(0);
    });

    it('leaves the view where the reader scrolled the card, until they act or reach the end', () => {
      const { t, card, stats } = newBag();
      card.height = 620;
      t.follower.update();
      t.readerScrollsTo(150); // down to the older roasts
      expect(t.follower.following).toBe(false);
      stats.height = 300;
      t.follower.update();
      expect(t.box.scrollTop).toBe(150);

      t.follower.resume(); // tapped Use this
      t.follower.update();
      expect(t.gapToBottom()).toBe(0);
    });
  });

  it('starts over on a new thread', () => {
    const t = thread();
    t.add(900);
    t.follower.update();
    t.readerScrollsTo(0);
    t.readerScrollsTo(50);
    t.readerScrollsTo(10);
    expect(t.follower.following).toBe(false);
    t.follower.reset();
    t.follower.update();
    expect(t.box.scrollTop).toBe(0); // the tall message from its start
    expect(t.follower.following).toBe(true);
  });
});
