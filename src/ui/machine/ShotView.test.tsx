// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { TID } from '../testIds.ts';
import { IDLE_TELEMETRY } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { DASH } from './format.ts';
import { ShotView } from './ShotView.tsx';

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
    expect(view.lastElementChild).toBe(within(view).getByTestId(TID.coachNote));
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
