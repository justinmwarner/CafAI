// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServicesShowing } from '../testing/displayServices.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { CLOCK_TID, ClockRow } from './ClockRow.tsx';

const group = () => screen.getByRole('group', { name: 'Clock' });

describe('Settings > Display > Units > Clock (D245)', () => {
  it('offers 24-hour and 12-hour, each with a time as it would read, 24-hour until someone chooses', () => {
    renderWithServices(<ClockRow />, createFakeServicesShowing());
    expect(screen.getByText('Clock')).toBeInTheDocument();
    expect(screen.getByTestId(CLOCK_TID.format('24h'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(CLOCK_TID.format('12h'))).toHaveAttribute('aria-pressed', 'false');
    expect(within(group()).getByRole('button', { name: '24-hour' })).toHaveTextContent('24-hour14:30');
    expect(within(group()).getByRole('button', { name: '12-hour' })).toHaveTextContent('12-hour2:30 pm');
  });

  it('shows the saved choice', () => {
    renderWithServices(<ClockRow />, createFakeServicesShowing({ clock: '12h' }));
    expect(screen.getByTestId(CLOCK_TID.format('12h'))).toHaveAttribute('aria-pressed', 'true');
  });

  it('a tap applies at once and saves the choice with the settings, and 24-hour chosen is a choice too', async () => {
    const services = createFakeServicesShowing();
    renderWithServices(<ClockRow />, services);
    await userEvent.click(screen.getByTestId(CLOCK_TID.format('12h')));
    expect(screen.getByTestId(CLOCK_TID.format('12h'))).toHaveAttribute('aria-pressed', 'true');
    expect(services.displayPrefs.clock()).toBe('12h');
    await waitFor(async () => expect((await services.storage.settings.get()).clock).toBe('12h'));
    await userEvent.click(screen.getByTestId(CLOCK_TID.format('24h')));
    await waitFor(async () => expect((await services.storage.settings.get()).clock).toBe('24h'));
  });

  it('a tap on the chosen clock saves nothing', async () => {
    const services = createFakeServicesShowing();
    const update = vi.spyOn(services.storage.settings, 'update');
    renderWithServices(<ClockRow />, services);
    await userEvent.click(screen.getByTestId(CLOCK_TID.format('24h')));
    expect(update).not.toHaveBeenCalled();
  });

  it('a failed save says so, and the choice stays on screen for now', async () => {
    const services = createFakeServicesShowing();
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    renderWithServices(<ClockRow />, services);
    await userEvent.click(screen.getByTestId(CLOCK_TID.format('12h')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the clock: Storage is full.');
    expect(screen.getByTestId(CLOCK_TID.format('12h'))).toHaveAttribute('aria-pressed', 'true');
  });

  it('draws nothing without the store, as in a preview: there is nowhere to keep a choice', () => {
    renderWithServices(<ClockRow />, createFakeServices());
    expect(screen.queryByRole('group', { name: 'Clock' })).toBeNull();
  });
});
