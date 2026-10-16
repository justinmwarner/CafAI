// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GatewayError, type TelemetryState } from '../../api/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { DASH } from './format.ts';
import { LoadedProfileContextForTests } from './LoadedProfileContext.tsx';
import { MachineAlerts } from './MachineAlerts.tsx';
import { ShotView } from './ShotView.tsx';
import type { LoadedProfileState } from './useLoadedProfile.ts';
import { machineCommandsFor } from './useMachineCommands.ts';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

/** The Shot view's own box, as it measures it (jsdom lays nothing out). */
function viewSize(width: number, height: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height);
}

const style = (element: Element) => getComputedStyle(element);
const header = () => screen.getByTestId(TID.shotTimer).parentElement!;
const readouts = () => screen.getByRole('list', { name: 'Shot readouts' });
const plot = () => screen.getByRole('img', { name: 'Pressure, flow and weight over the shot' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ShotView', () => {
  it('shows the dash for a machine reading Decaid did not send, never 0 (5.8)', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { services } = renderWithServices(<ShotView awaitingOutcome={false} />);
    const machine = { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'pouring' }, pressure: null, flow: 2.1 };
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => services.telemetry.emitSample({ tS: 1, machine, scale: null }));
    act(() => {
      for (const paint of frames.splice(0)) paint();
    });
    const value = (label: string) => within(readouts()).getByText(label).closest('li')!.lastElementChild!.firstElementChild!.textContent;
    expect(value('Pressure')).toBe(DASH);
    expect(value('Flow')).toBe('2.1 ml/s');
  });

  it('is the full graph, with the coach note under it once a shot runs', () => {
    const { services } = renderWithServices(<ShotView awaitingOutcome={false} />);
    const view = screen.getByTestId(TID.shotView);
    expect(within(view).getByTestId(TID.liveGraph)).toBeInTheDocument();
    expect(within(view).getByRole('list', { name: 'Shot readouts' })).toBeInTheDocument();
    expect(within(view).queryByTestId(TID.coachNote)).not.toBeInTheDocument();

    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    // Under the plot, never over the curves.
    expect(view.lastElementChild).toContainElement(within(view).getByTestId(TID.coachNote));
    expect(view.lastElementChild).not.toContainElement(within(view).getByTestId(TID.liveGraph));
  });

  it('shows the note while the chat waits for the outcome', () => {
    renderWithServices(<ShotView awaitingOutcome />);
    expect(screen.getByTestId(TID.coachNote)).toHaveTextContent('Done. Reading the shot');
  });

  it("on a tablet, spans the pane up to a width still read at a glance: the step beside the caption, four readouts in a row", () => {
    viewSize(962, 546);
    renderWithServices(<ShotView awaitingOutcome={false} />);
    expect(style(screen.getByTestId(TID.shotView)).maxWidth).toBe('960px');
    expect(style(header()).gridTemplateAreas).toBe('"caption step timer"');
    expect(style(readouts()).gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect(style(screen.getByTestId(TID.shotTimer)).fontSize).toBe('46px');
    expect(style(plot()).minHeight).toBe('120px');
  });

  it("on an upright phone's Shot tab, puts the step on its own line and the readouts two by two", () => {
    viewSize(390, 700);
    renderWithServices(<ShotView awaitingOutcome={false} />);
    expect(style(header()).gridTemplateAreas).toBe('"caption timer" "step step"');
    expect(style(readouts()).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(style(screen.getByTestId(TID.shotTimer)).fontSize).toBe('34px');
    // The plot fills what is left, and never less than this.
    expect(style(plot()).minHeight).toBe('120px');
  });

  it('on a phone on its side, keeps four readouts in a row and takes the smaller sizes, so the plot keeps its room', () => {
    viewSize(764, 338);
    renderWithServices(<ShotView awaitingOutcome={false} />);
    expect(style(header()).gridTemplateAreas).toBe('"caption step timer"');
    expect(style(readouts()).gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect(style(screen.getByTestId(TID.shotTimer)).fontSize).toBe('34px');
    expect(style(plot()).minHeight).toBe('120px');
  });

  it('follows its own box as the phone turns', () => {
    let width = 390;
    let height = 700;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height);
    renderWithServices(<ShotView awaitingOutcome={false} />);
    expect(style(readouts()).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    // jsdom has no ResizeObserver, so the view listens for the window's resizes.
    width = 764;
    height = 338;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(style(readouts()).gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
  });
});

/** Blooming Espresso's four steps, as the shell's one workflow read gives them. */
const BLOOMING_STEPS = ['preinfusion', 'pause', 'ramp', 'pour'];

function reading(stepNames: readonly string[] | null = BLOOMING_STEPS): LoadedProfileState {
  return { title: 'Blooming Espresso', mark: 'thisBag', stepNames, targetYieldG: 36 };
}

/** The machine in `state`, running step `frame` (0-based). */
const atStep = (frame: number, state = 'espresso', substate = 'pouring'): Partial<TelemetryState> => ({
  machine: { ...IDLE_TELEMETRY.machine!, state: { state, substate }, profileFrame: frame },
});

function renderShot(services: FakeServices, shared: LoadedProfileState | null = reading(), extra: ReactElement | null = null) {
  const ui = (
    <>
      {extra}
      <ShotView awaitingOutcome={false} />
    </>
  );
  return renderWithServices(shared ? <LoadedProfileContextForTests.Provider value={shared}>{ui}</LoadedProfileContextForTests.Provider> : ui, services);
}

const nextStep = () => screen.queryByTestId(TID.nextStep);
const stateCalls = (services: FakeServices) => services.decaid.calls.filter((call) => call.method === 'setMachineState').map((call) => call.args[0]);

describe('ShotView: Next step (6.7)', () => {
  it("moves the shot on to the profile's next step while one runs that has another after it", async () => {
    const services = createFakeServices({ telemetry: atStep(1) });
    renderShot(services);
    expect(nextStep()).toHaveAccessibleName('Next step');
    expect(nextStep()).toHaveTextContent('Next step');
    await userEvent.click(nextStep()!);
    expect(stateCalls(services)).toEqual(['skipStep']);
    // Still there through the moment the machine moves on, and on to the next step.
    act(() => services.telemetry.setState(atStep(1, 'skipStep')));
    expect(nextStep()).toBeInTheDocument();
    act(() => services.telemetry.setState(atStep(2, 'espresso', 'preinfusion')));
    expect(nextStep()).toBeEnabled();
  });

  it('is not there on the last step, outside a shot, in the preheat, without the profile, or without the machine', () => {
    const cases: Array<[string, Partial<TelemetryState>, LoadedProfileState | null]> = [
      ['the last step', atStep(3), reading()],
      ['a one-step profile', atStep(0), reading(['pour'])],
      ['idle', atStep(1, 'idle', 'idle'), reading()],
      ['steam', atStep(1, 'steam', 'pouring'), reading()],
      // The step index is still the last shot's until the first step starts.
      ['the preheat', atStep(1, 'espresso', 'preparingForShot'), reading()],
      ['the pour ending', atStep(1, 'espresso', 'pouringDone'), reading()],
      ['no steps read yet', atStep(1), reading(null)],
      ['outside the shell', atStep(1), null],
      ['no machine', { ...atStep(1), machineConnected: false }, reading()],
      ['no step index', { machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'pouring' }, profileFrame: null } }, reading()],
    ];
    for (const [what, telemetry, shared] of cases) {
      renderShot(createFakeServices({ telemetry }), shared);
      expect(nextStep(), what).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('goes through the one command at a time: held while any command is in flight, and sent once', async () => {
    const services = createFakeServices({ telemetry: atStep(0, 'espresso', 'preinfusion') });
    let release: () => void = () => {};
    services.decaid.setMachineState = (state) => {
      services.decaid.calls.push({ method: 'setMachineState', args: [state] });
      return new Promise<void>((resolve) => (release = resolve));
    };
    renderShot(services);
    act(() => nextStep()!.click());
    act(() => nextStep()!.click());
    expect(nextStep()).toBeDisabled();
    expect(stateCalls(services)).toEqual(['skipStep']);
    await act(async () => release());
    // Answered, but held until the machine shows its next step.
    expect(nextStep()).toBeDisabled();
    act(() => services.telemetry.setState(atStep(1, 'espresso', 'pouring')));
    expect(nextStep()).toBeEnabled();

    // Another button's command in flight holds it too.
    services.decaid.tareScale = () => new Promise<void>(() => {});
    act(() => void machineCommandsFor(services.decaid).send('tare', "Couldn't tare the scale."));
    expect(nextStep()).toBeDisabled();
  });

  it("is held while Decaid can't be reached, and sends nothing", async () => {
    const services = createFakeServices({ telemetry: { ...atStep(1), unreachable: true } });
    renderShot(services);
    expect(nextStep()).toBeDisabled();
    act(() => nextStep()!.click());
    expect(stateCalls(services)).toEqual([]);
    act(() => services.telemetry.setState({ unreachable: false }));
    expect(nextStep()).toBeEnabled();
  });

  it('skips one step per tap: held after the tap until the machine shows the next step, or 1.5 s at most', async () => {
    vi.useFakeTimers();
    try {
      const services = createFakeServices({ telemetry: atStep(1) });
      renderShot(services);
      // Decaid answers the PUT at once; the machine shows its next step a moment later.
      act(() => nextStep()!.click());
      await act(async () => {});
      act(() => nextStep()!.click());
      await act(async () => {});
      expect(stateCalls(services)).toEqual(['skipStep']);
      expect(nextStep()).toBeDisabled();
      act(() => services.telemetry.setState(atStep(2)));
      expect(nextStep(), 'the step it skipped to').toBeEnabled();

      // A skip the machine never shows lets go after 1.5 s.
      act(() => nextStep()!.click());
      await act(async () => {});
      act(() => void vi.advanceTimersByTime(1499));
      expect(nextStep()).toBeDisabled();
      act(() => void vi.advanceTimersByTime(1));
      expect(nextStep()).toBeEnabled();
      expect(stateCalls(services)).toEqual(['skipStep', 'skipStep']);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a refused skip in the machine alert, in Decaid's words", async () => {
    const services = createFakeServices({ telemetry: atStep(1) });
    services.decaid.failNext('setMachineState', new GatewayError(500, '/api/v1/machine/state/skipStep', 'The machine did not answer.'));
    renderShot(services, reading(), <MachineAlerts />);
    await act(async () => {});
    await userEvent.click(nextStep()!);
    expect(screen.getByTestId(TID.machineAlerts)).toHaveTextContent("Couldn't move to the next step. The machine did not answer.");
  });

  it('sits at the end of the coach note\'s row; on a phone its icon alone, named', () => {
    viewSize(390, 700);
    const services = createFakeServices({ telemetry: atStep(1) });
    renderShot(services);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    const view = screen.getByTestId(TID.shotView);
    expect(view.lastElementChild).toContainElement(screen.getByTestId(TID.coachNote));
    expect(view.lastElementChild).toContainElement(nextStep());
    expect(nextStep()).toHaveTextContent(/^$/);
    expect(nextStep()).toHaveAccessibleName('Next step');
  });
});
