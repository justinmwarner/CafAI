import { describe, expect, it } from 'vitest';
import { revealInColumn } from './reveal.ts';

/**
 * A scrolling column on screen from `top` to `top + height`, and boxes at
 * fixed places in its content: their screen position follows its scrollTop,
 * as a browser's would.
 */
function fakeColumn(top: number, height: number) {
  const column = { scrollTop: 0, getBoundingClientRect: () => ({ top, bottom: top + height }) };
  const box = (contentTop: number, boxHeight = 48) => ({
    getBoundingClientRect: () => {
      const screenTop = top + contentTop - column.scrollTop;
      return { top: screenTop, bottom: screenTop + boxHeight };
    },
  });
  const reveal = (first: ReturnType<typeof box>, last?: ReturnType<typeof box>) =>
    revealInColumn(column as unknown as HTMLElement, first as unknown as Element, (last ?? null) as unknown as Element | null);
  return { column, box, reveal };
}

// The Settings column at 962x602: under the 64 px top bar, down to the bottom of the window.
const TOP = 64;
const HEIGHT = 538;

describe('revealInColumn', () => {
  it('scrolls just far enough to bring the span below the fold into view, with a margin', () => {
    const { column, box, reveal } = fakeColumn(TOP, HEIGHT);
    const setting = box(634);
    const save = box(750);
    reveal(setting, save);
    expect(column.scrollTop).toBe(750 + 48 + 16 - HEIGHT);
    expect(save.getBoundingClientRect().bottom).toBe(TOP + HEIGHT - 16);
    expect(setting.getBoundingClientRect().top).toBeGreaterThanOrEqual(TOP + 16);
  });

  it('leaves the column alone when the span is already in view', () => {
    const { column, box, reveal } = fakeColumn(TOP, HEIGHT);
    column.scrollTop = 100;
    reveal(box(300), box(420));
    expect(column.scrollTop).toBe(100);
  });

  it('scrolls back up when the span is above the view', () => {
    const { column, box, reveal } = fakeColumn(TOP, HEIGHT);
    column.scrollTop = 500;
    const setting = box(300);
    reveal(setting, box(420));
    expect(column.scrollTop).toBe(300 - 16);
    expect(setting.getBoundingClientRect().top).toBe(TOP + 16);
  });

  it("keeps the first box's top in view when the span is taller than the column", () => {
    const { column, box, reveal } = fakeColumn(TOP, HEIGHT);
    const setting = box(700);
    reveal(setting, box(1400));
    expect(column.scrollTop).toBe(700 - 16);
    expect(setting.getBoundingClientRect().top).toBe(TOP + 16);
  });

  it('brings a single box into view', () => {
    const { column, box, reveal } = fakeColumn(TOP, HEIGHT);
    const setting = box(634);
    reveal(setting);
    expect(column.scrollTop).toBe(634 + 48 + 16 - HEIGHT);
  });
});
