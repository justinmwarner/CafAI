/**
 * Adapt the real modules to the engine's ports (src/app/engine/ports.ts).
 */
import {
  activateProfile,
  createProfileVersion,
  type DecaidClient,
} from '../api/index.ts';
import {
  COACH_TOOL_SPECS,
  TEMPLATES,
  buildSystemPrompt,
  buildVersionProfile,
  createShotSource,
  getTemplate,
  readLeverValues,
  runQueryTool,
  summarizeShot,
  validateProposal,
  versionTitle,
  withOther,
} from '../coach/index.ts';
import { createAnthropicProvider, resolveModel, runConversation, toToolDefinition, zodValidator } from '../llm/index.ts';
import type { SecretStore } from '../storage/types.ts';
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
    withOther: (options) => withOther([...options]),
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
      return runQueryTool(name, rewritten, { source, versions: context.versions, iterations: context.iterations });
    },
  };
}

export function createLlmPort(secrets: SecretStore): LlmPort {
  return {
    provider: createAnthropicProvider({ getApiKey: () => secrets.getApiKey() }),
    run: (request) => runConversation({ ...request, model: resolveModel(request.model) }),
    toolDefinition: toToolDefinition,
    validator: zodValidator,
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
  };
}
