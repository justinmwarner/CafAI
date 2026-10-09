// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalizeProfile } from '../../../mock/decaid/profiles.ts';
import type { MachineSnapshot, TelemetryState } from '../../api/types.ts';
import blooming from '../../coach/templates/source/Blooming_espresso.json';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, SAMPLE_WORKFLOW, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { MachineRow } from './MachineRow.tsx';
import { StatsCard } from './StatsCard.tsx';

const machine = (patch: Partial<MachineSnapshot>): MachineSnapshot => ({ ...IDLE_TELEMETRY.machine!, ...patch });

const DISCONNECTED: Partial<TelemetryState> = { machineConnected: false, scaleConnected: false, scale: null };
const SLEEPING: Partial<TelemetryState> = { machine: machine({ state: { state: 'sleeping', substate: 'idle' } }) };
const PULLING: Partial<TelemetryState> = {
  machine: machine({ state: { state: 'espresso', substate: 'preinfusion' }, pressure: 2.1, flow: 3.9 }),
};

async function renderCard(services: FakeServices = createFakeServices()) {
  const view = renderWithServices(<StatsCard />, services);
  // Let the workflow and machine-info reads settle inside act().
  await act(async () => {});
  return view;
}

const card = () => screen.getByTestId(TID.statsCard);
const inCard = (testId: string) => within(card()).getByTestId(testId);
const calls = (services: FakeServices, method: string) => services.decaid.calls.filter((call) => call.method === method);
const stateCalls = (services: FakeServices) => calls(services, 'setMachineState').map((call) => call.args[0]);

/** The card's own width, as the layout reads it (jsdom lays nothing out). */
function cardWidth(width: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('StatsCard: what it shows', () => {
  it('shows a connected, ready machine: the state, both links, the four readouts and the profile', async () => {
    await renderCard();
    expect(within(card()).getByRole('heading', { name: 'Machine' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Machine' })).toBe(card());
    expect(inCard(TID.machineState)).toHaveTextContent('Ready');
    expect(inCard(TID.connectionStatus)).toHaveTextContent('DE1 connected');
    expect(inCard(TID.connectionStatus)).toHaveTextContent('Scale connected');
    expect(inCard(TID.groupTemp)).toHaveTextContent('92.4 °C');
    expect(inCard(TID.groupTemp)).toHaveTextContent('target 92.5');
    expect(inCard(TID.steamTemp)).toHaveTextContent('140 °C');
    expect(inCard(TID.waterLevel)).toHaveTextContent('40 mm');
    expect(inCard(TID.scaleWeight)).toHaveTextContent('0.0 g');
    expect(within(card()).getByRole('group', { name: 'Profile' })).toHaveTextContent('Blooming Espresso');
  });

  it('says "Not connected" and blanks the readouts when the machine link is down', async () => {
    await renderCard(createFakeServices({ telemetry: DISCONNECTED }));
    expect(inCard(TID.machineState)).toHaveTextContent('Not connected');
    expect(inCard(TID.connectionStatus)).toHaveTextContent('No machine');
    expect(inCard(TID.connectionStatus)).toHaveTextContent('No scale');
    expect(inCard(TID.groupTemp)).toHaveTextContent('—');
    expect(inCard(TID.scaleWeight)).toHaveTextContent('No scale');
    // D42: never "on the machine" while it is away.
    expect(within(card()).getByRole('group', { name: 'Profile' })).toHaveTextContent('Decaid loads it when the machine connects');
  });

  it('shows something readable for a malformed machine frame', async () => {
    const broken = { ...IDLE_TELEMETRY.machine!, state: undefined, groupTemperature: undefined } as unknown as MachineSnapshot;
    await renderCard(createFakeServices({ telemetry: { machine: broken } }));
    expect(inCard(TID.machineState)).toHaveTextContent('Connected');
    expect(inCard(TID.groupTemp)).toHaveTextContent('—');
  });

  it('follows the machine live', async () => {
    const { services } = await renderCard();
    act(() => services.telemetry.setState(PULLING));
    expect(inCard(TID.machineState)).toHaveTextContent('Pulling a shot: preinfusion');
    act(() => services.telemetry.setState({ machine: machine({ groupTemperature: 93.06 }) }));
    expect(inCard(TID.machineState)).toHaveTextContent('Ready');
    expect(inCard(TID.groupTemp)).toHaveTextContent('93.1 °C');
    act(() => services.telemetry.setState({ scale: { ...IDLE_TELEMETRY.scale!, weight: 18.44 } }));
    expect(inCard(TID.scaleWeight)).toHaveTextContent('18.4 g');
    act(() => services.telemetry.setState(SLEEPING));
    expect(inCard(TID.machineState)).toHaveTextContent('Sleeping');
  });

  it("names the running step of the profile in Decaid's workflow, from the Profile line's read", async () => {
    // Blooming Espresso's bloom: 30 s with the pump off, which the machine reports as pouring.
    const bloom = machine({ state: { state: 'espresso', substate: 'pouring' }, profileFrame: 2, pressure: 0, flow: 0 });
    const services = createFakeServices({ telemetry: { machine: bloom } });
    services.decaid.getWorkflow = async () => {
      services.decaid.calls.push({ method: 'getWorkflow', args: [] });
      return { ...SAMPLE_WORKFLOW, profile: normalizeProfile(blooming) };
    };
    await renderCard(services);
    expect(inCard(TID.machineState)).toHaveTextContent('Pulling a shot: pause');
    act(() => services.telemetry.setState({ machine: { ...bloom, profileFrame: 3, pressure: 6 } }));
    expect(inCard(TID.machineState)).toHaveTextContent('Pulling a shot: ramp');
    expect(calls(services, 'getWorkflow')).toHaveLength(1);
  });

  it('warns when the tank needs refilling', async () => {
    await renderCard(createFakeServices({ telemetry: { waterLevels: { currentLevel: 4, refillLevel: 5 } } }));
    expect(inCard(TID.waterLevel)).toHaveTextContent('Refill');
  });
});

describe('StatsCard: Tare and Sleep', () => {
  it('tares the scale', async () => {
    const { services } = await renderCard();
    await userEvent.click(inCard(TID.tareButton));
    expect(calls(services, 'tareScale')).toHaveLength(1);
  });

  it('cannot tare without a scale, and says why to a screen reader', async () => {
    await renderCard(createFakeServices({ telemetry: { scaleConnected: false, scale: null } }));
    const tare = inCard(TID.tareButton);
    expect(tare).toBeDisabled();
    expect(tare).toHaveAccessibleDescription(/connect a scale/i);
  });

  it('puts a ready machine to sleep, and wakes a sleeping one', async () => {
    const { services } = await renderCard();
    const button = inCard(TID.sleepWakeButton);
    expect(button).toHaveTextContent('Sleep');
    await userEvent.click(button);
    expect(stateCalls(services)).toEqual(['sleeping']);

    act(() => services.telemetry.setState(SLEEPING));
    expect(button).toHaveTextContent('Wake');
    await userEvent.click(button);
    expect(stateCalls(services)).toEqual(['sleeping', 'idle']);
  });

  it('holds Sleep while something runs, and without a machine; the scale tares through Decaid either way', async () => {
    const { services } = await renderCard(createFakeServices({ telemetry: PULLING }));
    expect(inCard(TID.sleepWakeButton)).toBeDisabled();
    expect(inCard(TID.tareButton)).toBeEnabled();
    act(() => services.telemetry.setState({ ...DISCONNECTED, scaleConnected: true }));
    expect(inCard(TID.sleepWakeButton)).toBeDisabled();
    expect(inCard(TID.tareButton)).toBeEnabled();
  });

  it("holds its buttons while the row's command is in flight: one command at a time across the app", async () => {
    const services = createFakeServices();
    let release: () => void = () => {};
    services.decaid.setMachineState = (state) => {
      services.decaid.calls.push({ method: 'setMachineState', args: [state] });
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    renderWithServices(
      <>
        <MachineRow />
        <StatsCard />
      </>,
      services,
    );
    await act(async () => {});
    act(() => screen.getByTestId(TID.espressoButton).click());
    expect(inCard(TID.sleepWakeButton)).toBeDisabled();
    expect(inCard(TID.tareButton)).toBeDisabled();
    await act(async () => release());
    expect(inCard(TID.sleepWakeButton)).toBeEnabled();
    expect(inCard(TID.tareButton)).toBeEnabled();
  });

  it('shows no failure of its own: the alert under the top bar does', async () => {
    const services = createFakeServices();
    services.decaid.failNext('tareScale', new Error("The scale can't be tared during a shot."));
    await renderCard(services);
    await userEvent.click(inCard(TID.tareButton));
    await act(async () => {});
    expect(calls(services, 'tareScale')).toHaveLength(1);
    expect(within(card()).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('StatsCard: its own width', () => {
  const columns = () => getComputedStyle(inCard(TID.groupTemp).parentElement!).gridTemplateColumns;

  it('puts the four readouts in a row where it has the room', async () => {
    cardWidth(680);
    await renderCard();
    expect(columns()).toBe('repeat(4, minmax(0, 1fr))');
    expect(inCard(TID.sleepWakeButton)).toHaveTextContent('Sleep');
  });

  it('puts them two by two under 520 px, and Sleep becomes its icon, named for screen readers', async () => {
    cardWidth(519);
    await renderCard(createFakeServices({ telemetry: SLEEPING }));
    expect(columns()).toBe('repeat(2, minmax(0, 1fr))');
    const wake = inCard(TID.sleepWakeButton);
    expect(wake).toHaveTextContent('');
    expect(wake).toHaveAccessibleName('Wake');
    expect(inCard(TID.tareButton)).toHaveTextContent('Tare');
  });

  it('takes the room it has before its first paint, and follows it when it changes', async () => {
    let width = 360;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    await renderCard();
    expect(columns()).toBe('repeat(2, minmax(0, 1fr))');
    // jsdom has no ResizeObserver, so the card listens for the window's resizes.
    width = 600;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(columns()).toBe('repeat(4, minmax(0, 1fr))');
  });
});

describe('StatsCard: rendering cost', () => {
  it('does not re-render for telemetry it does not show', async () => {
    const services = createFakeServices();
    let commits = 0;
    renderWithServices(
      <Profiler id="card" onRender={() => (commits += 1)}>
        <StatsCard />
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
