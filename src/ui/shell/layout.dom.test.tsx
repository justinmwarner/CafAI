// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useLayout } from './layout.ts';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

describe('useLayout', () => {
  afterEach(() => {
    cleanup();
  });

  it('follows a resize once innerWidth/innerHeight change', async () => {
    setViewport(1024, 768);
    const { result } = renderHook(() => useLayout());
    expect(result.current).toMatchObject({ mode: 'tablet', nav: 'bar', width: 1024, height: 768 });

    act(() => {
      setViewport(390, 844);
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => expect(result.current).toMatchObject({ mode: 'phone', nav: 'bar', width: 390, height: 844 }));
  });

  it('follows an orientationchange too', async () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useLayout());
    expect(result.current.mode).toBe('phone');

    act(() => {
      setViewport(844, 390);
      window.dispatchEvent(new Event('orientationchange'));
    });

    await waitFor(() => expect(result.current).toMatchObject({ mode: 'phone', nav: 'rail', width: 844, height: 390 }));
  });
});
