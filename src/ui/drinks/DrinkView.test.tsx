// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
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

  it('keeps the loops still once the run is over, and no water falls', () => {
    const { send } = renderView('hotWater');
    send(frame('hotWater', 'pouring'));
    const dial = screen.getByTestId(TID.drinkDial);
    expect(dial).toHaveAttribute('data-moving', 'true');
    expect(getComputedStyle(dial.querySelector('.stream')!).display).not.toBe('none');
    send(frame('idle', 'idle'));
    expect(dial).toHaveAttribute('data-moving', 'false');
    expect(getComputedStyle(dial.querySelector('.stream')!).display).toBe('none');
  });

  it('sets the done check above the number, not over the whole dial as the drawing is', () => {
    const { send } = renderView('flush');
    send(frame('flush', 'pouring'));
    send(frame('idle', 'idle'));
    const dial = screen.getByTestId(TID.drinkDial);
    const check = dial.querySelector('.done-check');
    expect(check).not.toBeNull();
    expect(getComputedStyle(check!).position).not.toBe('absolute');
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
