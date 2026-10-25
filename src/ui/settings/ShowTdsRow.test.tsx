// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServicesShowing } from '../testing/displayServices.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { SHOW_TDS_LINE, SHOW_TDS_TID, ShowTdsRow } from './ShowTdsRow.tsx';

const toggle = () => screen.getByTestId(SHOW_TDS_TID);

describe('Settings > Display > Shot cards > Show TDS and extraction (D246)', () => {
  it('is a switch, on until someone turns it off, with its line', () => {
    renderWithServices(<ShowTdsRow />, createFakeServicesShowing());
    expect(screen.getByRole('switch', { name: 'Show TDS and extraction' })).toBe(toggle());
    expect(toggle()).toBeChecked();
    expect(screen.getByText(SHOW_TDS_LINE)).toBeInTheDocument();
    expect(SHOW_TDS_LINE).toBe("On shot cards and in History, for a refractometer's reading.");
    expect(toggle()).toHaveAccessibleDescription(SHOW_TDS_LINE);
  });

  it('shows the saved choice', () => {
    renderWithServices(<ShowTdsRow />, createFakeServicesShowing({ showTds: false }));
    expect(toggle()).not.toBeChecked();
  });

  it('applies at once and saves the choice with the settings, and on again is a choice too', async () => {
    const services = createFakeServicesShowing();
    renderWithServices(<ShowTdsRow />, services);
    await userEvent.click(toggle());
    expect(toggle()).not.toBeChecked();
    expect(services.displayPrefs.showTds()).toBe(false);
    await waitFor(async () => expect((await services.storage.settings.get()).showTds).toBe(false));
    await userEvent.click(toggle());
    await waitFor(async () => expect((await services.storage.settings.get()).showTds).toBe(true));
  });

  it('a failed save says so, and the change stays on screen for now', async () => {
    const services = createFakeServicesShowing();
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    renderWithServices(<ShowTdsRow />, services);
    await userEvent.click(toggle());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the TDS setting: Storage is full.');
    expect(toggle()).not.toBeChecked();
  });

  it('draws nothing without the store, as in a preview: there is nowhere to keep a choice', () => {
    renderWithServices(<ShowTdsRow />, createFakeServices());
    expect(screen.queryByTestId(SHOW_TDS_TID)).toBeNull();
  });
});
