// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalizeProfile } from '../../../mock/decaid/profiles.ts';
import { GatewayError, type MachineSnapshot, type TelemetryState } from '../../api/types.ts';
import blooming from '../../coach/templates/source/Blooming_espresso.json';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, SAMPLE_WORKFLOW, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { MachinePanel } from './MachinePanel.tsx';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

const machine = (patch: Partial<MachineSnapshot> & { state?: MachineSnapshot['state'] }): MachineSnapshot => ({
  ...IDLE_TELEMETRY.machine!,
  ...patch,
});

const DISCONNECTED: Partial<TelemetryState> = { machineConnected: false, scaleConnected: false, scale: null };
const SLEEPING: Partial<TelemetryState> = { machine: machine({ state: { state: 'sleeping', substate: 'idle' } }) };
const PULLING: Partial<TelemetryState> = {
  machine: machine({ state: { state: 'espresso', substate: 'preinfusion' }, pressure: 2.1, flow: 3.9 }),
};

async function renderPanel(services: FakeServices = createFakeServices()) {
  const view = renderWithServices(<MachinePanel />, services);
  // Let the machine-info request settle so its state update lands inside act().
  await act(async () => {});
  return view;
}

const stateCalls = (services: FakeServices) =>
  services.decaid.calls.filter((call) => call.method === 'setMachineState').map((call) => call.args[0]);

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('MachinePanel status', () => {
  it('shows a connected, idle machine', async () => {
    await renderPanel();
    expect(screen.getByTestId(TID.machineState)).toHaveTextContent('Ready');
    expect(screen.getByTestId(TID.connectionStatus)).toHaveTextContent('Machine connected');
    expect(screen.getByTestId(TID.connectionStatus)).toHaveTextContent('Scale connected');
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('92.4 °C');
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('target 92.5');
    expect(screen.getByTestId(TID.steamTemp)).toHaveTextContent('140 °C');
    expect(screen.getByTestId(TID.waterLevel)).toHaveTextContent('40 mm');
    expect(screen.getByTestId(TID.scaleWeight)).toHaveTextContent('0.0 g');
  });

  it('says "Not connected" and blanks the readouts when the machine link is down', async () => {
    await renderPanel(createFakeServices({ telemetry: DISCONNECTED }));
    expect(screen.getByTestId(TID.machineState)).toHaveTextContent('Not connected');
    expect(screen.getByTestId(TID.connectionStatus)).toHaveTextContent('No machine');
    expect(screen.getByTestId(TID.connectionStatus)).toHaveTextContent('No scale');
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('—');
    expect(screen.getByTestId(TID.scaleWeight)).toHaveTextContent('No scale');
  });

  it("says when Decaid itself can't be reached, without flickering on reconnects", async () => {
    vi.useFakeTimers();
    try {
      const services = createFakeServices({
        telemetry: { ...DISCONNECTED, sockets: { ...IDLE_TELEMETRY.sockets, devices: 'connecting' } },
      });
      renderWithServices(<MachinePanel />, services);
      expect(screen.queryByText("Can't reach Decaid")).not.toBeInTheDocument();
      act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'closed' } }));
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByTestId(TID.connectionStatus)).toHaveTextContent("Can't reach Decaid");
      act(() => services.telemetry.setState({ sockets: { ...IDLE_TELEMETRY.sockets, devices: 'open' } }));
      expect(screen.queryByText("Can't reach Decaid")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows something readable for a malformed machine frame', async () => {
    const broken = { ...IDLE_TELEMETRY.machine!, state: undefined, groupTemperature: undefined } as unknown as MachineSnapshot;
    await renderPanel(createFakeServices({ telemetry: { machine: broken } }));
    expect(screen.getByTestId(TID.machineState)).toHaveTextContent('Connected');
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('—');
  });

  it('names the shot phase while pulling', async () => {
    await renderPanel(createFakeServices({ telemetry: PULLING }));
    expect(screen.getByTestId(TID.machineState)).toHaveTextContent('Pulling a shot: preinfusion');
  });

  it("names the running step of the profile in Decaid's workflow, from the Profile line's read", async () => {
    // Blooming Espresso's bloom: 30 s with the pump off, which the machine reports as pouring.
    const bloom = machine({ state: { state: 'espresso', substate: 'pouring' }, profileFrame: 2, pressure: 0, flow: 0 });
    const services = createFakeServices({ telemetry: { machine: bloom } });
    services.decaid.getWorkflow = async () => {
      services.decaid.calls.push({ method: 'getWorkflow', args: [] });
      return { ...SAMPLE_WORKFLOW, profile: normalizeProfile(blooming) };
    };
    await renderPanel(services);
    const line = screen.getByTestId(TID.machineState);
    expect(line).toHaveTextContent('Pulling a shot: pause');

    act(() => services.telemetry.setState({ machine: { ...bloom, profileFrame: 3, pressure: 6 } }));
    expect(line).toHaveTextContent('Pulling a shot: ramp');
    // Preheat still shows the last shot's step; a step the profile does not have is unnamed.
    act(() => services.telemetry.setState({ machine: { ...bloom, state: { state: 'espresso', substate: 'preparingForShot' } } }));
    expect(line).toHaveTextContent('Pulling a shot: preheating');
    act(() => services.telemetry.setState({ machine: { ...bloom, profileFrame: 9 } }));
    expect(line).toHaveTextContent('Pulling a shot: pouring');
    act(() => services.telemetry.setState({ machine: { ...bloom, state: { state: 'espresso', substate: 'pouringDone' } } }));
    expect(line).toHaveTextContent('Pulling a shot: ending');

    expect(services.decaid.calls.filter((call) => call.method === 'getWorkflow')).toHaveLength(1);
  });

  it('follows telemetry changes', async () => {
    const { services } = await renderPanel();
    act(() => services.telemetry.setState(SLEEPING));
    expect(screen.getByTestId(TID.machineState)).toHaveTextContent('Sleeping');
    act(() => services.telemetry.setState({ scale: { ...IDLE_TELEMETRY.scale!, weight: 18.44 } }));
    expect(screen.getByTestId(TID.scaleWeight)).toHaveTextContent('18.4 g');
  });

  it('warns when the tank needs refilling', async () => {
    await renderPanel(createFakeServices({ telemetry: { waterLevels: { currentLevel: 4, refillLevel: 5 } } }));
    expect(screen.getByTestId(TID.waterLevel)).toHaveTextContent('Refill');
  });

  it("names the profile in Decaid's workflow, in the status section", async () => {
    const { services } = await renderPanel();
    const status = screen.getByRole('region', { name: 'Machine status' });
    const profile = within(status).getByRole('group', { name: 'Profile' });
    expect(profile).toHaveTextContent('Blooming Espresso');
    expect(services.decaid.calls.filter((call) => call.method === 'getWorkflow')).toHaveLength(1);
  });

  it("shows Decaid's connection error until dismissed", async () => {
    const services = createFakeServices({
      telemetry: {
        connectionError: {
          kind: 'profileUploadFailed',
          severity: 'error',
          timestamp: '2026-10-03T08:00:00Z',
          deviceId: null,
          deviceName: null,
          message: 'The profile could not be sent to the machine.',
          suggestion: 'Check the machine is awake.',
          details: null,
        },
      },
    });
    await renderPanel(services);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The profile could not be sent to the machine. Check the machine is awake.');
    await userEvent.click(within(alert).getByRole('button', { name: /close/i }));
    expect(screen.queryByText(/could not be sent/)).not.toBeInTheDocument();
  });
});

describe('MachinePanel controls', () => {
  it('sends the right state for each start button', async () => {
    const { services } = await renderPanel();
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

  it('puts an idle machine to sleep', async () => {
    const { services } = await renderPanel();
    expect(screen.getByTestId(TID.stopButton)).toBeDisabled();
    await userEvent.click(screen.getByTestId(TID.sleepWakeButton));
    expect(stateCalls(services)).toEqual(['sleeping']);
  });

  it('wakes a sleeping machine and will not brew until then', async () => {
    const { services } = await renderPanel(createFakeServices({ telemetry: SLEEPING }));
    expect(screen.getByTestId(TID.espressoButton)).toBeDisabled();
    expect(screen.getByText(/asleep/i)).toBeInTheDocument();
    const wake = screen.getByTestId(TID.sleepWakeButton);
    expect(wake).toHaveTextContent('Wake');
    await userEvent.click(wake);
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('offers Stop while a shot runs and disables the other starts', async () => {
    const { services } = await renderPanel(createFakeServices({ telemetry: PULLING }));
    for (const testId of [TID.espressoButton, TID.steamButton, TID.flushButton, TID.hotWaterButton, TID.sleepWakeButton]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
    const stop = screen.getByTestId(TID.stopButton);
    expect(stop).toBeEnabled();
    await userEvent.click(stop);
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('commands nothing without a machine, and says why', async () => {
    const { services } = await renderPanel(createFakeServices({ telemetry: { ...DISCONNECTED, scaleConnected: true } }));
    for (const testId of [TID.espressoButton, TID.steamButton, TID.flushButton, TID.hotWaterButton, TID.stopButton, TID.sleepWakeButton]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
    expect(screen.getByRole('status')).toHaveTextContent(/not connected\. wake the DE1/i);
    // The scale is reached through Decaid, so tare still works.
    expect(screen.getByTestId(TID.tareButton)).toBeEnabled();
    expect(services.decaid.calls.filter((call) => call.method === 'getMachineInfo')).toHaveLength(0);
  });

  it('shows "Start on the machine" on a GHC machine but keeps Stop and Sleep', async () => {
    const services = createFakeServices();
    services.decaid.getMachineInfo = async () => ({ version: '1358', model: 'DE1XL', serialNumber: '7', GHC: true });
    await renderPanel(services);
    expect(screen.getByText('Start on the machine')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.espressoButton)).not.toBeInTheDocument();
    expect(screen.getByTestId(TID.stopButton)).toBeInTheDocument();
    expect(screen.getByTestId(TID.sleepWakeButton)).toBeEnabled();

    act(() => services.telemetry.setState(PULLING));
    expect(screen.getByTestId(TID.stopButton)).toBeEnabled();
  });

  it('remembers a GHC machine across loads so the layout does not flicker', async () => {
    const first = createFakeServices();
    first.decaid.getMachineInfo = async () => ({ version: '1358', model: 'DE1XL', serialNumber: '7', GHC: true });
    const view = await renderPanel(first);
    view.unmount();

    // Next load, before the machine has answered (it is still connecting).
    await renderPanel(createFakeServices({ telemetry: DISCONNECTED }));
    expect(screen.getByText('Start on the machine')).toBeInTheDocument();
  });

  it('cannot tare without a scale', async () => {
    await renderPanel(createFakeServices({ telemetry: { scaleConnected: false, scale: null } }));
    const tare = screen.getByTestId(TID.tareButton);
    expect(tare).toBeDisabled();
    expect(tare).toHaveAccessibleDescription(/connect a scale/i);
  });

  it('tares the scale and shows a tare failure in plain words', async () => {
    const services = createFakeServices();
    await renderPanel(services);
    await userEvent.click(screen.getByTestId(TID.tareButton));
    expect(services.decaid.calls.filter((call) => call.method === 'tareScale')).toHaveLength(1);

    services.decaid.failNext(
      'tareScale',
      new GatewayError(400, '/api/v1/scale/tare', "The scale can't be tared during a shot.", 'block_tare_during_shot'),
    );
    await userEvent.click(screen.getByTestId(TID.tareButton));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't tare the scale. The scale can't be tared during a shot.");
  });

  it('shows a command error inline and never retries on its own', async () => {
    const services = createFakeServices();
    services.decaid.failNext(
      'setMachineState',
      new GatewayError(400, '/api/v1/machine/state/espresso', 'Connect a scale before pulling a shot (Decaid is set to require one).', 'block_no_scale'),
    );
    await renderPanel(services);
    await userEvent.click(screen.getByTestId(TID.espressoButton));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't start the shot. Connect a scale before pulling a shot");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(stateCalls(services)).toEqual(['espresso']);

    // A later success clears it.
    await userEvent.click(screen.getByTestId(TID.espressoButton));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    await renderPanel(services);
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
});

describe('MachinePanel graph modes', () => {
  it('shows the panel graph by default, and as the button to the Shot view when it can open it', async () => {
    const onOpenGraph = vi.fn();
    const { rerenderWith } = await renderPanel();
    expect(screen.getByTestId(TID.liveGraph)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /legend/i })).toBeInTheDocument();
    expect(screen.queryByTestId(TID.previewGraph)).not.toBeInTheDocument();

    rerenderWith(<MachinePanel graph="preview" onOpenGraph={onOpenGraph} />);
    const preview = screen.getByRole('button', { name: 'Open the shot graph' });
    expect(preview).toBe(screen.getByTestId(TID.previewGraph));
    await userEvent.click(preview);
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
  });

  it('graph="full" is the phone Machine tab: status, buttons, then the big graph and the coach note', async () => {
    const services = createFakeServices();
    renderWithServices(<MachinePanel graph="full" />, services);
    await act(async () => {});
    expect(screen.getByRole('list', { name: 'Shot readouts' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /legend/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId(TID.previewGraph)).not.toBeInTheDocument();
    expect(screen.queryByTestId(TID.coachNote)).not.toBeInTheDocument();

    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    const graph = screen.getByTestId(TID.liveGraph);
    const note = screen.getByTestId(TID.coachNote);
    // Below the controls, the note last.
    expect(screen.getByTestId(TID.espressoButton).compareDocumentPosition(graph) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(graph.nextElementSibling).toBe(note);
    expect(note.nextElementSibling).toBeNull();
  });

  it('graph="full" passes the note its "Reading the shot" state', async () => {
    renderWithServices(<MachinePanel graph="full" awaitingOutcome />);
    await act(async () => {});
    expect(screen.getByTestId(TID.coachNote)).toHaveTextContent('Done. Reading the shot');
  });

  it('columns={2} (a phone on its side): status and buttons in one column, the graph and the note in the other', async () => {
    const services = createFakeServices();
    const { rerenderWith } = renderWithServices(<MachinePanel graph="full" columns={2} />, services);
    await act(async () => {});
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    const status = screen.getByRole('region', { name: 'Machine status' });
    const controls = screen.getByRole('region', { name: 'Machine controls' });
    const graph = screen.getByTestId(TID.liveGraph);
    const note = screen.getByTestId(TID.coachNote);
    const left = status.parentElement!;
    const right = graph.parentElement!;
    expect(controls.parentElement).toBe(left);
    expect(note.parentElement).toBe(right);
    expect(left.nextElementSibling).toBe(right);
    expect(getComputedStyle(left.parentElement!).flexDirection).toBe('row');
    // The buttons' column scrolls on its own if it must; the graph's never needs to.
    expect(getComputedStyle(left).overflowY).toBe('auto');

    // Turning the phone upright keeps the very same buttons (a command in flight stays in flight).
    const espresso = screen.getByTestId(TID.espressoButton);
    rerenderWith(<MachinePanel graph="full" columns={1} />);
    expect(screen.getByTestId(TID.espressoButton)).toBe(espresso);
    expect(getComputedStyle(left).display).toBe('contents');
    expect(getComputedStyle(left.parentElement!).flexDirection).toBe('column');
  });

  it('graph="none", or the older showGraph={false}, leaves the graph out and keeps the rest', async () => {
    const { rerenderWith } = renderWithServices(<MachinePanel graph="none" />);
    await act(async () => {});
    expect(screen.queryByTestId(TID.liveGraph)).not.toBeInTheDocument();
    expect(screen.getByTestId(TID.machineState)).toBeInTheDocument();
    expect(screen.getByTestId(TID.espressoButton)).toBeInTheDocument();

    rerenderWith(<MachinePanel showGraph={false} onOpenGraph={() => {}} />);
    expect(screen.queryByTestId(TID.liveGraph)).not.toBeInTheDocument();
    expect(screen.queryByTestId(TID.previewGraph)).not.toBeInTheDocument();
  });
});

describe('MachinePanel rendering cost', () => {
  it('does not re-render for graph samples or telemetry it does not show', async () => {
    const services = createFakeServices();
    let commits = 0;
    renderWithServices(
      <Profiler id="panel" onRender={() => (commits += 1)}>
        <MachinePanel />
      </Profiler>,
      services,
    );
    await act(async () => {});
    const before = commits;

    act(() => {
      for (let i = 0; i < 30; i += 1) {
        // Pressure, flow and timestamps change every frame but are not readouts.
        services.telemetry.setState({
          machine: machine({ pressure: i / 3, flow: i / 10, timestamp: `2026-10-03T08:00:${String(i).padStart(2, '0')}.000000` }),
        });
      }
    });
    expect(commits).toBe(before);
  });
});
