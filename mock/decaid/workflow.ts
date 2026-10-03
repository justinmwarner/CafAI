/**
 * Decaid's workflow model for the mock: `Workflow.fromJson -> toJson` and the
 * PUT validation in web/workflow_handler.dart + json_patch.dart (a45961b).
 */
import type { Workflow, WorkflowContext } from '../../src/api/types.ts';
import { DartError, formatException, typeError } from './errors.ts';
import { isPlainObject, type JsonObject } from './json.ts';
import { normalizeProfile } from './profiles.ts';

const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$/;

function optionalDouble(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && NUMBER_TEXT.test(value.trim())) return Number(value.trim());
  if (typeof value === 'string') return undefined;
  throw typeError(value, 'String');
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function requiredInt(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) return Number(value.trim());
  if (typeof value === 'string') throw formatException('Invalid radix-10 number (at character 1)');
  throw typeError(value, 'String');
}

function requiredDouble(value: unknown): number {
  const parsed = optionalDouble(value);
  if (parsed === undefined) {
    if (typeof value === 'string') throw formatException('Invalid double');
    throw typeError(value, 'String');
  }
  return parsed;
}

function asMap(value: unknown, label: string): JsonObject {
  if (!isPlainObject(value)) throw typeError(value, `Map<String, dynamic>${label ? ` (${label})` : ''}`);
  return value;
}

/** WorkflowContext.fromJson -> toJson: every null is omitted. */
export function normalizeContext(raw: unknown): WorkflowContext {
  const json = asMap(raw, 'context');
  const context: WorkflowContext = {};
  const doubles = ['targetDoseWeight', 'targetYield', 'targetWaterVolume'] as const;
  const strings = [
    'grinderId',
    'grinderModel',
    'grinderSetting',
    'beanBatchId',
    'coffeeName',
    'coffeeRoaster',
    'finalBeverageType',
    'baristaName',
    'drinkerName',
  ] as const;
  for (const key of doubles) {
    const value = optionalDouble(json[key]);
    if (value !== undefined) context[key] = value;
  }
  for (const key of strings) {
    const value = optionalString(json[key]);
    if (value !== undefined) context[key] = value;
  }
  if (json.extras !== null && json.extras !== undefined) context.extras = asMap(json.extras, 'extras');
  return context;
}

/** Workflow.fromJson(json).toJson(), including the legacy dose/grinder/coffee folding. */
export function normalizeWorkflow(raw: JsonObject): Workflow {
  if (typeof raw.id !== 'string') throw typeError(raw.id, 'String');
  if (typeof raw.name !== 'string') throw typeError(raw.name, 'String');
  if (typeof raw.description !== 'string') throw typeError(raw.description, 'String');

  let context: WorkflowContext | undefined =
    raw.context !== null && raw.context !== undefined ? normalizeContext(raw.context) : undefined;
  const dose = isPlainObject(raw.doseData) ? raw.doseData : null;
  const grinder = isPlainObject(raw.grinderData) ? raw.grinderData : null;
  const coffee = isPlainObject(raw.coffeeData) ? raw.coffeeData : null;
  if (dose || grinder || coffee) {
    const legacy = normalizeContext({
      targetDoseWeight: dose?.doseIn,
      targetYield: dose?.doseOut,
      grinderSetting: grinder?.setting,
      grinderModel: grinder?.model,
      coffeeName: coffee?.name,
      coffeeRoaster: coffee?.roaster,
    });
    // Existing context values win; legacy fields only fill gaps.
    context = { ...legacy, ...(context ?? {}) };
  }

  const steam = raw.steamSettings !== null && raw.steamSettings !== undefined ? asMap(raw.steamSettings, 'steamSettings') : null;
  const hotWater = raw.hotWaterData !== null && raw.hotWaterData !== undefined ? asMap(raw.hotWaterData, 'hotWaterData') : null;
  const rinse = raw.rinseData !== null && raw.rinseData !== undefined ? asMap(raw.rinseData, 'rinseData') : null;

  const workflow: Workflow = {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    profile: normalizeProfile(raw.profile),
    ...(context ? { context } : {}),
    steamSettings: steam
      ? {
          targetTemperature: requiredInt(steam.targetTemperature),
          duration: requiredInt(steam.duration),
          flow: requiredDouble(steam.flow),
          stopAtTemperature: 'stopAtTemperature' in steam ? requiredDouble(steam.stopAtTemperature) : 0,
        }
      : { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 },
    hotWaterData: hotWater
      ? {
          targetTemperature: requiredInt(hotWater.targetTemperature),
          duration: requiredInt(hotWater.duration),
          volume: requiredInt(hotWater.volume),
          flow: requiredDouble(hotWater.flow),
        }
      : { targetTemperature: 75, duration: 30, volume: 50, flow: 10 },
    rinseData: rinse
      ? {
          targetTemperature: requiredInt(rinse.targetTemperature),
          duration: requiredInt(rinse.duration),
          flow: requiredDouble(rinse.flow),
        }
      : { targetTemperature: 90, duration: 10, flow: 6 },
  };
  if (isPlainObject(raw.machine)) (workflow as Workflow & { machine?: unknown }).machine = raw.machine;
  return workflow;
}

function rejectExplicitNulls(patch: JsonObject, fields: readonly string[]): void {
  for (const field of fields) {
    if (field in patch && patch[field] === null) throw formatException(`Field "${field}" cannot be null`);
  }
}

/** The checks workflow_handler.dart runs on the raw patch, before merging. */
export function validateWorkflowPatch(patch: JsonObject): void {
  rejectExplicitNulls(patch, ['steamSettings', 'context']);
  if (isPlainObject(patch.steamSettings)) {
    rejectExplicitNulls(patch.steamSettings, ['targetTemperature', 'duration', 'flow', 'stopAtTemperature']);
  } else if ('steamSettings' in patch) {
    throw formatException('Field "steamSettings" must be an object');
  }
  if (isPlainObject(patch.context)) {
    rejectExplicitNulls(patch.context, ['targetYield']);
    const value = patch.context.targetYield;
    if ('targetYield' in patch.context && value !== null && typeof value !== 'number') {
      throw formatException('Field "targetYield" must be a number or null');
    }
  } else if ('context' in patch) {
    throw formatException('Field "context" must be an object');
  }
}

export { DartError };
