// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { usePrefersDark } from './usePrefersDark.ts';

function Probe() {
  return <span>{usePrefersDark() ? 'dark' : 'light'}</span>;
}

/** A matchMedia stand-in whose answer the test flips. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
  return {
    set(dark: boolean) {
      list.matches = dark;
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

describe('usePrefersDark', () => {
  it('follows the device as it changes', () => {
    const device = stubMatchMedia(false);
    const { unmount } = render(<Probe />);
    expect(screen.getByText('light')).toBeInTheDocument();
    act(() => device.set(true));
    expect(screen.getByText('dark')).toBeInTheDocument();
    unmount();
    expect(device.listenerCount).toBe(0);
  });

  it('says light where the engine cannot tell', () => {
    // @ts-expect-error: an engine without matchMedia.
    delete window.matchMedia;
    render(<Probe />);
    expect(screen.getByText('light')).toBeInTheDocument();
  });
});
