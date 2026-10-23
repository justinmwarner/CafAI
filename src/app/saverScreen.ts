/**
 * The tablet's screen while a screensaver shows (D-SAVER-2), through
 * Decaid's display socket (src/api/display.ts), inside Decaid only:
 *
 * - hold(), as it comes up: from Decaid's first frame, remember the
 *   brightness asked for (in this device's storage, so a page unloaded while
 *   dimmed can put it back), unless one is remembered already; dim to 30, or
 *   leave a lower brightness where it is; and take the wake lock, which
 *   Decaid lets go of itself while the machine sleeps, so without one
 *   Android's timeout would blank the screen within minutes. Each new
 *   opening of the socket asks for both again: the lock went with the old
 *   socket.
 * - release(), 30 minutes on: close the socket, which lets the wake lock go,
 *   so Android's own timeout turns the screen off. The dim stays.
 * - restore(), as it goes, and at start with a value left over: open the
 *   socket if it is closed, put the remembered brightness back (100 hands it
 *   back to Android), let the lock go, forget the value once Decaid's frame
 *   shows it back, and close the socket. Nothing remembered and no socket
 *   open: nothing to do, so a start with nothing left over opens nothing.
 *
 * A socket that fails changes nothing on screen: the screensaver shows, only
 * not dimmed and not held on. Like the heartbeat, presence is a nicety,
 * never worth an error.
 */
import type { DisplayChannel } from '../api/display.ts';
import { dimTo } from '../ui/saver/policy.ts';

/** Where the brightness asked for before the dim is kept while it lasts. */
export const SAVER_BRIGHTNESS_KEY = 'cafai.saver.brightness';

/** The part of this device's storage the screen needs (localStorage). */
export interface BrightnessMemory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaverScreen {
  /** The screensaver came up, or starts over: remember, dim, hold on. */
  hold(): void;
  /** Its 30 minutes are over: let the wake lock go, keep the dim. */
  release(): void;
  /** It went (or CafAI starts with a dim left over): put the brightness back, let go, forget. */
  restore(): void;
  /** Stops listening and closes the socket. */
  dispose(): void;
}

type Goal = 'none' | 'hold' | 'release' | 'restore';

function readBrightness(text: string | null): number | null {
  if (text === null || !/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return value >= 0 && value <= 100 ? value : null;
}

export function createSaverScreen(channel: DisplayChannel, storage: BrightnessMemory | null): SaverScreen {
  let remembered: number | null = null;
  try {
    remembered = readBrightness(storage?.getItem(SAVER_BRIGHTNESS_KEY) ?? null);
  } catch {
    // Storage blocked: remembered for this page only.
  }
  let goal: Goal = 'none';
  // What this opening of the socket has been sent already.
  let locked = false;
  let dimmed = false;
  let putBack = false;

  function remember(value: number): void {
    remembered = value;
    try {
      storage?.setItem(SAVER_BRIGHTNESS_KEY, String(value));
    } catch {
      // Storage blocked or full: remembered for this page only.
    }
  }

  function forget(): void {
    remembered = null;
    try {
      storage?.removeItem(SAVER_BRIGHTNESS_KEY);
    } catch {
      // Storage blocked: nothing was kept there.
    }
  }

  function act(): void {
    if (goal === 'hold') {
      if (!channel.isOpen()) return;
      if (!locked) locked = channel.send({ command: 'requestWakeLock' });
      const state = channel.state();
      if (state === null) return;
      if (remembered === null) remember(state.requestedBrightness);
      if (!dimmed) {
        const target = dimTo(state.requestedBrightness);
        dimmed = target === state.requestedBrightness || channel.send({ command: 'setBrightness', brightness: target });
      }
      return;
    }
    if (goal === 'restore') {
      if (!channel.isOpen()) return;
      const state = channel.state();
      if (state === null) return;
      if (remembered !== null && state.requestedBrightness !== remembered) {
        if (!putBack) {
          putBack = channel.send({ command: 'setBrightness', brightness: remembered });
          if (putBack && state.wakeLockOverride) channel.send({ command: 'releaseWakeLock' });
        }
        // Forgotten once a frame shows it back; a reconnect meanwhile sends it again.
        return;
      }
      // Back where it was, or nothing to put back: let go of the lock (closing does too) and close.
      if (state.wakeLockOverride) channel.send({ command: 'releaseWakeLock' });
      forget();
      goal = 'none';
      channel.want(false);
    }
  }

  const unsubscribe = channel.subscribe((event) => {
    if (event === 'open') {
      locked = false;
      dimmed = false;
      putBack = false;
    }
    act();
  });

  return {
    hold() {
      goal = 'hold';
      channel.want(true);
      act();
    },
    release() {
      goal = 'release';
      if (channel.isOpen()) channel.send({ command: 'releaseWakeLock' });
      channel.want(false);
    },
    restore() {
      if (remembered === null && !channel.isOpen()) {
        // Nothing dimmed and nothing held: no socket to open for it.
        goal = 'none';
        channel.want(false);
        return;
      }
      goal = 'restore';
      putBack = false;
      channel.want(true);
      act();
    },
    dispose() {
      unsubscribe();
      goal = 'none';
      channel.want(false);
    },
  };
}
