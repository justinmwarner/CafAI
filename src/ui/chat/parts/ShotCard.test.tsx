// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TID } from '../../testIds.ts';
import { renderThemed } from '../testing/render.tsx';
import { sampleSummary } from '../testing/fixtures.ts';
import { ShotCard } from './ShotCard.tsx';
import { Notice } from './Notice.tsx';

const stars = () => screen.getAllByRole('radio');
const checked = () => stars().map((star) => star.getAttribute('aria-checked'));

describe('ShotCard rating', () => {
  it('asks how much the shot was enjoyed, with one named target per star', async () => {
    const onRate = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} onRate={onRate} />);
    const group = screen.getByRole('radiogroup', { name: 'How much did you enjoy it?' });
    expect(within(group).getAllByRole('radio').map((star) => star.getAttribute('aria-label'))).toEqual([
      'Rate 1 out of 5',
      'Rate 2 out of 5',
      'Rate 3 out of 5',
      'Rate 4 out of 5',
      'Rate 5 out of 5',
    ]);
    expect(checked()).toEqual(['false', 'false', 'false', 'false', 'false']);
    await userEvent.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }));
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('shows the rating it has, and lets a re-tap change it', async () => {
    const onRate = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} stars={3} onRate={onRate} />);
    expect(checked()).toEqual(['false', 'false', 'true', 'false', 'false']);
    await userEvent.click(screen.getByRole('radio', { name: 'Rate 5 out of 5' }));
    expect(onRate).toHaveBeenCalledWith(5);
  });

  it('moves the rating with the arrow keys, from the one star that takes focus', async () => {
    const onRate = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} stars={3} onRate={onRate} />);
    expect(stars().map((star) => star.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
    screen.getByRole('radio', { name: 'Rate 3 out of 5' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onRate).toHaveBeenLastCalledWith(4);
    await userEvent.keyboard('{ArrowLeft}');
    expect(onRate).toHaveBeenLastCalledWith(2);
  });

  it('blocks a rating while the coach is working', () => {
    const onRate = vi.fn();
    renderThemed(<ShotCard summary={sampleSummary()} stars={2} onRate={onRate} disabled />);
    for (const star of stars()) expect(star).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }));
    expect(onRate).not.toHaveBeenCalled();
    expect(checked()).toEqual(['false', 'true', 'false', 'false', 'false']);
  });

  it('shows no rating where nobody can rate', () => {
    renderThemed(<ShotCard summary={sampleSummary()} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
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
