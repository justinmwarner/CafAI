/**
 * The status line under each of Settings' group rows, and its dot (D236):
 * how the group stands, read from what the screens already read, and
 * whether something there needs the barista. The words always say it too:
 * the dot is never the only signal.
 *
 * | Group | Says | Dot |
 * |---|---|---|
 * | Coach | "Opus 5.5 · $1.84 this month"; "On your computer · Opus 5.5" | "No key yet", "Not set up yet", "Paused: budget reached" |
 * | Grinder | "Niche Zero · 14"; "Not set yet" | never |
 * | Drinks | "Steam 50 s · Water 50 ml · Flush 10 s" | never |
 * | Machine | "Sleeps after 30 min · Next wake 06:30"; "Never sleeps" | "Descale due" (a care step due, reminders on) |
 * | Display | "Dark · Crema · °C", " · 12-hour" when chosen | never |
 * | Data and privacy | "Backed up 5 min ago"; "Not backed up yet" | "Backup paused" |
 * | About | "CafAI 0.1.3 · Decaid 0.9.0" | "Decaid 0.8.6 is older than checked", "Decaid sent something unexpected" |
 *
 * A line with nothing live to say yet says the group's plain contents
 * (groups.tsx). Nothing here asks Decaid for anything, and nothing polls:
 * the coach's state, where it runs, the spend, the care service, the
 * appearance, temperature and display stores, the mirror's backup status,
 * Decaid's version (asked as Settings opens, decaidVersion.ts) and the drift
 * log are live already; the settings come through Settings' own cards, and
 * the drinks and the sleep and wake settings are what the Drinks and Machine
 * groups last read in this page's life (statusReads.ts).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { driftLog } from '../../api/drift.ts';
import { VERIFIED_DECAID } from '../../api/decaidVersion.ts';
import type { PresenceSettings } from '../../api/types.ts';
import type { TrackedStepId } from '../../app/care/careRules.ts';
import { useAppearance, useClockFormat, useCoach, useServices, useTemperatureUnit } from '../../app/services.tsx';
import type { TemperatureUnit } from '../../coach/temperature.ts';
import { modelInfo, resolveModel } from '../../llm/models.ts';
import { formatUsd } from '../../spend/budget.ts';
import { useSpendSummary } from '../../spend/useSpend.ts';
import { DEFAULT_COACH_SOURCE, normalizeAddress, normalizeCode, type CoachSource } from '../../storage/coachSource.ts';
import type { Appearance, ClockFormat, Settings } from '../../storage/types.ts';
import { LINE_NAMES } from '../care/careWords.ts';
import { useDueStep } from '../care/useCare.ts';
import { formatTime } from '../clock.ts';
import { DEFAULT_TINT_ID, namedTint, TINTS } from '../palette.ts';
import { isOlderDecaid } from './AboutDecaid.tsx';
import { backupHealthText, useBackupStatus, useMinuteClock, type BackupStatus } from './BackupCard.tsx';
import { useDecaidVersion } from './decaidVersion.ts';
import { fieldValue, type Presets } from './DrinkFields.tsx';
import { isDrinkOff, steamTemperatureField } from './drinkSettings.ts';
import { SETTINGS_GROUP_IDS, type SettingsGroupId } from './groupIds.ts';
import { settingsGroup } from './groups.tsx';
import { useKeptDrinkPresets, useKeptPresence, useWatchedSettings } from './statusReads.ts';
import { formatMinutes, nextWake, WEEKDAYS } from './wakeSchedule.ts';

export interface GroupStatus {
  /** One line, cut with an ellipsis where it is too long for the row. */
  line: string;
  /** Something in the group needs the barista: the row shows a dot beside the words that say what. */
  attention: boolean;
}

export type GroupStatuses = Readonly<Record<SettingsGroupId, GroupStatus>>;

const says = (line: string): GroupStatus => ({ line, attention: false });
const needs = (line: string): GroupStatus => ({ line, attention: true });

export interface CoachFacts {
  /** Where the coach runs, as saved; null until it has been read. */
  source: CoachSource | null;
  /** The coach has read its key (or the bridge's code) at least once. */
  keyKnown: boolean;
  /** It has one: on Anthropic, the API key. */
  hasKey: boolean;
  /** The model's name ("Opus 5.5"); null until the settings are read. */
  model: string | null;
  /** This month's estimated spend on the API key, in millionths of a dollar; null without the spend service. */
  monthMicros: number | null;
  /** The budget pauses the coach now (D240). */
  paused: boolean;
}

/** The bridge can be asked: its address and its code both read as CafAI Bridge's (coachAccess.ts' activeCredential). */
function bridgeSetUp(source: CoachSource): boolean {
  return normalizeAddress(source.address).ok && normalizeCode(source.code).ok;
}

export function coachStatus(facts: CoachFacts): GroupStatus | null {
  const { source, model } = facts;
  if (source === null || model === null) return null;
  // The Claude plan pays on the computer: no key, no prices, no budget there.
  if (source.kind === 'computer') return bridgeSetUp(source) ? says(`On your computer · ${model}`) : needs('Not set up yet');
  if (!facts.keyKnown) return null;
  if (!facts.hasKey) return needs('No key yet');
  if (facts.paused) return needs('Paused: budget reached');
  return says(facts.monthMicros === null ? model : `${model} · ${formatUsd(facts.monthMicros)} this month`);
}

export function grinderStatus(settings: Pick<Settings, 'grinderName' | 'grinderSetting'> | null): GroupStatus | null {
  if (settings === null) return null;
  const name = settings.grinderName?.trim() || null;
  const setting = settings.grinderSetting?.trim() || null;
  if (name && setting) return says(`${name} · ${setting}`);
  if (name) return says(name);
  if (setting) return says(`Setting ${setting}`);
  return says('Not set yet');
}

/** A whole number for the line: Decaid's own may carry a fraction. */
const whole = (value: number) => String(Math.round(value));

export function drinksStatus(presets: Presets | null): GroupStatus | null {
  if (presets === null) return null;
  const parts: string[] = [];
  const temperature = fieldValue(presets.steamSettings, 'targetTemperature');
  const steam = fieldValue(presets.steamSettings, 'duration');
  // Below its heater's range steam is off in Decaid, as its card says.
  if (temperature !== null && isDrinkOff(steamTemperatureField(null), temperature)) parts.push('Steam off');
  else if (steam !== null) parts.push(`Steam ${whole(steam)} s`);
  const water = fieldValue(presets.hotWaterData, 'volume');
  if (water !== null) parts.push(`Water ${whole(water)} ml`);
  const flush = fieldValue(presets.rinseData, 'duration');
  if (flush !== null) parts.push(`Flush ${whole(flush)} s`);
  return parts.length > 0 ? says(parts.join(' · ')) : null;
}

export interface MachineFacts {
  /** The most overdue care step while its reminders are on (useDueStep), or null. */
  dueStep: TrackedStepId | null;
  /** Decaid's sleep and wake settings as Settings > Machine last read them; null before. */
  presence: PresenceSettings | null;
  clock: ClockFormat;
  now: Date;
}

/** Calendar days from `now`'s day to `at`'s. */
function daysAhead(now: Date, at: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** "06:30" today or tomorrow; the day's short name beyond: "Mon 06:30". */
function wakeWhen(at: Date, now: Date, clock: ClockFormat): string {
  const time = formatTime(at, clock);
  if (daysAhead(now, at) <= 1) return time;
  return `${WEEKDAYS[(at.getDay() + 6) % 7]?.short ?? ''} ${time}`.trim();
}

export function machineStatus({ dueStep, presence, clock, now }: MachineFacts): GroupStatus | null {
  if (dueStep !== null) {
    const name = (LINE_NAMES as Partial<Record<TrackedStepId, string>>)[dueStep] ?? 'Machine care';
    return needs(`${name} due`);
  }
  if (presence === null) return null;
  // Sleep when idle is Decaid's idle sleep on and above 0 minutes (D158).
  const sleeps = presence.userPresenceEnabled && presence.sleepTimeoutMinutes > 0 ? `Sleeps after ${formatMinutes(presence.sleepTimeoutMinutes)}` : 'Never sleeps';
  const next = nextWake(presence.schedules, now);
  return says(next ? `${sleeps} · Next wake ${wakeWhen(next.at, now, clock)}` : sleeps);
}

const MODE_NAMES: Readonly<Record<Appearance['mode'], string>> = { dark: 'Dark', light: 'Light', auto: 'Auto' };

export function displayStatus({ appearance, unit, clock }: { appearance: Appearance; unit: TemperatureUnit; clock: ClockFormat }): GroupStatus {
  const tint =
    typeof appearance.tint === 'string'
      ? // A tint this build does not know is drawn as the default (resolveTint), so it is named as that too.
        (TINTS.find((each) => each.id === appearance.tint) ?? namedTint(DEFAULT_TINT_ID)).name
      : 'Custom';
  const parts = [MODE_NAMES[appearance.mode] ?? MODE_NAMES.dark, tint, unit === 'fahrenheit' ? '°F' : '°C'];
  if (clock === '12h') parts.push('12-hour');
  return says(parts.join(' · '));
}

export function dataStatus(backup: BackupStatus, now: number): GroupStatus | null {
  // Why it is paused is the card's to say: the row has room for the fact.
  if (backup.lastError) return needs('Backup paused');
  const health = backupHealthText(backup, now);
  return health === null ? null : says(health.replace(/^Backed up to Decaid /, 'Backed up '));
}

/** "0.9.0" of "0.9.0+2850": the build is About's to say. */
function releaseOf(version: string): string {
  return /^\d+\.\d+\.\d+/.exec(version)?.[0] ?? version;
}

export function aboutStatus({ appVersion, decaidVersion, drift }: { appVersion: string; decaidVersion: string | null; drift: number }): GroupStatus {
  if (decaidVersion !== null && isOlderDecaid(decaidVersion, VERIFIED_DECAID.release)) return needs(`Decaid ${releaseOf(decaidVersion)} is older than checked`);
  if (drift > 0) return needs('Decaid sent something unexpected');
  return says(decaidVersion !== null ? `CafAI ${appVersion} · Decaid ${releaseOf(decaidVersion)}` : `CafAI ${appVersion}`);
}

/**
 * Where the coach runs as saved, and every choice saved from now on; null
 * until read (or when it cannot be). Without the store (fakes, previews) the
 * coach runs on Anthropic.
 */
function useSavedCoachSource(): CoachSource | null {
  const { coachSource } = useServices();
  const [source, setSource] = useState<CoachSource | null>(coachSource ? null : { ...DEFAULT_COACH_SOURCE });
  useEffect(() => {
    if (!coachSource) return undefined;
    let live = true;
    // A choice saved while the first read is out is newer than its answer.
    let heard = false;
    coachSource.get().then(
      (saved) => {
        if (live && !heard) setSource(saved);
      },
      () => undefined,
    );
    const stop = coachSource.subscribe((saved) => {
      heard = true;
      if (live) setSource(saved);
    });
    return () => {
      live = false;
      stop();
    };
  }, [coachSource]);
  return source;
}

/** The model's name as the list shows it: the catalog's label, a former model's, or the id as typed. */
function modelName(models: ReturnType<typeof useServices>['models'], saved: string): string {
  const id = resolveModel(saved);
  return models.find((model) => model.id === id)?.label ?? modelInfo(id).label;
}

/**
 * Every group's status line and dot, worked out once for the whole list
 * (SettingsList.tsx), each row described by its own.
 */
export function useGroupStatuses(): GroupStatuses {
  const { models, spend, appVersion, storage } = useServices();
  const settings = useWatchedSettings();
  const source = useSavedCoachSource();
  const keyKnown = useCoach((state) => state.ready);
  const hasKey = useCoach((state) => state.hasApiKey);
  const summary = useSpendSummary();
  const presets = useKeptDrinkPresets();
  const presence = useKeptPresence();
  const due = useDueStep();
  const appearance = useAppearance();
  const unit = useTemperatureUnit();
  const clock = useClockFormat();
  const backup = useBackupStatus(storage.mirror);
  const now = useMinuteClock();
  // Settings asks it as it opens (SettingsScreen.tsx); one request answers both.
  const decaidVersion = useDecaidVersion();
  const drift = useSyncExternalStore(driftLog.subscribe, driftLog.list);

  const live: Record<SettingsGroupId, GroupStatus | null> = {
    coach: coachStatus({
      source,
      keyKnown,
      hasKey,
      model: settings ? modelName(models, settings.model) : null,
      monthMicros: summary ? summary.anthropic.month.costMicros : null,
      // The spend summary above re-renders the list as the month's spend moves.
      paused: settings !== null && spend !== undefined && spend.budget(settings.coachBudget).paused,
    }),
    grinder: grinderStatus(settings),
    drinks: drinksStatus(presets),
    machine: machineStatus({ dueStep: due?.status.step ?? null, presence, clock, now: new Date(now) }),
    display: displayStatus({ appearance, unit, clock }),
    data: dataStatus(backup, now),
    about: aboutStatus({ appVersion, decaidVersion, drift: drift.length }),
  };
  return Object.fromEntries(SETTINGS_GROUP_IDS.map((id) => [id, live[id] ?? says(settingsGroup(id).contents)])) as GroupStatuses;
}
