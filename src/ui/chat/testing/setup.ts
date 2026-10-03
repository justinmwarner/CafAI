/**
 * Local setup for the chat, history and settings component tests, imported
 * first by each of them (the shared src/test/setup.ts is not ours to change):
 *   - unmount after every test (RTL only does this itself with vitest globals);
 *   - browser APIs jsdom lacks but MUI and x-chat touch.
 * Not shipped.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const g = globalThis as Record<string, unknown>;
if (typeof g.ResizeObserver === 'undefined') g.ResizeObserver = NoopResizeObserver;

if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.scrollTo !== 'function') proto.scrollTo = function scrollTo() {};
  if (typeof proto.scrollIntoView !== 'function') proto.scrollIntoView = function scrollIntoView() {};
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
