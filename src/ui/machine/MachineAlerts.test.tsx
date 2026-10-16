// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures } from '../../../mock/fixtures/index.ts';
import { GatewayError, type ConnectionError, type DeviceEntry, type DevicesState, type TelemetryState } from '../../api/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { MachineAlerts } from './MachineAlerts.tsx';
import { MachineRow } from './MachineRow.tsx';
import { StatsCard } from './StatsCard.tsx';

const NOT_CONNECTED = "Not connected. Wake the DE1 and tap Connect DE1, or pair it in Decaid's settings.";
const SCALE_AWAY = "The scale is not connected. Switch it on and tap Connect scale, or pair it in Decaid's settings.";

const DISCONNECTED: Partial<TelemetryState> = { machineConnected: false, scaleConnected: false, scale: null };

/** Decaid's device list as `states` leave it: by default both remembered and away, as after a sleep that dropped them. */
function devicesList(states: { machine?: string; scale?: string } = {}): DevicesState {
  const list = fixtures.devicesWs();
  list.devices = list.devices.map((device) => {
    const state = (device.type === 'scale' ? states.scale : states.machine) ?? 'disconnected';
    return { name: device.name, id: device.id, type: device.type, state, available: state === 'connected' };
  });
  return list;
}

/** The machine and the scale away, and Decaid remembering both. */
const AWAY: Partial<TelemetryState> = { ...DISCONNECTED, devices: devicesList() };
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

const START_IDS = [TID.espressoButton, TID.steamButton, TID.flushButton, TID.hotWaterButton];

/** The machine row over the alert, as in the shell; by default a connected, ready machine. */
async function renderWithRow(services: FakeServices = createFakeServices()) {
  renderWithServices(
    <>
      <MachineRow />
      <MachineAlerts />
    </>,
    services,
  );
  await act(async () => {});
  return services;
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
    expect(alert()).toHaveTextContent(NOT_CONNECTED);
    // Only while the problem lasts.
    act(() => services.telemetry.setState({ machineConnected: true }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it("says nothing before Decaid has answered, then that it can't be reached once that has lasted", async () => {
    vi.useFakeTimers();
    const services = createFakeServices({ telemetry: STARTING });
    renderWithServices(<MachineAlerts />, services);
    // The first frames of every start: no flash of "Not connected" pushing the screen down.
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    wait(2000);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    // The store says when it has lasted (telemetry.ts, 2.5 s).
    act(() => services.telemetry.setState({ unreachable: true }));
    expect(alert()).toHaveRole('alert');
    expect(alert()).toHaveTextContent("Can't reach Decaid. Trying again…");
  });

  it("says when Decaid can't be reached while the machine is connected, holding the starts; a blip shows nothing", async () => {
    vi.useFakeTimers();
    const services = await renderWithRow();
    // A socket between retries is not an outage: the machine stands as Decaid last said.
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'connecting' } }));
    wait(2000);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    expect(screen.getByTestId(TID.espressoButton)).toBeEnabled();
    act(() => services.telemetry.setState({ sockets: IDLE_TELEMETRY.sockets }));
    wait(5000);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();

    // Decaid goes away, and the store says so: the machine is still connected by its last word.
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'closed' } }));
    wait(2500);
    act(() => services.telemetry.setState({ unreachable: true }));
    expect(alert()).toHaveTextContent("Can't reach Decaid. Trying again…");
    for (const id of START_IDS) expect(screen.getByTestId(id)).toBeDisabled();
    // Retries come and go under it.
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'connecting' } }));
    wait(30_000);
    expect(alert()).toHaveTextContent("Can't reach Decaid. Trying again…");

    // Back, with the machine still there: the alert goes and the starts are live, at once.
    act(() => services.telemetry.setState({ unreachable: false, sockets: IDLE_TELEMETRY.sockets }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    for (const id of START_IDS) expect(screen.getByTestId(id)).toBeEnabled();
  });

  it('when Decaid answers again that the machine went away meanwhile, goes straight to Not connected: never a moment of a live row', async () => {
    vi.useFakeTimers();
    const services = await renderWithRow();
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'closed' } }));
    wait(2500);
    act(() => services.telemetry.setState({ unreachable: true }));
    // The socket opens again: no word from Decaid yet, so nothing changes.
    act(() => services.telemetry.setState({ sockets: IDLE_TELEMETRY.sockets }));
    expect(alert()).toHaveTextContent("Can't reach Decaid. Trying again…");
    expect(screen.getByTestId(TID.espressoButton)).toBeDisabled();
    // Its devices frame: the machine and the scale went away. One change, as the store makes it.
    act(() => services.telemetry.setState({ ...AWAY, unreachable: false }));
    expect(alert()).toHaveTextContent(NOT_CONNECTED);
    expect(within(alert()).getByTestId(TID.connectMachine)).toBeEnabled();
    expect(screen.getByTestId(TID.espressoButton)).toBeDisabled();
    // A dropped socket between retries is not an outage.
    act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'connecting' } }));
    wait(1000);
    expect(alert()).toHaveTextContent(NOT_CONNECTED);
  });

  it("keeps Stop live while Decaid can't be reached; a Stop that can't get through says so", async () => {
    const services = createFakeServices({ telemetry: { machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'pouring' } } } });
    services.decaid.failNext(
      'setMachineState',
      new GatewayError(0, '/api/v1/machine/state/idle', 'Could not reach Decaid. Check that it is running and that this device is on the same network.', 'network'),
    );
    await renderWithRow(services);
    act(() => services.telemetry.setState({ unreachable: true, sockets: { ...IDLE_TELEMETRY.sockets, devices: 'closed' } }));
    // The plain words: whether Stop gets through is for its tap to say.
    expect(alert()).toHaveTextContent("Can't reach Decaid. Trying again…");
    expect(screen.getByTestId(TID.stopButton)).toBeEnabled();
    await userEvent.click(screen.getByTestId(TID.stopButton));
    expect(callsTo(services, 'setMachineState')).toEqual([['idle']]);
    expect(alert()).toHaveTextContent("Couldn't stop the machine. Could not reach Decaid.");
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

const GATEWAY_FULL = 'Decaid is set to leave stopping shots to the skin, and CafAI does not stop them, so shots will not stop at the target weight.';

/** Decaid in a gateway mode, and the call log cleared. */
async function inGatewayMode(mode: string, services = createFakeServices()) {
  await services.decaid.updateSettings({ gatewayMode: mode });
  services.decaid.calls.length = 0;
  return services;
}

const callsTo = (services: FakeServices, method: string) => services.decaid.calls.filter((call) => call.method === method).map((call) => call.args);

describe('MachineAlerts: gateway mode Full (5.1)', () => {
  it('says shots will not stop at the target weight, with a fix that asks Decaid for Tracking', async () => {
    const { services } = await renderAlerts(await inGatewayMode('full'));
    expect(alert()).toHaveRole('alert');
    expect(screen.getByTestId(TID.gatewayAlert)).toHaveTextContent(GATEWAY_FULL);
    const fix = within(alert()).getByTestId(TID.gatewayFix);
    expect(fix).toHaveAccessibleName('Let Decaid stop shots');
    // A lasting problem: it goes when the problem does, never with a close.
    expect(within(alert()).queryByRole('button', { name: /close/i })).not.toBeInTheDocument();

    await userEvent.click(fix);
    expect(callsTo(services, 'updateSettings')).toEqual([[{ gatewayMode: 'tracking' }]]);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it('says nothing in Tracking or Disabled, nor when the settings cannot be read', async () => {
    for (const mode of ['tracking', 'disabled']) {
      await renderAlerts(await inGatewayMode(mode));
      expect(screen.queryByTestId(TID.machineAlerts), mode).not.toBeInTheDocument();
      cleanup();
    }
    const services = createFakeServices();
    services.decaid.failNext('getSettings', new GatewayError(200, '/api/v1/settings', "Decaid sent a reply CafAI doesn't recognise.", 'unexpected_reply'));
    await renderAlerts(services);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it('a fix that fails says why in the alert, and the button stays to try again', async () => {
    const services = await inGatewayMode('full');
    services.decaid.failNext(
      'updateSettings',
      new GatewayError(0, '/api/v1/settings', 'Decaid did not answer in time. Check that it is running, then try again.', 'timeout'),
    );
    await renderAlerts(services);
    await userEvent.click(screen.getByTestId(TID.gatewayFix));
    expect(screen.getByTestId(TID.gatewayAlert)).toHaveTextContent(
      "Couldn't change Decaid's setting. Decaid did not answer in time. Check that it is running, then try again.",
    );
    await userEvent.click(screen.getByTestId(TID.gatewayFix));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it('holds the button while the fix is on its way', async () => {
    const services = await inGatewayMode('full');
    let release: () => void = () => {};
    services.decaid.updateSettings = (patch) => {
      services.decaid.calls.push({ method: 'updateSettings', args: [patch] });
      return new Promise((resolve) => (release = () => resolve({ gatewayMode: 'tracking' })));
    };
    await renderAlerts(services);
    await userEvent.click(screen.getByTestId(TID.gatewayFix));
    expect(screen.getByTestId(TID.gatewayFix)).toBeDisabled();
    await act(async () => release());
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it('comes after what keeps the machine from working right now', async () => {
    vi.useFakeTimers();
    const services = await inGatewayMode('full', createFakeServices({ telemetry: { waterLevels: { currentLevel: 4, refillLevel: 5 } } }));
    await renderAlerts(services);
    wait(3000);
    expect(alert()).toHaveTextContent('Refill the water tank to continue.');
    act(() => services.telemetry.setState({ waterLevels: IDLE_TELEMETRY.waterLevels }));
    wait(3000);
    expect(alert()).toHaveTextContent(GATEWAY_FULL);
  });
});

const awayMachine: DeviceEntry = { name: 'DE1', id: 'm-1', state: 'disconnected', type: 'machine', available: true };

/** A connectKind the test answers by hand. */
function connectByHand(services: FakeServices) {
  let answer: (devices: DeviceEntry[]) => void = () => {};
  services.decaid.connectKind = (kind) => {
    services.decaid.calls.push({ method: 'connectKind', args: [kind] });
    return new Promise((resolve) => (answer = resolve));
  };
  return (devices: DeviceEntry[]) => act(async () => answer(devices));
}

describe('MachineAlerts: Connect (6.2)', () => {
  async function renderAway(telemetry: Partial<TelemetryState> = AWAY, services = createFakeServices({ telemetry })) {
    vi.useFakeTimers();
    await renderAlerts(services);
    wait(1000);
    return services;
  }

  it('offers Connect first, and for the scale too while a scale Decaid knows of is missing', async () => {
    await renderAway();
    expect(alert()).toHaveTextContent(NOT_CONNECTED);
    expect(within(alert()).getByTestId(TID.connectMachine)).toHaveAccessibleName('Connect DE1');
    expect(within(alert()).getByTestId(TID.connectScale)).toHaveAccessibleName('Connect scale');
    cleanup();

    await renderAway({ machineConnected: false });
    expect(within(alert()).getByTestId(TID.connectMachine)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.connectScale), 'the scale is connected').not.toBeInTheDocument();
    cleanup();

    // No scale this session, and none Decaid knows of: nothing to connect.
    await renderAway(DISCONNECTED);
    expect(screen.queryByTestId(TID.connectScale)).not.toBeInTheDocument();
  });

  it('looks for the DE1, saying so, holding both buttons until it is done; one at a time', async () => {
    const services = await renderAway();
    const answer = connectByHand(services);
    await tap(screen.getByTestId(TID.connectMachine));
    expect(callsTo(services, 'connectKind')).toEqual([['machine']]);
    expect(alert()).toHaveTextContent('Looking for your DE1…');
    expect(screen.getByTestId(TID.connectMachine)).toBeDisabled();
    expect(screen.getByTestId(TID.connectScale)).toBeDisabled();
    await tap(screen.getByTestId(TID.connectScale));
    expect(callsTo(services, 'connectKind')).toEqual([['machine']]);

    await answer([{ ...awayMachine, state: 'connected' }]);
    act(() => services.telemetry.setState({ machineConnected: true }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it('says why when Decaid still has no DE1 after, and a new try starts over', async () => {
    const services = await renderAway();
    const answer = connectByHand(services);
    await tap(screen.getByTestId(TID.connectMachine));
    await answer([]);
    expect(alert()).toHaveTextContent('No machine found. Check it is switched on and in Bluetooth range.');
    expect(screen.getByTestId(TID.connectMachine)).toBeEnabled();

    await tap(screen.getByTestId(TID.connectMachine));
    expect(alert()).toHaveTextContent('Looking for your DE1…');
    await answer([awayMachine]);
    expect(alert()).toHaveTextContent('DE1 was found but would not connect. Try again, or reconnect it from Decaid.');
  });

  it("looks for the scale with the scale's Connect", async () => {
    const services = await renderAway();
    const answer = connectByHand(services);
    await tap(screen.getByTestId(TID.connectScale));
    expect(callsTo(services, 'connectKind')).toEqual([['scale']]);
    expect(alert()).toHaveTextContent('Looking for your scale…');
    await answer([{ name: 'Lunar', id: 's-1', state: 'connected', type: 'scale', available: true }]);
    act(() => services.telemetry.setState({ scaleConnected: true }));
    expect(alert()).toHaveTextContent(NOT_CONNECTED);
    expect(screen.queryByTestId(TID.connectScale)).not.toBeInTheDocument();
  });

  it("keeps the machine's own words when the scale's Connect finds nothing; the scale's alert says why once the machine is back", async () => {
    const services = await renderAway();
    const answer = connectByHand(services);
    await tap(screen.getByTestId(TID.connectScale));
    await answer([]);
    // The DE1 is still away: what to do about it stays, never the scale's failure in its place.
    expect(alert()).toHaveTextContent(NOT_CONNECTED);
    expect(alert()).not.toHaveTextContent('No scale found');
    expect(screen.getByTestId(TID.connectMachine)).toBeEnabled();
    expect(screen.getByTestId(TID.connectScale)).toBeEnabled();

    act(() => services.telemetry.setState({ machineConnected: true }));
    wait(3000);
    expect(alert()).toHaveTextContent('No scale found. Check it is switched on and in Bluetooth range.');
  });

  it("says Decaid's own sentence when it could not look at all", async () => {
    const services = await renderAway();
    services.decaid.failNext(
      'connectKind',
      new GatewayError(0, '/api/v1/devices', 'Could not reach Decaid. Check that it is running and that this device is on the same network.', 'network'),
    );
    await tap(screen.getByTestId(TID.connectMachine));
    expect(alert()).toHaveTextContent("Couldn't connect the DE1. Could not reach Decaid.");
  });

  it('forgets why a connect failed once the machine is back', async () => {
    const services = await renderAway();
    await tap(screen.getByTestId(TID.connectMachine));
    expect(alert()).toHaveTextContent('No machine found.');
    act(() => services.telemetry.setState({ machineConnected: true }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    act(() => services.telemetry.setState({ machineConnected: false }));
    wait(1000);
    expect(alert()).toHaveTextContent(NOT_CONNECTED);
  });
});

describe('MachineAlerts: the scale gone while the machine is here (6.2)', () => {
  /** The machine awake, the scale connected and then gone, as when it sleeps by itself. */
  async function scaleGoes(telemetry: Partial<TelemetryState> = {}) {
    vi.useFakeTimers();
    const services = createFakeServices({ telemetry });
    await renderAlerts(services);
    act(() => services.telemetry.setState({ scaleConnected: false, scale: null }));
    return services;
  }

  it('says so with Connect scale once a scale connected this session has been gone a moment', async () => {
    const services = await scaleGoes();
    // A scale that drops and comes straight back, as scales do around a wake, was never away.
    wait(2999);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    wait(1);
    expect(alert()).toHaveTextContent(SCALE_AWAY);
    expect(within(alert()).getByTestId(TID.connectScale)).toBeEnabled();
    expect(screen.queryByTestId(TID.connectMachine)).not.toBeInTheDocument();

    const answer = connectByHand(services);
    await tap(screen.getByTestId(TID.connectScale));
    expect(callsTo(services, 'connectKind')).toEqual([['scale']]);
    expect(alert()).toHaveTextContent('Looking for your scale…');
    await answer([{ name: 'Lunar', id: 's-1', state: 'connected', type: 'scale', available: true }]);
    act(() => services.telemetry.setState({ scaleConnected: true }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
  });

  it('or when Decaid lists a scale that is not connected, though none connected this session', async () => {
    vi.useFakeTimers();
    await renderAlerts(createFakeServices({ telemetry: { scaleConnected: false, scale: null, devices: devicesList({ machine: 'connected' }) } }));
    wait(3000);
    expect(alert()).toHaveTextContent(SCALE_AWAY);
  });

  it('says nothing for a machine that has no scale, nor while the machine sleeps', async () => {
    vi.useFakeTimers();
    await renderAlerts(createFakeServices({ telemetry: { scaleConnected: false, scale: null } }));
    wait(5000);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    cleanup();

    const services = await scaleGoes({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'sleeping', substate: 'idle' } } });
    wait(5000);
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    // Awake again, the scale is missed.
    act(() => services.telemetry.setState({ machine: IDLE_TELEMETRY.machine }));
    wait(3000);
    expect(alert()).toHaveTextContent(SCALE_AWAY);
  });

  it('holds Connect scale while the machine runs something: a scan could upset it', async () => {
    const services = await scaleGoes({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'pouring' } } });
    wait(3000);
    expect(alert()).toHaveTextContent(SCALE_AWAY);
    expect(screen.getByTestId(TID.connectScale)).toBeDisabled();
    act(() => services.telemetry.setState({ machine: IDLE_TELEMETRY.machine }));
    expect(screen.getByTestId(TID.connectScale)).toBeEnabled();
  });

  it('says why a scale was not found, until the scale is back', async () => {
    const services = await scaleGoes();
    wait(3000);
    await tap(screen.getByTestId(TID.connectScale));
    expect(alert()).toHaveTextContent('No scale found. Check it is switched on and in Bluetooth range.');
    act(() => services.telemetry.setState({ scaleConnected: true }));
    expect(screen.queryByTestId(TID.machineAlerts)).not.toBeInTheDocument();
    act(() => services.telemetry.setState({ scaleConnected: false }));
    wait(3000);
    expect(alert()).toHaveTextContent(SCALE_AWAY);
  });

  it('comes after the gateway alert', async () => {
    vi.useFakeTimers();
    const services = await inGatewayMode('full');
    await renderAlerts(services);
    act(() => services.telemetry.setState({ scaleConnected: false, scale: null }));
    wait(3000);
    expect(alert()).toHaveTextContent(GATEWAY_FULL);
  });
});
