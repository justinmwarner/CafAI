import { describe, expect, it } from 'vitest';
import { REVEAL_MARGIN_PX, createFollowNewest, type ScrollBox } from './followNewest.ts';

/** A thread of stacked messages in a scroller that clamps like a browser. */
function thread(viewport = 400) {
  const messages: Array<{ height: number }> = [];
  let top = 0;
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
    clientHeight: viewport,
  };
  const follower = createFollowNewest(box, () => {
    const last = messages[messages.length - 1];
    if (!last) return null;
    return { key: last, top: messages.slice(0, -1).reduce((sum, m) => sum + m.height, 0), height: last.height };
  });
  return {
    box,
    follower,
    add(height: number) {
      const message = { height };
      messages.push(message);
      return message;
    },
    /** The reader drags the thread to `to`; the browser then fires its scroll event. */
    readerScrollsTo(to: number) {
      box.scrollTop = to;
      follower.onScroll();
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
