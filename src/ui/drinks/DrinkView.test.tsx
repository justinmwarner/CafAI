// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { MachineFrame } from '../../api/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { DrinkView } from './DrinkView.tsx';
import { drinkTraceFor } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

let seconds = 0;
const frame = (state: string, substate = 'pouring', values: Partial<MachineFrame> = {}): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  timestamp: formatLocalTimestamp(new Date(2026, 9, 13, 8).getTime() + (seconds += 0.5) * 1000),
  state: { state, substate },
  ...values,
});

function renderView(kind: DrinkKind, services: FakeServices = createFakeServices()) {
  drinkTraceFor(services.telemetry);
  const onGoBack = vi.fn();
  renderWithServices(<DrinkView kind={kind} back={{ name: 'settings' }} onGoBack={onGoBack} />, services);
  const send = (f: MachineFrame) => act(() => services.telemetry.setState({ machine: f }));
  return { services, onGoBack, send };
}

describe('DrinkView', () => {
  it('names the drink and says its phase as the machine moves through it', () => {
    const { send } = renderView('steam');
    expect(screen.getByRole('heading', { name: 'Steam' })).toBeInTheDocument();
    send(frame('steam', 'preparingForShot'));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Heating');
    send(frame('steam', 'pouring', { steamTemperature: 152, pressure: 1.9, flow: 0.8 }));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Steaming');
    send(frame('steam', 'puffing'));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Purging');
    send(frame('idle', 'idle'));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Done');
  });

  it("counts the drink toward its target on the dial, from the machine's own settings", async () => {
    const services = createFakeServices();
    const { send } = renderView('steam', services);
    await screen.findByText('Changes go to Decaid at once.');
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    expect(screen.getByTestId(TID.drinkDialValue)).toHaveTextContent('1.0');
    expect(screen.getByTestId(TID.drinkDialOf)).toHaveTextContent('of 50 s');
    act(() =>
      services.telemetry.setState({
        shotSettings: {
          steamSetting: 0,
          targetSteamTemp: 150,
          targetSteamDuration: 40,
          targetHotWaterTemp: 75,
          targetHotWaterVolume: 50,
          targetHotWaterDuration: 30,
          targetShotVolume: 0,
          groupTemp: 93,
        },
      }),
    );
    expect(screen.getByTestId(TID.drinkDialOf)).toHaveTextContent('of 40 s');
  });

  it("keeps a finished run's target on the dial when a setting changes afterwards", async () => {
    const services = createFakeServices();
    const { send } = renderView('steam', services);
    await screen.findByText('Changes go to Decaid at once.');
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    send(frame('idle', 'idle'));
    expect(screen.getByTestId(TID.drinkDialOf)).toHaveTextContent('of 50 s');
    // The barista sets a longer steam for next time; the machine's shot settings follow.
    act(() =>
      services.telemetry.setState({
        shotSettings: {
          steamSetting: 0,
          targetSteamTemp: 150,
          targetSteamDuration: 55,
          targetHotWaterTemp: 75,
          targetHotWaterVolume: 50,
          targetHotWaterDuration: 30,
          targetShotVolume: 0,
          groupTemp: 93,
        },
      }),
    );
    expect(screen.getByTestId(TID.drinkDialOf)).toHaveTextContent('of 50 s');
  });

  it('shows no check for a run the machine going away cut short', () => {
    const { services, send } = renderView('steam');
    send(frame('steam', 'pouring'));
    act(() => services.telemetry.setState({ machineConnected: false }));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Connection lost');
    expect(screen.getByTestId(TID.drinkDial).querySelector('.done-check')).toBeNull();
  });

  it('names the dial in words for a screen reader', async () => {
    const { send } = renderView('steam');
    await screen.findByText('Changes go to Decaid at once.');
    expect(screen.getByRole('img', { name: 'Steam time: none yet' })).toBeInTheDocument();
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    expect(screen.getByRole('img', { name: 'Steam time: 1 second of 50' })).toBeInTheDocument();
  });

  it('shows the readouts of the drink, live', () => {
    const { send } = renderView('steam');
    send(frame('steam', 'pouring', { steamTemperature: 152, pressure: 1.94, flow: 0.81 }));
    expect(screen.getByTestId(TID.drinkReadout('steam'))).toHaveTextContent('152 °C');
    expect(screen.getByTestId(TID.drinkReadout('pressure'))).toHaveTextContent('1.9 bar');
    expect(screen.getByTestId(TID.drinkReadout('flow'))).toHaveTextContent('0.8 ml/s');
  });

  it('holds the settings while the drink runs, and lets them change once it stops', async () => {
    const { services, send } = renderView('flush');
    await screen.findByText('Changes go to Decaid at once.');
    send(frame('flush', 'pouring'));
    const time = screen.getByRole('spinbutton', { name: 'Flush time' });
    expect(time).toBeDisabled();
    expect(screen.getByText('Change these once it stops: the machine is using them now.')).toBeInTheDocument();
    send(frame('idle', 'idle'));
    expect(time).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'More flush time' }));
    expect(services.decaid.calls.find((call) => call.method === 'updateWorkflow')?.args).toEqual([{ rinseData: { duration: 11 } }]);
  });

  it('offers Go back only while nothing runs, named for where it goes', async () => {
    const { onGoBack, send } = renderView('hotWater');
    expect(screen.getByRole('button', { name: 'Go back to Settings' })).toBeInTheDocument();
    send(frame('hotWater', 'pouring'));
    expect(screen.queryByRole('button', { name: 'Go back to Settings' })).toBeNull();
    send(frame('idle', 'idle'));
    await userEvent.click(screen.getByRole('button', { name: 'Go back to Settings' }));
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it("says nothing of a phase, and shows a dash on the dial, before the drink's first run", () => {
    renderView('flush');
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('');
    expect(screen.getByTestId(TID.drinkDialValue)).toHaveTextContent('—');
  });

  it('keeps the loops still once the run is over', () => {
    const { send } = renderView('hotWater');
    send(frame('hotWater', 'pouring'));
    const dial = screen.getByTestId(TID.drinkDial);
    expect(dial).toHaveAttribute('data-moving', 'true');
    send(frame('idle', 'idle'));
    expect(dial).toHaveAttribute('data-moving', 'false');
  });

  it('sets the done check above the number, not over the whole dial as the drawing is', () => {
    const { send } = renderView('flush');
    send(frame('flush', 'pouring'));
    send(frame('idle', 'idle'));
    const dial = screen.getByTestId(TID.drinkDial);
    const check = dial.querySelector('.done-check');
    expect(check).not.toBeNull();
    expect(getComputedStyle(check!).width).not.toBe('100%');
    expect(getComputedStyle(dial.querySelector(':scope > svg')!).position).toBe('absolute');
  });

  it("draws the trace of the run's flow", () => {
    const { send } = renderView('flush');
    send(frame('flush', 'pouring', { flow: 6 }));
    send(frame('flush', 'pouring', { flow: 6 }));
    const trace = screen.getByTestId(TID.drinkTrace);
    expect(within(trace).getByTestId('trace-flow').getAttribute('d')).toMatch(/^M0,/);
  });
});

describe('DrinkView going back by itself (D221)', () => {
  /** The countdown's clock; the presets load, and taps land, on real timers. */
  const fakeClock = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const seconds = () => screen.queryByTestId(TID.drinkGoBackSeconds);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('once a steam it saw is done, counts down on Go back, says once where it goes, and goes back by itself after 10 s', () => {
    const { onGoBack, send } = renderView('steam');
    fakeClock();
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    expect(seconds()).toBeNull();
    expect(screen.queryByTestId(TID.drinkStay)).toBeNull();
    send(frame('idle', 'idle'));
    expect(seconds()).toHaveTextContent('10 s');
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Done. Going back to Settings in 10 seconds.');
    // Go back keeps its name, the seconds inside it; Stay sits before it.
    const back = screen.getByRole('button', { name: 'Go back to Settings' });
    expect(back).toContainElement(seconds());
    expect(screen.getByRole('button', { name: 'Stay on this screen' })).toHaveTextContent('Stay');

    wait(1000);
    expect(seconds()).toHaveTextContent('9 s');
    // Said once, never second by second.
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Done. Going back to Settings in 10 seconds.');
    wait(8999);
    expect(seconds()).toHaveTextContent('1 s');
    expect(onGoBack).not.toHaveBeenCalled();
    wait(1);
    expect(onGoBack).toHaveBeenCalledTimes(1);
    expect(onGoBack).toHaveBeenCalledWith({ auto: true });
  });

  it('Stay keeps the view: no going back, no seconds, Go back as it was, and the focus on it', async () => {
    const { onGoBack, send } = renderView('steam');
    fakeClock();
    send(frame('steam', 'pouring'));
    send(frame('idle', 'idle'));
    wait(3000);
    await userEvent.click(screen.getByRole('button', { name: 'Stay on this screen' }));
    expect(seconds()).toBeNull();
    expect(screen.queryByTestId(TID.drinkStay)).toBeNull();
    expect(screen.getByTestId(TID.drinkPhase).textContent).toBe('·Done');
    const back = screen.getByRole('button', { name: 'Go back to Settings' });
    expect(back).toHaveTextContent(/^Go back$/);
    expect(back).toHaveFocus();
    wait(20_000);
    expect(onGoBack).not.toHaveBeenCalled();
  });

  it('a press on Stay keeps the view as it starts, even when the zero falls before it is let go', () => {
    const { onGoBack, send } = renderView('steam');
    fakeClock();
    send(frame('steam', 'pouring'));
    send(frame('idle', 'idle'));
    wait(9900);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Stay on this screen' }));
    wait(200);
    expect(onGoBack).not.toHaveBeenCalled();
    expect(seconds()).toBeNull();
    expect(screen.getByRole('button', { name: 'Go back to Settings' })).toHaveFocus();
  });

  it('Enter or Space on Stay keeps the view as the key goes down', () => {
    const { onGoBack, send } = renderView('steam');
    fakeClock();
    send(frame('steam', 'pouring'));
    send(frame('idle', 'idle'));
    wait(9900);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Stay on this screen' }), { key: ' ' });
    wait(200);
    expect(onGoBack).not.toHaveBeenCalled();
    expect(seconds()).toBeNull();
  });

  it('a tap anywhere on the view keeps it, and does what it was for', async () => {
    const { services, onGoBack, send } = renderView('steam');
    await screen.findByText('Changes go to Decaid at once.');
    fakeClock();
    send(frame('steam', 'pouring'));
    send(frame('idle', 'idle'));
    await userEvent.click(screen.getByRole('button', { name: 'More steam time' }));
    expect(seconds()).toBeNull();
    expect(services.decaid.calls.find((call) => call.method === 'updateWorkflow')?.args).toEqual([{ steamSettings: { duration: 55 } }]);
    wait(20_000);
    expect(onGoBack).not.toHaveBeenCalled();
  });

  it('a key press in the view keeps it', async () => {
    const { onGoBack, send } = renderView('steam');
    await screen.findByText('Changes go to Decaid at once.');
    fakeClock();
    send(frame('steam', 'pouring'));
    send(frame('idle', 'idle'));
    act(() => screen.getByRole('button', { name: 'More steam time' }).focus());
    await userEvent.keyboard('{Shift}');
    expect(seconds()).toBeNull();
    wait(20_000);
    expect(onGoBack).not.toHaveBeenCalled();
  });

  it('a press on Go back while it counts goes back at once, as the barista asked', async () => {
    const { onGoBack, send } = renderView('hotWater');
    fakeClock();
    send(frame('hotWater', 'pouring'));
    send(frame('idle', 'idle'));
    await userEvent.click(screen.getByRole('button', { name: 'Go back to Settings' }));
    expect(onGoBack).toHaveBeenCalledTimes(1);
    expect(onGoBack).toHaveBeenCalledWith();
  });

  it('with going back by itself off, it is Done and stays, with Go back', async () => {
    const services = createFakeServices();
    await services.drinkScreens.set('steam', { goBack: false });
    const { onGoBack, send } = renderView('steam', services);
    fakeClock();
    send(frame('steam', 'pouring'));
    send(frame('idle', 'idle'));
    expect(screen.getByTestId(TID.drinkPhase).textContent).toBe('·Done');
    expect(seconds()).toBeNull();
    expect(screen.queryByTestId(TID.drinkStay)).toBeNull();
    wait(20_000);
    expect(onGoBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Go back to Settings' })).toBeInTheDocument();
  });

  it('never counts down after a run the machine going away cut short', () => {
    const { services, onGoBack, send } = renderView('steam');
    fakeClock();
    send(frame('steam', 'pouring'));
    act(() => services.telemetry.setState({ machineConnected: false }));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Connection lost');
    expect(seconds()).toBeNull();
    wait(20_000);
    expect(onGoBack).not.toHaveBeenCalled();
  });

  it('never counts down on a view opened after the run was over', () => {
    const services = createFakeServices();
    drinkTraceFor(services.telemetry);
    services.telemetry.setState({ machine: frame('flush', 'pouring') });
    services.telemetry.setState({ machine: frame('idle', 'idle') });
    const { onGoBack } = renderView('flush', services);
    fakeClock();
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Done');
    expect(seconds()).toBeNull();
    wait(20_000);
    expect(onGoBack).not.toHaveBeenCalled();
  });
});
