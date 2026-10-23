// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShotRecord } from '../../../api/types.ts';
import shot01 from '../../../coach/__fixtures__/decaid-mcp/shot-01.json';
import { summarizeShot } from '../../../coach/summary/summarize.ts';
import { TID } from '../../testIds.ts';
import { createFakeUsage } from '../../testing/fakeServices.ts';
import { UsageContextForTests } from '../../usage/useUsage.ts';
import { renderThemed } from '../testing/render.tsx';
import { sampleSummary } from '../testing/fixtures.ts';
import { ShotCard } from './ShotCard.tsx';
import { Notice } from './Notice.tsx';

const words = () => screen.getAllByRole('radio');
const checked = () => words().map((word) => word.getAttribute('aria-checked'));
const question = (name: string) => screen.getByRole('radiogroup', { name });

describe('ShotCard rating (D126)', () => {
  it('asks how the shot compared with the one before it, in five words, each one named target', async () => {
    const onRate = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} baseline={{ kind: 'previous', shotId: 'shot-0' }} onRate={onRate} />);
    const group = question('Compared with your previous shot?');
    expect(group).toHaveAttribute('data-testid', TID.shotRating);
    expect(within(group).getAllByRole('radio').map((word) => word.textContent)).toEqual([
      'Much worse',
      'Worse',
      'About the same',
      'Better',
      'Much better',
    ]);
    expect(checked()).toEqual(['false', 'false', 'false', 'false', 'false']);
    // Words only: nothing on the card reads as a score.
    expect(screen.getByTestId(TID.shotCard).querySelector('svg[data-testid*="Star"]')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Better' }));
    expect(onRate).toHaveBeenCalledWith('better');
  });

  it("names what the shot is compared with: another coffee's last shot, or the coffee usually enjoyed", () => {
    const card = (baseline: Parameters<typeof ShotCard>[0]['baseline']) =>
      renderThemed(<ShotCard summary={sampleSummary()} baseline={baseline} onRate={vi.fn()} />);
    let view = card({ kind: 'otherCoffee', shotId: 'shot-r', coffee: 'Red Brick' });
    expect(question('Compared with your last shot of Red Brick?')).toBeInTheDocument();
    view.unmount();
    view = card({ kind: 'otherCoffee', shotId: 'shot-r', coffee: null });
    expect(question('Compared with your last shot?')).toBeInTheDocument();
    view.unmount();
    view = card({ kind: 'usual' });
    expect(question('Compared with the coffee you usually enjoy?')).toBeInTheDocument();
    view.unmount();
    card(null);
    expect(question('Compared with your previous shot?')).toBeInTheDocument();
  });

  it('shows the answer it has, and lets a re-tap change it', async () => {
    const onRate = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} verdict="worse" onRate={onRate} />);
    expect(checked()).toEqual(['false', 'true', 'false', 'false', 'false']);
    await userEvent.click(screen.getByRole('radio', { name: 'Much better' }));
    expect(onRate).toHaveBeenCalledWith('muchBetter');
  });

  it('moves the answer with the arrow keys, from the one word that takes focus', async () => {
    const onRate = vi.fn();
    const { rerender } = renderThemed(<ShotCard summary={sampleSummary()} onRate={onRate} />);
    // Unanswered, About the same takes the Tab stop, and an arrow moves from it.
    expect(words().map((word) => word.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
    words()[2]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onRate).toHaveBeenLastCalledWith('better');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onRate).toHaveBeenLastCalledWith('worse');
    // As in any radio group: down is the next word (towards better), up the previous one.
    await userEvent.keyboard('{ArrowDown}');
    expect(onRate).toHaveBeenLastCalledWith('better');
    await userEvent.keyboard('{ArrowUp}');
    expect(onRate).toHaveBeenLastCalledWith('worse');

    rerender(<ShotCard summary={sampleSummary()} verdict="muchBetter" onRate={onRate} />);
    expect(words().map((word) => word.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
    words()[4]!.focus();
    onRate.mockClear();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowRight}');
    expect(onRate).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowUp}');
    expect(onRate).toHaveBeenLastCalledWith('better');
  });

  it('blocks a rating while the coach is working', () => {
    const onRate = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} verdict="worse" onRate={onRate} disabled />);
    for (const word of words()) expect(word).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Better' }));
    expect(onRate).not.toHaveBeenCalled();
    expect(checked()).toEqual(['false', 'true', 'false', 'false', 'false']);
  });

  it('says the stars a shot was given before shots were compared, and asks nothing more', () => {
    renderThemed(<ShotCard summary={sampleSummary()} stars={4} onRate={vi.fn()} />);
    expect(screen.getByText('You rated it 4 of 5 stars.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('keeps to the stars when a card has words too, as rating it does (no taps that do nothing)', () => {
    renderThemed(<ShotCard summary={sampleSummary()} stars={4} verdict="better" onRate={vi.fn()} />);
    expect(screen.getByText('You rated it 4 of 5 stars.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows no rating where nobody can rate', () => {
    renderThemed(<ShotCard summary={sampleSummary()} stars={4} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText(/stars/)).toBeNull();
  });
});

describe('ShotCard', () => {
  it('shows the shot numbers the coach reasons about', () => {
    renderThemed(<ShotCard summary={sampleSummary()} />);
    const card = screen.getByTestId(TID.shotCard);
    expect(within(card).getByRole('heading')).toHaveTextContent('Shot 27.8 s');
    expect(within(card).getByText('· Kiambu AA v1')).toBeInTheDocument();
    expect(within(card).getByText('18.0 g → 36.4 g')).toBeInTheDocument();
    expect(within(card).getByText('1:2.0')).toBeInTheDocument();
    expect(within(card).getByText('8.9 bar at 16 s')).toBeInTheDocument();
    expect(within(card).getByText('9.4 s')).toBeInTheDocument();
  });

  it('counts the peak and the first drop from the start of the pour, as the shot time is', () => {
    // On the record's clock, which starts with 2 s of preheat, the peak came at 61 s and the first drops at 6.6 s.
    renderThemed(<ShotCard summary={sampleSummary({ durationS: 60, pourStartS: 2, peakPressureBar: 6, peakPressureAtS: 61, timeToFirstDropS: 6.6 })} />);
    const card = screen.getByTestId(TID.shotCard);
    expect(within(card).getByRole('heading')).toHaveTextContent('Shot 60.0 s');
    expect(within(card).getByText('6.0 bar at 59 s')).toBeInTheDocument();
    expect(within(card).getByText('4.6 s')).toBeInTheDocument();
    expect(within(card).queryByText(/at 61 s|6\.6 s/)).toBeNull();
  });

  it("a real Decaid shot: the summarizer's times, less its 6.5 s of preheat", () => {
    const summary = summarizeShot(shot01 as unknown as ShotRecord);
    expect(summary).toMatchObject({ pourStartS: 6.5, timeToFirstDropS: 13.8, peakPressureAtS: 18.3 });
    renderThemed(<ShotCard summary={summary} />);
    const card = screen.getByTestId(TID.shotCard);
    expect(within(card).getByText(`${summary.peakPressureBar!.toFixed(1)} bar at 12 s`)).toBeInTheDocument();
    expect(within(card).getByText('7.3 s')).toBeInTheDocument();
  });

  it('never shows a time before the pour began', () => {
    renderThemed(<ShotCard summary={sampleSummary({ pourStartS: 4.6, peakPressureAtS: 3.2, timeToFirstDropS: 4.1 })} />);
    expect(screen.getByText('8.9 bar at 0 s')).toBeInTheDocument();
    expect(screen.getByText('0.0 s')).toBeInTheDocument();
  });

  it('shows a summary saved before pourStartS as it always did', () => {
    const saved = sampleSummary();
    expect(saved).not.toHaveProperty('pourStartS');
    renderThemed(<ShotCard summary={saved} />);
    expect(screen.getByText('8.9 bar at 16 s')).toBeInTheDocument();
    expect(screen.getByText('9.4 s')).toBeInTheDocument();
  });

  it('draws pressure and flow as an inline sparkline', () => {
    renderThemed(<ShotCard summary={sampleSummary()} />);
    const svg = screen.getByRole('img', { name: 'Pressure and flow during the shot' });
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    for (const path of paths) expect(path.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/);
  });

  it('puts channeling flags in words', () => {
    renderThemed(<ShotCard summary={sampleSummary({ channelingFlags: ['pressure_dip_after_peak', 'early_drops'] })} />);
    expect(screen.getByText('Possible channeling: Pressure dipped after the peak; Early drips.')).toBeInTheDocument();
  });

  it('copes with a shot that has no scale or curves', () => {
    renderThemed(
      <ShotCard
        summary={sampleSummary({
          doseG: null,
          yieldG: null,
          ratio: null,
          peakPressureBar: null,
          timeToFirstDropS: null,
          series: { tS: [], pressure: [], flow: [], weight: [], weightFlow: [], temperature: [], targetPressure: [], targetFlow: [] },
        })}
      />,
    );
    expect(screen.getByText('– → –')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/channeling/)).toBeNull();
  });
});

describe('Notice', () => {
  it('announces errors as alerts and the rest as status', () => {
    renderThemed(
      <>
        <Notice tone="error" text="Upload failed." />
        <Notice tone="success" text="Kiambu AA v1 is on the machine." />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed.');
    expect(screen.getByRole('status')).toHaveTextContent('Kiambu AA v1 is on the machine.');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success');
  });

  it('shows how far a search has got, as status with a progress bar', () => {
    renderThemed(<Notice tone="info" text="Looking for that shot in Decaid…" progress={{ value: 0.5, label: 'Try 4 of 6' }} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Looking for that shot in Decaid…');
    expect(status).toHaveTextContent('Try 4 of 6');
    const bar = within(status).getByRole('progressbar', { name: 'Looking for that shot in Decaid…' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows an open-ended bar while the length is unknown', () => {
    renderThemed(<Notice tone="info" text="Loading Kiambu AA v2 on the machine…" progress={{ value: null, label: null }} />);
    const bar = screen.getByRole('progressbar', { name: 'Loading Kiambu AA v2 on the machine…' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('status')).toHaveTextContent('Loading Kiambu AA v2 on the machine…');
  });
});

describe('ShotCard graph link', () => {
  it('shows a Graph button that opens the full graph', async () => {
    const onOpenGraph = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} onOpenGraph={onOpenGraph} />);
    const button = screen.getByTestId(TID.openShotGraph);
    expect(button).toHaveTextContent('Graph');
    await userEvent.click(button);
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
  });

  it('shows no Graph button without onOpenGraph', () => {
    renderThemed(<ShotCard summary={sampleSummary()} />);
    expect(screen.queryByTestId(TID.openShotGraph)).toBeNull();
  });
});

describe('ShotCard Visualizer link (6.4)', () => {
  const url = 'https://visualizer.coffee/shots/c5b6b2b8-0f2e';

  it("links to the shot's page on Visualizer with a plain link, once the plugin uploaded it", () => {
    renderThemed(<ShotCard summary={sampleSummary()} visualizerUrl={url} />);
    const link = screen.getByTestId(TID.visualizerLink);
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', url);
    expect(link).not.toHaveAttribute('target');
    expect(link).toHaveTextContent('On Visualizer');
    expect(screen.getByRole('link', { name: 'On Visualizer' })).toBe(link);
  });

  it("keeps the shot's address out of the page while the device shares usage: a button that goes there on a tap (D214)", () => {
    const state = { sharing: true, prompt: null, rule: 'notice' } as const;
    const { usage } = createFakeUsage(state);
    renderThemed(
      <UsageContextForTests value={usage}>
        <ShotCard summary={sampleSummary()} visualizerUrl={url} />
      </UsageContextForTests>,
    );
    const button = screen.getByTestId(TID.visualizerLink);
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toHaveAttribute('href');
    expect(screen.getByRole('button', { name: 'On Visualizer' })).toBe(button);
    expect(document.body.innerHTML).not.toContain(url);
  });

  it('shows no link before the upload, nor one that does not lead to Visualizer', () => {
    renderThemed(<ShotCard summary={sampleSummary()} />);
    expect(screen.queryByTestId(TID.visualizerLink)).toBeNull();
    renderThemed(<ShotCard summary={sampleSummary()} visualizerUrl="javascript:alert(1)" />);
    expect(screen.queryByTestId(TID.visualizerLink)).toBeNull();
  });
});

describe('ShotCard sparkline', () => {
  it('keys the curves with drawn swatches, not box-drawing characters', () => {
    renderThemed(<ShotCard summary={sampleSummary()} />);
    expect(screen.getByRole('img', { name: 'Pressure and flow during the shot' })).toBeInTheDocument();
    expect(screen.getByText('Pressure')).toBeInTheDocument();
    expect(screen.getByText('Flow')).toBeInTheDocument();
    expect(screen.queryByText(/━/)).toBeNull();
  });
});
