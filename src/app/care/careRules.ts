/**
 * Machine care's reminders, as rules (D183, D184, D185): which
 * steps of the cleaning guide keep a last time, which of them come due and
 * when, the shots and steams since a step's count began, and which step is
 * the most overdue. Pure: the service (careService.ts) keeps the records and
 * Decaid's totals, the screens say it in words (src/ui/care/careWords.ts).
 */
import { parseDecaidTimestamp } from '../../api/time.ts';
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

/** Decaid's newest record of a kind, as Decaid gave it: its id, and when it began (local, no zone). */
export interface NewestRecord {
  id: string;
  at: string;
}

/** Decaid's totals as CafAI last read them (D185). */
export interface Totals {
  /** Every shot Decaid keeps (its shot list's total); null while unknown. */
  shots: number | null;
  /** Every steam record Decaid keeps (GET /api/v1/steams/ids); null while unknown, or on a Decaid without them. */
  steams: number | null;
  /** The newest shot and the newest steam (GET /api/v1/shots/latest, /steams/latest); null without one, or while its total is unknown. */
  newestShot: NewestRecord | null;
  newestSteam: NewestRecord | null;
}

export const UNKNOWN_TOTALS: Totals = { shots: null, steams: null, newestShot: null, newestSteam: null };

/** What a step's record keeps of Decaid's totals (D185): the totals, and the newest records' times, from when its count began. */
export type CareBaselines = Pick<CareRecord, 'shotTotal' | 'steamTotal' | 'newestShotAt' | 'newestSteamAt'>;

/** A record's baselines from totals read now. */
export function baselinesOf(totals: Totals): CareBaselines {
  return { shotTotal: totals.shots, steamTotal: totals.steams, newestShotAt: totals.newestShot?.at ?? null, newestSteamAt: totals.newestSteam?.at ?? null };
}

/**
 * Old shots Decaid took in between two readings (de1app's history, say),
 * among the ones pulled: baselines at or under `upTo`, the shot total of the
 * reading before, move up by `count` (D185).
 */
export interface ImportedShots {
  count: number;
  upTo: number;
}

/** Shots (or steams) since a step's count began: the total now less the one then; null while either is unknown. */
export function countSince(baseline: number | null, total: number | null): number | null {
  if (baseline === null || total === null) return null;
  return Math.max(0, total - baseline);
}

/**
 * Whether Decaid's newest record now began after the one it had then, both
 * Decaid's times, read alike on this device; null when either is unknown.
 * Never against CafAI's own clock: a phone in another zone, or a tablet whose
 * date is off, would read Decaid's times as earlier or later than they are.
 */
function newerThan(now: NewestRecord | null, then: string | null): boolean | null {
  if (now === null || then === null) return null;
  const nowMs = parseDecaidTimestamp(now.at);
  const thenMs = parseDecaidTimestamp(then);
  return Number.isFinite(nowMs) && Number.isFinite(thenMs) ? nowMs > thenMs : null;
}

interface Baseline {
  total: number | null;
  newestAt: string | null;
}

/**
 * A baseline brought up to date with fresh totals, or the same one: filled in
 * while unknown; started again from now when the total fell (records
 * deleted, another Decaid), or when records were added and none began after
 * Decaid's newest when the count began (old ones imported); moved up by the
 * old ones imported among new ones.
 */
function rebased(baseline: Baseline, total: number | null, newest: NewestRecord | null, imported: ImportedShots | null): Baseline {
  if (total === null) return baseline;
  const now = { total, newestAt: newest?.at ?? null };
  if (baseline.total === null || total < baseline.total) return now;
  const moved = imported !== null && imported.count > 0 && baseline.total <= imported.upTo ? Math.min(total, baseline.total + imported.count) : baseline.total;
  if (total > moved && newerThan(newest, baseline.newestAt) === false) return now;
  return { total: moved, newestAt: baseline.newestAt };
}

/** A record's baselines with fresh totals (D185), or null when they need no change. */
export function rebaseline(record: CareRecord, totals: Totals, importedShots: ImportedShots | null = null): CareBaselines | null {
  const shots = rebased({ total: record.shotTotal, newestAt: record.newestShotAt }, totals.shots, totals.newestShot, importedShots);
  // Decaid's de1app import brings shots only; steams come in only with a backup of a whole Decaid (D185).
  const steams = rebased({ total: record.steamTotal, newestAt: record.newestSteamAt }, totals.steams, totals.newestSteam, null);
  const next: CareBaselines = { shotTotal: shots.total, steamTotal: steams.total, newestShotAt: shots.newestAt, newestSteamAt: steams.newestAt };
  const same =
    next.shotTotal === record.shotTotal &&
    next.steamTotal === record.steamTotal &&
    next.newestShotAt === record.newestShotAt &&
    next.newestSteamAt === record.newestSteamAt;
  return same ? null : next;
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
