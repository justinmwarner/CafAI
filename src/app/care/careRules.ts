/**
 * Machine care's reminders, as rules (D183, D184, D185): which
 * steps of the cleaning guide keep a last time, which of them come due and
 * when, the shots and steams since a step's count began, and which step is
 * the most overdue. Pure: the service (careService.ts) keeps the records and
 * Decaid's totals, the screens say it in words (src/ui/care/careWords.ts).
 */
import type { CareRecord, CareSettings, WaterBand } from '../../storage/types.ts';

/**
 * The steps beyond Daily, by their ids in the guide (src/ui/care/careGuide.ts),
 * in its order: each keeps its last time and can be marked done. Daily's
 * steps are habits, done on the day, and keep neither.
 */
export const TRACKED_STEPS = [
  'detergent-clean',
  'rinza',
  'tank-tray',
  'intake-filter',
  'group-parts',
  'gasket',
  'descale',
  'steam-tip',
  'transport',
] as const;

export type TrackedStepId = (typeof TRACKED_STEPS)[number];

export function isTrackedStep(id: string): id is TrackedStepId {
  return (TRACKED_STEPS as readonly string[]).includes(id);
}

/** What the stats card's line counts for a step: its shots, its steams, or the time. */
export type CareCount = 'shots' | 'steams' | 'time';

/** When a step comes due (D184). */
export interface Reminder {
  /** Due once this many days have passed since its count began. */
  days: number;
  /** Or once this many shots were pulled since, whichever comes first. */
  shots?: number;
  /** Due only once the machine was used for it since: a shot leaves oils, a steam milk. */
  needs?: 'shot' | 'steam';
  counts: CareCount;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The descale, by Decent's water page: under 30 ppm, never; 30 to 120 ppm (or
 * not said), a year; over 120 ppm, at least twice a year. Its LSI table pairs
 * a year with 1,500 to 2,250 shots and six months with 800 to 1,200: the
 * earlier end of each, whichever comes first.
 */
export function descaleReminder(water: WaterBand | null): Reminder | null {
  if (water === 'under30') return null;
  if (water === 'over120') return { days: 182, shots: 800, counts: 'time' };
  return { days: 365, shots: 1500, counts: 'time' };
}

/**
 * The reminder of a step, or null for one without (D183): the tank and
 * drip tray are in plain sight, the gasket is looked at with the group head's
 * parts, the steam tip waits for a clog and the transport for a move.
 */
export function reminderFor(step: TrackedStepId, settings: CareSettings): Reminder | null {
  switch (step) {
    case 'detergent-clean':
      return { days: 7, needs: 'shot', counts: 'shots' };
    case 'rinza':
      return { days: 7, needs: 'steam', counts: 'steams' };
    case 'intake-filter':
      // V1 every week or two, V2 at least monthly; not said, as V1, the more often.
      return { days: settings.filter === 'v2' ? 30 : 14, counts: 'time' };
    case 'group-parts':
      // "Every two to four weeks": the quieter end.
      return { days: 28, needs: 'shot', counts: 'time' };
    case 'descale':
      return descaleReminder(settings.water);
    default:
      return null;
  }
}

/** Decaid's totals as CafAI last read them (D185). */
export interface Totals {
  /** Every shot Decaid keeps (GET /api/v1/shots?limit=1, its total); null while unknown. */
  shots: number | null;
  /** Every steam record Decaid keeps (GET /api/v1/steams/ids); null while unknown, or on a Decaid without them. */
  steams: number | null;
  /** When the newest shot and the newest steam began, epoch ms; null while unknown, or without one. */
  newestShotMs: number | null;
  newestSteamMs: number | null;
}

export const UNKNOWN_TOTALS: Totals = { shots: null, steams: null, newestShotMs: null, newestSteamMs: null };

/** Shots (or steams) since a step's count began: the total now less the one then; null while either is unknown. */
export function countSince(baseline: number | null, total: number | null): number | null {
  if (baseline === null || total === null) return null;
  return Math.max(0, total - baseline);
}

/**
 * A baseline brought up to date with fresh totals, or the same one: filled in
 * while unknown; started again from now when the total fell (shots deleted,
 * another Decaid) or when every record that is new since is older than the
 * count's start (old ones imported).
 */
function rebased(baseline: number | null, total: number | null, newestMs: number | null, fromMs: number): number | null {
  if (total === null) return baseline;
  if (baseline === null || total < baseline) return total;
  if (total > baseline && newestMs !== null && newestMs < fromMs) return total;
  return baseline;
}

/** A record's baselines with fresh totals (D185), or null when they need no change. */
export function rebaseline(record: CareRecord, totals: Totals): Pick<CareRecord, 'shotTotal' | 'steamTotal'> | null {
  const fromMs = Date.parse(record.countFrom);
  const shotTotal = rebased(record.shotTotal, totals.shots, totals.newestShotMs, fromMs);
  const steamTotal = rebased(record.steamTotal, totals.steams, totals.newestSteamMs, fromMs);
  return shotTotal === record.shotTotal && steamTotal === record.steamTotal ? null : { shotTotal, steamTotal };
}

/** A step as it stands now. */
export interface StepStatus {
  step: TrackedStepId;
  /** Null until CafAI first counted it. */
  record: CareRecord | null;
  reminder: Reminder | null;
  /** Days since its count began; null without a record. */
  days: number | null;
  /** Since its count began; null while unknown. */
  shots: number | null;
  steams: number | null;
  /** Whether the machine was used for it since its count began; true while that is unknown, so the days decide. */
  used: boolean;
  /** How much of its interval has passed, the larger of days and shots; null without a reminder or a record. */
  share: number | null;
  due: boolean;
  /** When its days run out, epoch ms; null without a reminder or a record. */
  dueAtMs: number | null;
}

export function stepStatus(step: TrackedStepId, record: CareRecord | null, settings: CareSettings, totals: Totals, nowMs: number): StepStatus {
  const reminder = reminderFor(step, settings);
  const fromMs = record ? Date.parse(record.countFrom) : NaN;
  const known = record !== null && Number.isFinite(fromMs);
  const days = known ? Math.max(0, nowMs - fromMs) / DAY_MS : null;
  const shots = record ? countSince(record.shotTotal, totals.shots) : null;
  const steams = record ? countSince(record.steamTotal, totals.steams) : null;
  const sinceUse = reminder?.needs === 'shot' ? shots : reminder?.needs === 'steam' ? steams : null;
  const used = sinceUse === null || sinceUse > 0;
  let share: number | null = null;
  if (reminder && days !== null) {
    share = days / reminder.days;
    if (reminder.shots !== undefined && shots !== null) share = Math.max(share, shots / reminder.shots);
  }
  const dueAtMs = reminder && known ? fromMs + reminder.days * DAY_MS : null;
  return { step, record, reminder, days, shots, steams, used, share, due: share !== null && share >= 1 && used, dueAtMs };
}

/** The step due the longest, by the share of its interval past; ties in the guide's order. Null when none is due. */
export function mostOverdue(statuses: readonly StepStatus[]): StepStatus | null {
  let worst: StepStatus | null = null;
  for (const status of statuses) {
    if (!status.due || status.share === null) continue;
    if (worst === null || status.share > (worst.share ?? 0)) worst = status;
  }
  return worst;
}

/** Every tracked step's status, in the guide's order. */
export function allStatuses(records: ReadonlyMap<string, CareRecord>, settings: CareSettings, totals: Totals, nowMs: number): StepStatus[] {
  return TRACKED_STEPS.map((step) => stepStatus(step, records.get(step) ?? null, settings, totals, nowMs));
}
