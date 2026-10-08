// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LiveSample } from '../../api/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { theme } from '../theme.ts';
import { LiveStrip } from './LiveStrip.tsx';

function sample(tS: number, scale = true): LiveSample {
  return {
    tS,
    machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'pouring' }, pressure: 2 + tS / 2, flow: 1.8 },
    scale: scale ? { timestamp: '', weight: tS * 1.5, weightFlow: 1.5, battery: null, timerValue: null } : null,
  };
}

function renderStrip(awaitingOutcome = false, services: FakeServices = createFakeServices()) {
  const onOpen = vi.fn();
  const view = renderWithServices(<LiveStrip awaitingOutcome={awaitingOutcome} onOpen={onOpen} />, services);
  return { ...view, onOpen };
}

const paths = () => {
  const strip = screen.getByTestId(TID.liveStrip);
  const [flow, pressure] = Array.from(strip.querySelectorAll('path'));
  return { flow: flow!, pressure: pressure! };
};

describe('LiveStrip', () => {
  it('is nothing until a shot runs', () => {
    renderStrip();
    expect(screen.queryByTestId(TID.liveStrip)).not.toBeInTheDocument();
  });

  it('while a shot runs: the time, weight and pressure, and the pressure and flow lines, following the shot', async () => {
    const { services, onOpen } = renderStrip();
    act(() => {
      services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
      services.telemetry.emitSample(sample(0));
      services.telemetry.emitSample(sample(4));
    });
    const strip = screen.getByTestId(TID.liveStrip);
    expect(strip).toHaveAccessibleName('Open the live shot');
    expect(strip).toHaveTextContent('Live shot');
    expect(strip).toHaveTextContent('4.0 s · 6.0 g · 4.0 bar');
    const { flow, pressure } = paths();
    expect(pressure.getAttribute('d')).toMatch(/^M0,\d/);
    expect(flow.getAttribute('d')).toMatch(/^M0,\d/);
    expect(pressure).toHaveAttribute('stroke', theme.palette.cafai.graph.pressure);
    expect(flow).toHaveAttribute('stroke', theme.palette.cafai.graph.flow);

    const before = pressure.getAttribute('d');
    act(() => services.telemetry.emitSample(sample(10)));
    expect(strip).toHaveTextContent('10.0 s · 15.0 g · 7.0 bar');
    expect(pressure.getAttribute('d')).not.toBe(before);
    expect(pressure.getAttribute('d')).toContain('L');

    await userEvent.click(strip);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('leaves out the weight without a scale', () => {
    const { services } = renderStrip();
    act(() => {
      services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
      services.telemetry.emitSample(sample(0, false));
      services.telemetry.emitSample(sample(3, false));
    });
    expect(screen.getByTestId(TID.liveStrip)).toHaveTextContent(/3\.0 s · 3\.5 bar$/);
  });

  it('stays, as the last shot, until the outcome is in the chat', () => {
    const services = createFakeServices();
    const { rerenderWith, onOpen } = renderStrip(false, services);
    act(() => {
      services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
      services.telemetry.emitSample(sample(0));
      services.telemetry.emitSample(sample(6));
    });
    act(() => {
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: null });
      rerenderWith(<LiveStrip awaitingOutcome onOpen={onOpen} />);
    });
    const strip = screen.getByTestId(TID.liveStrip);
    expect(strip).toHaveTextContent('Last shot');
    expect(strip).toHaveTextContent('6.0 s · 9.0 g · 5.0 bar');

    rerenderWith(<LiveStrip awaitingOutcome={false} onOpen={onOpen} />);
    expect(screen.queryByTestId(TID.liveStrip)).not.toBeInTheDocument();
  });
});
