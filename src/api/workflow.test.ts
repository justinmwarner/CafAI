import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import blooming from '../coach/templates/source/Blooming_espresso.json';
import { createMockServer } from '../../mock/node.ts';
import { fixtures } from '../../mock/fixtures/index.ts';
import { normalizeProfile } from '../../mock/decaid/profiles.ts';
import { createDecaidClient } from './client.ts';
import { activateProfile, createProfileVersion, findProfileMismatch, isShotRunning } from './workflow.ts';
import { GatewayError, type DecaidClient, type Workflow, type WorkflowContext, type WorkflowPatch } from './types.ts';
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

describe('activateProfile after a workflow PUT that timed out or answered 503 (5.13)', () => {
  const timeout = new GatewayError(0, '/api/v1/workflow', 'Decaid did not answer in time. Check that it is running, then try again.', 'timeout');
  const busy = new GatewayError(503, '/api/v1/workflow', 'Workflow request queue timed out', 'http');
  /** What the engine sends with a load: the targets, the coffee (beanBatchId cleared), the grinder and the tag. */
  const context: WorkflowContext = {
    targetYield: 36,
    targetDoseWeight: 18,
    coffeeName: 'Kiambu AA',
    coffeeRoaster: 'Square Mile',
    beanBatchId: null,
    grinderId: 'g-niche',
    grinderModel: 'Niche Zero',
    grinderSetting: '14',
    extras: { cafai: { versionId: 'v-3', bagId: 'bag-1' } },
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A PUT that fails with `failure`, then GETs answered by `readBack(what was sent, the read's number from 0)`. */
  function slowDecaid(failure: Error, readBack: (sent: WorkflowPatch, read: number) => Workflow | Error) {
    const calls: string[] = [];
    let sent: WorkflowPatch = {};
    const client = {
      updateWorkflow: async (patch: WorkflowPatch) => {
        calls.push('PUT');
        sent = patch;
        throw failure;
      },
      getWorkflow: async () => {
        const answer = readBack(sent, calls.filter((call) => call === 'GET').length);
        calls.push('GET');
        if (answer instanceof Error) throw answer;
        return answer;
      },
    } as unknown as DecaidClient;
    return { client, calls };
  }

  /**
   * What Decaid holds once the PUT is applied: the profile, the context merged
   * key by key with the keys sent as null gone (Decaid omits them), and the
   * extras merged too, the tag's keys in another order.
   */
  const applied = (sent: WorkflowPatch): Workflow => {
    const merged = Object.entries({ ...fixtures.workflowGet().context, ...sent.context }).filter(([, value]) => value !== null);
    return {
      ...fixtures.workflowGet(),
      profile: sent.profile!,
      context: { ...Object.fromEntries(merged), extras: { other: { x: 1 }, cafai: { bagId: 'bag-1', versionId: 'v-3' } } },
    };
  };

  /** The workflow as it stood before the PUT: v3 loaded earlier, with its yield since changed to 40 g in Decaid. */
  const v3At40 = (sent: WorkflowPatch): Workflow => {
    const workflow = applied(sent);
    return { ...workflow, context: { ...workflow.context, targetYield: 40 } };
  };

  /** activateProfile's outcome once the timers have run out: the workflow, or what it threw. */
  async function outcome(client: DecaidClient): Promise<unknown> {
    const result = activateProfile(client, bloomingV1(), context, { shotRunning: false }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    return result;
  }

  it('a timeout, then a read-back that holds everything sent: the load counts', async () => {
    const { client, calls } = slowDecaid(timeout, applied);
    expect(await outcome(client)).toMatchObject({ profile: { title: 'Kiambu AA v1' }, context: { targetYield: 36 } });
    expect(calls).toEqual(['PUT', 'GET']);
  });

  it('after a timeout the PUT may still land: the workflow is read 3 times, 2 s apart', async () => {
    const { client, calls } = slowDecaid(timeout, (sent, read) => (read < 2 ? v3At40(sent) : applied(sent)));
    const result = activateProfile(client, bloomingV1(), context, { shotRunning: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['PUT', 'GET']);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toEqual(['PUT', 'GET']);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['PUT', 'GET', 'GET']);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toMatchObject({ context: { targetYield: 36 } });
    expect(calls).toEqual(['PUT', 'GET', 'GET', 'GET']);
  });

  it('after a timeout, 3 reads that never hold it, or that fail: the timeout stands', async () => {
    const stale = slowDecaid(timeout, v3At40);
    expect(await outcome(stale.client)).toBe(timeout);
    expect(stale.calls).toEqual(['PUT', 'GET', 'GET', 'GET']);
    const unreachable = slowDecaid(timeout, () => new GatewayError(0, '/api/v1/workflow', 'Could not reach Decaid.', 'network'));
    expect(await outcome(unreachable.client)).toBe(timeout);
    expect(unreachable.calls).toEqual(['PUT', 'GET', 'GET', 'GET']);
  });

  it('v3 active, its yield changed to 40 g in Decaid: reloading v3 with 36 g that gets a 503 fails', async () => {
    // Decaid never applies a workflow PUT it answers 503 (queue timeout, write queue full, machine unavailable).
    const { client, calls } = slowDecaid(busy, v3At40);
    expect(await outcome(client)).toBe(busy);
    expect(calls, 'one read: a 503 never lands later').toEqual(['PUT', 'GET']);
  });

  it('a 503 counts only when the workflow already holds everything sent', async () => {
    const { client, calls } = slowDecaid(busy, applied);
    expect(await outcome(client)).toMatchObject({ context: { targetYield: 36 } });
    expect(calls).toEqual(['PUT', 'GET']);
  });

  it('every key sent counts: the dose, the coffee, the grinder, a key cleared, the tag', async () => {
    const changes: Array<[string, (context: Record<string, unknown>) => Record<string, unknown>]> = [
      ['targetDoseWeight', (c) => ({ ...c, targetDoseWeight: 19 })],
      ['coffeeName', (c) => ({ ...c, coffeeName: 'Guji' })],
      ['coffeeRoaster', (c) => ({ ...c, coffeeRoaster: 'Coffee Collective' })],
      ['grinderId', (c) => ({ ...c, grinderId: 'g-other' })],
      ['grinderModel', (c) => ({ ...c, grinderModel: 'EK43' })],
      ['grinderSetting', (c) => ({ ...c, grinderSetting: '15' })],
      ['beanBatchId (sent as null)', (c) => ({ ...c, beanBatchId: 'batch-1' })],
      ['extras.cafai', (c) => ({ ...c, extras: { cafai: { versionId: 'v-2', bagId: 'bag-1' } } })],
      ['targetYield missing', ({ targetYield: _yield, ...c }) => c],
    ];
    for (const [key, change] of changes) {
      const { client } = slowDecaid(busy, (sent) => {
        const workflow = applied(sent);
        return { ...workflow, context: change(workflow.context as Record<string, unknown>) };
      });
      expect(await outcome(client), key).toBe(busy);
    }
  });

  it('a different profile under the same context: the error stands', async () => {
    const { client } = slowDecaid(busy, (sent) => ({ ...applied(sent), profile: { ...sent.profile!, title: 'Something else' } }));
    expect(await outcome(client)).toBe(busy);
  });

  it('a 400 is never reconciled: Decaid refused what was sent', async () => {
    const refused = new GatewayError(400, '/api/v1/workflow', 'Field "targetYield" cannot be null', 'http');
    const { client, calls } = slowDecaid(refused, applied);
    expect(await outcome(client)).toBe(refused);
    expect(calls).toEqual(['PUT']);
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

  it('leaves a shot state it does not know to the machine state, so a renamed one never blocks loads (5.9)', () => {
    const idle = fixtures.machineState();
    const espresso = { ...idle, state: { state: 'espresso', substate: 'pouring' } };
    const shot = (state: string) => ({ ...fixtures.shotStateWs(), state });
    expect(isShotRunning({ shotState: shot('done'), machine: idle })).toBe(false);
    expect(isShotRunning({ shotState: shot('brewing'), machine: espresso })).toBe(true);
  });

  it('counts skipStep, the moment a shot moves to its next step, as the shot', () => {
    const skipping = { ...fixtures.machineState(), state: { state: 'skipStep', substate: 'pouring' } };
    expect(isShotRunning({ shotState: { ...fixtures.shotStateWs(), state: 'done' }, machine: skipping })).toBe(true);
    expect(isShotRunning({ shotState: null, machine: skipping })).toBe(true);
  });
});
