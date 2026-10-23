import { describe, expect, it, vi } from 'vitest';
import { mirrorScreen, withScreen } from './address.ts';

describe('withScreen (D-USAGE-4)', () => {
  it("sets the screen beside Decaid's cache buster and the hash", () => {
    expect(withScreen('http://localhost:24800/?_=1730000000000#/settings', 'settings')).toBe(
      'http://localhost:24800/?_=1730000000000&screen=settings#/settings',
    );
  });

  it('replaces a screen already there and keeps every other parameter', () => {
    expect(withScreen('http://192.168.1.42:24800/?screen=coach&mockSpeed=25#/shot', 'shot')).toBe(
      'http://192.168.1.42:24800/?screen=shot&mockSpeed=25#/shot',
    );
  });

  it('takes the screen out for null, leaving no empty query behind', () => {
    expect(withScreen('http://localhost:24800/?screen=coach#/', null)).toBe('http://localhost:24800/#/');
    expect(withScreen('http://localhost:24800/?_=1&screen=coach#/', null)).toBe('http://localhost:24800/?_=1#/');
  });
});

describe('mirrorScreen', () => {
  it('replaces the history entry only when the address changes', () => {
    const replaceState = vi.fn();
    const win = { location: { href: 'http://localhost:24800/#/' }, history: { state: null, replaceState } };
    expect(mirrorScreen(win as unknown as Window, null)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(mirrorScreen(win as unknown as Window, 'coach')).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', 'http://localhost:24800/?screen=coach#/');
  });

  it('shrugs off a history that refuses', () => {
    const win = {
      location: { href: 'http://localhost:24800/#/' },
      history: {
        state: null,
        replaceState: () => {
          throw new Error('SecurityError');
        },
      },
    };
    expect(mirrorScreen(win as unknown as Window, 'coach')).toBe(false);
  });
});
