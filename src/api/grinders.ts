/**
 * Decaid's grinder library: GET /api/v1/grinders and /api/v1/grinders/{id},
 * and POST /api/v1/grinders to add one (Settings' Add a grinder, and the
 * coach's offer the barista confirms).
 *
 * Decaid stores what a grinder's dial can do (a45961b: grinders_handler.dart,
 * models/data/grinder.dart): a numeric dial with a small and a big step, or a
 * list of preset settings. It has no range, no units, no current setting and
 * no "which way is finer", so CafAI reads the steps and nothing more.
 *
 * Records are read leniently. Decaid leaves null fields out, other apps (the
 * DYE2 plugin) write the same table, and an older Decaid may lack fields, so
 * unknown fields are ignored, a malformed optional field is dropped, and only
 * a record without an id or a model is skipped: one odd grinder must never
 * hide the rest. What CafAI did not expect is reported as drift where the
 * reply enters CafAI (readers.ts, D95), and a list reply that is not a list,
 * null included, fails the call: only `[]` means Decaid has none.
 *
 * These calls sit beside the DecaidClient contract, not in it (other code
 * implements that interface); they only need the client's httpOrigin.
 */
import { containsKeyLike, redactKeyLike } from '../storage/redact.ts';
import { DEFAULT_TIMEOUT_MS, request, requestList, requestValue, type Transport } from './http.ts';
import { readGrinderRecord, readGrinderRecords, unexpectedReply } from './readers.ts';
import type { DecaidClient } from './types.ts';

/** Decaid reads "values" as preset and anything it does not know as numeric. */
export type GrinderSettingType = 'numeric' | 'preset';

/** One grinder as Decaid's Grinder.toJson() sends it (null fields are left out). */
export interface Grinder {
  /** UUID. */
  id: string;
  /** Required by Decaid, but it may be empty text. */
  model: string;
  burrs?: string;
  /** mm */
  burrSize?: number;
  burrType?: string;
  notes?: string;
  archived: boolean;
  settingType: GrinderSettingType;
  /** The dial positions of a preset grinder, as the grinder shows them. */
  settingValues?: string[];
  settingSmallStep?: number;
  settingBigStep?: number;
  rpmSmallStep?: number;
  rpmBigStep?: number;
  /** Local time, no zone. Always sent by Decaid; optional so an odd record still reads. */
  createdAt?: string;
  updatedAt?: string;
  extras?: Record<string, unknown>;
}

/** How CafAI can move this grinder's dial, from what Decaid knows. */
export type GrinderSteps =
  | { kind: 'numeric'; smallStep: number; bigStep: number | null }
  | { kind: 'preset'; values: string[] }
  | { kind: 'none' };

/** All the calls need is where Decaid is (a DecaidClient fits). */
export type GrinderSource = Pick<DecaidClient, 'httpOrigin'>;

export interface GrinderRequestOptions {
  /** Defaults to the global fetch, resolved per call (so a test or the mock can patch it). */
  fetch?: typeof globalThis.fetch;
  /** Deadline in ms, reading the body included (default 8 s). */
  timeoutMs?: number;
}

export interface ListGrindersOptions extends GrinderRequestOptions {
  /** Archived grinders too (Decaid hides them by default). */
  includeArchived?: boolean;
}

/**
 * What CafAI sends to add a grinder (POST /api/v1/grinders). Decaid needs
 * only the model; a field nobody gave is left out, so Decaid keeps its own
 * default for it (a numeric dial without steps).
 */
export interface GrinderCreateRequest {
  model: string;
  burrs?: string;
  settingType?: GrinderSettingType;
  /** A preset grinder's settings, finest first, as the grinder shows them. */
  settingValues?: string[];
  settingSmallStep?: number;
  settingBigStep?: number;
}

/** A grinder as the barista described it, in Settings or to the coach: null for what they did not say. */
export interface GrinderDraft {
  model: string;
  burrs: string | null;
  settingType: GrinderSettingType | null;
  smallStep: number | null;
  bigStep: number | null;
  /** A preset grinder's settings, finest first. */
  values: readonly string[] | null;
}

/** The longest text each field takes, as Settings' grinder fields do. */
export const GRINDER_LIMITS = { model: 60, burrs: 60, setting: 20, settings: 100 } as const;

/** Why nothing could be added: an older Decaid without the grinder library answers its routes with a plain 404. */
export const NO_GRINDER_LIBRARY = 'This Decaid has no grinder library to add to. Update Decaid, then try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function transportFor(source: GrinderSource, options: GrinderRequestOptions): Transport {
  return {
    origin: source.httpOrigin.trim().replace(/\/+$/, ''),
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

const TEXT_FIELDS = ['burrs', 'burrType', 'notes', 'createdAt', 'updatedAt'] as const;
const NUMBER_FIELDS = ['burrSize', 'settingSmallStep', 'settingBigStep', 'rpmSmallStep', 'rpmBigStep'] as const;

/** A wire grinder, or null when it has no id or no model. */
export function parseGrinder(value: unknown): Grinder | null {
  if (!isRecord(value)) return null;
  const { id, model } = value;
  if (typeof id !== 'string' || id === '' || typeof model !== 'string') return null;
  const settingType = value['settingType'];
  const grinder: Grinder = {
    id,
    model,
    archived: value['archived'] === true,
    settingType: settingType === 'preset' || settingType === 'values' ? 'preset' : 'numeric',
  };
  for (const field of TEXT_FIELDS) {
    const text = value[field];
    if (typeof text === 'string') grinder[field] = text;
  }
  for (const field of NUMBER_FIELDS) {
    const number = value[field];
    if (typeof number === 'number' && Number.isFinite(number)) grinder[field] = number;
  }
  const settingValues = value['settingValues'];
  if (Array.isArray(settingValues)) grinder.settingValues = settingValues.filter((item): item is string => typeof item === 'string');
  const extras = value['extras'];
  if (isRecord(extras)) grinder.extras = extras;
  return grinder;
}

/** A grinder reply, checked where it enters CafAI (readers.ts reports what it lacks), then read as Decaid reads it. */
function readGrinder(data: unknown, source: string): Grinder {
  const grinder = parseGrinder(readGrinderRecord(data, source));
  if (grinder === null) throw unexpectedReply(source);
  return grinder;
}

function readGrinders(data: unknown, source: string): Grinder[] {
  return readGrinderRecords(data, source).flatMap((record) => parseGrinder(record) ?? []);
}

/**
 * Decaid's grinders, most recently edited first (Decaid's order). Throws a
 * GatewayError when Decaid cannot be read, including an older Decaid without
 * the grinder library (plain-text 404), and `unexpected_reply` for a reply
 * that is not a list (null included), reported as drift: a reply CafAI could
 * not read never reads as "Decaid has none".
 */
export async function listGrinders(source: GrinderSource, options: ListGrindersOptions = {}): Promise<Grinder[]> {
  const path = options.includeArchived ? '/api/v1/grinders?includeArchived=true' : '/api/v1/grinders';
  const grinders = await requestList(transportFor(source, options), path, { read: readGrinders });
  // Decaid filters archived grinders itself; this only guards against one that slipped through.
  return options.includeArchived ? grinders : grinders.filter((grinder) => !grinder.archived);
}

/**
 * One grinder, or null when Decaid has none with that id (it was deleted) or
 * sent a record CafAI cannot read (reported as drift). Other failures throw a
 * GatewayError.
 */
export async function getGrinder(source: GrinderSource, id: string, options: GrinderRequestOptions = {}): Promise<Grinder | null> {
  const reply = await request<unknown>(transportFor(source, options), `/api/v1/grinders/${encodeURIComponent(id)}`, { allowStatus: [404] });
  if (reply.status === 404) return null;
  try {
    return readGrinder(reply.data, 'GET /api/v1/grinders/{id}');
  } catch {
    return null; // Unreadable, and reported: the coach gives directions only, as for a grinder Decaid lost.
  }
}

/**
 * Add a grinder to Decaid's library, so Decaid and every skin list it, and
 * answer it as Decaid stored it. Throws a GatewayError when Decaid refuses
 * it or cannot be reached (an older Decaid without the library answers a
 * plain 404), and `unexpected_reply` for a reply CafAI cannot read, reported
 * as drift. Never retried: the first attempt may have added it.
 */
export function createGrinder(source: GrinderSource, body: GrinderCreateRequest, options: GrinderRequestOptions = {}): Promise<Grinder> {
  return requestValue(transportFor(source, options), '/api/v1/grinders', { method: 'POST', body, read: readGrinder });
}

/** Trimmed, one space between words, never a key (D69), at most `max` characters; null when nothing is left. */
function cleanText(text: string | null, max: number): string | null {
  if (text === null) return null;
  const words = (containsKeyLike(text) ? redactKeyLike(text, ' ') : text).replace(/\s+/g, ' ').trim();
  return words.slice(0, max).trim() || null;
}

const isStep = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/**
 * What CafAI sends to add the grinder a barista described: its text cleaned
 * (cleanText), a step only when it can move a dial (more than 0), a preset's
 * settings in order without blanks or repeats. What nobody said is left out,
 * and the dial's kind is sent only when it is known (said, or plain from the
 * steps or the settings). Null when no model is left to name it.
 */
export function grinderRequest(draft: GrinderDraft): GrinderCreateRequest | null {
  const model = cleanText(draft.model, GRINDER_LIMITS.model);
  if (model === null) return null;
  const request: GrinderCreateRequest = { model };
  const burrs = cleanText(draft.burrs, GRINDER_LIMITS.burrs);
  if (burrs !== null) request.burrs = burrs;
  const values = [
    ...new Set((draft.values ?? []).flatMap((value) => cleanText(value, GRINDER_LIMITS.setting) ?? [])),
  ].slice(0, GRINDER_LIMITS.settings);
  const smallStep = isStep(draft.smallStep) ? draft.smallStep : null;
  const bigStep = isStep(draft.bigStep) ? draft.bigStep : null;
  const kind = draft.settingType ?? (values.length > 0 ? 'preset' : smallStep !== null || bigStep !== null ? 'numeric' : null);
  if (kind === 'preset') {
    request.settingType = 'preset';
    if (values.length > 0) request.settingValues = values;
  } else if (kind === 'numeric') {
    request.settingType = 'numeric';
    if (smallStep !== null) request.settingSmallStep = smallStep;
    if (bigStep !== null) request.settingBigStep = bigStep;
  }
  return request;
}

/**
 * The grinder a request describes, in Decaid's library: the one already
 * there (findSameGrinder, on a fresh read), or one CafAI adds. Decaid itself
 * takes duplicates, so a second tap, or a grinder another skin added a
 * moment ago, never becomes a second entry. Throws as listGrinders and
 * createGrinder do.
 */
export async function addOrFindGrinder(
  source: GrinderSource,
  body: GrinderCreateRequest,
  options: GrinderRequestOptions = {},
): Promise<{ grinder: Grinder; added: boolean }> {
  const same = findSameGrinder(await listGrinders(source, options), body);
  if (same) return { grinder: same, added: false };
  return { grinder: await createGrinder(source, body, options), added: true };
}

/** Case, extra spaces and missing text aside, the same words. */
const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === (b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The grinder in Decaid's list that a request describes: not archived, the
 * same model, and the same burrs when both say which. Adding it again would
 * only put a second entry for one grinder in every skin's list.
 */
export function findSameGrinder(grinders: readonly Grinder[], request: Pick<GrinderCreateRequest, 'model' | 'burrs'>): Grinder | null {
  const burrs = request.burrs?.trim() ?? '';
  return (
    grinders.find(
      (grinder) =>
        !grinder.archived &&
        sameText(grinder.model, request.model) &&
        (burrs === '' || !grinder.burrs?.trim() || sameText(grinder.burrs, burrs)),
    ) ?? null
  );
}

/**
 * What Decaid says about moving the dial: the small step (and the big one)
 * of a numeric grinder, or the settings of a preset grinder, in order. With
 * neither, CafAI can say which way to turn but not how far.
 */
export function grinderSteps(grinder: Grinder): GrinderSteps {
  if (grinder.settingType === 'preset') {
    const values = (grinder.settingValues ?? []).filter((value) => value.trim() !== '');
    return values.length > 0 ? { kind: 'preset', values } : { kind: 'none' };
  }
  const small = grinder.settingSmallStep;
  if (small === undefined || !(small > 0)) return { kind: 'none' };
  const big = grinder.settingBigStep;
  return { kind: 'numeric', smallStep: small, bigStep: big !== undefined && big > 0 ? big : null };
}
