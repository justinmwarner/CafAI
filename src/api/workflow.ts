// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/gateway/workflow.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: full-profile activation with a read-back check and
// versioned profile creation replace Crema's recipe diff and null-based undo (Decaid now rejects null targetYield).
/**
 * Putting a profile on the machine, and recording a version of it.
 *
 * Activation is one PUT /api/v1/workflow with the complete ten-key profile
 * and the context. Decaid deep-merges the body into the current workflow
 * (objects merge, arrays replace), so an omitted profile key would silently
 * keep the previous profile's value: the profile always goes out whole.
 * Stop-at-weight reads context.targetYield (never profile.target_weight), and
 * Decaid rejects a null or non-numeric targetYield. The response is the
 * truth; it is checked against what was sent.
 */
import type { ProfileJson } from '../coach/types.ts';
import { isShotMachineState } from './machineStates.ts';
import {
  GatewayError,
  type DecaidClient,
  type ProfileCreateRequest,
  type ProfileRecord,
  type TelemetryState,
  type WireProfile,
  type Workflow,
  type WorkflowContext,
} from './types.ts';

const PATH = '/api/v1/workflow';

/** Every key Decaid's Profile.toJson emits, in its order. */
const PROFILE_KEYS = [
  'version',
  'title',
  'notes',
  'author',
  'beverage_type',
  'steps',
  'target_volume',
  'target_weight',
  'target_volume_count_start',
  'tank_temperature',
] as const;

/** shotState's states while a shot runs; any other, a renamed one included, leaves it to the machine state (5.9). */
const SHOT_RUNNING_STATES: ReadonlySet<string> = new Set(['preheating', 'pouring', 'stopping']);

/** True while a shot is in progress: shotState preheating, pouring or stopping, or the machine in a shot (espresso, skipStep). */
export function isShotRunning(telemetry: Pick<TelemetryState, 'shotState' | 'machine'>): boolean {
  const shotState = telemetry.shotState?.state;
  if (shotState && SHOT_RUNNING_STATES.has(shotState)) return true;
  return isShotMachineState(telemetry.machine?.state.state);
}

type Loose = Record<string, unknown>;

function sameNumber(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (left === null || right === null) return left === right;
  const x = Number(left);
  const y = Number(right);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
}

function sameText(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

function stepMismatch(sent: Loose, got: Loose): string | null {
  for (const key of ['name', 'pump', 'transition', 'sensor'] as const) if (!sameText(sent[key], got[key])) return key;
  for (const key of ['temperature', 'seconds', 'volume', 'weight'] as const) if (!sameNumber(sent[key], got[key])) return key;
  // Only the active axis exists on the machine; Decaid drops the other.
  const axis = sent.pump === 'flow' ? 'flow' : 'pressure';
  if (!sameNumber(sent[axis], got[axis])) return axis;

  const sentExit = (sent.exit ?? null) as Loose | null;
  const gotExit = (got.exit ?? null) as Loose | null;
  if ((sentExit === null) !== (gotExit === null)) return 'exit';
  if (sentExit && gotExit) {
    if (!sameText(sentExit.type, gotExit.type) || !sameText(sentExit.condition, gotExit.condition)) return 'exit';
    if (!sameNumber(sentExit.value, gotExit.value)) return 'exit.value';
  }
  const sentLimiter = (sent.limiter ?? null) as Loose | null;
  const gotLimiter = (got.limiter ?? null) as Loose | null;
  if ((sentLimiter === null) !== (gotLimiter === null)) return 'limiter';
  if (sentLimiter && gotLimiter && (!sameNumber(sentLimiter.value, gotLimiter.value) || !sameNumber(sentLimiter.range, gotLimiter.range))) {
    return 'limiter';
  }
  return null;
}

/**
 * The first field where Decaid's profile differs from the one sent, or null.
 * Compares the title and everything that drives the machine (the content
 * hash fields); notes and author are presentation only.
 */
export function findProfileMismatch(sent: ProfileJson | WireProfile, got: ProfileJson | WireProfile): string | null {
  if (!sameText(sent.title, got.title)) return 'title';
  if (!sameText(sent.version, got.version)) return 'version';
  if (!sameText(sent.beverage_type, got.beverage_type)) return 'beverage_type';
  for (const key of ['target_weight', 'target_volume', 'target_volume_count_start', 'tank_temperature'] as const) {
    if (!sameNumber(sent[key], got[key])) return key;
  }
  const sentSteps = Array.isArray(sent.steps) ? sent.steps : [];
  const gotSteps = Array.isArray(got.steps) ? got.steps : [];
  if (sentSteps.length !== gotSteps.length) return 'steps';
  for (let index = 0; index < sentSteps.length; index += 1) {
    const field = stepMismatch(sentSteps[index] as unknown as Loose, gotSteps[index] as unknown as Loose);
    if (field) return `steps[${index}].${field}`;
  }
  return null;
}

/** Equal as JSON, whatever the key order. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Loose;
  const right = b as Loose;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && sameJson(left[key], right[key]));
}

/** After a timeout, the workflow is read this many times, this far apart, before the timeout stands. */
const READS_AFTER_TIMEOUT = 3;
const READ_EVERY_MS = 2000;

/**
 * Every key of the context sent holds its value in the one read back: a key
 * sent as null is gone (Decaid leaves out a key without a value), and the
 * extras are compared key by key, as Decaid merges them.
 */
function holdsContext(sent: WorkflowContext, got: WorkflowContext | undefined): boolean {
  const held = (got ?? {}) as Loose;
  return Object.entries(sent as Loose).every(([key, value]) => {
    if (key === 'extras' && typeof value === 'object' && value !== null) {
      const extras = typeof held.extras === 'object' && held.extras !== null ? (held.extras as Loose) : {};
      return Object.entries(value as Loose).every(([name, entry]) => sameJson(entry ?? null, extras[name] ?? null));
    }
    return typeof value === 'number' ? sameNumber(value, held[key]) : sameJson(value ?? null, held[key] ?? null);
  });
}

/**
 * Whether a workflow PUT that failed holds after all (5.13). Decaid v0.8.8
 * never applies a PUT it answers 503: one that waited 30 s in its queue is
 * skipped, and a full machine write queue or an unavailable machine fail
 * before the workflow is set (workflow_handler.dart), as admission control
 * fails before the handler. A client-side timeout can still land, though: the
 * PUT may be off the queue, writing to the DE1. So the workflow is read
 * `reads` times, READ_EVERY_MS apart, and counts only when it holds
 * everything that was sent: the profile, and every context key with its value.
 */
async function landedAnyway(
  client: Pick<DecaidClient, 'getWorkflow'>,
  profile: ProfileJson,
  context: WorkflowContext,
  reads: number,
): Promise<Workflow | null> {
  for (let read = 0; read < reads; read += 1) {
    if (read > 0) await new Promise((resolve) => setTimeout(resolve, READ_EVERY_MS));
    try {
      const workflow = await client.getWorkflow();
      if (findProfileMismatch(profile, workflow.profile) === null && holdsContext(context, workflow.context)) return workflow;
    } catch {
      // Not readable now either: the next read, or the PUT's own error.
    }
  }
  return null;
}

/**
 * Activate a profile: one PUT /api/v1/workflow with the complete profile and
 * the context, then check Decaid kept what was sent.
 *
 * Refused (GatewayError `shot_running`) while a shot runs, because Decaid
 * snapshots the workflow at the END of the shot into its record.
 * `context.targetYield` must be a number (0 = stop-at-weight off).
 * The machine upload happens after the response; Decaid only signals a
 * failure (devices connectionStatus.error kind `profileUploadFailed`).
 * A PUT that timed out or answered 503 counts only when the workflow read
 * back already holds everything that was sent; otherwise its error stands.
 */
export async function activateProfile(
  client: Pick<DecaidClient, 'updateWorkflow' | 'getWorkflow'>,
  profile: ProfileJson,
  context: WorkflowContext,
  options: { shotRunning: boolean },
): Promise<Workflow> {
  if (options.shotRunning) {
    throw new GatewayError(0, PATH, 'A shot is running. Change the profile when it has finished.', 'shot_running');
  }
  const targetYield: unknown = context.targetYield;
  if (typeof targetYield !== 'number' || !Number.isFinite(targetYield) || targetYield < 0) {
    throw new GatewayError(0, PATH, 'The target yield must be a number of grams (0 turns stop-at-weight off).', 'invalid_context');
  }
  const loose = profile as unknown as Loose;
  const complete: Loose = {};
  for (const key of PROFILE_KEYS) {
    if (loose[key] === undefined) {
      throw new GatewayError(0, PATH, `The profile is missing "${key}", so Decaid would keep the old value. Nothing was changed.`, 'invalid_profile');
    }
    complete[key] = loose[key];
  }

  const sent = complete as unknown as ProfileJson;
  let workflow: Workflow;
  try {
    workflow = await client.updateWorkflow({ profile: sent, context });
  } catch (error) {
    // A timeout may still land, so it is read a few times; a 503 never lands, so once.
    let reads = 0;
    if (error instanceof GatewayError) reads = error.code === 'timeout' ? READS_AFTER_TIMEOUT : error.status === 503 ? 1 : 0;
    if (reads === 0) throw error;
    const landed = await landedAnyway(client, sent, context, reads);
    if (landed === null) throw error;
    return landed;
  }
  const mismatch = findProfileMismatch(sent, workflow.profile);
  if (mismatch) {
    throw new GatewayError(200, PATH, `Decaid kept a different profile than CafAI sent (${mismatch}). Try again.`, 'activation_mismatch');
  }
  return workflow;
}

/**
 * Record a profile version with POST /api/v1/profiles.
 *
 * Decaid ids hash the execution content only, and a POST with content that
 * already exists returns THAT record (201) with its old title, parent,
 * metadata and visibility. `deduped` says so: the returned title or parent
 * differs from what was sent.
 */
export async function createProfileVersion(
  client: Pick<DecaidClient, 'createProfile'>,
  request: { profile: ProfileJson; parentId?: string; metadata?: Record<string, unknown> },
): Promise<{ record: ProfileRecord; deduped: boolean }> {
  const body: ProfileCreateRequest = { profile: request.profile };
  if (request.parentId !== undefined) body.parentId = request.parentId;
  if (request.metadata !== undefined) body.metadata = request.metadata;
  const record = await client.createProfile(body);
  const deduped = record.profile.title !== request.profile.title || (record.parentId ?? null) !== (request.parentId ?? null);
  return { record, deduped };
}
