// @vitest-environment jsdom
import '../testing/setup.ts';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { GatewayError, type ShotRecord } from '../../../api/types.ts';
import type { CoachUiMessage, ShotBaseline } from '../../../app/types.ts';
import { syntheticShotRecord } from '../../../coach/__fixtures__/syntheticShot.ts';
import type { ShotSeries, ShotSummary } from '../../../coach/types.ts';
import { TID } from '../../testIds.ts';
import { createFakeServices } from '../../testing/fakeServices.ts';
import { previewTheme } from '../testing/previewTheme.ts';
import { renderThemed, renderWithServices } from '../testing/render.tsx';
import { sampleSeries, sampleSummary } from '../testing/fixtures.ts';
import { ShotSparkline } from './ShotSparkline.tsx';

const graph = previewTheme.palette.cafai.graph;

function card(summary: ShotSummary, baseline?: ShotBaseline): CoachUiMessage {
  return {
    id: `m-${summary.shotId}`,
    role: 'system',
    parts: [{ kind: 'shot', shotId: summary.shotId, summary, ...(baseline ? { baseline } : {}) }],
    createdAt: '2026-10-15T08:00:00.000Z',
  };
}

const previousShot = sampleSummary({ shotId: 'shot-0', durationS: 30, peakPressureBar: 9.4, series: sampleSeries(30, 9.4) });
const thisShot = sampleSummary({ shotId: 'shot-1' });
const PREVIOUS: ShotBaseline = { kind: 'previous', shotId: 'shot-0' };

/** The card's curves with a chat holding `messages`, and a Decaid whose shots are read by `getShot`. */
function renderInChat(ui: ReactElement, messages: CoachUiMessage[], getShot?: (id: string) => Promise<ShotRecord>) {
  const services = createFakeServices({ coach: { messages } });
  if (getShot) services.decaid.getShot = vi.fn(getShot);
  return renderWithServices(ui, services);
}

const curves = () => screen.getByRole('img', { name: /^Pressure and flow during the shot/ });
const guide = () => screen.queryByTestId(TID.shotGuide);

function series(tS: number[], pressure: number[], flow: number[]): ShotSeries {
  const blank = tS.map(() => null);
  return { tS, pressure, flow, weight: blank, weightFlow: blank, temperature: blank, targetPressure: blank, targetFlow: blank };
}

describe("a shot card's curves, with the shot its question names under them (D-CURVE-1 to D-CURVE-5)", () => {
  it('draws the previous shot from its card in the chat, under this one, with no request', () => {
    const { services } = renderInChat(<ShotSparkline summary={thisShot} baseline={PREVIOUS} />, [card(previousShot), card(thisShot, PREVIOUS)]);
    const svg = curves();
    expect(svg).toHaveAccessibleName('Pressure and flow during the shot, with the pressure and flow of your previous shot under them');
    expect(svg).toHaveAccessibleDescription('Previous shot: 30.0 s, peak pressure 9.4 bar.');
    const bands = guide()!.querySelectorAll('path');
    expect(bands).toHaveLength(2);
    // Under this shot's lines: the bands come first in the drawing.
    const paths = [...svg.querySelectorAll('path')];
    expect(paths.map((path) => path.getAttribute('stroke'))).toEqual([graph.flowGuide, graph.pressureGuide, graph.flow, graph.pressure]);
    for (const band of bands) {
      expect(band).toHaveAttribute('stroke-width', '5');
      expect(band).toHaveAttribute('stroke-linecap', 'round');
      expect(band.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/);
    }
    expect(screen.getByTestId(TID.shotGuideKey)).toHaveTextContent('Previous shot');
    expect(services.decaid.calls.filter((call) => call.method === 'getShot')).toEqual([]);
  });

  it("reads another coffee's last shot from Decaid once, and names it by its coffee", async () => {
    const getShot = vi.fn(async (id: string) => syntheticShotRecord({ id }));
    const red: ShotBaseline = { kind: 'otherCoffee', shotId: 'shot-r', coffee: 'Red Brick' };
    const { rerender, services } = renderInChat(<ShotSparkline summary={thisShot} baseline={red} />, [card(thisShot, red)], getShot);
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(curves()).toHaveAccessibleName('Pressure and flow during the shot, with the pressure and flow of your last shot of Red Brick under them');
    expect(screen.getByTestId(TID.shotGuideKey)).toHaveTextContent('Last shot of Red Brick');
    // Never on every render: a re-render, and a second card wanting the same shot, ask nothing more.
    rerender(
      <>
        <ShotSparkline summary={thisShot} baseline={red} />
        <ShotSparkline summary={sampleSummary({ shotId: 'shot-2' })} baseline={{ ...red }} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId(TID.shotGuide)).toHaveLength(2));
    expect(services.decaid.getShot).toHaveBeenCalledTimes(1);
    expect(services.decaid.getShot).toHaveBeenCalledWith('shot-r');
  });

  it('reads the previous shot from Decaid when its card in the chat kept no curve', async () => {
    const restored = sampleSummary({ shotId: 'shot-0', series: series([], [], []) });
    const getShot = vi.fn(async (id: string) => syntheticShotRecord({ id }));
    renderInChat(<ShotSparkline summary={thisShot} baseline={PREVIOUS} />, [card(restored), card(thisShot, PREVIOUS)], getShot);
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(getShot).toHaveBeenCalledWith('shot-0');
  });

  it('draws this shot alone, saying nothing, when Decaid no longer has the shot or cannot be reached', async () => {
    const red: ShotBaseline = { kind: 'otherCoffee', shotId: 'shot-r', coffee: 'Red Brick' };
    for (const error of [new GatewayError(404, '/api/v1/shots/shot-r', 'Shot not found'), new GatewayError(0, '/api/v1/shots/shot-r', 'Could not reach Decaid.', 'network')]) {
      const getShot = vi.fn(() => Promise.reject(error));
      const view = renderInChat(<ShotSparkline summary={thisShot} baseline={red} />, [card(thisShot, red)], getShot);
      await waitFor(() => expect(getShot).toHaveBeenCalledTimes(1));
      await act(async () => {});
      expect(guide()).toBeNull();
      expect(screen.queryByTestId(TID.shotGuideKey)).toBeNull();
      expect(curves()).toHaveAccessibleName('Pressure and flow during the shot');
      expect(screen.queryByText(/not found|reach/i)).toBeNull();
      view.unmount();
    }
  });

  it('draws this shot alone when its question names no shot, and asks Decaid nothing', () => {
    const { services } = renderInChat(<ShotSparkline summary={thisShot} baseline={{ kind: 'usual' }} />, [card(previousShot), card(thisShot)]);
    expect(guide()).toBeNull();
    expect(screen.getByText('Pressure')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.shotGuideKey)).toBeNull();
    expect(services.decaid.calls.filter((call) => call.method === 'getShot')).toEqual([]);
  });

  it('draws this shot alone on its own, outside the chat (a test, a preview)', () => {
    renderThemed(<ShotSparkline summary={thisShot} baseline={PREVIOUS} />);
    expect(curves()).toHaveAccessibleName('Pressure and flow during the shot');
    expect(guide()).toBeNull();
  });

  it("counts both shots from the pour's start, the time running to the longer one", () => {
    // This shot: 2 s of preheat, then 4 s of pour. The previous: 1 s of preheat, then 8 s.
    const short = sampleSummary({ shotId: 'shot-1', durationS: 4, pourStartS: 2, series: series([0, 1, 2, 3, 4, 5, 6], [0, 0, 2, 4, 6, 6, 6], [0, 0, 4, 3, 2, 2, 2]) });
    const long = sampleSummary({ shotId: 'shot-0', durationS: 8, pourStartS: 1, series: series([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2, 3, 4, 5, 6, 6, 6, 6], [0, 4, 4, 3, 3, 2, 2, 2, 2, 2]) });
    renderInChat(<ShotSparkline summary={short} baseline={PREVIOUS} />, [card(long), card(short, PREVIOUS)]);
    const [flowBand, , flowLine] = [...curves().querySelectorAll('path')].map((path) => path.getAttribute('d')!);
    // Both start at the pour, at x 0; the previous shot's 8 s spans the 240-wide box, this one's 4 s half of it.
    expect(flowBand).toMatch(/^M0,/);
    expect(flowBand).toMatch(/L240,[\d.]+$/);
    expect(flowLine).toMatch(/^M0,/);
    expect(flowLine).toMatch(/L120,[\d.]+$/);
  });
});
