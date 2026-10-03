// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import type { Heartbeat } from '../../api/types.ts';
import { useHeartbeatOnInteraction } from './useHeartbeatOnInteraction.ts';

function counter(): Heartbeat & { count: number } {
  const heartbeat = {
    count: 0,
    notify() {
      heartbeat.count += 1;
    },
  };
  return heartbeat;
}

describe('useHeartbeatOnInteraction', () => {
  afterEach(() => cleanup());

  it('tells Decaid someone is here on a touch or a key press', () => {
    const heartbeat = counter();
    renderHook(() => useHeartbeatOnInteraction(heartbeat));

    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(heartbeat.count).toBe(2);
  });

  it('hears input even when a control stops propagation', () => {
    const heartbeat = counter();
    renderHook(() => useHeartbeatOnInteraction(heartbeat));
    const button = document.createElement('button');
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    document.body.appendChild(button);

    fireEvent.pointerDown(button);
    expect(heartbeat.count).toBe(1);
    button.remove();
  });

  it('ignores events that are not input', () => {
    const heartbeat = counter();
    renderHook(() => useHeartbeatOnInteraction(heartbeat));
    fireEvent.scroll(window);
    fireEvent(window, new Event('resize'));
    expect(heartbeat.count).toBe(0);
  });

  it('stops listening on unmount', () => {
    const heartbeat = counter();
    const { unmount } = renderHook(() => useHeartbeatOnInteraction(heartbeat));
    unmount();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(heartbeat.count).toBe(0);
  });
});
