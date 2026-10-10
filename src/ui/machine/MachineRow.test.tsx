// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GatewayError, type MachineSnapshot, type TelemetryState } from '../../api/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { MachineRow, STARTS_HOLD_MS } from './MachineRow.tsx';

const withState = (state: string, substate = 'pouring'): Partial<TelemetryState> => ({
  machine: { ...IDLE_TELEMETRY.machine!, state: { state, substate } as MachineSnapshot['state'] },
});

const DISCONNECTED: Partial<TelemetryState> = { machineConnected: false, scaleConnected: false, scale: null };
const START_IDS = [TID.espressoButton, TID.steamButton, TID.flushButton, TID.hotWaterButton];

async function renderRow(services: FakeServices = createFakeServices(), icons = false) {
  const view = renderWithServices(<MachineRow icons={icons} />, services);
  // Let the machine-info request settle so its state update lands inside act().
  await act(async () => {});
  return view;
}

const row = () => screen.getByTestId(TID.machineRow);
const labels = () => within(row()).queryAllByRole('button').map((b) => b.textContent);
const stateCalls = (services: FakeServices) =>
  services.decaid.calls.filter((call) => call.method === 'setMachineState').map((call) => call.args[0]);

function groupHead(services: FakeServices = createFakeServices()): FakeServices {
  services.decaid.getMachineInfo = async () => ({ version: '1358', model: 'DE1XL', serialNumber: '7', GHC: true });
  return services;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('MachineRow', () => {
  it('offers the four starts while the machine is ready', async () => {
    await renderRow();
    expect(labels()).toEqual(['Espresso', 'Steam', 'Flush', 'Hot water']);
    for (const id of START_IDS) {
      expect(screen.getByTestId(id)).toBeEnabled();
    }
    expect(screen.queryByTestId(TID.stopButton)).not.toBeInTheDocument();
  });

  it('sends the right state for each start', async () => {
    const { services } = await renderRow();
    const user = userEvent.setup();
    for (const [testId, state] of [
      [TID.espressoButton, 'espresso'],
      [TID.steamButton, 'steam'],
      [TID.flushButton, 'flush'],
      [TID.hotWaterButton, 'hotWater'],
    ] as const) {
      await user.click(screen.getByTestId(testId));
      await act(async () => {});
      expect(stateCalls(services).at(-1)).toBe(state);
    }
    expect(stateCalls(services)).toEqual(['espresso', 'steam', 'flush', 'hotWater']);
  });

  it('turns the running start into Stop in its own place and holds the others', async () => {
    await renderRow(createFakeServices({ telemetry: withState('steam') }));
    expect(labels()).toEqual(['Espresso', 'Stop', 'Flush', 'Hot water']);
    expect(screen.getByTestId(TID.stopButton)).toBeEnabled();
    expect(screen.getByTestId(TID.espressoButton)).toBeDisabled();
    expect(screen.getByTestId(TID.flushButton)).toBeDisabled();
    expect(screen.getByTestId(TID.hotWaterButton)).toBeDisabled();
  });

  it('is the very same button: the start becomes Stop where the finger already is', async () => {
    const { services } = await renderRow();
    const espresso = screen.getByTestId(TID.espressoButton);
    act(() => services.telemetry.setState(withState('espresso', 'preinfusion')));
    expect(screen.getByTestId(TID.stopButton)).toBe(espresso);
    expect(espresso).toHaveTextContent('Stop');
  });

  it("puts Stop in the place of whatever runs, and anything else that runs in the first place", async () => {
    const places = ['Espresso', 'Steam', 'Flush', 'Hot water'];
    for (const [state, place] of [
      ['espresso', 0],
      ['skipStep', 0],
      ['steam', 1],
      ['steamRinse', 1],
      ['flush', 2],
      ['airPurge', 2],
      ['hotWater', 3],
      ['cleaning', 0],
      ['descaling', 0],
    ] as const) {
      const { unmount } = await renderRow(createFakeServices({ telemetry: withState(state) }));
      expect(labels(), state).toEqual(places.map((label, index) => (index === place ? 'Stop' : label)));
      unmount();
    }
  });

  it('shows Stop for a state it does not know, in the first place, and stops it (D97)', async () => {
    const { services } = await renderRow(createFakeServices({ telemetry: withState('brewing') }));
    expect(labels()).toEqual(['Stop', 'Steam', 'Flush', 'Hot water']);
    for (const id of [TID.steamButton, TID.flushButton, TID.hotWaterButton]) expect(screen.getByTestId(id)).toBeDisabled();
    await userEvent.click(screen.getByTestId(TID.stopButton));
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('never offers Stop during a firmware upgrade, a calibration or a self test', async () => {
    for (const state of ['fwUpgrade', 'calibration', 'selfTest']) {
      const { unmount } = await renderRow(createFakeServices({ telemetry: withState(state, 'idle') }));
      expect(labels(), state).toEqual(['Espresso', 'Steam', 'Flush', 'Hot water']);
      expect(screen.queryByTestId(TID.stopButton), state).not.toBeInTheDocument();
      for (const id of START_IDS) expect(screen.getByTestId(id), state).toBeDisabled();
      unmount();
    }
  });

  it('on a group-head machine too: Stop alone for a state it does not know, nothing during a firmware upgrade', async () => {
    const services = groupHead();
    await renderRow(services);
    act(() => services.telemetry.setState(withState('brewing')));
    expect(labels()).toEqual(['Stop']);
    act(() => services.telemetry.setState(withState('fwUpgrade', 'idle')));
    expect(labels()).toEqual([]);
  });

  it('stops the machine from Stop', async () => {
    const { services } = await renderRow(createFakeServices({ telemetry: withState('espresso') }));
    await userEvent.click(screen.getByTestId(TID.stopButton));
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('never blocks Stop behind a command in flight', async () => {
    const services = createFakeServices();
    services.decaid.setMachineState = (state) => {
      services.decaid.calls.push({ method: 'setMachineState', args: [state] });
      // The start's request never answers, and the machine starts anyway; Stop's answers.
      return state === 'espresso' ? new Promise<void>(() => {}) : Promise.resolve();
    };
    await renderRow(services);
    act(() => screen.getByTestId(TID.espressoButton).click());
    act(() => services.telemetry.setState(withState('espresso')));
    expect(screen.getByTestId(TID.stopButton)).toBeEnabled();
    await userEvent.click(screen.getByTestId(TID.stopButton));
    expect(stateCalls(services)).toEqual(['espresso', 'idle']);
  });

  it('holds the starts for a moment after a run ends, so a second tap on Stop cannot start again', async () => {
    vi.useFakeTimers();
    const { services } = await renderRow(createFakeServices({ telemetry: withState('espresso') }));
    act(() => services.telemetry.setState(withState('idle', 'idle')));
    expect(labels()).toEqual(['Espresso', 'Steam', 'Flush', 'Hot water']);
    for (const id of START_IDS) expect(screen.getByTestId(id)).toBeDisabled();
    act(() => vi.advanceTimersByTime(STARTS_HOLD_MS - 1));
    expect(screen.getByTestId(TID.espressoButton)).toBeDisabled();
    act(() => vi.advanceTimersByTime(1));
    for (const id of START_IDS) expect(screen.getByTestId(id)).toBeEnabled();
  });

  it('shows Wake alone while the machine sleeps', async () => {
    const { services } = await renderRow(createFakeServices({ telemetry: withState('sleeping', 'idle') }));
    expect(labels()).toEqual(['Wake']);
    await userEvent.click(screen.getByRole('button', { name: 'Wake' }));
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('holds the starts for a moment after the machine wakes, so a second tap on Wake starts nothing', async () => {
    vi.useFakeTimers();
    const { services } = await renderRow(createFakeServices({ telemetry: withState('sleeping', 'idle') }));
    act(() => services.telemetry.setState(withState('idle', 'idle')));
    expect(screen.getByTestId(TID.espressoButton)).toBeDisabled();
    act(() => vi.advanceTimersByTime(STARTS_HOLD_MS));
    expect(screen.getByTestId(TID.espressoButton)).toBeEnabled();
  });

  it('holds every start while the machine is not connected, and says why to a screen reader', async () => {
    await renderRow(createFakeServices({ telemetry: DISCONNECTED }));
    expect(labels()).toEqual(['Espresso', 'Steam', 'Flush', 'Hot water']);
    for (const id of START_IDS) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAccessibleDescription(/not connected\. wake the DE1/i);
    }
    expect(screen.queryByTestId(TID.stopButton)).not.toBeInTheDocument();
  });

  it('shows nothing on a group-head machine until something runs, then Stop alone', async () => {
    const services = groupHead();
    await renderRow(services);
    expect(labels()).toEqual([]);
    expect(row()).toHaveTextContent('Start on the machine');

    act(() => services.telemetry.setState(withState('espresso')));
    expect(labels()).toEqual(['Stop']);
    await userEvent.click(screen.getByTestId(TID.stopButton));
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('remembers a group-head machine across loads, so four starts never flash before it answers', async () => {
    const first = await renderRow(groupHead());
    first.unmount();
    // Next load, before the machine has answered (it is still connecting).
    await renderRow(createFakeServices({ telemetry: DISCONNECTED }));
    expect(labels()).toEqual([]);
  });

  it('ignores a second tap while a command is in flight', async () => {
    const services = createFakeServices();
    let release: () => void = () => {};
    services.decaid.setMachineState = (state) => {
      services.decaid.calls.push({ method: 'setMachineState', args: [state] });
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    await renderRow(services);
    const espresso = screen.getByTestId(TID.espressoButton);
    const steam = screen.getByTestId(TID.steamButton);
    // Two taps before React re-renders: the second still hits an enabled button.
    act(() => {
      espresso.click();
      steam.click();
    });
    expect(stateCalls(services)).toEqual(['espresso']);
    expect(steam).toBeDisabled();
    await act(async () => release());
    expect(steam).toBeEnabled();
  });

  it('sends a failed start once and never again on its own', async () => {
    const services = createFakeServices();
    services.decaid.failNext(
      'setMachineState',
      new GatewayError(400, '/api/v1/machine/state/espresso', 'Connect a scale before pulling a shot (Decaid is set to require one).', 'block_no_scale'),
    );
    await renderRow(services);
    await userEvent.click(screen.getByTestId(TID.espressoButton));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(stateCalls(services)).toEqual(['espresso']);
    // The top bar has no room for the sentence: MachineAlerts shows it (MachineAlerts.test.tsx).
    expect(within(row()).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId(TID.espressoButton)).toBeEnabled();
  });

  it('names each button for screen readers when it shows icons only', async () => {
    await renderRow(createFakeServices(), true);
    expect(row()).toHaveAttribute('data-icons', 'true');
    for (const name of ['Espresso', 'Steam', 'Flush', 'Hot water']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('');
    }
  });

  it('names Stop and Wake too when it shows icons only', async () => {
    const { services } = await renderRow(createFakeServices({ telemetry: withState('flush') }), true);
    expect(screen.getByRole('button', { name: 'Stop' })).toBe(screen.getByTestId(TID.stopButton));
    act(() => services.telemetry.setState(withState('sleeping', 'idle')));
    expect(screen.getByRole('button', { name: 'Wake' })).toBeEnabled();
  });
});
