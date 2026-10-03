// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { TID } from '../../testIds.ts';
import { renderThemed } from '../testing/render.tsx';
import { sampleSummary } from '../testing/fixtures.ts';
import { ShotCard } from './ShotCard.tsx';
import { Notice } from './Notice.tsx';

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
});
