// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, revealInOwnColumn } from './careReveal.ts';

/** A ResizeObserver the test fires by hand: jsdom lays nothing out. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  observed: Element[] = [];
  disconnected = false;
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.last = this;
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  /** The content changed size: heard only while observing, as a real observer's is. */
  fire() {
    if (!this.disconnected) this.callback([], this as unknown as ResizeObserver);
  }
}

/**
 * A 300 px scrolling column on screen at the top, holding the target 200 px
 * tall at `contentTop` in its content: its screen position follows the
 * column's scrollTop, as a browser's would.
 */
function layout() {
  const column = document.createElement('div');
  column.style.overflowY = 'auto';
  const content = document.createElement('div');
  const target = document.createElement('section');
  content.append(target);
  column.append(content);
  document.body.append(column);
  Object.defineProperty(column, 'scrollHeight', { value: 3000 });
  Object.defineProperty(column, 'clientHeight', { value: 300 });
  const place = { contentTop: 2000 };
  column.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
  target.getBoundingClientRect = () => {
    const top = place.contentTop - column.scrollTop;
    return { top, bottom: top + 200 } as DOMRect;
  };
  return { column, content, target, place };
}

describe('revealInOwnColumn: bringing a target into view and keeping it there (D187, D188)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    FakeResizeObserver.last = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('scrolls the column just far enough that the target shows, 16 px clear of the bottom', () => {
    const { column, target } = layout();
    revealInOwnColumn(target);
    expect(column.scrollTop).toBe(1916);
    expect(target.getBoundingClientRect().bottom).toBe(284);
  });

  it('keeps the target in view while a section above it grows, as Sleep and wake does once Decaid answers', () => {
    const { column, content, target, place } = layout();
    revealInOwnColumn(target);
    expect(FakeResizeObserver.last!.observed).toEqual([content]);
    place.contentTop = 2300;
    FakeResizeObserver.last!.fire();
    expect(column.scrollTop).toBe(2216);
    expect(target.getBoundingClientRect().top).toBe(84);
  });

  it('lets go the moment the barista touches, scrolls or types in the column', () => {
    for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
      const { column, target, place } = layout();
      revealInOwnColumn(target);
      column.dispatchEvent(new Event(type));
      expect(FakeResizeObserver.last!.disconnected, type).toBe(true);
      place.contentTop = 2300;
      FakeResizeObserver.last!.fire();
      expect(column.scrollTop, type).toBe(1916);
    }
  });

  it(`lets go after ${HOLD_MS} ms, and when the target is gone`, () => {
    const first = layout();
    revealInOwnColumn(first.target);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(FakeResizeObserver.last!.disconnected).toBe(false);
    vi.advanceTimersByTime(1);
    expect(FakeResizeObserver.last!.disconnected).toBe(true);

    const second = layout();
    revealInOwnColumn(second.target);
    second.target.remove();
    FakeResizeObserver.last!.fire();
    expect(FakeResizeObserver.last!.disconnected).toBe(true);
  });
});
