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
 *   back to Android), let the lock go, forget the value once a frame Decaid
 *   sent after that shows it back, and close the socket. Nothing remembered
 *   and no socket open: nothing to do, so a start with nothing left over
 *   opens nothing.
 *
 * Decaid's frames trail the commands: a dim just sent is not in the last
 * frame yet. So what was asked for on this opening counts, not only what the
 * last frame says: once a dim has gone out, restore() always sends the
 * barista's brightness after it (a restore right behind a hold would
 * otherwise see their brightness still in the frame, send nothing, and leave
 * the dim to land after it), and a hold() right behind a restore() dims again
 * though the frame still shows the dim.
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
  // On this opening of the socket: the wake lock asked for, the brightness last asked for, and Decaid's frames, counted.
  let locked = false;
  let commanded: number | null = null;
  let frames = 0;
  /** `frames` when `commanded` was sent: a frame after it may show it. */
  let commandedAt = 0;

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

  function setBrightness(value: number): boolean {
    if (!channel.send({ command: 'setBrightness', brightness: value })) return false;
    commanded = value;
    commandedAt = frames;
    return true;
  }

  function releaseLock(): void {
    channel.send({ command: 'releaseWakeLock' });
    locked = false;
  }

  function act(): void {
    if (!channel.isOpen()) return;
    if (goal === 'hold') {
      if (!locked) locked = channel.send({ command: 'requestWakeLock' });
      const state = channel.state();
      if (state === null) return;
      if (remembered === null) remember(state.requestedBrightness);
      const target = dimTo(remembered ?? state.requestedBrightness);
      // Asked for already on this opening, or Decaid there already with nothing else on its way.
      if (commanded === target || (commanded === null && state.requestedBrightness === target)) return;
      setBrightness(target);
      return;
    }
    if (goal === 'restore') {
      const state = channel.state();
      if (state === null) return;
      // Something asked for on this opening may still be on its way, whatever the last frame says.
      if (remembered !== null && (commanded !== null || state.requestedBrightness !== remembered)) {
        if (commanded !== remembered) {
          if (!setBrightness(remembered)) return;
          if (locked || state.wakeLockOverride) releaseLock();
        }
        // Forgotten once a frame sent after it shows it back; a reconnect meanwhile sends it again.
        if (frames === commandedAt || state.requestedBrightness !== remembered) return;
      }
      // Back where it was, or nothing to put back: let go of the lock (closing does too) and close.
      if (state.wakeLockOverride) releaseLock();
      forget();
      goal = 'none';
      channel.want(false);
    }
  }

  const unsubscribe = channel.subscribe((event) => {
    if (event === 'open') {
      locked = false;
      commanded = null;
      frames = 0;
      commandedAt = 0;
    }
    if (event === 'state') frames += 1;
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
      if (channel.isOpen()) releaseLock();
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
