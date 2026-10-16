/**
 * Decaid's sleep and wake settings for Settings > Sleep and wake (D157-D160):
 * read on mount (and by Retry) with GET /api/v1/presence/settings, each
 * change sent at once and shown as Decaid answers it, and the keep-awake
 * window read again after each change (below). None needs the machine:
 * they are Decaid's own settings, kept on its device.
 *
 * Sleep when idle is Decaid's idle sleep on and above 0 minutes (D158). Off
 * is 0 minutes, with Decaid's own switch (userPresenceEnabled) left on, so
 * the wake times still show on Decaid's own Sleep & Wake page and still go to
 * a Bengle's firmware; a wake time added or turned on while that switch is
 * off turns it on at 0 minutes first, which keeps the machine from sleeping
 * as before. The minutes it had are kept while the screen is open, so
 * turning Sleep when idle back on brings them back; otherwise Decaid's 30.
 *
 * The minutes show what was chosen while the write is on its way, as the
 * drink settings do (useDrinkPresets.ts), and go back to Decaid's if it
 * fails; the switches move once Decaid has answered. The dialog's adds,
 * changes and deletes are promises that throw with a sentence, for the
 * dialog to show.
 *
 * The keep-awake window ("A wake time keeps the machine awake until 07:30.")
 * is Decaid's keepAwakeUntil, which it works out afresh from the wake times
 * on every read and which no write's answer carries: after each change that
 * Decaid took, the settings are read again for it (D209).
 */
import { useEffect, useRef, useState } from 'react';
import {
  GatewayError,
  type PresencePatch,
  type PresenceSettings,
  type WakeSchedule,
  type WakeSchedulePatch,
  type WakeScheduleRequest,
} from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import { DEFAULT_SLEEP_MINUTES } from './wakeSchedule.ts';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** Said when a wake time was deleted elsewhere (Decaid's own page, another skin) since Settings read them. */
export const WAKE_TIME_GONE = 'That wake time is no longer in Decaid: it was deleted elsewhere.';

export interface PresenceView {
  /** Decaid's settings as last read or written; null until Decaid answers. */
  settings: PresenceSettings | null;
  /** Why reading them failed, until a Retry reads them. */
  loadError: string | null;
  retry(): void;
  /** Decaid puts the machine to sleep when nobody uses it: its switch on and more than 0 minutes. */
  sleepWhenIdle: boolean;
  /** Sleep when idle is on its way to Decaid. */
  sleepBusy: boolean;
  /** A change of the minutes is on its way. */
  minutesSaving: boolean;
  /** Why the last change of Sleep when idle failed, until the next one. */
  sleepError: string | null;
  /** Why the last change of the minutes failed, until the next one. */
  minutesError: string | null;
  /** Wake times whose switch is on its way, by id. */
  switching: ReadonlySet<string>;
  /** Why the last switch of a wake time failed, until the next one. */
  scheduleError: string | null;
  setSleepWhenIdle(on: boolean): void;
  setSleepAfter(minutes: number): void;
  setScheduleEnabled(schedule: WakeSchedule, enabled: boolean): void;
  addSchedule(request: WakeScheduleRequest): Promise<void>;
  updateSchedule(id: string, patch: WakeSchedulePatch): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
}

function isGone(error: unknown): boolean {
  return error instanceof GatewayError && error.status === 404;
}

export function usePresence(): PresenceView {
  const { decaid } = useServices();
  const [settings, setSettings] = useState<PresenceSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by Retry, and after a wake time turned out to be gone: reads the settings again. */
  const [reads, setReads] = useState(0);
  const [sleepBusy, setSleepBusy] = useState(false);
  const [sleepError, setSleepError] = useState<string | null>(null);
  const [minutesSaving, setMinutesSaving] = useState(0);
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<ReadonlySet<string>>(new Set());
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  /** The idle minutes last seen above 0, which Sleep when idle turned back on brings back. */
  const remembered = useRef(DEFAULT_SLEEP_MINUTES);
  /** The number of the newest change of the minutes, its changes on their way, and the value Decaid last held, which a failed newest change goes back to. */
  const minutesSaves = useRef({ newest: 0, inFlight: 0, settled: 0 });
  /** The number of the newest read of Decaid's settings: only its answer sets the keep-awake window. */
  const windowReads = useRef(0);
  /** Whether the section is still on screen, for a read of the window that answers after it has gone. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const number = ++windowReads.current;
    setLoadError(null);
    decaid
      .getPresenceSettings()
      .then((read) => {
        if (!live) return;
        if (read.sleepTimeoutMinutes > 0) remembered.current = read.sleepTimeoutMinutes;
        // A read sent after this one (after a change) says the window: this one keeps the window that read set, or will set.
        setSettings((now) => (now !== null && number !== windowReads.current ? { ...read, keepAwakeUntil: now.keepAwakeUntil } : read));
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setLoadError(`Could not read Decaid's sleep and wake settings: ${errorText(caught)}`);
        // The newest read of the window failed: a window Decaid may no longer hold does not stay (D209).
        if (number === windowReads.current) setSettings((now) => now && { ...now, keepAwakeUntil: null });
      });
    return () => {
      live = false;
    };
  }, [decaid, reads]);

  /**
   * Decaid's keep-awake window after a change it took (D209). No write's
   * answer carries keepAwakeUntil (presence_handler.dart:98-101, 182, 267
   * and 294 at aab5f93), and Decaid works it out afresh from the wake times
   * on every read, so the settings are read again for it. Only the window is
   * taken: the rest shows what CafAI wrote, and a change of the minutes may
   * still be on its way. Only the newest read sets it, and one that fails
   * takes the line away rather than leave a window Decaid may no longer hold.
   */
  const readWindow = () => {
    const number = ++windowReads.current;
    const settle = (keepAwakeUntil: string | null) => {
      if (mounted.current && number === windowReads.current) setSettings((now) => now && { ...now, keepAwakeUntil });
    };
    decaid.getPresenceSettings().then(
      (read) => settle(read.keepAwakeUntil ?? null),
      () => settle(null),
    );
  };

  /** Decaid's answer to a settings change: the two settings as it saved them. */
  const applySaved = (saved: Pick<PresenceSettings, 'userPresenceEnabled' | 'sleepTimeoutMinutes'>) => {
    if (saved.sleepTimeoutMinutes > 0) remembered.current = saved.sleepTimeoutMinutes;
    setSettings((now) => now && { ...now, userPresenceEnabled: saved.userPresenceEnabled, sleepTimeoutMinutes: saved.sleepTimeoutMinutes });
  };
  const sendSettings = async (patch: PresencePatch) => applySaved(await decaid.updatePresenceSettings(patch));
  /** Before a wake time is added or turned on: Decaid's own switch on, at 0 minutes when the idle sleep was off (D158). */
  const switchOnForWakes = async (current: PresenceSettings) => {
    if (!current.userPresenceEnabled) await sendSettings({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 });
  };
  const putSchedule = (schedule: WakeSchedule) =>
    setSettings((now) => now && { ...now, schedules: now.schedules.map((each) => (each.id === schedule.id ? schedule : each)) });
  const dropSchedule = (id: string) => setSettings((now) => now && { ...now, schedules: now.schedules.filter((each) => each.id !== id) });

  const sleepWhenIdle = settings !== null && settings.userPresenceEnabled && settings.sleepTimeoutMinutes > 0;

  const setSleepWhenIdle = (on: boolean) => {
    if (settings === null || sleepBusy || on === sleepWhenIdle) return;
    if (settings.sleepTimeoutMinutes > 0) remembered.current = settings.sleepTimeoutMinutes;
    const patch: PresencePatch = on
      ? settings.sleepTimeoutMinutes > 0
        ? { userPresenceEnabled: true }
        : { userPresenceEnabled: true, sleepTimeoutMinutes: remembered.current }
      : { sleepTimeoutMinutes: 0 };
    // A change of the minutes still on its way no longer decides what shows: this answer does.
    minutesSaves.current.newest += 1;
    setSleepBusy(true);
    setSleepError(null);
    setMinutesError(null);
    sendSettings(patch)
      .then(() => readWindow())
      .catch((caught: unknown) => setSleepError(`Could not change Sleep when idle: ${errorText(caught)}`))
      .finally(() => setSleepBusy(false));
  };

  const setSleepAfter = (minutes: number) => {
    if (settings === null || !sleepWhenIdle || minutes === settings.sleepTimeoutMinutes) return;
    const saves = minutesSaves.current;
    // With none on its way, the value before this change is the one Decaid holds.
    if (saves.inFlight === 0) saves.settled = settings.sleepTimeoutMinutes;
    const number = ++saves.newest;
    saves.inFlight += 1;
    setSettings((now) => now && { ...now, sleepTimeoutMinutes: minutes });
    setMinutesSaving((count) => count + 1);
    setMinutesError(null);
    setSleepError(null);
    decaid
      .updatePresenceSettings({ sleepTimeoutMinutes: minutes })
      .then((saved) => {
        saves.settled = saved.sleepTimeoutMinutes;
        // A newer change was sent: its own answer decides what the field shows, and reads the window.
        if (number !== saves.newest) return;
        applySaved(saved);
        readWindow();
      })
      .catch((caught: unknown) => {
        if (number !== saves.newest) return;
        setSettings((now) => now && { ...now, sleepTimeoutMinutes: saves.settled });
        setMinutesError(`Could not save the minutes: ${errorText(caught)}`);
      })
      .finally(() => {
        saves.inFlight -= 1;
        setMinutesSaving((count) => count - 1);
      });
  };

  const setScheduleEnabled = (schedule: WakeSchedule, enabled: boolean) => {
    if (settings === null || switching.has(schedule.id)) return;
    const current = settings;
    setSwitching((now) => new Set(now).add(schedule.id));
    setScheduleError(null);
    (async () => {
      if (enabled) await switchOnForWakes(current);
      putSchedule(await decaid.updateWakeSchedule(schedule.id, { enabled }));
      readWindow();
    })()
      .catch((caught: unknown) => {
        if (isGone(caught)) {
          setScheduleError(WAKE_TIME_GONE);
          setReads((count) => count + 1);
          return;
        }
        setScheduleError(`Could not turn the ${schedule.time} wake time ${enabled ? 'on' : 'off'}: ${errorText(caught)}`);
      })
      .finally(() =>
        setSwitching((now) => {
          const next = new Set(now);
          next.delete(schedule.id);
          return next;
        }),
      );
  };

  const addSchedule = async (request: WakeScheduleRequest) => {
    if (settings === null) return;
    try {
      if (request.enabled) await switchOnForWakes(settings);
      const added = await decaid.addWakeSchedule(request);
      setSettings((now) => now && { ...now, schedules: [...now.schedules, added] });
    } catch (caught) {
      throw new Error(`Could not add the wake time: ${errorText(caught)}`, { cause: caught });
    }
    // A wake time whose minute has just passed holds the machine awake at once.
    readWindow();
  };

  const updateSchedule = async (id: string, patch: WakeSchedulePatch) => {
    if (settings === null) return;
    try {
      if (patch.enabled === true) await switchOnForWakes(settings);
      putSchedule(await decaid.updateWakeSchedule(id, patch));
    } catch (caught) {
      if (isGone(caught)) {
        dropSchedule(id);
        readWindow();
        throw new Error(WAKE_TIME_GONE, { cause: caught });
      }
      throw new Error(`Could not save the wake time: ${errorText(caught)}`, { cause: caught });
    }
    readWindow();
  };

  const deleteSchedule = async (id: string) => {
    try {
      await decaid.deleteWakeSchedule(id);
    } catch (caught) {
      // Already gone is what a delete wants.
      if (!isGone(caught)) throw new Error(`Could not delete the wake time: ${errorText(caught)}`, { cause: caught });
    }
    dropSchedule(id);
    // Its window, if one ran, went with it.
    readWindow();
  };

  return {
    settings,
    loadError,
    retry: () => setReads((count) => count + 1),
    sleepWhenIdle,
    sleepBusy,
    minutesSaving: minutesSaving > 0,
    sleepError,
    minutesError,
    switching,
    scheduleError,
    setSleepWhenIdle,
    setSleepAfter,
    setScheduleEnabled,
    addSchedule,
    updateSchedule,
    deleteSchedule,
  };
}
