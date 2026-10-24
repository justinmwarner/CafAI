/**
 * How times and shots read (D245, D246) as live state, as the temperature
 * unit is (temperatureUnit.ts): the clock, 24-hour or 12-hour, and whether
 * shot cards and History show the TDS cell and the extraction. A change
 * shows on every screen at once and is saved with the other settings, so it
 * is mirrored to Decaid and exported like them.
 *
 * Neither reaches the coach or Decaid: Decaid keeps its wake times "HH:MM"
 * whatever the clock, and a TDS already given stays stored and goes to the
 * coach whether its cell shows or not (D246).
 */
import { DEFAULT_CLOCK } from '../storage/settings.ts';
import type { ClockFormat, Settings, SettingsRepository } from '../storage/types.ts';

/** The two choices as saved: either absent while none was made on this device. */
export type DisplayPrefsSaved = Pick<Settings, 'clock' | 'showTds'>;

export interface DisplayPrefsStore {
  /** The clock times are shown and typed in: DEFAULT_CLOCK, 24-hour, until one was chosen. */
  clock(): ClockFormat;
  /** Whether shot cards and History show the TDS cell and the extraction: on until turned off. */
  showTds(): boolean;
  subscribe(listener: () => void): () => void;
  /** Shows and saves a clock. A failed save rejects; the change stays on screen for this session. */
  setClock(next: ClockFormat): Promise<void>;
  /** Shows and saves the TDS cell's switch, as setClock. */
  setShowTds(next: boolean): Promise<void>;
  /** Re-reads both (after an import or a restore). */
  reload(): Promise<void>;
}

/** `initial`: the saved settings, or none (24-hour, the TDS cell shown). */
export function createDisplayPrefsStore(settings: SettingsRepository, initial: DisplayPrefsSaved = {}): DisplayPrefsStore {
  let clock = initial.clock ?? DEFAULT_CLOCK;
  let showTds = initial.showTds ?? true;
  // One count per field: a later change of a field made while an earlier one saves wins. Each save's
  // answer carries the other field too, as it stood then, and is never read for it.
  let latestClock = 0;
  let latestTds = 0;
  const listeners = new Set<() => void>();
  /** Shows what `saved` says of the fields named (absent: none chosen); listeners hear once, of a change only. */
  const show = (saved: DisplayPrefsSaved, fields: { clock: boolean; showTds: boolean }) => {
    const nextClock = fields.clock ? (saved.clock ?? DEFAULT_CLOCK) : clock;
    const nextTds = fields.showTds ? (saved.showTds ?? true) : showTds;
    if (nextClock === clock && nextTds === showTds) return;
    clock = nextClock;
    showTds = nextTds;
    for (const listener of [...listeners]) listener();
  };
  return {
    clock: () => clock,
    showTds: () => showTds,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async setClock(next) {
      const ticket = ++latestClock;
      show({ clock: next }, { clock: true, showTds: false });
      const saved = await settings.update({ clock: next });
      if (ticket === latestClock) show(saved, { clock: true, showTds: false });
    },
    async setShowTds(next) {
      const ticket = ++latestTds;
      show({ showTds: next }, { clock: false, showTds: true });
      const saved = await settings.update({ showTds: next });
      if (ticket === latestTds) show(saved, { clock: false, showTds: true });
    },
    async reload() {
      show(await settings.get(), { clock: true, showTds: true });
    },
  };
}
