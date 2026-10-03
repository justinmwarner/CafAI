// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySafeArea, watchSafeArea } from './safeArea.ts';

describe('safe-area wiring', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--safe-bottom');
  });

  it('publishes --safe-bottom on the root element', () => {
    applySafeArea(window);
    // jsdom reports no touch and no inset, which is the desktop case.
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('0px');
  });

  it('stops listening once cleaned up', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const stop = watchSafeArea(window);
    const added = add.mock.calls.map(([type]) => type);
    expect(added).toEqual(expect.arrayContaining(['resize', 'orientationchange']));

    stop();
    const removed = remove.mock.calls.map(([type]) => type);
    expect(removed).toEqual(expect.arrayContaining(['resize', 'orientationchange']));

    document.documentElement.style.setProperty('--safe-bottom', '7px');
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('7px');
  });
});
