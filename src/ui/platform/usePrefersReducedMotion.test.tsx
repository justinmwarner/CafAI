// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion.ts';

function Probe() {
  return <span>{usePrefersReducedMotion() ? 'still' : 'moving'}</span>;
}

/** A matchMedia stand-in whose answer the test flips; it answers only the reduced-motion query. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const asked: string[] = [];
  const list = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  window.matchMedia = ((query: string) => {
    asked.push(query);
    return list;
  }) as unknown as typeof window.matchMedia;
  return {
    asked,
    set(reduce: boolean) {
      list.matches = reduce;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

/** An older WebView's MediaQueryList: addListener and removeListener only. */
function stubOldMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    addListener: (listener: () => void) => void listeners.add(listener),
    removeListener: (listener: () => void) => void listeners.delete(listener),
  };
  window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
  return {
    set(reduce: boolean) {
      list.matches = reduce;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

describe('usePrefersReducedMotion', () => {
  it('follows the device as it changes, asking for reduced motion', () => {
    const device = stubMatchMedia(false);
    const { unmount } = render(<Probe />);
    expect(screen.getByText('moving')).toBeInTheDocument();
    expect(device.asked).toContain('(prefers-reduced-motion: reduce)');
    act(() => device.set(true));
    expect(screen.getByText('still')).toBeInTheDocument();
    unmount();
    expect(device.listenerCount).toBe(0);
  });

  it("listens the old way on a WebView that has only addListener", () => {
    const device = stubOldMatchMedia(true);
    const { unmount } = render(<Probe />);
    expect(screen.getByText('still')).toBeInTheDocument();
    act(() => device.set(false));
    expect(screen.getByText('moving')).toBeInTheDocument();
    unmount();
    expect(device.listenerCount).toBe(0);
  });

  it('says moving where the engine cannot tell', () => {
    // @ts-expect-error: an engine without matchMedia.
    delete window.matchMedia;
    render(<Probe />);
    expect(screen.getByText('moving')).toBeInTheDocument();
  });
});
