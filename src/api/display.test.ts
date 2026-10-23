import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trafficLog } from '../traffic/recorder.ts';
import { createDisplayChannel, parseDisplayFrame, type DisplayEvent } from './display.ts';
import { createFakeWebSocket } from './testing/fakeWebSocket.ts';
import type { VisibilitySource } from './telemetry.ts';

const PATH = '/ws/v1/display';
const STATE = { wakeLockEnabled: false, wakeLockOverride: false, brightness: 100, requestedBrightness: 100, lowBatteryBrightnessActive: false };

function fakeVisibility() {
  const listeners = new Set<() => void>();
  const source: VisibilitySource & { set(state: 'visible' | 'hidden'): void; readonly listenerCount: number } = {
    visibilityState: 'visible',
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    set(state) {
      (source as { visibilityState: string }).visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
  return source;
}

function setup() {
  const sockets = createFakeWebSocket();
  const visibility = fakeVisibility();
  const channel = createDisplayChannel({
    wsOrigin: 'ws://tablet.local:8080/',
    WebSocketImpl: sockets.WebSocketImpl as unknown as typeof WebSocket,
    visibility,
  });
  const events: DisplayEvent[] = [];
  channel.subscribe((event) => events.push(event));
  return { sockets, visibility, channel, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  trafficLog.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseDisplayFrame', () => {
  it("reads Decaid's DisplayState", () => {
    expect(parseDisplayFrame({ ...STATE, brightness: 30, requestedBrightness: 30, wakeLockOverride: true, platformSupported: {} })).toEqual({
      brightness: 30,
      requestedBrightness: 30,
      wakeLockEnabled: false,
      wakeLockOverride: true,
    });
  });

  it('drops a frame without a brightness it can read, and reads a missing flag as off', () => {
    expect(parseDisplayFrame({ ...STATE, requestedBrightness: 'high' })).toBeNull();
    expect(parseDisplayFrame({ error: 'Unknown command' })).toBeNull();
    expect(parseDisplayFrame([1, 2])).toBeNull();
    expect(parseDisplayFrame(null)).toBeNull();
    expect(parseDisplayFrame({ brightness: 50, requestedBrightness: 50 })).toEqual({
      brightness: 50,
      requestedBrightness: 50,
      wakeLockEnabled: false,
      wakeLockOverride: false,
    });
  });
});

describe('createDisplayChannel', () => {
  it('opens nothing until wanted, then one socket to ws/v1/display', () => {
    const { sockets, channel } = setup();
    expect(sockets.sockets).toHaveLength(0);
    channel.want(true);
    channel.want(true);
    expect(sockets.sockets).toHaveLength(1);
    expect(sockets.latest(PATH).url).toBe('ws://tablet.local:8080/ws/v1/display');
  });

  it('takes the state frames in, from the first after each opening', () => {
    const { sockets, channel, events } = setup();
    channel.want(true);
    const socket = sockets.latest(PATH).open();
    expect(channel.isOpen()).toBe(true);
    expect(channel.state()).toBeNull();
    socket.message(STATE);
    expect(channel.state()).toEqual({ brightness: 100, requestedBrightness: 100, wakeLockEnabled: false, wakeLockOverride: false });
    socket.message({ ...STATE, brightness: 30, requestedBrightness: 30 });
    expect(channel.state()?.requestedBrightness).toBe(30);
    // A frame it cannot read changes nothing.
    socket.message('not json').message({ error: 'Unknown command' });
    expect(channel.state()?.requestedBrightness).toBe(30);
    expect(events).toEqual(['open', 'state', 'state']);
  });

  it('sends the three commands out on the open socket only, and logs them', () => {
    const { sockets, channel } = setup();
    expect(channel.send({ command: 'requestWakeLock' })).toBe(false);
    channel.want(true);
    // Still connecting: nothing can go yet.
    expect(channel.send({ command: 'requestWakeLock' })).toBe(false);
    const socket = sockets.latest(PATH).open();
    expect(channel.send({ command: 'requestWakeLock' })).toBe(true);
    expect(channel.send({ command: 'setBrightness', brightness: 30 })).toBe(true);
    expect(channel.send({ command: 'releaseWakeLock' })).toBe(true);
    expect(socket.sentJson()).toEqual([{ command: 'requestWakeLock' }, { command: 'setBrightness', brightness: 30 }, { command: 'releaseWakeLock' }]);
    const logged = trafficLog.list().filter((entry) => entry.what === 'ws/v1/display');
    expect(logged.map((entry) => [entry.direction, entry.status])).toEqual([
      ['sent', 'connect'],
      ['received', 'open'],
      ['sent', '{"command":"requestWakeLock"}'],
      ['sent', '{"command":"setBrightness","brightness":30}'],
      ['sent', '{"command":"releaseWakeLock"}'],
    ]);
  });

  it('reconnects after a drop with the backoff, 1 s doubling to 30 s, reset by an open', () => {
    const { sockets, channel, events } = setup();
    channel.want(true);
    sockets.latest(PATH).open().message(STATE).drop();
    expect(channel.isOpen()).toBe(false);
    expect(channel.state()).toBeNull();
    expect(events).toEqual(['open', 'state', 'closed']);
    vi.advanceTimersByTime(999);
    expect(sockets.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets.sockets).toHaveLength(2);
    // Failing again and again: 2 s, 4 s, ... never more than 30 s.
    sockets.latest(PATH).fail();
    vi.advanceTimersByTime(2000);
    expect(sockets.sockets).toHaveLength(3);
    for (let i = 0; i < 6; i += 1) {
      sockets.latest(PATH).fail();
      vi.advanceTimersByTime(30_000);
    }
    expect(sockets.sockets).toHaveLength(9);
    // An open resets it: the next drop waits 1 s again.
    sockets.latest(PATH).open().drop();
    vi.advanceTimersByTime(1000);
    expect(sockets.sockets).toHaveLength(10);
    expect(sockets.live(PATH)).toHaveLength(1);
  });

  it('reconnects at once when the page comes back into view', () => {
    const { sockets, channel, visibility } = setup();
    channel.want(true);
    sockets.latest(PATH).open().drop();
    visibility.set('hidden');
    expect(sockets.sockets).toHaveLength(1);
    visibility.set('visible');
    expect(sockets.sockets).toHaveLength(2);
    // The retry that was waiting does not open a second one.
    vi.advanceTimersByTime(60_000);
    expect(sockets.live(PATH)).toHaveLength(1);
  });

  it('closes on want(false), for good: no reconnect, nothing left listening', () => {
    const { sockets, channel, visibility, events } = setup();
    channel.want(true);
    const socket = sockets.latest(PATH).open();
    channel.want(false);
    expect(socket.closedByClient).toBe(true);
    expect(channel.isOpen()).toBe(false);
    expect(events).toEqual(['open', 'closed']);
    vi.advanceTimersByTime(120_000);
    visibility.set('visible');
    expect(sockets.sockets).toHaveLength(1);
    expect(visibility.listenerCount).toBe(0);
    expect(channel.send({ command: 'releaseWakeLock' })).toBe(false);
  });

  it('a close while a retry waits cancels the retry', () => {
    const { sockets, channel } = setup();
    channel.want(true);
    sockets.latest(PATH).fail();
    channel.want(false);
    vi.advanceTimersByTime(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });

  it('a socket that cannot even be made is retried, not thrown', () => {
    let made = 0;
    const channel = createDisplayChannel({
      wsOrigin: 'ws://tablet.local:8080',
      WebSocketImpl: class {
        constructor() {
          made += 1;
          throw new Error('SecurityError');
        }
      } as unknown as typeof WebSocket,
      visibility: null,
    });
    expect(() => channel.want(true)).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(made).toBe(2);
    channel.want(false);
  });
});
