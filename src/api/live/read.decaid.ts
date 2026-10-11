/**
 * CafAI against a running Decaid, read-only (spec 4.4 "Always"; D104: safe on
 * a tablet). Every call goes through CafAI's own client and parsers; every
 * reply is checked against the pinned spec (contract/decaid/, with its drift
 * registry), and nothing may land in CafAI's drift log. `npm test` never runs it.
 *
 *   DECAID_URL=http://<tablet-ip>:8080 npm run test:decaid
 *
 * Without DECAID_URL every check is reported as skipped.
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { profileId, summarizeShot } from '../../coach/index.ts';
import { deviceConnections, parseMachineFrame, type DeviceConnections, type ParsedScaleFrame } from '../frames.ts';
import { listGrinders } from '../grinders.ts';
import { GatewayError } from '../types.ts';
import { describeDecaid, openDecaid, type LiveDecaid } from './env.ts';
import { captureChannels, channelName, checkFrames, telemetryChannels, type ChannelWatch } from './harness.ts';

/** How long every channel is listened to. */
const LISTEN_MS = 5000;
/** Decaid replays these on connect (a BehaviorSubject behind each). */
const REPLAYED = new Set(['/ws/v1/devices', '/ws/v1/machine/shotState']);
/** These send while the machine is connected: snapshots twice a second at rest, water levels every second. */
const WHILE_MACHINE = new Set(['/ws/v1/machine/snapshot', '/ws/v1/machine/waterLevels']);
const SCALE = '/ws/v1/scale/snapshot';
/** A bean id no Decaid has: its batches are an empty list. */
const NO_BEAN = 'cafai-contract-test-no-bean';

describeDecaid('read', ({ url }) => {
  let live: LiveDecaid;
  /** From GET /api/v1/devices, read the way CafAI reads it. */
  let links: DeviceConnections = { machine: false, scale: false };

  beforeAll(async () => {
    live = await openDecaid(url);
    links = deviceConnections({ devices: await live.client.getDevices() }) ?? links;
  });
  beforeEach(() => live.reset());

  /** With a machine connected the call must answer; without one Decaid says so, and CafAI reads it as not_connected. */
  async function machineCall<T>(call: () => Promise<T>): Promise<T | null> {
    if (links.machine) return call();
    const error = await call().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error instanceof GatewayError ? error.code : error, 'no machine: CafAI reads not_connected').toBe('not_connected');
    return null;
  }

  it('GET /api/v1/info: which Decaid this is', async () => {
    const info = await live.client.getInfo();
    const machine = links.machine ? 'machine connected' : 'no machine';
    const scale = links.scale ? 'scale connected' : 'no scale';
    console.log(`Decaid ${info.fullVersion} (${info.commitShort}) at ${live.url}: ${machine}, ${scale}`);
    expect(info.fullVersion, 'fullVersion').not.toBe('');
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/machine/info', async () => {
    const info = await machineCall(() => live.client.getMachineInfo());
    if (info) expect(typeof info.GHC, 'GHC').toBe('boolean');
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/machine/state: a snapshot CafAI’s parser takes', async () => {
    const snapshot = await machineCall(() => live.client.getMachineState());
    if (snapshot) expect(parseMachineFrame(snapshot), 'parsed').not.toBeNull();
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/devices', async () => {
    const devices = await live.client.getDevices();
    expect(deviceConnections({ devices }), 'read as links').not.toBeNull();
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/workflow: a profile CafAI can identify', async () => {
    const workflow = await live.client.getWorkflow();
    expect(workflow.profile.steps.length, 'steps').toBeGreaterThan(0);
    expect(profileId(workflow.profile), 'its Decaid id, computed by CafAI').toMatch(/^profile:[0-9a-f]{20}$/);
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/settings', async () => {
    const settings = await live.client.getSettings();
    expect(typeof settings.gatewayMode, 'gatewayMode').toBe('string');
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/machine/capabilities', async () => {
    const capabilities = await machineCall(() => live.client.getCapabilities());
    if (capabilities) expect(Array.isArray(capabilities)).toBe(true);
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/grinders', async () => {
    expect(Array.isArray(await listGrinders(live.client, { fetch: live.fetch }))).toBe(true);
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/beans and a bean’s batches', async () => {
    const beans = await live.client.listBeans();
    const batches = await live.client.listBatches(beans[0]?.id ?? NO_BEAN);
    if (beans.length === 0) expect(batches, 'the batches of a bean Decaid does not have').toEqual([]);
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/bean-batches: every batch at once, as the bean card reads them (6.1)', async () => {
    const batches = await live.client.listAllBatches();
    const withArchived = await live.client.listAllBatches({ includeArchived: true });
    expect(withArchived.length, 'with the archived ones').toBeGreaterThanOrEqual(batches.length);
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/plugins: each says whether it is loaded (D103)', async () => {
    const plugins = await live.client.listPlugins();
    expect(plugins.filter((plugin) => typeof plugin.loaded !== 'boolean').map((plugin) => plugin.id), 'without a loaded flag').toEqual([]);
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/display (CafAI does not read it yet)', async () => {
    expect((await live.send('GET', '/api/v1/display')).status).toBe(200);
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/shots/latest and that shot, summarised by CafAI', async () => {
    // A Decaid without shots answers 200 null, which CafAI reads as none.
    const latest = await live.client.getLatestShot();
    if (latest) {
      const shot = await live.client.getShot(latest.id);
      expect(shot.id).toBe(latest.id);
      expect(summarizeShot(shot).shotId).toBe(latest.id);
    }
    expect(live.problems()).toEqual([]);
  });

  it('GET /api/v1/store/cafai?full=1: CafAI’s backup namespace', async () => {
    const all = await live.client.kv.getAll('cafai');
    expect(all.notModified, 'a first read').toBe(false);
    expect(live.problems()).toEqual([]);
  });

  // Every channel at once, for LISTEN_MS, on the first channel's check.
  const channels = telemetryChannels();
  let capture: Promise<Map<string, ChannelWatch>> | null = null;
  const captured = () => (capture ??= captureChannels(live.client.wsOrigin, channels, LISTEN_MS));

  /** The links the last devices frame gives, read the way CafAI reads it; the REST ones without a frame. */
  function frameLinks(watches: Map<string, ChannelWatch>): DeviceConnections {
    const frames = watches.get('/ws/v1/devices')?.frames ?? [];
    const last = frames[frames.length - 1];
    if (last === undefined) return links;
    try {
      return deviceConnections(JSON.parse(last)) ?? links;
    } catch {
      return links;
    }
  }

  for (const path of channels) {
    const channel = channelName(path);
    it(`${channel}: frames CafAI’s parser takes, as the spec says`, async () => {
      const watches = await captured();
      const watch = watches.get(path);
      if (!watch) throw new Error(`${channel} was not listened to.`);
      expect(watch.opened, `${channel} opened`).toBe(true);
      expect(watch.ended, `${channel} stayed open`).toBeNull();
      const { parsed, problems } = checkFrames(path, watch.frames, live.validator);
      expect(problems, `${channel}: frames CafAI or the spec disagree with`).toEqual([]);

      const now = frameLinks(watches);
      if (REPLAYED.has(path)) expect(parsed.length, `${channel}: replayed on connect`).toBeGreaterThan(0);
      if (WHILE_MACHINE.has(path) && now.machine) expect(parsed.length, `${channel}: within 5 s, machine connected`).toBeGreaterThan(0);
      if (path === SCALE && now.scale) {
        const weights = (parsed as ParsedScaleFrame[]).filter((frame) => frame?.kind === 'snapshot');
        expect(weights.length, `${channel}: weights within 5 s, scale connected`).toBeGreaterThan(0);
      }
      expect(live.problems()).toEqual([]);
    });
  }
});
