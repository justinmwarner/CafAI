import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseDecaidTimestamp } from '../../src/api/time.ts';
import { createMockServer } from '../node.ts';
import { createShotPlayer } from './shotPlayer.ts';
import { createMockDecaid } from './state.ts';

const START = new Date(2026, 9, 3, 8, 15, 2, 725).getTime();

afterEach(() => vi.useRealTimers());

function setup(options: Parameters<typeof createMockDecaid>[0] = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  const state = createMockDecaid({ seedExamples: false, uploadMs: 0, ...options });
  const player = createShotPlayer(state, { speed: 10 });
  return { state, player };
}

describe("the mock's steam records (D191), as steam_sequencer.dart keeps them", () => {
  it('a steaming leaves one record: opened on its first frame in steam, with the workflow then and a sample per frame', async () => {
    const { state, player } = setup();
    expect(state.getSteamIds()).toEqual([]);
    expect(state.getLatestSteam()).toBeNull();
    const before = state.getMachineSnapshot().timestamp;
    player.command('steam');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(player.activity).toBeNull();

    const ids = state.getSteamIds();
    expect(ids).toHaveLength(1);
    const record = state.getSteam(ids[0]!);
    expect(parseDecaidTimestamp(record.timestamp)).toBeGreaterThan(parseDecaidTimestamp(before));
    expect(record.workflow.steamSettings).toEqual(state.getWorkflow().steamSettings);
    expect(record.measurements.length).toBeGreaterThan(200);
    expect(record.measurements.every((sample) => sample.machine.state.state === 'steam' && sample.milkTemperature === null)).toBe(true);
    // The warm-up and the wand's purge are part of the steaming.
    expect(record.measurements[0]!.machine.state.substate).toBe('preparingForShot');
    expect(record.measurements.at(-1)!.machine.state.substate).toBe('puffing');
    expect(record.measurements[0]!.machine.timestamp).toBe(record.timestamp);
  });

  it('lists them newest first without measurements, and answers the newest the same way', async () => {
    const { state, player } = setup();
    player.command('steam');
    await vi.advanceTimersByTimeAsync(10_000);
    player.command('steam');
    await vi.advanceTimersByTimeAsync(10_000);
    const [first, second] = state.getSteamIds();
    const list = state.listSteams();
    expect(list.map((steam) => steam.id)).toEqual([second, first]);
    expect(list.every((steam) => !('measurements' in steam))).toBe(true);
    expect(state.getLatestSteam()).toEqual(list[0]);
  });

  it('a hot water or a flush leaves none, and a steam the machine left mid-way is discarded', async () => {
    const { state, player } = setup();
    player.command('hotWater');
    await vi.advanceTimersByTimeAsync(10_000);
    player.command('flush');
    await vi.advanceTimersByTimeAsync(10_000);
    player.command('steam');
    await vi.advanceTimersByTimeAsync(300);
    state.setMachineConnected(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.getSteamIds()).toEqual([]);
  });

  it('a steam the barista stops is kept, as the machine left steam', async () => {
    const { state, player } = setup();
    player.command('steam');
    await vi.advanceTimersByTimeAsync(400);
    player.command('idle');
    await vi.advanceTimersByTimeAsync(200);
    expect(player.activity).toBeNull();
    expect(state.getSteamIds()).toHaveLength(1);
  });

  it('getSteam answers 404 with its error for an id it does not have', () => {
    const { state } = setup();
    expect(() => state.getSteam('nope')).toThrow(expect.objectContaining({ status: 404, body: { error: 'Steam record not found' } }));
  });
});

describe('a cleaning profile run (D191)', () => {
  it('saves no shot, as Decaid skips cleaning and calibration profiles; an espresso profile still does', async () => {
    const { state, player } = setup();
    const espresso = state.getWorkflow().profile;
    state.updateWorkflow({ profile: { ...espresso, title: 'Cleaning/Forward Flush x5', beverage_type: 'cleaning' } });
    await vi.advanceTimersByTimeAsync(100);
    player.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(player.activity).toBeNull();
    expect(state.getShotIds()).toEqual([]);

    state.updateWorkflow({ profile: espresso });
    await vi.advanceTimersByTimeAsync(100);
    player.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.getShotIds()).toHaveLength(1);
  });
});

describe('the steam routes', () => {
  const mock = createMockServer([], { seedExamples: false });
  beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => mock.close());

  const get = async (path: string) => {
    const response = await fetch(`http://tablet.local:8080/api/v1${path}`);
    return { status: response.status, body: (await response.json()) as unknown };
  };

  it('answer the list, the ids, the newest (null before any) and one by id, as steams_handler.dart does', async () => {
    expect(await get('/steams')).toEqual({ status: 200, body: [] });
    expect(await get('/steams/ids')).toEqual({ status: 200, body: [] });
    expect(await get('/steams/latest')).toEqual({ status: 200, body: null });
    expect(await get('/steams/nope')).toEqual({ status: 404, body: { error: 'Steam record not found' } });

    const workflow = mock.state.getWorkflow();
    mock.state.addSteam({ id: 'steam-1', timestamp: '2026-10-03T08:15:02.725000', measurements: [], workflow });
    expect(await get('/steams/ids')).toEqual({ status: 200, body: ['steam-1'] });
    expect(await get('/steams/latest')).toEqual({ status: 200, body: { id: 'steam-1', timestamp: '2026-10-03T08:15:02.725000', workflow } });
    expect((await get('/steams/steam-1')).body).toMatchObject({ id: 'steam-1', measurements: [] });
  });
});
