/**
 * When a screensaver covers CafAI (D223) and how far it dims the
 * tablet (D224), as pure functions of what the overlay knows: the
 * design's section 3, row by row
 * (docs/superpowers/specs/2026-10-22-screensavers-design.md).
 *
 * Only inside Decaid's WebView, whose display Decaid drives: CafAI open on
 * a phone or a computer never shows one by itself (Preview shows anywhere,
 * and is the overlay's business, not this file's). Only while Decaid
 * confirms the machine asleep, from its frames, never from CafAI's own
 * commands: a machine that is off or not connected never raises one, and
 * Android's own timeout applies then, as it always did. And only once
 * nothing has touched the screen for a minute, so a barista who taps Sleep
 * and goes on reading is left to read.
 *
 * Settings > Screensaver can choose the wait (1, 2, 5, 10 or 15 minutes)
 * and the brightness (10 to 60) instead (D247); without a choice they are
 * the minute and the 30 here.
 */
import type { TelemetryState } from '../../api/types.ts';
import type { ScreensaverSetting } from '../../storage/types.ts';

/** Asleep and untouched this long, unless Settings chose another wait (D247): the screensaver comes up. */
export const SAVER_IDLE_MS = 60_000;

/** Then this long animating, dimmed and held on; after it, black, and the wake lock let go. */
export const SAVER_SHOW_MS = 30 * 60_000;

/** The brightness it dims to, on Decaid's 0-100, unless Settings chose another (D247) or the barista's own is lower. */
export const SAVER_BRIGHTNESS = 30;

/**
 * Decaid's word that the machine sleeps must stand this long first. Across a
 * dropped link the store keeps the last frame, which goes on saying asleep
 * when the machine comes back until a fresh frame arrives, well within this;
 * a machine that came back awake would otherwise flash the screensaver up.
 */
export const SAVER_SETTLE_MS = 3_000;

export interface SaverInputs {
  /** Settings > Screensaver's switch. */
  on: boolean;
  /** CafAI runs inside Decaid's WebView (services.host.insideDecaid). */
  insideDecaid: boolean;
  /** confirmedAsleep() of the telemetry. */
  asleep: boolean;
  /** Since the last pointerdown or keydown on the window (the events the heartbeat counts), or the page's load. */
  untouchedMs: number;
  /** How long `asleep` has been true without a break. */
  asleepMs: number;
  /** How long untouched it waits: saverIdleMs() of the setting. */
  idleMs: number;
}

/** How long untouched before it comes up (D223, D247): the minutes chosen in Settings, else SAVER_IDLE_MS. */
export function saverIdleMs(setting: Pick<ScreensaverSetting, 'startAfterMinutes'>): number {
  const minutes = setting.startAfterMinutes;
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : SAVER_IDLE_MS;
}

/** The brightness it dims to (D224, D247): the one chosen in Settings, within Decaid's 0-100, else SAVER_BRIGHTNESS. */
export function saverBrightness(setting: Pick<ScreensaverSetting, 'dimTo'>): number {
  const level = setting.dimTo;
  return typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : SAVER_BRIGHTNESS;
}

/** Whether the screensaver should be up now. */
export function saverWanted(inputs: SaverInputs): boolean {
  return msUntilWanted(inputs) === 0;
}

/**
 * How long until the screensaver comes up if nothing else changes: 0 when it
 * should be up now, null while time alone cannot bring it (off, outside
 * Decaid, the machine not confirmed asleep).
 */
export function msUntilWanted(inputs: SaverInputs): number | null {
  if (!inputs.on || !inputs.insideDecaid || !inputs.asleep) return null;
  const untouched = Number.isFinite(inputs.untouchedMs) ? inputs.untouchedMs : 0;
  const asleepFor = Number.isFinite(inputs.asleepMs) ? inputs.asleepMs : 0;
  const idle = Number.isFinite(inputs.idleMs) ? inputs.idleMs : SAVER_IDLE_MS;
  return Math.max(0, idle - untouched, SAVER_SETTLE_MS - asleepFor);
}

/**
 * Confirmed asleep: the machine connected, Decaid reachable, and `sleeping`
 * the state its frames last said. While Decaid is out of reach the store
 * keeps its last word, which is no news, so that never counts.
 */
export function confirmedAsleep(telemetry: Pick<TelemetryState, 'machineConnected' | 'unreachable' | 'machine'>): boolean {
  return telemetry.machineConnected && !telemetry.unreachable && telemetry.machine?.state?.state === 'sleeping';
}

/** The brightness to dim to: `level` (SAVER_BRIGHTNESS unless Settings chose one, D247), or the barista's own when it is lower. */
export function dimTo(requestedBrightness: number, level: number = SAVER_BRIGHTNESS): number {
  if (!Number.isFinite(requestedBrightness)) return level;
  return Math.max(0, Math.min(level, Math.round(requestedBrightness)));
}
