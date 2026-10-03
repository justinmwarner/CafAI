import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import blooming from '../coach/templates/source/Blooming_espresso.json';
import { createMockServer } from '../../mock/node.ts';
import { fixtures } from '../../mock/fixtures/index.ts';
import { normalizeProfile } from '../../mock/decaid/profiles.ts';
import { createDecaidClient } from './client.ts';
import { activateProfile, createProfileVersion, findProfileMismatch, isShotRunning } from './workflow.ts';
import { GatewayError, type DecaidClient, type Workflow, type WorkflowPatch } from './types.ts';
import type { ProfileJson } from '../coach/types.ts';

const mock = createMockServer();
const client = createDecaidClient({ origin: 'http://localhost:8080' });

beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mock.server.resetHandlers());
afterAll(() => mock.close());

function bloomingV1(): ProfileJson {
  return { ...(normalizeProfile(blooming) as ProfileJson), title: 'Kiambu AA v1', author: 'CafAI', notes: '' };
}

function fakeClient(answer: (patch: WorkflowPatch) => Workflow): { client: DecaidClient; patches: WorkflowPatch[] } {
  const patches: WorkflowPatch[] = [];
  return {
    patches,
    client: {
      updateWorkflow: async (patch: WorkflowPatch) => {
        patches.push(patch);
        return answer(patch);
      },
    } as unknown as DecaidClient,
  };
}

const echo = (patch: WorkflowPatch): Workflow => ({ ...fixtures.workflowGet(), profile: patch.profile!, context: patch.context });

describe('activateProfile', () => {
  it('sends one PUT /workflow with the complete profile and the context, and returns the response', async () => {
    const before = mock.state.requests.length;
    const profile = bloomingV1();
    const workflow = await activateProfile(client, profile, { targetYield: 40, targetDoseWeight: 18, grinderSetting: '14' }, { shotRunning: false });

    const sent = mock.state.requests.slice(before);
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual(['PUT /api/v1/workflow']);
    const body = sent[0]!.body as { profile: Record<string, unknown>; context: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(['profile', 'context']);
    expect(Object.keys(body.profile)).toEqual([
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
    ]);
    expect(body.context).toEqual({ targetYield: 40, targetDoseWeight: 18, grinderSetting: '14' });

    expect(workflow.profile).toEqual(profile);
    expect(workflow.context).toMatchObject({ targetYield: 40, targetDoseWeight: 18, grinderSetting: '14' });
    expect(mock.state.getWorkflow().profile.title).toBe('Kiambu AA v1');
  });

  it('drops keys outside the ten, so nothing stale or unknown reaches Decaid', async () => {
    const fake = fakeClient(echo);
    const profile = { ...bloomingV1(), id: 'profile:x', hidden: '0' } as unknown as ProfileJson;
    await activateProfile(fake.client, profile, { targetYield: 36 }, { shotRunning: false });
    expect(Object.keys(fake.patches[0]!.profile!)).toHaveLength(10);
    expect('id' in fake.patches[0]!.profile!).toBe(false);
  });

  it('refuses while a shot runs, without touching Decaid', async () => {
    const fake = fakeClient(echo);
    const error = await activateProfile(fake.client, bloomingV1(), { targetYield: 36 }, { shotRunning: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ code: 'shot_running', path: '/api/v1/workflow' });
    expect((error as Error).message).toMatch(/shot/i);
    expect(fake.patches).toHaveLength(0);
  });

  it('requires targetYield to be a number (Decaid rejects null and strings)', async () => {
    const fake = fakeClient(echo);
    for (const targetYield of [null, undefined, '36', Number.NaN]) {
      const error = await activateProfile(fake.client, bloomingV1(), { targetYield } as never, { shotRunning: false }).catch((e: unknown) => e);
      expect(error, String(targetYield)).toMatchObject({ code: 'invalid_context' });
    }
    expect(fake.patches).toHaveLength(0);
    await expect(activateProfile(fake.client, bloomingV1(), { targetYield: 0 }, { shotRunning: false })).resolves.toBeDefined();
  });

  it('refuses an incomplete profile, which the deep merge would fill from the old one', async () => {
    const fake = fakeClient(echo);
    const profile = bloomingV1() as Partial<ProfileJson>;
    delete profile.target_volume;
    const error = await activateProfile(fake.client, profile as ProfileJson, { targetYield: 36 }, { shotRunning: false }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_profile', message: expect.stringContaining('target_volume') });
    expect(fake.patches).toHaveLength(0);
  });

  it('reports activation_mismatch when Decaid answers with a different profile', async () => {
    const cases: Array<[string, (profile: ProfileJson) => ProfileJson]> = [
      ['steps', (p) => ({ ...p, steps: p.steps.slice(1) })],
      ['title', (p) => ({ ...p, title: 'Something else' })],
      ['target_weight', (p) => ({ ...p, target_weight: 61 })],
      ['steps[4].flow', (p) => ({ ...p, steps: p.steps.map((s, i) => (i === 4 ? { ...s, flow: 2.4 } : s)) })],
    ];
    for (const [field, mutate] of cases) {
      const fake = fakeClient((patch) => ({ ...fixtures.workflowGet(), profile: mutate(patch.profile!) }));
      const error = await activateProfile(fake.client, bloomingV1(), { targetYield: 36 }, { shotRunning: false }).catch((e: unknown) => e);
      expect(error, field).toBeInstanceOf(GatewayError);
      expect(error, field).toMatchObject({ code: 'activation_mismatch', status: 200 });
      expect((error as Error).message, field).toContain(field);
    }
  });

  it('notes, author and Decaid normalisation do not count as a mismatch', async () => {
    const sent = bloomingV1();
    const answer = {
      ...sent,
      notes: 'changed by someone',
      steps: sent.steps.map((step) => ({ ...step, temperature: String(step.temperature), pressure: 1 })),
    } as unknown as ProfileJson;
    expect(findProfileMismatch(sent, answer)).toBeNull();
    const sparse = { ...sent, steps: sent.steps.map((step) => ({ ...step, weight: undefined })) } as unknown as ProfileJson;
    expect(findProfileMismatch(sparse, { ...sent, steps: sent.steps.map((step) => ({ ...step, weight: null })) })).toBeNull();
  });
});

describe('createProfileVersion', () => {
  it('a new version is created as sent', async () => {
    const request = fixtures.profileCreateRequest();
    const profile = { ...request.profile, target_weight: 38, title: 'Guji Hambela v2' };
    const { record, deduped } = await createProfileVersion(client, { profile, parentId: 'profile:fbff9b37ed390c6a8110', metadata: { source: 'cafai' } });
    expect(deduped).toBe(false);
    expect(record).toMatchObject({ parentId: 'profile:fbff9b37ed390c6a8110', profile: { title: 'Guji Hambela v2' }, metadata: { source: 'cafai' } });
  });

  it('identical content comes back as the existing record: deduped', async () => {
    const { record, deduped } = await createProfileVersion(client, { profile: bloomingV1(), parentId: 'profile:7438cb7266f60558b48f' });
    expect(deduped).toBe(true);
    expect(record.id).toBe('profile:7438cb7266f60558b48f');
    expect(record.profile.title).toBe('Blooming Espresso');
  });

  it('a different parent alone also means deduped', async () => {
    const template = mock.state.getProfile('profile:729d284747718d27c93a');
    const { deduped } = await createProfileVersion(client, { profile: template.profile as ProfileJson, parentId: 'profile:7438cb7266f60558b48f' });
    expect(deduped).toBe(true);
  });

  it('the same title and no parent on both sides is not a dedupe', async () => {
    const template = mock.state.getProfile('profile:729d284747718d27c93a');
    const { deduped } = await createProfileVersion(client, { profile: template.profile as ProfileJson });
    expect(deduped).toBe(false);
  });
});

describe('isShotRunning', () => {
  it('is true while shotState is past idle, or the machine is in espresso', () => {
    const idle = fixtures.machineState();
    const espresso = { ...idle, state: { state: 'espresso', substate: 'pouring' } };
    const shot = (state: string) => ({ ...fixtures.shotStateWs(), state });
    expect(isShotRunning({ shotState: null, machine: null })).toBe(false);
    expect(isShotRunning({ shotState: shot('idle'), machine: idle })).toBe(false);
    expect(isShotRunning({ shotState: shot('finished'), machine: idle })).toBe(false);
    expect(isShotRunning({ shotState: shot('preheating'), machine: idle })).toBe(true);
    expect(isShotRunning({ shotState: shot('stopping'), machine: idle })).toBe(true);
    expect(isShotRunning({ shotState: shot('idle'), machine: espresso })).toBe(true);
  });
});
