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
import { clampDrinkField, HOT_WATER_TEMPERATURE, RINSE_TEMPERATURE, steamTemperatureField } from '../../ui/settings/drinkSettings.ts';
import { fieldView } from '../../ui/settings/drinkUnits.ts';
import { deviceConnections, type DeviceConnections } from '../frames.ts';
import { createGrinder, getGrinder, grinderRequest, listGrinders, type GrinderDraft } from '../grinders.ts';
import { loadProfileOnMachine } from '../machineProfile.ts';
import type { DeviceEntry, WorkflowContext, WorkflowPatch } from '../types.ts';
import { activateProfile, createProfileVersion, findProfileMismatch } from '../workflow.ts';
import { describeDecaid, openDecaid, type LiveDecaid } from './env.ts';
import { contextDifference, contextNotKept, createUndoList, restoreContext, simulatorProblem, waitUntil } from './harness.ts';

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
/** The test wake schedule's time, at weekends only and never enabled. */
const TEST_WAKE_TIME = '04:56';
/** From a disconnect to Decaid answering that the machine is not connected. */
const DISCONNECT_MS = 15_000;
/** Decaid gives a connect up to 60 s on Linux (connection_manager.dart:587-591 at aab5f93). */
const RECONNECT_MS = 60_000;

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

  it('a grinder CafAI adds, each kind of dial, is listed and read back as sent, then deleted', async () => {
    const drafts: GrinderDraft[] = [
      { model: TITLE, burrs: '64 mm flat', settingType: 'numeric', smallStep: 0.5, bigStep: 2, values: null },
      { model: TITLE, burrs: '40 mm conical', settingType: 'preset', smallStep: null, bigStep: null, values: ['1', '2', '3'] },
    ];
    for (const draft of drafts) {
      const request = grinderRequest(draft);
      if (!request) assert.fail('grinderRequest made nothing of the test grinder.');
      const added = await createGrinder(live.client, request, { fetch: live.fetch });
      const path = `/api/v1/grinders/${encodeURIComponent(added.id)}`;
      // Settings and the coach only add grinders; the suite deletes its own, as nothing else would.
      const deleteNow = undo.add(`the test grinder (${draft.settingType})`, async () => {
        const reply = await live.send('DELETE', path);
        if (reply.status !== 200) throw new Error(`DELETE ${path} answered HTTP ${reply.status}.`);
      });
      expect(added, 'the grinder Decaid stored').toMatchObject({ ...request, archived: false });
      const listed = (await listGrinders(live.client, { fetch: live.fetch })).find((grinder) => grinder.id === added.id);
      expect(listed, 'in the list every skin reads').toEqual(added);
      expect(await getGrinder(live.client, added.id, { fetch: live.fetch }), 'read by its id').toEqual(added);

      await deleteNow();
      expect((await listGrinders(live.client, { fetch: live.fetch, includeArchived: true })).map((g) => g.id), 'after deleting').not.toContain(added.id);
      expect(await getGrinder(live.client, added.id, { fetch: live.fetch }), 'read by its id after deleting').toBeNull();
    }
    expect(live.problems()).toEqual([]);
  });

  it('sleep and wake: the settings changed and put back, a wake schedule added, changed and deleted', async () => {
    const client = live.client;
    const before = await client.getPresenceSettings();
    const saved = { userPresenceEnabled: before.userPresenceEnabled, sleepTimeoutMinutes: before.sleepTimeoutMinutes };
    const putBack = undo.add('the sleep and wake settings', async () => {
      const after = await client.updatePresenceSettings(saved);
      if (after.userPresenceEnabled !== saved.userPresenceEnabled || after.sleepTimeoutMinutes !== saved.sleepTimeoutMinutes) {
        throw new Error(`Decaid kept ${JSON.stringify(after)}, not ${JSON.stringify(saved)}.`);
      }
    });
    expect(await client.updatePresenceSettings({ sleepTimeoutMinutes: 999 }), 'minutes clamped to 240').toEqual({ ...saved, sleepTimeoutMinutes: 240 });
    expect(await client.updatePresenceSettings({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 }), 'on, never idle').toEqual({
      userPresenceEnabled: true,
      sleepTimeoutMinutes: 0,
    });

    // Disabled from the start, so it never wakes the simulated machine nor holds off its sleep.
    const added = await client.addWakeSchedule({ time: TEST_WAKE_TIME, daysOfWeek: [7, 6], enabled: false, keepAwakeFor: 45 });
    const deleteNow = undo.add('the test wake schedule', () => client.deleteWakeSchedule(added.id));
    expect(added, 'the schedule Decaid stored').toEqual({ id: expect.any(String), time: TEST_WAKE_TIME, daysOfWeek: [6, 7], enabled: false, keepAwakeFor: 45 });
    const changed = await client.updateWakeSchedule(added.id, { keepAwakeFor: null });
    expect(changed, 'keepAwakeFor cleared').toEqual({ id: added.id, time: TEST_WAKE_TIME, daysOfWeek: [6, 7], enabled: false });
    expect((await client.getPresenceSettings()).schedules, 'with the settings').toContainEqual(changed);

    await deleteNow();
    expect((await client.getPresenceSettings()).schedules.map((schedule) => schedule.id), 'after deleting').not.toContain(added.id);
    expect(await client.deleteWakeSchedule(added.id).then(() => null, (error: unknown) => error), 'deleted again').toMatchObject({ status: 404 });

    await putBack();
    expect(await client.getPresenceSettings(), 'after putting back').toMatchObject(saved);
    expect(live.problems()).toEqual([]);
  });

  it("sleep and wake: a wake schedule's window running now is keepAwakeUntil, and goes with the schedule's delete (D209)", async () => {
    const client = live.client;
    // Decaid holds a window only while a machine is connected (presence_controller.dart:58-69 at aab5f93).
    if (!links.machine) assert.fail('The simulated machine is not connected.');
    const before = await client.getPresenceSettings();
    if (before.keepAwakeUntil) assert.fail(`A wake schedule already keeps the machine awake until ${before.keepAwakeUntil}: run this when none does.`);
    // Two minutes back on Decaid's own clock (its machine snapshot's local time): a minute that has passed, so Decaid
    // never wakes the machine for it, inside a 30-minute window that runs now.
    const { timestamp } = await client.getMachineState();
    const clock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(timestamp);
    if (!clock) assert.fail(`The machine snapshot's time is not a local time: ${timestamp}.`);
    const [year, month, day, hour, minute] = clock.slice(1).map(Number) as [number, number, number, number, number];
    const start = new Date(year, month - 1, day, hour, minute - 2);
    const end = new Date(start.getTime() + 30 * 60_000);
    const hhmm = (at: Date) => `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const added = await client.addWakeSchedule({ time: hhmm(start), daysOfWeek: [], enabled: true, keepAwakeFor: 30 });
    // On, unlike the schedule above, so it must not stay whatever fails below: afterAll retries this and names it.
    const deleteNow = undo.add('the test wake schedule (D209)', async () => {
      if ((await client.getPresenceSettings()).schedules.some((schedule) => schedule.id === added.id)) await client.deleteWakeSchedule(added.id);
    });
    expect((await client.getPresenceSettings()).keepAwakeUntil, 'while its window runs').toMatch(new RegExp(`T${hhmm(end)}:00`));
    // Decaid's answer to the delete carries no window: CafAI reads the settings again for it.
    await client.deleteWakeSchedule(added.id);
    expect((await client.getPresenceSettings()).keepAwakeUntil, 'after deleting it').toBeNull();
    await deleteNow();
    expect((await client.getPresenceSettings()).schedules, 'the wake schedules as found').toEqual(before.schedules);
    expect(live.problems()).toEqual([]);
  });

  it('drink temperatures set in °F: kept as the whole °C CafAI sends, and read back as set, at each end (D173)', async () => {
    const client = live.client;
    // Decaid puts the drinks' settings on the machine at once, so it takes them only with one connected (D114).
    if (!links.machine) assert.fail('The simulated machine is not connected.');
    const original = await client.getWorkflow();
    const steam = original.steamSettings.targetTemperature;
    const water = original.hotWaterData.targetTemperature;
    const rinse = original.rinseData.targetTemperature;
    if (steam === null || water === null || rinse === null) assert.fail(`Decaid sent a drink temperature CafAI could not read (${steam}, ${water}, ${rinse}).`);
    const putBack = undo.add('the drink temperatures', async () => {
      const after = await client.updateWorkflow({
        steamSettings: { targetTemperature: steam },
        hotWaterData: { targetTemperature: water },
        rinseData: { targetTemperature: rinse },
      });
      const kept = [after.steamSettings.targetTemperature, after.hotWaterData.targetTemperature, after.rinseData.targetTemperature];
      if (kept.join() !== [steam, water, rinse].join()) throw new Error(`Decaid kept ${kept.join(', ')}, not ${steam}, ${water}, ${rinse}.`);
    });
    const cases = [
      ['steamSettings', steamTemperatureField(null), [275, 300, 320]],
      ['hotWaterData', HOT_WATER_TEMPERATURE, [34, 167, 212]],
      ['rinseData', RINSE_TEMPERATURE, [34, 194, 212]],
    ] as const;
    for (const [drink, spec, typed] of cases) {
      const view = fieldView(spec, 'fahrenheit');
      for (const fahrenheit of typed) {
        // As the stepper sends it: the nearest whole °C, inside CafAI's range.
        const celsius = clampDrinkField(spec, view.fromShown(fahrenheit));
        const patch: WorkflowPatch = { [drink]: { targetTemperature: celsius } };
        await client.updateWorkflow(patch);
        const kept = (await client.getWorkflow())[drink].targetTemperature;
        expect(kept, `${drink} at ${fahrenheit} °F`).toBe(celsius);
        expect(view.shown(kept ?? Number.NaN), `${drink} at ${fahrenheit} °F, read back`).toBe(fahrenheit);
      }
    }
    await putBack();
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

  it('a scan that connects nothing, a connect of a device already connected, and Connect leaving it be (D111)', async () => {
    const client = live.client;
    const before = await client.getDevices();
    const machine = before.find((device) => device.type === 'machine' && device.state === 'connected');
    if (!machine) assert.fail('The simulated machine is not connected.');
    // CafAI's scan is discovery only (connect=false): it lists what it found and connects nothing.
    expect((await client.scanDevices()).map((device) => device.id), 'the scan lists the machine').toContain(machine.id);
    expect(connectedIds(await client.getDevices()), 'connected after the scan').toEqual(connectedIds(before));
    // Decaid answers a connect of a device it has connected already, and leaves it connected.
    await client.connectDevice(machine.id);
    expect(connectedIds(await client.getDevices()), 'connected after connecting the connected machine').toEqual(connectedIds(before));
    // CafAI's own Connect, reading Decaid's preferred devices, leaves connected devices as they are.
    for (const kind of ['machine', 'scale'] as const) {
      expect(connectedIds(await client.connectKind(kind)), `connected after Connect ${kind}`).toEqual(connectedIds(before));
    }
    expect(live.problems()).toEqual([]);
  });

  // Last: it takes the machine away, and puts it back.
  it("without a machine, CafAI reads Decaid's answer as not connected, in the words the machine alert shows", async () => {
    const client = live.client;
    const machine = (await client.getDevices()).find((device) => device.type === 'machine' && device.state === 'connected');
    if (!machine) assert.fail('The simulated machine is not connected.');
    const machineBack = undo.add('the machine connection', () => reconnect(machine.id));
    const reply = await live.send('PUT', '/api/v1/devices/disconnect', { deviceId: machine.id });
    expect(reply.status, 'PUT /api/v1/devices/disconnect').toBe(200);
    const refused = await waitUntil(
      () => client.getMachineState().then(() => null, (error: unknown) => error),
      DISCONNECT_MS,
      'Decaid to answer for a machine it has not got',
    );
    expect(refused).toMatchObject({ code: 'not_connected', message: 'The machine is not connected. Wake the DE1 and check it is paired with Decaid.' });
    for (const call of [() => client.getMachineInfo(), () => client.getCapabilities()]) {
      expect(await call().then(() => null, (error: unknown) => error)).toMatchObject({ code: 'not_connected' });
    }
    await machineBack();
    expect(live.problems()).toEqual([]);
  });

  /** The connected devices' ids, sorted. */
  function connectedIds(devices: readonly DeviceEntry[]): string[] {
    return devices.filter((device) => device.state === 'connected').map((device) => device.id).sort();
  }

  /** The simulated machine connected again: by id, or else by the scan Decaid's own CI start uses (scripts/decaid-ci.sh). */
  async function reconnect(machineId: string): Promise<void> {
    const client = live.client;
    const connected = async () => ((await client.getDevices()).some((device) => device.id === machineId && device.state === 'connected') ? true : null);
    await client.connectDevice(machineId).catch(() => undefined);
    const back = await waitUntil(connected, RECONNECT_MS / 3, 'the simulated machine to connect again').catch(() => null);
    if (back) return;
    await live.send('GET', '/api/v1/devices/scan?connect=true&quick=true');
    await waitUntil(connected, RECONNECT_MS, 'the simulated machine to connect again after a scan');
  }
});
