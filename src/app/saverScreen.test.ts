import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDisplayChannel } from '../api/display.ts';
import { createFakeWebSocket, type FakeSocket } from '../api/testing/fakeWebSocket.ts';
import { createSaverScreen, SAVER_BRIGHTNESS_KEY, type BrightnessMemory } from './saverScreen.ts';

const PATH = '/ws/v1/display';

function frame(requestedBrightness: number, wakeLockOverride = false) {
  return { wakeLockEnabled: wakeLockOverride, wakeLockOverride, brightness: requestedBrightness, requestedBrightness, lowBatteryBrightnessActive: false };
}

function memory(initial: Record<string, string> = {}): BrightnessMemory & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => void (values[key] = value),
    removeItem: (key) => void delete values[key],
  };
}

/** A stand-in for Decaid's side of the socket: the state on connect, a frame after each command. */
function decaid(socket: FakeSocket, initial: number) {
  let requested = initial;
  let override = false;
  let seen = 0;
  socket.open().message(frame(requested, override));
  return {
    /** Answers what the client sent since the last call, as Decaid does. */
    answer() {
      for (const text of socket.sent.slice(seen)) {
        const command = JSON.parse(text) as { command: string; brightness?: number };
        if (command.command === 'setBrightness') requested = command.brightness!;
        if (command.command === 'requestWakeLock') override = true;
        if (command.command === 'releaseWakeLock') override = false;
        socket.message(frame(requested, override));
      }
      seen = socket.sent.length;
    },
    get requested() {
      return requested;
    },
    get override() {
      return override;
    },
  };
}

function setup(stored: Record<string, string> = {}) {
  const sockets = createFakeWebSocket();
  const channel = createDisplayChannel({
    wsOrigin: 'ws://tablet.local:8080',
    WebSocketImpl: sockets.WebSocketImpl as unknown as typeof WebSocket,
    visibility: null,
  });
  const storage = memory(stored);
  const screen = createSaverScreen(channel, storage);
  return { sockets, channel, storage, screen };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSaverScreen', () => {
  it('hold(): remembers the brightness from the first frame, dims to 30 and takes the wake lock', () => {
    const { sockets, storage, screen } = setup();
    screen.hold();
    const socket = sockets.latest(PATH);
    // Nothing goes before the socket opens.
    expect(socket.sent).toEqual([]);
    const tablet = decaid(socket, 100);
    expect(storage.values[SAVER_BRIGHTNESS_KEY]).toBe('100');
    tablet.answer();
    expect(socket.sentJson()).toEqual([{ command: 'requestWakeLock' }, { command: 'setBrightness', brightness: 30 }]);
    expect([tablet.requested, tablet.override]).toEqual([30, true]);
    // The frames its commands bring change nothing more.
    tablet.answer();
    expect(socket.sent).toHaveLength(2);
    expect(storage.values[SAVER_BRIGHTNESS_KEY]).toBe('100');
  });

  it('leaves a brightness lower than 30 where it is, and remembers it', () => {
    const { sockets, storage, screen } = setup();
    screen.hold();
    const socket = sockets.latest(PATH);
    decaid(socket, 12).answer();
    expect(socket.sentJson()).toEqual([{ command: 'requestWakeLock' }]);
    expect(storage.values[SAVER_BRIGHTNESS_KEY]).toBe('12');
  });

  it('a reconnect asks for the wake lock and the dim again, and keeps the brightness remembered the first time', () => {
    const { sockets, storage, screen } = setup();
    screen.hold();
    decaid(sockets.latest(PATH), 100).answer();
    // The connection goes: the lock went with it, the dim stayed.
    sockets.latest(PATH).drop();
    vi.advanceTimersByTime(1000);
    const again = sockets.latest(PATH);
    expect(sockets.sockets).toHaveLength(2);
    decaid(again, 30).answer();
    expect(again.sentJson()).toEqual([{ command: 'requestWakeLock' }]);
    expect(storage.values[SAVER_BRIGHTNESS_KEY]).toBe('100');
  });

  it('release(): lets the wake lock go and closes the socket, keeping the dim and the value remembered', () => {
    const { sockets, storage, screen } = setup();
    screen.hold();
    const socket = sockets.latest(PATH);
    const tablet = decaid(socket, 100);
    tablet.answer();
    screen.release();
    tablet.answer();
    expect(socket.sentJson().at(-1)).toEqual({ command: 'releaseWakeLock' });
    expect(socket.closedByClient).toBe(true);
    expect([tablet.requested, tablet.override]).toEqual([30, false]);
    expect(storage.values[SAVER_BRIGHTNESS_KEY]).toBe('100');
    vi.advanceTimersByTime(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });

  it('hold() after release() starts over: held on and dimmed again, the first value still the one remembered', () => {
    const { sockets, storage, screen } = setup();
    screen.hold();
    decaid(sockets.latest(PATH), 100).answer();
    screen.release();
    screen.hold();
    expect(sockets.sockets).toHaveLength(2);
    const again = sockets.latest(PATH);
    decaid(again, 30).answer();
    expect(again.sentJson()).toEqual([{ command: 'requestWakeLock' }]);
    expect(storage.values[SAVER_BRIGHTNESS_KEY]).toBe('100');
  });

  it('restore(): puts the remembered brightness back, lets the lock go, forgets it once Decaid shows it back, and closes', () => {
    const { sockets, storage, screen } = setup();
    screen.hold();
    const socket = sockets.latest(PATH);
    const tablet = decaid(socket, 100);
    tablet.answer();
    screen.restore();
    expect(socket.sentJson().slice(2)).toEqual([{ command: 'setBrightness', brightness: 100 }, { command: 'releaseWakeLock' }]);
    expect(storage.values[SAVER_BRIGHTNESS_KEY]).toBe('100');
    tablet.answer();
    expect([tablet.requested, tablet.override]).toEqual([100, false]);
    expect(storage.values).toEqual({});
    expect(socket.closedByClient).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });

  it('restore() after release() opens the socket again to put the brightness back', () => {
    const { sockets, storage, screen } = setup();
    screen.hold();
    decaid(sockets.latest(PATH), 100).answer();
    screen.release();
    screen.restore();
    expect(sockets.sockets).toHaveLength(2);
    const socket = sockets.latest(PATH);
    const tablet = decaid(socket, 30);
    expect(socket.sentJson()).toEqual([{ command: 'setBrightness', brightness: 100 }]);
    tablet.answer();
    expect(tablet.requested).toBe(100);
    expect(storage.values).toEqual({});
    expect(socket.closedByClient).toBe(true);
  });

  it('restore() that loses the socket before Decaid shows the brightness back sends it again on the next one', () => {
    const { sockets, storage, screen } = setup({ [SAVER_BRIGHTNESS_KEY]: '100' });
    screen.restore();
    const first = sockets.latest(PATH);
    decaid(first, 30);
    expect(first.sentJson()).toEqual([{ command: 'setBrightness', brightness: 100 }]);
    first.drop();
    vi.advanceTimersByTime(1000);
    const second = sockets.latest(PATH);
    const tablet = decaid(second, 30);
    expect(second.sentJson()).toEqual([{ command: 'setBrightness', brightness: 100 }]);
    tablet.answer();
    expect(storage.values).toEqual({});
    expect(second.closedByClient).toBe(true);
  });

  it('a start with a value left over (the page unloaded while dimmed) puts it back', () => {
    const { sockets, storage, screen } = setup({ [SAVER_BRIGHTNESS_KEY]: '80' });
    screen.restore();
    const socket = sockets.latest(PATH);
    const tablet = decaid(socket, 30);
    tablet.answer();
    expect(socket.sentJson()).toEqual([{ command: 'setBrightness', brightness: 80 }]);
    expect(tablet.requested).toBe(80);
    expect(storage.values).toEqual({});
    expect(socket.closedByClient).toBe(true);
  });

  it('a start with nothing left over opens no socket', () => {
    const { sockets, screen } = setup();
    screen.restore();
    expect(sockets.sockets).toHaveLength(0);
  });

  it('a value left over that Decaid already shows (it reset the brightness when the skin closed) is only forgotten', () => {
    const { sockets, storage, screen } = setup({ [SAVER_BRIGHTNESS_KEY]: '100' });
    screen.restore();
    const socket = sockets.latest(PATH);
    decaid(socket, 100);
    expect(socket.sent).toEqual([]);
    expect(storage.values).toEqual({});
    expect(socket.closedByClient).toBe(true);
  });

  it('reads a stored value it cannot use as nothing remembered', () => {
    for (const text of ['', 'bright', '150', '-1', '30.5']) {
      const { sockets, screen } = setup({ [SAVER_BRIGHTNESS_KEY]: text });
      screen.restore();
      expect(sockets.sockets, text).toHaveLength(0);
    }
  });

  it('a socket that fails changes nothing on screen, and nothing throws', () => {
    const { sockets, storage, screen } = setup();
    expect(() => screen.hold()).not.toThrow();
    sockets.latest(PATH).fail();
    vi.advanceTimersByTime(1000);
    sockets.latest(PATH).fail();
    expect(storage.values).toEqual({});
    // It goes before anything was dimmed: the retry stops, nothing to put back.
    expect(() => screen.restore()).not.toThrow();
    vi.advanceTimersByTime(120_000);
    expect(sockets.sockets).toHaveLength(2);
  });

  it('works with storage blocked, remembering for the page alone', () => {
    const sockets = createFakeWebSocket();
    const channel = createDisplayChannel({ wsOrigin: 'ws://tablet.local:8080', WebSocketImpl: sockets.WebSocketImpl as unknown as typeof WebSocket, visibility: null });
    const blocked: BrightnessMemory = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const screen = createSaverScreen(channel, blocked);
    screen.hold();
    const socket = sockets.latest(PATH);
    const tablet = decaid(socket, 100);
    tablet.answer();
    screen.restore();
    tablet.answer();
    expect(tablet.requested).toBe(100);
    expect(socket.closedByClient).toBe(true);
  });

  it('dispose() closes the socket and stops listening', () => {
    const { sockets, screen } = setup();
    screen.hold();
    const socket = sockets.latest(PATH);
    screen.dispose();
    expect(socket.closedByClient).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });
});
