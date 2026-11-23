// @vitest-environment jsdom
import '../../ui/chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ServicesProvider } from '../../app/services.tsx';
import { TID } from '../../ui/testIds.ts';
import { createFakeServices } from '../../ui/testing/fakeServices.ts';
import { DEFAULT_SETTINGS, readSettings, settingsValues, validValues } from '../shared/settings.ts';
import { OverheadUnavailable, type OverheadClient } from './client.ts';
import { INSTALL_HELP, OverheadSection } from './OverheadSection.tsx';
import { createOverheadPreview } from './preview.ts';

function client(initial: Record<string, unknown> = {}) {
  let values = settingsValues(readSettings(initial));
  const posted: Array<Record<string, unknown>> = [];
  const fake: OverheadClient = {
    overhead: () => Promise.reject(new Error('not used')),
    config: async () => values,
    saveConfig: async (changes) => {
      posted.push(changes);
      const stored: Record<string, unknown> = { ...values };
      for (const [key, value] of Object.entries(validValues(changes))) stored[key] = value;
      values = settingsValues(readSettings(stored));
      return values;
    },
  };
  return { fake, posted };
}

async function show(overhead?: OverheadClient) {
  const preview = createOverheadPreview();
  render(
    <ServicesProvider services={createFakeServices()}>
      <OverheadSection client={overhead} preview={preview} />
    </ServicesProvider>,
  );
  await act(async () => undefined);
  return preview;
}

describe('Settings › Display › Overhead', () => {
  it('says how to install the plugin when Decaid does not have it', async () => {
    await show({ overhead: vi.fn(), config: () => Promise.reject(new OverheadUnavailable(404, 'missing')), saveConfig: vi.fn() });
    expect(screen.getByTestId(TID.overheadSectionStatus)).toHaveTextContent(INSTALL_HELP);
    expect(screen.queryByTestId(TID.overheadSave)).toBeNull();
  });

  it('is off without a plugin client at all (fakes, previews)', async () => {
    await show();
    expect(screen.getByTestId(TID.overheadSectionStatus)).toHaveTextContent('overhead.reaplugin');
  });

  it('shows the plugin’s settings with their defaults, and saves only what changed', async () => {
    const { fake, posted } = client({ RadiusNm: 30 });
    await show(fake);
    expect(screen.getByTestId(TID.overheadField('RadiusNm'))).toHaveValue('30');
    expect(screen.getByTestId(TID.overheadField('HomeLat'))).toHaveValue('');
    expect(screen.getByTestId(TID.overheadField('ScreensaverOn'))).toBeChecked();
    expect(screen.getByTestId(TID.overheadSave)).toBeDisabled();

    fireEvent.change(screen.getByTestId(TID.overheadField('HomeLat')), { target: { value: '41.9786' } });
    fireEvent.change(screen.getByTestId(TID.overheadField('HomeLon')), { target: { value: '-87.9048' } });
    fireEvent.change(screen.getByTestId(TID.overheadField('RadiusNm')), { target: { value: '' } });
    await act(async () => void fireEvent.click(screen.getByTestId(TID.overheadSave)));
    expect(posted).toEqual([{ HomeLat: '41.9786', HomeLon: '-87.9048', RadiusNm: null }]);
    expect(screen.getByTestId(TID.overheadField('RadiusNm'))).toHaveValue(String(DEFAULT_SETTINGS.radiusNm));
    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  it('will not save a value the plugin cannot use', async () => {
    const { fake } = client();
    await show(fake);
    fireEvent.change(screen.getByTestId(TID.overheadField('PollIntervalSeconds')), { target: { value: 'fast' } });
    expect(screen.getByTestId(TID.overheadSave)).toBeDisabled();
    expect(screen.getByText('Not a value Overhead can use: Update every.')).toBeInTheDocument();
  });

  it('previews Overhead with live data', async () => {
    const { fake } = client();
    const preview = await show(fake);
    fireEvent.click(screen.getByTestId(TID.overheadPreview));
    expect(preview.get()).toEqual({ mock: false });
  });
});
