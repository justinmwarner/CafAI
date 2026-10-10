import { describe, expect, it, vi } from 'vitest';
import { GatewayError, type DeviceEntry } from '../../api/types.ts';
import { createFakeDecaid } from '../testing/fakeServices.ts';
import { createDeviceConnect, deviceConnectFor, type DeviceKind } from './deviceConnect.ts';

const machine = (state: string, available = true): DeviceEntry => ({ name: 'DE1', id: 'm-1', state, type: 'machine', available });
const scale = (state: string, available = true): DeviceEntry => ({ name: 'Lunar', id: 's-1', state, type: 'scale', available });

/** A connectKind the test answers by hand. */
function manual() {
  const asked: DeviceKind[] = [];
  let answer: (devices: DeviceEntry[]) => void = () => {};
  let refuse: (error: unknown) => void = () => {};
  const connectKind = vi.fn(
    (kind: DeviceKind) =>
      new Promise<DeviceEntry[]>((resolve, reject) => {
        asked.push(kind);
        answer = resolve;
        refuse = reject;
      }),
  );
  return { connectKind, asked, answer: (devices: DeviceEntry[]) => answer(devices), refuse: (error: unknown) => refuse(error) };
}

describe('createDeviceConnect', () => {
  it('connects one kind, says it is looking meanwhile, and answers whether Decaid lists it connected after', async () => {
    const decaid = manual();
    const store = createDeviceConnect(decaid);
    const done = store.connect('machine');
    expect(decaid.asked).toEqual(['machine']);
    expect(store.getState()).toEqual({ pending: 'machine', failure: null });
    decaid.answer([machine('connected'), scale('disconnected', false)]);
    expect(await done).toBe(true);
    expect(store.getState()).toEqual({ pending: null, failure: null });
  });

  it('one at a time for the whole app: a second connect while one runs is not sent', async () => {
    const decaid = manual();
    const store = createDeviceConnect(decaid);
    const first = store.connect('machine');
    expect(await store.connect('scale')).toBe(false);
    expect(await store.connect('machine')).toBe(false);
    expect(decaid.connectKind).toHaveBeenCalledTimes(1);
    decaid.answer([machine('connected')]);
    await first;
    void store.connect('scale');
    expect(decaid.asked).toEqual(['machine', 'scale']);
  });

  it('says why when the list after still lacks the device, in describeFailedConnect\'s words', async () => {
    const decaid = manual();
    const store = createDeviceConnect(decaid);
    const nothing = store.connect('machine');
    decaid.answer([scale('connected')]);
    expect(await nothing).toBe(false);
    expect(store.getState().failure).toEqual({ kind: 'machine', text: 'No machine found. Check it is switched on and in Bluetooth range.' });

    const refused = store.connect('machine');
    expect(store.getState().failure, 'a new try starts with a clean slate').toBeNull();
    decaid.answer([machine('disconnected')]);
    await refused;
    expect(store.getState().failure?.text).toBe('DE1 was found but would not connect. Try again, or reconnect it from Decaid.');
  });

  it("says Decaid's own sentence when the connect could not even ask", async () => {
    const decaid = manual();
    const store = createDeviceConnect(decaid);
    const away = store.connect('scale');
    decaid.refuse(new GatewayError(0, '/api/v1/devices', 'Could not reach Decaid. Check that it is running and that this device is on the same network.', 'network'));
    expect(await away).toBe(false);
    expect(store.getState()).toEqual({
      pending: null,
      failure: {
        kind: 'scale',
        text: "Couldn't connect the scale. Could not reach Decaid. Check that it is running and that this device is on the same network.",
      },
    });
    const blank = store.connect('machine');
    decaid.refuse(new Error(' '));
    await blank;
    expect(store.getState().failure).toEqual({ kind: 'machine', text: "Couldn't connect the DE1. Try again." });
  });

  it('a quiet try in the background takes its turn but never says anything', async () => {
    const decaid = manual();
    const store = createDeviceConnect(decaid);
    const tapped = store.connect('machine');
    decaid.answer([]);
    await tapped;
    const said = store.getState().failure;
    expect(said).not.toBeNull();

    const quiet = store.connect('scale', { quiet: true });
    expect(store.getState()).toEqual({ pending: 'scale', failure: said });
    decaid.answer([]);
    expect(await quiet).toBe(false);
    expect(store.getState()).toEqual({ pending: null, failure: said });
  });

  it('forgets a failure once its device is back, and notifies only on a change', async () => {
    const decaid = manual();
    const store = createDeviceConnect(decaid);
    const listener = vi.fn();
    store.subscribe(listener);
    const tapped = store.connect('machine');
    decaid.answer([]);
    await tapped;
    listener.mockClear();
    // The scale coming back says nothing about the machine.
    store.clearFailure('scale');
    expect(store.getState().failure?.kind).toBe('machine');
    store.clearFailure('machine');
    expect(store.getState().failure).toBeNull();
    store.clearFailure('machine');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is one store per Decaid client', () => {
    const decaid = createFakeDecaid();
    expect(deviceConnectFor(decaid)).toBe(deviceConnectFor(decaid));
    expect(deviceConnectFor(createFakeDecaid())).not.toBe(deviceConnectFor(decaid));
  });
});
