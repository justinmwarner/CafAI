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
import { ShotCard } from './ShotCard.tsx';
import { KEY_BESIDE_FROM, keyUnderCurves, NAME_BESIDE_EM, ShotSparkline } from './ShotSparkline.tsx';

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

describe("a shot card's curves, with the shot its question names under them (D178-D182)", () => {
  it('draws the previous shot from its card in the chat, under this one, with no request', () => {
    const { services } = renderInChat(<ShotSparkline summary={thisShot} baseline={PREVIOUS} />, [card(previousShot), card(thisShot, PREVIOUS)]);
    const svg = curves();
    expect(svg).toHaveAccessibleName('Pressure and flow during the shot, with the pressure and flow of your previous shot under them');
    expect(svg).toHaveAccessibleDescription('Previous shot: 30.0 s, peak pressure 9.4 bar.');
    // Heard once, as the description, never again as text in the reading order.
    expect(screen.getByText('Previous shot: 30.0 s, peak pressure 9.4 bar.')).not.toBeVisible();
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

  it('asks Decaid nothing as the chat moves to another bag and this card renders once more before it goes', async () => {
    const getShot = vi.fn(async (id: string) => syntheticShotRecord({ id }));
    const { services } = renderInChat(<ShotSparkline summary={thisShot} baseline={PREVIOUS} />, [card(previousShot), card(thisShot, PREVIOUS)], getShot);
    expect(guide()).not.toBeNull();
    // The new bag's chat holds neither this card nor its previous shot.
    act(() => services.coach.setState({ messages: [card(sampleSummary({ shotId: 'other-bag-1' }))] }));
    await act(async () => {});
    expect(getShot).not.toHaveBeenCalled();
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

  it('draws nothing under on a card that asks nothing: rated with stars before D126, or with no rating at all', () => {
    const messages = [card(previousShot), card(thisShot, PREVIOUS)];
    let view = renderInChat(<ShotCard summary={thisShot} baseline={PREVIOUS} stars={4} onRate={vi.fn()} />, messages);
    expect(screen.getByText('You rated it 4 of 5 stars.')).toBeInTheDocument();
    expect(guide()).toBeNull();
    view.unmount();
    view = renderInChat(<ShotCard summary={thisShot} baseline={PREVIOUS} />, messages);
    expect(guide()).toBeNull();
    view.unmount();
    renderInChat(<ShotCard summary={thisShot} baseline={PREVIOUS} onRate={vi.fn()} />, messages);
    expect(screen.getByRole('radiogroup', { name: 'Compared with your previous shot?' })).toBeInTheDocument();
    expect(guide()).not.toBeNull();
  });

  it('draws this shot alone on its own, outside the chat (a test, a preview)', () => {
    renderThemed(<ShotSparkline summary={thisShot} baseline={PREVIOUS} />);
    expect(curves()).toHaveAccessibleName('Pressure and flow during the shot');
    expect(guide()).toBeNull();
  });

  // Its room on a real screen, and its name whole there, are e2e/shot-overlay.spec.ts's to measure.
  it('puts the third key on a line of its own under the curves on a narrow card, so it never squeezes them; beside them on a wide one', () => {
    // jsdom has no layout: the name measures 0 here, so only the card's width decides.
    const red: ShotBaseline = { kind: 'otherCoffee', shotId: 'shot-0', coffee: 'Red Brick' };
    const legendOf = () => screen.getByText('Pressure').parentElement!.parentElement!;
    const key = () => screen.getByTestId(TID.shotGuideKey);
    for (const [width, under] of [
      // A 320, 360 and 390 px phone upright; then the narrowest card that keeps it beside, and a tablet's.
      [262, true],
      [302, true],
      [332, true],
      [KEY_BESIDE_FROM - 1, true],
      [KEY_BESIDE_FROM, false],
      [654, false],
    ] as const) {
      // The Graph link counts either way, so a card's key keeps its place as Graph moves on to the newest card.
      for (const onOpenGraph of [vi.fn(), undefined]) {
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
        const view = renderInChat(<ShotSparkline summary={thisShot} baseline={red} onOpenGraph={onOpenGraph} />, [card(previousShot), card(thisShot, red)]);
        expect(screen.queryAllByTestId(TID.openShotGraph)).toHaveLength(onOpenGraph ? 1 : 0);
        expect(key()).toHaveTextContent('Last shot of Red Brick');
        if (under) {
          // A line of its own after the row of the curves, the Pressure and Flow keys and Graph.
          expect(legendOf()).not.toContainElement(key());
          expect(key().previousElementSibling).toContainElement(curves());
          expect(key().previousElementSibling).toContainElement(legendOf());
        } else {
          expect(legendOf()).toContainElement(key());
        }
        view.unmount();
        vi.restoreAllMocks();
      }
    }
  });

  it("decides by the card's width and the whole name's width: beside only when the name fits the legend's 9.5em", () => {
    const capAt13 = NAME_BESIDE_EM * 13; // 123.5 px
    // A tablet's card (622 px inside its padding): the name decides.
    expect(keyUnderCurves(622, 80, 13), 'Previous shot').toBe(false);
    expect(keyUnderCurves(622, capAt13, 13), 'a name of 9.5em exactly').toBe(false);
    expect(keyUnderCurves(622, capAt13 + 0.1, 13), 'a hair over').toBe(true);
    expect(keyUnderCurves(622, 136, 13), 'Last shot of Kiambu AA').toBe(true);
    expect(keyUnderCurves(622, 250, 13), 'a 30-character coffee').toBe(true);
    // A narrow card puts any key under (D192); before a measurement, and without layout, it stays beside.
    expect(keyUnderCurves(KEY_BESIDE_FROM - 1, 80, 13)).toBe(true);
    expect(keyUnderCurves(KEY_BESIDE_FROM, 80, 13)).toBe(false);
    expect(keyUnderCurves(0, 250, 13)).toBe(false);
    // A font size that could not be read never sends a key under.
    expect(keyUnderCurves(622, 250, Number.NaN)).toBe(false);
  });

  it("puts the key under the curves on a wide card when its whole name is wider than the legend's 9.5em, measured on a hidden ruler, never where the key is", () => {
    const legendOf = () => screen.getByText('Pressure').parentElement!.parentElement!;
    const key = () => screen.getByTestId(TID.shotGuideKey);
    const rect = (width: number) => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) }) as DOMRect;
    for (const [coffee, width, under] of [
      // The caption is 13 px, so 9.5em is 123.5 px.
      ['Santos', 112, false],
      ['Kiambu AA', 136, true],
      ['Huila Pink Bourbon', 182, true],
      ['Finca El Paraíso Lychee Geisha', 250, true],
    ] as const) {
      const name = `Last shot of ${coffee}`;
      // A tablet's card; only the ruler, out of sight, has a width: the key itself measures 0 wherever it is.
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => 622);
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return rect(this.closest('[aria-hidden="true"]') !== null && this.textContent === name ? width : 0);
      });
      const baseline: ShotBaseline = { kind: 'otherCoffee', shotId: 'shot-0', coffee };
      const view = renderInChat(<ShotSparkline summary={thisShot} baseline={baseline} onOpenGraph={vi.fn()} />, [card(previousShot), card(thisShot, baseline)]);
      expect(key()).toHaveTextContent(name);
      if (under) {
        expect(legendOf(), name).not.toContainElement(key());
        expect(key().previousElementSibling).toContainElement(curves());
      } else {
        expect(legendOf(), name).toContainElement(key());
      }
      // The ruler is the name once more, hidden from screen readers, which hear the key alone.
      const [shown, ruler] = screen.getAllByText(name);
      expect(key()).toContainElement(shown!);
      expect(ruler!.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(key()).not.toContainElement(ruler!);
      view.unmount();
      vi.restoreAllMocks();
    }
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
