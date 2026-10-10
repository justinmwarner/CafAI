import { getResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WireProfile } from '../../src/api/types.ts';
import { fixtures } from '../fixtures/index.ts';
import { MockHttpError } from './errors.ts';
import { decaidFallbackHandlers, decaidHttpHandlers } from './handlers.ts';
import { createShotPlayer } from './shotPlayer.ts';
import { createMockDecaid, type MockDecaidOptions } from './state.ts';

const NO_MACHINE = { error: 'DeviceNotConnectedException: machine not connected' };

afterEach(() => {
  vi.useRealTimers();
});

/** The mock on fake timers, with its REST handlers callable without a server (no sockets needed here). */
function setup(options: MockDecaidOptions & { speed?: number } = {}) {
  vi.useFakeTimers();
  const { speed, ...stateOptions } = options;
  const state = createMockDecaid({ seedExamples: false, ...stateOptions });
  const player = createShotPlayer(state, { speed: speed ?? 1 });
  const handlers = [...decaidHttpHandlers(state, player), ...decaidFallbackHandlers()];
  async function call(method: string, path: string, body?: unknown) {
    const init: RequestInit = { method };
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    const response = await getResponse(handlers, new Request(`http://tablet.local:8080/api/v1${path}`, init));
    if (!response) throw new Error(`no handler for ${method} ${path}`);
    const text = await response.text();
    let json: unknown = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      // plain text
    }
    return { status: response.status, text, body: json };
  }
  /** Settles `promise` while the fake clock runs; `ms` is how far to run it. */
  async function settle<T>(promise: Promise<T>, ms: number): Promise<T> {
    await vi.advanceTimersByTimeAsync(ms);
    return promise;
  }
  return { state, player, call, settle };
}

/** A complete profile that differs from the workflow's in its title and temperatures. */
function variant(title: string, temperature = 80): WireProfile {
  const base = fixtures.workflowGet().profile;
  return { ...base, title, steps: base.steps.map((step) => ({ ...step, temperature })) };
}

describe('the DE1 holds its own profile', () => {
  it("starts with the workflow's profile, and hands out copies", () => {
    const { state } = setup();
    expect(state.getMachineProfile()).toEqual(state.getWorkflow().profile);
    expect(state.isUploadingProfile()).toBe(false);
    state.getMachineProfile().steps.splice(0);
    expect(state.getMachineProfile()).toEqual(state.getWorkflow().profile);
  });

  it('takes a new workflow profile only after uploadMs of wall time; until then it keeps the old one', async () => {
    const { state } = setup();
    const before = state.getMachineProfile();
    state.updateWorkflow({ profile: variant('B') });
    expect(state.getWorkflow().profile.title).toBe('B');
    expect(state.getMachineProfile()).toEqual(before);
    expect(state.isUploadingProfile()).toBe(true);
    await vi.advanceTimersByTimeAsync(799);
    expect(state.getMachineProfile()).toEqual(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.getMachineProfile()).toEqual(state.getWorkflow().profile);
    expect(state.isUploadingProfile()).toBe(false);
  });

  it('honours uploadMs, and 0 uploads at once', async () => {
    const slow = setup({ uploadMs: 3000 });
    slow.state.updateWorkflow({ profile: variant('B') });
    await vi.advanceTimersByTimeAsync(2999);
    expect(slow.state.getMachineProfile().title).not.toBe('B');
    await vi.advanceTimersByTimeAsync(1);
    expect(slow.state.getMachineProfile().title).toBe('B');

    const instant = setup({ uploadMs: 0 });
    instant.state.updateWorkflow({ profile: variant('C') });
    expect(instant.state.getMachineProfile().title).toBe('C');
    expect(instant.state.isUploadingProfile()).toBe(false);
  });

  it('the upload time does not follow the shot speed', async () => {
    const { state } = setup({ speed: 100 });
    state.updateWorkflow({ profile: variant('B') });
    await vi.advanceTimersByTimeAsync(100);
    expect(state.getMachineProfile().title).not.toBe('B');
    await vi.advanceTimersByTimeAsync(700);
    expect(state.getMachineProfile().title).toBe('B');
  });

  it('a context-only PUT, or the same profile again, uploads nothing', async () => {
    const { state } = setup();
    state.updateWorkflow({ context: { targetYield: 40 } });
    expect(state.isUploadingProfile()).toBe(false);
    state.updateWorkflow({ profile: state.getWorkflow().profile });
    expect(state.isUploadingProfile()).toBe(false);
  });

  it('compares all ten keys: a new title alone is an upload, like Decaid', () => {
    const { state } = setup();
    state.updateWorkflow({ profile: { ...state.getWorkflow().profile, title: 'Renamed' } });
    expect(state.isUploadingProfile()).toBe(true);
  });

  it('uploads one at a time, first in first out, the newest workflow profile winning', async () => {
    const { state } = setup();
    state.updateWorkflow({ profile: variant('B') });
    state.updateWorkflow({ profile: variant('C') });
    state.updateWorkflow({ profile: variant('D') });
    await vi.advanceTimersByTimeAsync(800);
    expect(state.getMachineProfile().title).toBe('B');
    expect(state.isUploadingProfile()).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(state.getMachineProfile().title).toBe('D');
    expect(state.isUploadingProfile()).toBe(false);
  });

  it('a PUT back to the profile on the machine during an upload still ends on the workflow profile', async () => {
    const { state } = setup();
    const original = state.getWorkflow().profile;
    state.updateWorkflow({ profile: variant('B') });
    state.updateWorkflow({ profile: original });
    await vi.advanceTimersByTimeAsync(1600);
    expect(state.getMachineProfile()).toEqual(original);
    expect(state.isUploadingProfile()).toBe(false);
  });

  it('with no machine the upload waits for the next connect', async () => {
    const { state } = setup({ machineConnected: false });
    const before = state.getMachineProfile();
    state.updateWorkflow({ profile: variant('B') });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.getMachineProfile()).toEqual(before);
    expect(state.isUploadingProfile()).toBe(false);
    state.setMachineConnected(true);
    expect(state.isUploadingProfile()).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(state.getMachineProfile().title).toBe('B');
  });

  it('a machine that drops mid-upload keeps its old profile and takes the new one after it reconnects', async () => {
    const { state } = setup();
    const before = state.getMachineProfile();
    state.updateWorkflow({ profile: variant('B') });
    await vi.advanceTimersByTimeAsync(400);
    state.setMachineConnected(false);
    expect(state.isUploadingProfile()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.getMachineProfile()).toEqual(before);
    state.setMachineConnected(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(state.getMachineProfile().title).toBe('B');
  });

  it('dispose() stops an upload timer', async () => {
    const { state, player } = setup();
    state.updateWorkflow({ profile: variant('B') });
    state.dispose();
    player.dispose(); // also stops the player's own free-running timers (D5's time-to-ready ticker)
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.getMachineProfile().title).not.toBe('B');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('loadMachineProfile: the barrier behind POST /api/v1/machine/profile', () => {
  it('waits for the upload in flight, then answers at once because the machine holds the profile', async () => {
    const { state } = setup();
    const workflow = state.updateWorkflow({ profile: variant('B') });
    let answered = false;
    const barrier = state.loadMachineProfile(workflow.profile).then(() => {
      answered = true;
    });
    await vi.advanceTimersByTimeAsync(799);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);
    await barrier;
    expect(state.getMachineProfile().title).toBe('B');
  });

  it('uploads first, for uploadMs again, when the machine holds something else; the workflow stays as it was', async () => {
    const { state } = setup();
    let answered = false;
    void state.loadMachineProfile(variant('X')).then(() => {
      answered = true;
    });
    await vi.advanceTimersByTimeAsync(799);
    expect(answered).toBe(false);
    expect(state.getMachineProfile().title).not.toBe('X');
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);
    expect(state.getMachineProfile().title).toBe('X');
    expect(state.getWorkflow().profile.title).not.toBe('X');
  });

  it('answers at once when the machine already holds the profile', async () => {
    const { state } = setup();
    await expect(state.loadMachineProfile(state.getWorkflow().profile)).resolves.toBeUndefined();
  });

  it("without a machine it is a 500 with Decaid's own body", async () => {
    const { state } = setup({ machineConnected: false });
    await expect(state.loadMachineProfile(variant('B'))).rejects.toMatchObject({ status: 500, body: NO_MACHINE });
  });

  it('fails the same way when the machine drops while the barrier waits', async () => {
    const { state } = setup();
    state.updateWorkflow({ profile: variant('B') });
    const barrier = state.loadMachineProfile(variant('B')).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(300);
    state.setMachineConnected(false);
    expect(await barrier).toMatchObject({ status: 500, body: NO_MACHINE });
  });

  it('a profile Decaid cannot read is a 500 with {error, st}, as an unexpected machine-route exception', async () => {
    const { state } = setup();
    const error = await state.loadMachineProfile({ ...variant('B'), title: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MockHttpError);
    expect((error as MockHttpError).status).toBe(500);
    expect((error as MockHttpError).body).toEqual({ error: 'Invalid argument(s): Profile must have a non-empty "title"', st: expect.any(String) });
  });
});

describe('runMachineWrite: the one write queue', () => {
  it('waits for an upload in flight', async () => {
    const { state } = setup();
    state.updateWorkflow({ profile: variant('B') });
    const seen: string[] = [];
    const write = state.runMachineWrite(() => {
      seen.push(state.getMachineProfile().title);
      return 'done';
    });
    await vi.advanceTimersByTimeAsync(799);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual(['B']);
    await expect(write).resolves.toBe('done');
  });

  it('runs at once when nothing is queued, and passes a failure back', async () => {
    const { state } = setup();
    await expect(state.runMachineWrite(() => 7)).resolves.toBe(7);
    await expect(
      state.runMachineWrite(() => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    await expect(state.runMachineWrite(async () => 'next')).resolves.toBe('next');
  });
});

describe('POST /api/v1/machine/profile over HTTP', () => {
  it('answers 200 null once the machine holds the posted profile', async () => {
    const { call, settle, state } = setup();
    const workflow = state.updateWorkflow({ profile: variant('B') });
    const reply = await settle(call('POST', '/machine/profile', workflow.profile), 800);
    expect(reply).toMatchObject({ status: 200, text: 'null' });
    expect(state.getMachineProfile().title).toBe('B');
    expect(state.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/v1/machine/profile' });
  });

  it('answers 400 to a body that is not JSON, or not an object', async () => {
    const { call } = setup();
    for (const body of ['not json', '', '[1,2]', 'null']) {
      expect(await call('POST', '/machine/profile', body), body).toMatchObject({ status: 400, body: { error: 'Invalid JSON body' } });
    }
  });

  it("without a machine answers 500 with Decaid's body, before it reads the body", async () => {
    const { call } = setup({ machineConnected: false });
    expect(await call('POST', '/machine/profile', variant('B'))).toMatchObject({ status: 500, body: NO_MACHINE });
    expect(await call('POST', '/machine/profile', 'not json')).toMatchObject({ status: 500, body: NO_MACHINE });
  });

  it('honours injected faults, e.g. a BLE timeout', async () => {
    const { call, state } = setup();
    state.failNext({ method: 'POST', path: '/api/v1/machine/profile', status: 504, body: { error: 'BleTimeoutException: write timed out' } });
    expect(await call('POST', '/machine/profile', variant('B'))).toMatchObject({ status: 504, body: { error: 'BleTimeoutException: write timed out' } });
    expect(state.getMachineProfile().title).not.toBe('B');
  });

  it('answers the plain-text 404 of an older Decaid with machineProfileRoute: false', async () => {
    const { call } = setup({ machineProfileRoute: false });
    expect(await call('POST', '/machine/profile', variant('B'))).toMatchObject({ status: 404, text: 'Route not found' });
  });
});

describe('machine state requests share the write queue', () => {
  it('a REST espresso start waits for an upload in flight, so the shot runs the new profile', async () => {
    const { call, state, player } = setup();
    state.updateWorkflow({ profile: variant('B') });
    const start = call('PUT', '/machine/state/espresso');
    await vi.advanceTimersByTimeAsync(700);
    expect(player.activity).toBeNull();
    expect(state.machineCommands.at(-1), 'received at once').toBe('espresso');
    await vi.advanceTimersByTimeAsync(100);
    expect(await start).toMatchObject({ status: 200, text: 'null' });
    expect(player.activity).toBe('espresso');
    expect(state.getMachineProfile().title).toBe('B');
    player.dispose();
  });

  it('idle stops at once, outside the queue', async () => {
    const { call, state, player } = setup();
    player.start();
    state.updateWorkflow({ profile: variant('B') });
    expect(player.activity).toBe('espresso');
    expect(await call('PUT', '/machine/state/idle')).toMatchObject({ status: 200 });
    expect(state.isUploadingProfile()).toBe(true);
    player.dispose();
  });

  it('a queued start fails with the no-machine 500 when the machine drops first', async () => {
    const { call, state, player } = setup();
    state.updateWorkflow({ profile: variant('B') });
    const start = call('PUT', '/machine/state/espresso');
    await vi.advanceTimersByTimeAsync(200);
    state.setMachineConnected(false);
    expect(await start).toMatchObject({ status: 500, body: NO_MACHINE });
    expect(player.activity).toBeNull();
  });
});
