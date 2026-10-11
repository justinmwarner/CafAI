/**
 * A simulated shot through CafAI's own client and parsers (spec 4.4,
 * DECAID_SIM=1): espresso, the shotState sequence, the shot record read and
 * summarised by CafAI's summariser, notes and a rating written and read back,
 * then idle. Every reply and every frame of the shot is checked against the
 * pinned spec and for drift. A simulator only (D104): it refuses to run unless
 * Decaid simulates the machine and no real machine is connected, because
 * espresso moves water. `npm test` never runs it.
 *
 *   DECAID_URL=http://localhost:8080 DECAID_SIM=1 npm run test:decaid
 *
 * The shot stays in Decaid's history, with the suite's notes on it.
 */
import { afterAll, assert, beforeAll, beforeEach, expect, it } from 'vitest';
import { summarizeShot } from '../../coach/index.ts';
import { deviceConnections, parseShotStateFrame } from '../frames.ts';
import { GatewayError, type ShotStateEvent } from '../types.ts';
import { describeDecaid, openDecaid, type LiveDecaid } from './env.ts';
import { channelName, checkFrames, createUndoList, simulatorProblem, waitUntil, watchChannel, type ChannelWatch } from './harness.ts';

/** Decaid replays the latest shotState frame when the socket opens. */
const REPLAY_MS = 10_000;
/** From the espresso command to shotState finished (spec 4.4): preheat, the pour and the stop. */
const SHOT_MS = 90_000;
/** From finished to the record in Decaid's history. */
const RECORD_MS = 15_000;
const IDLE_MS = 15_000;
const SHOT_STATE = '/ws/v1/machine/shotState';
/** Listened to for the whole shot, then checked frame by frame. */
const SHOT_CHANNELS = [SHOT_STATE, '/ws/v1/machine/snapshot', '/ws/v1/scale/snapshot'];
const NOTES = 'CafAI contract test: written and read back by npm run test:decaid.';
/** Why a check after a shot that never finished cannot run: skipped, or failed under DECAID_REQUIRE=1. */
const NO_SHOT = 'needs the shot from the first check, which did not finish';

function shotEvent(text: string): ShotStateEvent | null {
  try {
    return parseShotStateFrame(JSON.parse(text));
  } catch {
    return null;
  }
}

describeDecaid('shot', ({ url, require }) => {
  let live: LiveDecaid;
  const undo = createUndoList();
  const watches: ChannelWatch[] = [];
  let idleNow: (() => Promise<void>) | null = null;
  let shotId: string | null = null;

  beforeAll(async () => {
    live = await openDecaid(url);
    const [settings, devices] = await Promise.all([live.client.getSettings(), live.client.getDevices()]);
    const problem = simulatorProblem(settings, devices);
    if (problem) throw new Error(`DECAID_SIM=1 runs only against Decaid's simulator (D104), and ${problem}.`);
    const links = deviceConnections({ devices });
    if (!links?.machine || !links.scale) {
      throw new Error('DECAID_SIM=1 needs the simulated machine and scale connected (docs/SIMULATOR.md part 2, or scripts/decaid-ci.sh).');
    }
    if (settings.gatewayMode === 'full') {
      throw new Error('Decaid’s gateway mode is Full, so it would not stop the shot at its target weight: set Tracking or Disabled.');
    }
    // Listening before the shot: shotState replays where it is, and every frame of the shot is checked at the end.
    for (const path of SHOT_CHANNELS) watches.push(watchChannel(live.client.wsOrigin, path));
  });
  beforeEach(() => live.reset());
  afterAll(async () => {
    for (const watch of watches) watch.close();
    const failures = await undo.runAll();
    if (failures.length > 0) throw new Error(`Could not put back: ${failures.join('; ')}.`);
  });

  it('espresso: shotState goes preheating or pouring, then finished', async () => {
    const shotState = watches.find((watch) => watch.path === SHOT_STATE);
    if (!shotState) throw new Error('shotState is not being listened to.');
    const client = live.client;
    // The replayed frame may be an earlier shot's finished: only frames after it count.
    await waitUntil(() => (shotState.frames.length > 0 ? true : null), REPLAY_MS, 'shotState to replay where it is');
    const before = shotState.frames.length;
    const events = () => shotState.frames.slice(before).map(shotEvent).filter((event) => event !== null);
    idleNow = undo.add('the machine (idle)', () => client.setMachineState('idle'));

    const startedAt = Date.now();
    await client.setMachineState('espresso');
    const started = await waitUntil(() => events().find((event) => event.state === 'preheating' || event.state === 'pouring'), SHOT_MS, 'shotState preheating or pouring');
    const left = Math.max(0, SHOT_MS - (Date.now() - startedAt));
    const finished = await waitUntil(() => events().find((event) => event.state === 'finished'), left, 'shotState finished');
    if (started.shotId !== null && finished.shotId !== null) expect(finished.shotId, 'one shot from start to finish').toBe(started.shotId);
    shotId = finished.shotId ?? started.shotId;
    expect(shotId, 'the shot’s id').toBeTruthy();
    expect(live.problems()).toEqual([]);
  });

  it('the shot record: CafAI reads it, and its summary has a pour and pressure', async ({ skip }) => {
    const id = shotId;
    if (id === null) return require ? assert.fail(NO_SHOT) : skip(NO_SHOT);
    const record = await waitUntil(
      () =>
        live.client.getShot(id).catch((error: unknown) => {
          if (error instanceof GatewayError && error.status === 404) return null;
          throw error;
        }),
      RECORD_MS,
      `shot ${id} in Decaid’s history`,
    );
    expect(record.measurements.length, 'measurements').toBeGreaterThan(0);
    const summary = summarizeShot(record);
    // A real pour, not a full-length shot: a fresh Decaid (scripts/decaid-ci.sh
    // starts each run with a new profile) pours its default for about 4 s on
    // the simulated machine and scale, a simulator full of CafAI's versions
    // for much longer.
    expect(summary.durationS, 'the pour, in s').toBeGreaterThan(2);
    expect(summary.peakPressureBar ?? 0, 'peak pressure, in bar').toBeGreaterThan(1);
    expect(live.problems()).toEqual([]);
  });

  it('notes and a rating on the probed scale are written and read back', async ({ skip }) => {
    const id = shotId;
    if (id === null) return require ? assert.fail(NO_SHOT) : skip(NO_SHOT);
    const scale = await live.client.probeEnjoymentScale();
    if (scale === null) assert.fail('The rating-scale probe got no answer CafAI understands.');
    const enjoyment = scale === 100 ? 80 : 8;
    await live.client.updateShot(id, { annotations: { espressoNotes: NOTES, enjoyment } });
    const annotations = (await live.client.getShot(id)).annotations;
    expect(annotations?.espressoNotes, 'espressoNotes').toBe(NOTES);
    expect(annotations?.enjoyment, `enjoyment on the 0-${scale} scale`).toBe(enjoyment);
    expect(live.problems()).toEqual([]);
  });

  it('idle: the machine goes back to rest', async () => {
    if (idleNow) await idleNow();
    else await live.client.setMachineState('idle');
    const state = await waitUntil(
      async () => {
        const snapshot = await live.client.getMachineState();
        return snapshot.state.state === 'idle' ? snapshot.state.state : null;
      },
      IDLE_MS,
      'the machine to report idle',
    );
    expect(state).toBe('idle');
    expect(live.problems()).toEqual([]);
  });

  it('every frame of the shot: CafAI’s parsers take it, as the spec says', () => {
    const problems = watches.flatMap((watch) =>
      checkFrames(watch.path, watch.frames, live.validator).problems.map((problem) => `${channelName(watch.path)}: ${problem}`),
    );
    expect(problems).toEqual([]);
    expect(live.problems()).toEqual([]);
  });
});
