// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import type { DeviceEntry, MachineFrame, TelemetryState } from '../../api/types.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { deviceConnectFor } from './deviceConnect.ts';
import { REVIVE_DELAY_MS, REVIVE_EVERY_MS, useScaleRevive } from './useScaleRevive.ts';

const machine = (state: string, substate = 'idle'): MachineFrame => ({ ...IDLE_TELEMETRY.machine!, state: { state, substate } });

function Revive() {
  useScaleRevive();
  return null;
}

/** The hook mounted on `telemetry` (by default the machine asleep, the scale connected). */
function mount(telemetry: Partial<TelemetryState> = { machine: machine('sleeping') }): FakeServices {
  const services = createFakeServices({ telemetry });
  renderWithServices(<Revive />, services);
  return services;
}

/** The machine asleep, the scale connected earlier this session and gone since: the case the revive is for. */
function asleepScaleGone(): FakeServices {
  const services = mount();
  act(() => services.telemetry.setState({ scaleConnected: false, scale: null }));
  return services;
}

const looks = (services: FakeServices) => services.decaid.calls.filter((call) => call.method === 'connectKind').map((call) => call.args[0]);
const machineGoes = (services: FakeServices, state: string, substate?: string) =>
  act(() => services.telemetry.setState({ machine: machine(state, substate) }));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useScaleRevive', () => {
  it('looks for the scale once, a moment after the machine wakes, when one was connected this session', async () => {
    const services = asleepScaleGone();
    machineGoes(services, 'idle');
    await wait(REVIVE_DELAY_MS - 1);
    expect(looks(services), 'Decaid gets its moment to find the scale itself').toEqual([]);
    await wait(1);
    expect(looks(services)).toEqual(['scale']);
    await wait(60_000);
    expect(looks(services)).toEqual(['scale']);
  });

  it('a machine that went away asleep and comes back awake has woken too', async () => {
    const services = asleepScaleGone();
    act(() => services.telemetry.setState({ machineConnected: false }));
    act(() => services.telemetry.setState({ machineConnected: true, machine: machine('idle') }));
    await wait(REVIVE_DELAY_MS);
    expect(looks(services)).toEqual(['scale']);
  });

  it('leaves the scale alone when none was connected this session, or one is connected now', async () => {
    const never = mount({ machine: machine('sleeping'), scaleConnected: false, scale: null });
    machineGoes(never, 'idle');
    await wait(REVIVE_DELAY_MS);
    expect(looks(never)).toEqual([]);
    cleanup();

    const connected = mount();
    machineGoes(connected, 'idle');
    await wait(REVIVE_DELAY_MS);
    expect(looks(connected)).toEqual([]);
    cleanup();

    // Back by itself before the look: Decaid found it.
    const back = asleepScaleGone();
    machineGoes(back, 'idle');
    act(() => back.telemetry.setState({ scaleConnected: true }));
    await wait(REVIVE_DELAY_MS);
    expect(looks(back)).toEqual([]);
  });

  it('looks at most every 30 s', async () => {
    const services = asleepScaleGone();
    const wakeUp = async () => {
      machineGoes(services, 'sleeping');
      machineGoes(services, 'idle');
      await wait(REVIVE_DELAY_MS);
    };
    await wakeUp();
    expect(looks(services)).toHaveLength(1);
    await wait(10_000);
    await wakeUp();
    expect(looks(services), '15 s after the last look').toHaveLength(1);
    await wait(REVIVE_EVERY_MS - 15_000);
    await wakeUp();
    expect(looks(services)).toHaveLength(2);
  });

  it('never during a shot, steam, hot water or flush, nor once the machine is asleep again', async () => {
    for (const [state, substate] of [
      ['espresso', 'pouring'],
      ['steam', 'pouring'],
      ['hotWater', 'pouring'],
      ['flush', 'pouring'],
      ['sleeping', 'idle'],
    ] as const) {
      const services = asleepScaleGone();
      machineGoes(services, 'idle');
      machineGoes(services, state, substate);
      await wait(REVIVE_DELAY_MS);
      expect(looks(services), state).toEqual([]);
      cleanup();
    }
  });

  it('looks when the page comes back into view, but not while something runs', async () => {
    const awake = mount({ machine: machine('idle') });
    act(() => awake.telemetry.setState({ scaleConnected: false, scale: null }));
    act(() => setVisibility('hidden'));
    await wait(REVIVE_DELAY_MS);
    expect(looks(awake)).toEqual([]);
    act(() => setVisibility('visible'));
    await wait(REVIVE_DELAY_MS);
    expect(looks(awake)).toEqual(['scale']);
    cleanup();

    const steaming = mount({ machine: machine('steam', 'pouring') });
    act(() => steaming.telemetry.setState({ scaleConnected: false, scale: null }));
    act(() => setVisibility('visible'));
    await wait(REVIVE_DELAY_MS);
    expect(looks(steaming)).toEqual([]);
  });

  it("waits its turn: never while a barista's Connect is looking", async () => {
    const services = asleepScaleGone();
    let answer: (devices: DeviceEntry[]) => void = () => {};
    services.decaid.connectKind = (kind) => {
      services.decaid.calls.push({ method: 'connectKind', args: [kind] });
      return new Promise((resolve) => (answer = resolve));
    };
    void deviceConnectFor(services.decaid).connect('machine');
    machineGoes(services, 'idle');
    await wait(REVIVE_DELAY_MS);
    expect(looks(services)).toEqual(['machine']);
    await act(async () => answer([]));
  });

  it('a quiet try: a scale it cannot find says nothing', async () => {
    const services = asleepScaleGone();
    machineGoes(services, 'idle');
    await wait(REVIVE_DELAY_MS);
    expect(looks(services)).toEqual(['scale']);
    expect(deviceConnectFor(services.decaid).getState()).toEqual({ pending: null, failure: null });
  });

  it("asks for Decaid's preferred scale only: no one tapped, and another would become Decaid's preferred one (D98)", async () => {
    const services = asleepScaleGone();
    const asked: unknown[] = [];
    services.decaid.connectKind = async (kind, options) => {
      asked.push([kind, options]);
      return [];
    };
    machineGoes(services, 'idle');
    await wait(REVIVE_DELAY_MS);
    expect(asked).toEqual([['scale', { preferredOnly: true }]]);
  });

  it('stops with the shell', async () => {
    const services = asleepScaleGone();
    machineGoes(services, 'idle');
    cleanup();
    await wait(REVIVE_DELAY_MS);
    expect(looks(services)).toEqual([]);
  });
});
