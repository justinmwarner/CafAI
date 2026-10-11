/**
 * Adapt the real modules to the engine's ports (src/app/engine/ports.ts).
 */
import {
  activateProfile,
  createProfileVersion,
  type DecaidClient,
} from '../api/index.ts';
import { getGrinder, grinderSteps, type Grinder } from '../api/grinders.ts';
import { loadProfileOnMachine } from '../api/machineProfile.ts';
import {
  COACH_TOOL_SPECS,
  DOSE_RULES,
  REFERENCE_DOSE_G,
  TEMPLATES,
  buildStartingProfile,
  buildSystemPrompt,
  buildVersionProfile,
  createShotSource,
  getTemplate,
  knownDose,
  profileId,
  readLeverValues,
  roastLine,
  runQueryTool,
  summarizeShot,
  validateProposal,
  versionTitle,
  withOther,
} from '../coach/index.ts';
import type { GrinderInfo } from '../coach/types.ts';
import { extractBag, resolveModel, runConversation, toToolDefinition, zodValidator } from '../llm/index.ts';
import { DEFAULT_COACH_SOURCE, type CoachSourceStore } from '../storage/coachSource.ts';
import type { SecretStore } from '../storage/types.ts';
import { createCoachProvider } from './coachAccess.ts';
import type { ApiPort, CoachPort, LlmPort, ShotSource } from './engine/ports.ts';

/** Shot reference fields in the query tools' inputs. */
const SHOT_REF_KEYS = ['shot', 'shotA', 'shotB'] as const;

export function createCoachPort(): CoachPort {
  // Built once: the system prompt must stay byte-identical across turns so it caches.
  const systemPrompt = buildSystemPrompt(TEMPLATES);
  return {
    templates: TEMPLATES,
    getTemplate,
    systemPrompt: () => systemPrompt,
    toolDescription: (name) => COACH_TOOL_SPECS[name].description,
    readLeverValues,
    validateProposal,
    summarizeShot,
    versionTitle,
    buildVersionProfile,
    buildStartingProfile,
    knownDose,
    referenceDoseG: REFERENCE_DOSE_G,
    doseRange: { min: DOSE_RULES.min, max: DOSE_RULES.max },
    profileId,
    withOther: (options) => withOther([...options]),
    roastLine,
    async runQuery(name, input, context) {
      // The coach's queries read a synchronous shot list. Resolve each shot
      // reference ("latest", "previous", an id) through the engine's source,
      // which fetches only the records needed, and query by concrete id.
      const rewritten: Record<string, unknown> = { ...(input as Record<string, unknown>) };
      const shots: Awaited<ReturnType<ShotSource['resolve']>>[] = [];
      for (const key of SHOT_REF_KEYS) {
        const ref = rewritten[key];
        if (typeof ref !== 'string') continue;
        const shot = await context.source.resolve(ref);
        if (!shot) {
          return {
            content: `No shot "${ref}". Use "latest", "previous", or a shotId from get_bag_history.`,
            isError: true,
          };
        }
        shots.push(shot);
        rewritten[key] = shot.record.id;
      }
      const source = createShotSource(shots.filter((s): s is NonNullable<typeof s> => s !== null));
      return runQueryTool(name, rewritten, {
        source,
        versions: context.versions,
        iterations: context.iterations,
        dye2: context.dye2,
        bag: context.bag,
      });
    },
  };
}

/** Without a saved choice the coach runs on Anthropic, as it always has. */
const ON_ANTHROPIC: Pick<CoachSourceStore, 'get'> = { get: async () => ({ ...DEFAULT_COACH_SOURCE }) };

/** `coachSource`: where the coach runs, Anthropic or CafAI Bridge, read at every request (coachAccess.ts). */
export function createLlmPort(secrets: SecretStore, coachSource: Pick<CoachSourceStore, 'get'> = ON_ANTHROPIC): LlmPort {
  // A photo of the bag goes once (6.8): a failed request is not sent again
  // on its own; the barista takes another photo.
  const photoReader = createCoachProvider({ secrets, coachSource, maxRetries: 0 });
  return {
    provider: createCoachProvider({ secrets, coachSource }),
    run: (request) => runConversation({ ...request, model: resolveModel(request.model) }),
    toolDefinition: toToolDefinition,
    validator: zodValidator,
    readBag: ({ model, photo }) => extractBag({ provider: photoReader, model: resolveModel(model), photo }),
  };
}

/**
 * A grinder from Decaid's library as the coach sizes a move with it (D62):
 * only what can move a dial survives, so a blank preset entry or a step of 0
 * never becomes a grind setting.
 */
export function grinderInfo(grinder: Grinder): GrinderInfo {
  const steps = grinderSteps(grinder);
  return {
    model: grinder.model,
    settingType: grinder.settingType,
    smallStep: steps.kind === 'numeric' ? steps.smallStep : null,
    bigStep: steps.kind === 'numeric' ? steps.bigStep : null,
    values: steps.kind === 'preset' ? steps.values : null,
  };
}

export function createApiPort(decaid: DecaidClient): ApiPort {
  return {
    getWorkflow: () => decaid.getWorkflow(),
    updateWorkflow: (patch) => decaid.updateWorkflow(patch),
    activateProfile: (profile, context, options) => activateProfile(decaid, profile, context, options),
    createProfileVersion: (request) => createProfileVersion(decaid, request),
    getShot: (id) => decaid.getShot(id),
    getLatestShot: () => decaid.getLatestShot(),
    // Not on DecaidClient (other modules fake that interface): its own transport to the same origin.
    loadProfileOnMachine: (profile) => loadProfileOnMachine(decaid, profile),
    updateShot: (id, patch) => decaid.updateShot(id, patch),
    probeEnjoymentScale: () => decaid.probeEnjoymentScale(),
    async getGrinder(id) {
      const grinder = await getGrinder(decaid, id);
      return grinder ? grinderInfo(grinder) : null;
    },
    listBeans: () => decaid.listBeans(),
    listBatches: (beanId) => decaid.listBatches(beanId),
    listAllBatches: (options) => decaid.listAllBatches(options),
    createBean: (request) => decaid.createBean(request),
    createBatch: (beanId, request) => decaid.createBatch(beanId, request),
    // What Decaid's plugins leave for CafAI (D103): read, never written.
    readStore: (namespace, key) => decaid.kv.get<unknown>(namespace, key),
    getPluginEndpoint: (pluginId, endpoint) => decaid.getPluginEndpoint<unknown>(pluginId, endpoint),
  };
}
