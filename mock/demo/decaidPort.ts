/**
 * The coach engine's Decaid port (src/app/engine/ports.ts) over a mock
 * Decaid in the same process, for playing the demo story without a network.
 *
 * Activation and profile creation go through CafAI's own client functions
 * (src/api/workflow.ts), so the bodies are the ones CafAI sends; the mock's
 * state answers as its REST handlers would. A grinder comes back reduced the
 * way CafAI's adapter reduces it (src/app/adapters.ts).
 */
import { activateProfile, createProfileVersion } from '../../src/api/workflow.ts';
import { findSameGrinder, parseGrinder } from '../../src/api/grinders.ts';
import type { ProfileCreateRequest, WorkflowPatch } from '../../src/api/types.ts';
import { grinderInfo } from '../../src/app/adapters.ts';
import type { ApiPort } from '../../src/app/engine/ports.ts';
import { MockHttpError } from '../decaid/errors.ts';
import type { MockDecaid } from '../decaid/state.ts';

export function mockDecaidPort(state: MockDecaid): ApiPort {
  const workflowClient = {
    updateWorkflow: async (patch: WorkflowPatch) => state.updateWorkflow(patch),
    getWorkflow: async () => state.getWorkflow(),
  };
  const profileClient = { createProfile: async (body: ProfileCreateRequest) => state.createProfile(body) };
  return {
    getWorkflow: async () => state.getWorkflow(),
    updateWorkflow: async (patch) => state.updateWorkflow(patch),
    activateProfile: (profile, context, options) => activateProfile(workflowClient, profile, context, options),
    createProfileVersion: (request) => createProfileVersion(profileClient, request),
    getShot: async (id) => state.getShot(id),
    getLatestShot: async () => state.getLatestShot(),
    async loadProfileOnMachine(profile) {
      await state.loadMachineProfile(profile);
      return 'loaded';
    },
    updateShot: async (id, patch) => state.updateShot(id, patch),
    async getGrinder(id) {
      let record: unknown;
      try {
        record = state.getGrinder(id);
      } catch (error) {
        if (error instanceof MockHttpError && error.status === 404) return null;
        throw error;
      }
      const grinder = parseGrinder(record);
      return grinder ? grinderInfo(grinder) : null;
    },
    // As addOrFindGrinder does: the grinder the mock already has, else a new one.
    async addGrinder(request) {
      const same = findSameGrinder(
        state.listGrinders().flatMap((record) => parseGrinder(record) ?? []),
        request,
      );
      const grinder = same ?? parseGrinder(state.createGrinder(request));
      if (!grinder) throw new Error('The mock stored a grinder CafAI cannot read.');
      return { id: grinder.id, model: grinder.model, burrs: grinder.burrs ?? null, info: grinderInfo(grinder), added: same === null };
    },
    // The mock validates enjoyment 0-10, as current Decaid builds do.
    probeEnjoymentScale: async () => 10,
    listBeans: async () => state.listBeans(),
    listBatches: async (beanId) => state.listBatches({ beanId }),
    listAllBatches: async (options) => state.listBatches({ includeArchived: options?.includeArchived ?? false }),
    createBean: async (request) => state.createBean(request),
    createBatch: async (beanId, request) => state.createBatch(beanId, request),
    // The demo runs no plugin: their keys hold what the mock seeded, and no endpoint answers.
    readStore: async (namespace, key) => state.kvGet(namespace, key),
    async getPluginEndpoint(pluginId, endpoint) {
      throw new MockHttpError(404, { error: `plugin with ${pluginId} not loaded (${endpoint})` });
    },
  };
}
