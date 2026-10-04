/**
 * Decaid's grinder library: GET /api/v1/grinders and /api/v1/grinders/{id}.
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
 * hide the rest.
 *
 * These calls sit beside the DecaidClient contract, not in it (other code
 * implements that interface); they only need the client's httpOrigin.
 */
import { DEFAULT_TIMEOUT_MS, request, requestJson, type Transport } from './http.ts';
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

/**
 * Decaid's grinders, most recently edited first (Decaid's order). Throws a
 * GatewayError when Decaid cannot be read, including an older Decaid without
 * the grinder library (plain-text 404).
 */
export async function listGrinders(source: GrinderSource, options: ListGrindersOptions = {}): Promise<Grinder[]> {
  const path = options.includeArchived ? '/api/v1/grinders?includeArchived=true' : '/api/v1/grinders';
  const body = await requestJson<unknown>(transportFor(source, options), path);
  if (!Array.isArray(body)) return [];
  const grinders = body.map(parseGrinder).filter((grinder): grinder is Grinder => grinder !== null);
  // Decaid filters archived grinders itself; this only guards against one that slipped through.
  return options.includeArchived ? grinders : grinders.filter((grinder) => !grinder.archived);
}

/**
 * One grinder, or null when Decaid has none with that id (it was deleted) or
 * sent a record CafAI cannot read. Other failures throw a GatewayError.
 */
export async function getGrinder(source: GrinderSource, id: string, options: GrinderRequestOptions = {}): Promise<Grinder | null> {
  const reply = await request<unknown>(transportFor(source, options), `/api/v1/grinders/${encodeURIComponent(id)}`, { allowStatus: [404] });
  return reply.status === 404 ? null : parseGrinder(reply.data);
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
