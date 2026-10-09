// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GatewayError, type ConnectionError, type TelemetryState } from '../../api/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { MachineAlerts } from './MachineAlerts.tsx';
import { MachineRow } from './MachineRow.tsx';
import { StatsCard } from './StatsCard.tsx';

const DISCONNECTED: Partial<TelemetryState> = { machineConnected: false, scaleConnected: false, scale: null };
/** As the app starts: nothing heard from Decaid yet. */
const STARTING: Partial<TelemetryState> = {
  ...DISCONNECTED,
  machine: null,
  devices: null,
  sockets: { ...IDLE_TELEMETRY.sockets, devices: 'connecting' },
};

const UPLOAD_FAILED: ConnectionError = {
  kind: 'profileUploadFailed',
  severity: 'error',
  timestamp: '2026-10-03T08:00:00Z',
  deviceId: null,
  deviceName: null,
  message: 'The profile could not be sent to the machine.',
  suggestion: 'Check the machine is awake.',
  details: null,
};

async function renderAlerts(services: FakeServices = createFakeServices()) {
  const view = renderWithServices(<MachineAlerts />, services);
  await act(async () => {});
  return view;
}

const alert = () => screen.getByTestId(TID.machineAlerts);
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
/** A tap under fake timers (userEvent waits on a timer of its own there), and the request it sends. */
async function tap(element: HTMLElement) {
  fireEvent.click(element);
  await act(async () => {});
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('MachineAlerts', () => {
  it('shows nothing for a connected, ready machine', async () => {
    await renderAlerts();
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the machine is not connected, and what to do, once it has been away a moment', async () => {
    vi.useFakeTimers();
    const { services } = await renderAlerts(createFakeServices({ telemetry: DISCONNECTED }));
    // A machine that drops and comes straight back (a Bluetooth reconnect) moves nothing.
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    wait(1000);
    expect(alert()).toHaveRole('alert');
    expect(alert()).toHaveTextContent('Not connected. Wake the DE1 and pair it in Decaid.');
    // Only while the problem lasts.
    act(() => services.telemetry.setState({ machineConnected: true }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it("says nothing before Decaid has answered, then that it can't be reached if that lasts", async () => {
    vi.useFakeTimers();
    const services = createFakeServices({ telemetry: STARTING });
    renderWithServices(<MachineAlerts />, services);
    // The first frames of every start: no flash of "Not connected" pushing the screen down.
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    wait(2000);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    wait(1000);
    expect(alert()).toHaveTextContent("Can't reach Decaid. Trying again…");
  });

  it("says when Decaid can't be reached, without flickering on reconnects", async () => {
    vi.useFakeTimers();
    const services = createFakeServices({
      telemetry: { ...DISCONNECTED, sockets: { ...IDLE_TELEMETRY.sockets, devices: 'connecting' } },
    });
    renderWithServices(<MachineAlerts />, services);
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'closed' } }));
    wait(3000);
    expect(alert()).toHaveTextContent("Can't reach Decaid");
    // Decaid answers, and says there is no machine: straight from one to the other.
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'open' } }));
    expect(alert()).toHaveTextContent('Not connected');
    // A dropped socket between retries is not an outage.
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'connecting' } }));
    wait(1000);
    expect(alert()).toHaveTextContent('Not connected');
  });

  it("shows Decaid's connection error at once and until closed, then the next problem", async () => {
    vi.useFakeTimers();
    await renderAlerts(createFakeServices({ telemetry: { ...DISCONNECTED, connectionError: UPLOAD_FAILED } }));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alert()).toHaveTextContent('The profile could not be sent to the machine. Check the machine is awake.');
    wait(1000);
    await tap(within(alert()).getByRole('button', { name: /close/i }));
    expect(screen.queryByText(/could not be sent/)).not.toBeInTheDocument();
    expect(alert()).toHaveTextContent('Not connected');
  });

  it("says something of a connection error Decaid gave no words to, and a new one comes back after a dismissal", async () => {
    const { services } = await renderAlerts(
      createFakeServices({ telemetry: { connectionError: { ...UPLOAD_FAILED, message: ' ', suggestion: null, severity: 'warning' } } }),
    );
    expect(alert()).toHaveTextContent('Decaid reported a problem with a device.');
    await userEvent.click(within(alert()).getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    act(() => services.telemetry.setState({ connectionError: { ...UPLOAD_FAILED, timestamp: '2026-10-03T08:05:00Z' } }));
    expect(alert()).toHaveTextContent('The profile could not be sent');
  });

  it('asks for a refill while the water is low, or the machine says it needs water', async () => {
    vi.useFakeTimers();
    const { services } = await renderAlerts(createFakeServices({ telemetry: { waterLevels: { currentLevel: 4, refillLevel: 5 } } }));
    wait(3000);
    expect(alert()).toHaveTextContent('Refill the water tank to continue.');
    act(() => services.telemetry.setState({ waterLevels: IDLE_TELEMETRY.waterLevels }));
    wait(3000);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'needsWater', substate: 'idle' } } }));
    wait(3000);
    expect(alert()).toHaveTextContent('Refill the water tank to continue.');
  });

  it('never flickers with a level that wobbles around the refill line', async () => {
    vi.useFakeTimers();
    const low = { currentLevel: 5, refillLevel: 5 };
    const high = { currentLevel: 6, refillLevel: 5 };
    const { services } = await renderAlerts(createFakeServices({ telemetry: { waterLevels: low } }));
    for (let i = 0; i < 4; i += 1) {
      wait(1500);
      act(() => services.telemetry.setState({ waterLevels: i % 2 === 0 ? high : low }));
      expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    }
    act(() => services.telemetry.setState({ waterLevels: low }));
    wait(3000);
    expect(alert()).toHaveTextContent('Refill');
    // Shown, it stays through the same wobble.
    for (let i = 0; i < 4; i += 1) {
      act(() => services.telemetry.setState({ waterLevels: i % 2 === 0 ? high : low }));
      wait(1500);
      expect(alert()).toHaveTextContent('Refill');
    }
  });

  it('says when the machine reports an error', async () => {
    await renderAlerts(createFakeServices({ telemetry: { machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'error', substate: 'idle' } } } }));
    expect(alert()).toHaveTextContent('The machine reports an error. Check it first.');
  });

  it("shows the row's failed command in plain words, until closed or the next command", async () => {
    const services = createFakeServices();
    services.decaid.failNext(
      'setMachineState',
      new GatewayError(400, '/api/v1/machine/state/espresso', 'Connect a scale before pulling a shot (Decaid is set to require one).', 'block_no_scale'),
    );
    renderWithServices(
      <>
        <MachineRow />
        <MachineAlerts />
      </>,
      services,
    );
    await act(async () => {});
    await userEvent.click(screen.getByTestId(TID.espressoButton));
    expect(await screen.findByTestId(TID.machineAlerts)).toHaveTextContent(
      "Couldn't start the shot. Connect a scale before pulling a shot (Decaid is set to require one).",
    );
    // A later command clears it.
    await userEvent.click(screen.getByTestId(TID.steamButton));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();

    services.decaid.failNext('setMachineState', new Error(''));
    await userEvent.click(screen.getByTestId(TID.flushButton));
    expect(alert()).toHaveTextContent("Couldn't start the flush. Try again.");
    await userEvent.click(within(alert()).getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it("shows the card's failed Tare too", async () => {
    const services = createFakeServices();
    services.decaid.failNext(
      'tareScale',
      new GatewayError(400, '/api/v1/scale/tare', "The scale can't be tared during a shot.", 'block_tare_during_shot'),
    );
    renderWithServices(
      <>
        <MachineAlerts />
        <StatsCard />
      </>,
      services,
    );
    await act(async () => {});
    await userEvent.click(screen.getByTestId(TID.tareButton));
    expect(await screen.findByTestId(TID.machineAlerts)).toHaveTextContent("Couldn't tare the scale. The scale can't be tared during a shot.");
  });

  it('puts the failed command first: it answers the tap the barista just made', async () => {
    vi.useFakeTimers();
    const services = createFakeServices({ telemetry: { waterLevels: { currentLevel: 4, refillLevel: 5 } } });
    services.decaid.failNext('setMachineState', new Error('The machine did not answer.'));
    renderWithServices(
      <>
        <MachineRow />
        <MachineAlerts />
      </>,
      services,
    );
    await act(async () => {});
    wait(3000);
    expect(alert()).toHaveTextContent('Refill');
    await tap(screen.getByTestId(TID.espressoButton));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alert()).toHaveTextContent("Couldn't start the shot. The machine did not answer.");
    await tap(within(alert()).getByRole('button', { name: /close/i }));
    expect(alert()).toHaveTextContent('Refill the water tank to continue.');
    // A problem that lasts has no close button: it goes when the problem does.
    expect(within(alert()).queryByRole('button')).not.toBeInTheDocument();
  });
});
