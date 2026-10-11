/**
 * CafAI's writes against a running Decaid (spec 4.4, DECAID_WRITE=1): each
 * through CafAI's own client, each reply checked against the pinned spec and
 * for drift, and every write put back in afterAll even after a failure. A
 * simulator only (D104): the suite refuses to write unless Decaid simulates
 * the machine and no real machine is connected. `npm test` never runs it.
 *
 *   DECAID_URL=http://localhost:8080 DECAID_WRITE=1 npm run test:decaid
 */
import { afterAll, assert, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildStartingProfile, buildVersionProfile, getTemplate, profileId, startingYield } from '../../coach/index.ts';
import type { ProfileJson, Template } from '../../coach/types.ts';
import { deviceConnections, type DeviceConnections } from '../frames.ts';
import { loadProfileOnMachine } from '../machineProfile.ts';
import type { WorkflowContext } from '../types.ts';
import { activateProfile, createProfileVersion, findProfileMismatch } from '../workflow.ts';
import { describeDecaid, openDecaid, type LiveDecaid } from './env.ts';
import { contextDifference, contextNotKept, createUndoList, restoreContext, simulatorProblem } from './harness.ts';

/** A namespace of the suite's own, never CafAI's `cafai`. */
const KV_NAMESPACE = 'cafai-contract-test';
const KV_KEY = 'probe';
const TEMPLATE_ID = 'blooming-espresso';
const DOSE_G = 18;
const TITLE = 'CafAI contract test';
const BAG = 'Contract test';
/**
 * The tag CafAI's engine puts in the context it loads (extras.cafai, engine.ts),
 * which activateProfile's read-back after a timeout or a 503 looks for (5.13).
 */
const TAG = { versionId: 'cafai-contract-test', bagId: 'cafai-contract-test' };
/**
 * The test profile's stop. CafAI's yields are whole grams, so no version of a
 * barista's has this content (Decaid's id hashes it): the record is the
 * suite's own, the same one every run, and hiding it hides nothing else.
 */
const TEST_TARGET_G = 41.5;

function blooming(): Template {
  const template = getTemplate(TEMPLATE_ID);
  if (!template) throw new Error(`No template ${TEMPLATE_ID} in the catalog.`);
  return template;
}

describeDecaid('write', ({ url }) => {
  let live: LiveDecaid;
  let links: DeviceConnections = { machine: false, scale: false };
  const undo = createUndoList();

  beforeAll(async () => {
    live = await openDecaid(url);
    const [settings, devices] = await Promise.all([live.client.getSettings(), live.client.getDevices()]);
    const problem = simulatorProblem(settings, devices);
    if (problem) throw new Error(`DECAID_WRITE=1 runs only against Decaid's simulator (D104), and ${problem}.`);
    links = deviceConnections({ devices }) ?? links;
  });
  beforeEach(() => live.reset());
  afterAll(async () => {
    const failures = await undo.runAll();
    if (failures.length > 0) throw new Error(`Could not put back: ${failures.join('; ')}.`);
  });

  /** Archive a bean or a batch: CafAI itself never edits or deletes them (D102). */
  async function archive(path: string): Promise<void> {
    const reply = await live.send('PUT', path, { archived: true });
    if (reply.status !== 200) throw new Error(`PUT ${path} answered HTTP ${reply.status}.`);
  }

  it('POST /api/v1/machine/heartbeat: the seconds to sleep, or -1', async () => {
    const { timeout } = await live.client.heartbeat();
    expect(timeout).toBeGreaterThanOrEqual(-1);
    expect(live.problems()).toEqual([]);
  });

  it(`KV in ${KV_NAMESPACE}: set, get, the whole namespace and its ETag, delete`, async () => {
    const kv = live.client.kv;
    const value = { by: 'npm run test:decaid', at: new Date().toISOString() };
    const removeNow = undo.add('the KV key', () => kv.delete(KV_NAMESPACE, KV_KEY));
    await kv.set(KV_NAMESPACE, KV_KEY, value);
    expect(await kv.get(KV_NAMESPACE, KV_KEY), 'get').toEqual(value);

    const all = await kv.getAll(KV_NAMESPACE);
    if (all.notModified) assert.fail('A first ?full=1 read answered 304.');
    expect(all.data[KV_KEY], '?full=1').toEqual(value);
    expect(all.etag, 'its ETag').toBeTruthy();
    expect(await kv.getAll(KV_NAMESPACE, all.etag), 'the same read with If-None-Match').toEqual({ notModified: true });

    await removeNow();
    expect(await kv.get(KV_NAMESPACE, KV_KEY), 'get after delete').toBeNull();
    expect(await kv.list(KV_NAMESPACE), 'keys after delete').not.toContain(KV_KEY);
    expect(live.problems()).toEqual([]);
  });

  it('the rating scale CafAI probes is 10 or 100 (D101)', async () => {
    expect([10, 100]).toContain(await live.client.probeEnjoymentScale());
    expect(live.problems()).toEqual([]);
  });

  it('workflow round trip: Blooming loaded and read back, the machine profile barrier, the original put back', async () => {
    const client = live.client;
    const original = await client.getWorkflow();
    const template = blooming();
    const profile = buildVersionProfile(template, buildStartingProfile(template, DOSE_G), TITLE, BAG);
    const context: WorkflowContext = {
      targetDoseWeight: DOSE_G,
      targetYield: startingYield(template, DOSE_G),
      coffeeName: BAG,
      coffeeRoaster: 'CafAI',
      extras: { cafai: TAG },
    };
    // Put back the way CafAI loads, so a slow PUT that answers 503 but lands still counts (5.13).
    const putBack = undo.add('the workflow', async () => {
      // Decaid's own profile, sent back as Decaid gave it.
      const profileBack = original.profile as unknown as ProfileJson;
      const restored = await activateProfile(client, profileBack, restoreContext(original.context, context), { shotRunning: false });
      const difference = contextDifference(original.context, restored.context);
      if (difference) throw new Error(`Decaid kept a context other than the original (${difference}).`);
    });

    // CafAI's own activation: one PUT with the complete profile, the reply checked with findProfileMismatch,
    // and after a timeout or a 503 the workflow read back and checked with the tag.
    const loaded = await activateProfile(client, profile, context, { shotRunning: false });
    expect(contextNotKept(context, loaded.context), 'the context Decaid kept').toBeNull();
    const onMachine = await loadProfileOnMachine(client, loaded.profile, { fetch: live.fetch });
    expect(onMachine, 'POST /api/v1/machine/profile').toBe(links.machine ? 'loaded' : 'offline');

    await putBack();
    const after = await client.getWorkflow();
    expect(findProfileMismatch(original.profile, after.profile), 'the original profile is back').toBeNull();
    expect(contextDifference(original.context, after.context), 'the original context is back').toBeNull();
    expect(live.problems()).toEqual([]);
  });

  it('a profile CafAI creates has the id CafAI computes, and is hidden afterwards', async () => {
    const client = live.client;
    const template = blooming();
    const base = { ...buildStartingProfile(template, DOSE_G), target_weight: TEST_TARGET_G };
    const profile = buildVersionProfile(template, base, TITLE, BAG);
    const { record } = await createProfileVersion(client, { profile });
    const path = `/api/v1/profiles/${encodeURIComponent(record.id)}/visibility`;
    const hideNow = undo.add('the test profile', async () => {
      const reply = await live.send('PUT', path, { visibility: 'hidden' });
      if (reply.status !== 200) throw new Error(`PUT ${path} answered HTTP ${reply.status}.`);
    });
    expect(record.id, 'Decaid’s id is the one CafAI computes').toBe(profileId(profile));
    expect(findProfileMismatch(profile, record.profile), 'the profile Decaid stored').toBeNull();

    await hideNow();
    expect((await client.listProfiles()).map((item) => item.id), 'visible profiles').not.toContain(record.id);
    const hidden = (await client.listProfiles({ includeHidden: true })).find((item) => item.id === record.id);
    expect(hidden?.visibility, 'with the hidden ones').toBe('hidden');
    expect(live.problems()).toEqual([]);
  });

  it('a bean and a batch CafAI creates are listed, then archived', async () => {
    const client = live.client;
    const bean = await client.createBean({ roaster: 'CafAI', name: BAG, processing: 'washed', notes: 'Made by npm run test:decaid, which archives it.' });
    const archiveBean = undo.add('the test bean', () => archive(`/api/v1/beans/${encodeURIComponent(bean.id)}`));
    const batch = await client.createBatch(bean.id, { roastDate: '2026-10-01', roastLevel: 'light' });
    const archiveBatch = undo.add('the test batch', () => archive(`/api/v1/bean-batches/${encodeURIComponent(batch.id)}`));
    expect(batch.beanId, 'the batch’s bean').toBe(bean.id);
    expect((await client.listBeans()).map((item) => item.id), 'beans').toContain(bean.id);
    expect((await client.listBatches(bean.id)).map((item) => item.id), 'its batches').toContain(batch.id);
    expect((await client.listAllBatches()).map((item) => item.id), 'every batch, as the bean card reads them').toContain(batch.id);

    await archiveBatch();
    await archiveBean();
    expect((await client.listBatches(bean.id)).map((item) => item.id), 'batches after archiving').not.toContain(batch.id);
    expect((await client.listAllBatches()).map((item) => item.id), 'every batch after archiving').not.toContain(batch.id);
    expect((await client.listAllBatches({ includeArchived: true })).map((item) => item.id), 'with the archived ones').toContain(batch.id);
    expect((await client.listBeans()).map((item) => item.id), 'beans after archiving').not.toContain(bean.id);
    expect(live.problems()).toEqual([]);
  });

  it('gateway mode read, set to tracking, then restored', async () => {
    const client = live.client;
    const before = (await client.getSettings()).gatewayMode;
    if (typeof before !== 'string') assert.fail(`GET /api/v1/settings sent no gatewayMode (${typeof before}).`);
    const restoreNow = undo.add('gateway mode', async () => {
      const settings = await client.updateSettings({ gatewayMode: before });
      if (settings.gatewayMode !== before) throw new Error(`gatewayMode stayed ${String(settings.gatewayMode)}, not ${before}.`);
    });
    expect((await client.updateSettings({ gatewayMode: 'tracking' })).gatewayMode, 'after setting tracking').toBe('tracking');

    await restoreNow();
    expect((await client.getSettings()).gatewayMode, 'after restoring').toBe(before);
    expect(live.problems()).toEqual([]);
  });
});
