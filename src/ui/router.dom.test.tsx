// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { navigate, replaceRoute, useRoute } from './router.ts';

describe('hash navigation', () => {
  afterEach(() => {
    cleanup();
    window.location.hash = '';
  });

  it('navigate() writes the hash', () => {
    navigate({ name: 'history', bagId: 'bag_1' });
    expect(window.location.hash).toBe('#/history/bag_1');
    navigate({ name: 'coach' });
    expect(window.location.hash).toBe('#/');
  });

  it('useRoute() follows hash changes', async () => {
    window.location.hash = '#/settings';
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'settings' });

    act(() => navigate({ name: 'history' }));
    await waitFor(() => expect(result.current).toEqual({ name: 'history' }));
  });

  it('keeps the same Route object while the hash is unchanged', () => {
    window.location.hash = '#/history/bag_2';
    const { result, rerender } = renderHook(() => useRoute());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('replaceRoute() changes the hash without a new history entry', () => {
    const before = window.history.length;
    replaceRoute({ name: 'shot' });
    expect(window.location.hash).toBe('#/shot');
    expect(window.history.length).toBe(before);

    replaceRoute({ name: 'shot' });
    expect(window.location.hash).toBe('#/shot');
    expect(window.history.length).toBe(before);
  });
});
