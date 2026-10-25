/**
 * The coach's token use and estimated cost (D237-D240): what is counted,
 * how it is kept, and what Settings > Coach > Usage and cost reads.
 *
 * Every response the coach is billed for is counted from the usage Anthropic
 * reports at the end of its stream (message_done): each request of a reply's
 * tool loop, a retry that reached the API, the bag photo. Counts are kept per
 * day, device, source, model and kind on this device (store.ts) and shared
 * through Decaid's store (sync.ts), so the totals add every device that uses
 * the same Decaid, as the bill does. Token counts and dollars only: never any
 * text, never a secret, never in the export.
 */
import type { LlmUsage } from '../llm/types.ts';
import type { CoachBudget } from '../storage/types.ts';

/** What a request was for: a reply to the barista, the reply after a credited shot, or reading a photo of the bag. */
export type SpendKind = 'reply' | 'shot' | 'photo';

/** Who answered it: Anthropic on the API key (billed), or CafAI Bridge on the user's computer (the Claude plan). */
export type SpendSource = 'anthropic' | 'computer';

/** One finished request, as the coach's provider saw it end (coachAccess.ts). */
export interface SpendCount {
  at: Date;
  source: SpendSource;
  model: string;
  kind: SpendKind;
  /** Which model call of its reply it was: 0 for the first (a new reply), up to 5 in a tool loop. */
  call: number;
  usage: LlmUsage;
}

/** One day's counts for one device, source, model and kind: what is stored, and copied to Decaid. */
export interface SpendRecord {
  /** 'YYYY-MM-DD', the device's local calendar day. */
  day: string;
  /** The device that counted it (store.ts's spendDeviceId). */
  device: string;
  source: SpendSource;
  model: string;
  kind: SpendKind;
  requests: number;
  /** Requests that began a reply (call 0), to the barista or after a shot; a bag photo's read is none. */
  replies: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  /** Estimated cost in millionths of a dollar, web searches included; requests of an unknown price count 0 here and in `unpriced`. */
  costMicros: number;
  webSearchMicros: number;
  unpriced: number;
}

export interface SpendTotals {
  costMicros: number;
  /** Everything sent and received: input, cache reads and writes, output. */
  tokens: number;
  requests: number;
  replies: number;
  webSearches: number;
}

export interface SpendPeriod extends SpendTotals {
  /** Each day of the period that has records, oldest first. */
  days: Array<{ day: string; costMicros: number; tokens: number }>;
  /** Cost by what it went on; web searches apart from the kinds. */
  byKind: { reply: number; shot: number; photo: number; web: number };
}

export interface SpendSummary {
  /** 'YYYY-MM', local. */
  month: string;
  /** Today, this month, last month and all time, for each source: dollars for the API key, the API price of the same tokens for the computer. */
  anthropic: { today: SpendTotals; month: SpendPeriod; lastMonth: SpendTotals; allTime: SpendTotals };
  computer: { today: SpendTotals; month: SpendPeriod; lastMonth: SpendTotals; allTime: SpendTotals };
  /** Models counted this month whose price is not known (typed by hand). */
  unpricedModels: string[];
}

/** The month's spend on the API key against the budget (D240). */
export interface BudgetState {
  /** The budget in millionths of a dollar; null without one. */
  budgetMicros: number | null;
  spentMicros: number;
  /** spent / budget; null without a budget. */
  ratio: number | null;
  /** near: 80 % or more; over: at or past the budget. */
  step: 'none' | 'under' | 'near' | 'over';
  /** Over and pauseAtBudget: the coach sends nothing. */
  paused: boolean;
  /** The first day of next month, 'YYYY-MM-DD', when a pause lifts by itself. */
  resumesOn: string;
}

export interface SpendService {
  /** Count one finished request. Never throws, never waits. */
  count(entry: SpendCount): void;
  /** The totals, worked out for `now` (the device's clock by default). The same object until something changes. */
  summary(now?: Date): SpendSummary;
  /** The month's API-key spend against `budget` (Settings.coachBudget). */
  budget(budget: CoachBudget | undefined, now?: Date): BudgetState;
  /** Called after every change: a count, or records merged from Decaid's copy. */
  subscribe(listener: () => void): () => void;
  /** Read Decaid's copy and merge it in. Resolves when done or failed (never rejects). */
  refresh(): Promise<void>;
}
