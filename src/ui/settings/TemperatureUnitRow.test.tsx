// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { TID } from '../testIds.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { createFakeServicesIn } from '../testing/temperatureServices.ts';
import { UnitsCard } from './UnitsCard.tsx';

const group = () => screen.getByRole('group', { name: 'Temperatures' });

describe('Settings > Display > Units > Temperatures (D172)', () => {
  it('sits in Units, °C until someone chooses, each unit named in words', () => {
    renderWithServices(<UnitsCard />, createFakeServices());
    const section = screen.getByRole('region', { name: 'Units' });
    expect(within(section).getByRole('group', { name: 'Temperatures' })).toBeInTheDocument();
    expect(screen.getByTestId(TID.temperatureUnit('celsius'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(TID.temperatureUnit('fahrenheit'))).toHaveAttribute('aria-pressed', 'false');
    expect(within(group()).getByRole('button', { name: 'Celsius' })).toHaveTextContent('°CCelsius');
    expect(within(group()).getByRole('button', { name: 'Fahrenheit' })).toHaveTextContent('°FFahrenheit');
    expect(group()).toHaveAccessibleDescription('Readouts, settings and the coach use it. Decaid and your profiles keep °C.');
  });

  it('a tap applies at once and saves the choice with the settings', async () => {
    const { services } = renderWithServices(<UnitsCard />, createFakeServices());
    await userEvent.click(screen.getByTestId(TID.temperatureUnit('fahrenheit')));
    expect(screen.getByTestId(TID.temperatureUnit('fahrenheit'))).toHaveAttribute('aria-pressed', 'true');
    expect(services.temperatureUnit.get()).toBe('fahrenheit');
    await waitFor(async () => expect((await services.storage.settings.get()).temperatureUnit).toBe('fahrenheit'));
    // And back: °C chosen here is a choice too.
    await userEvent.click(screen.getByTestId(TID.temperatureUnit('celsius')));
    await waitFor(async () => expect((await services.storage.settings.get()).temperatureUnit).toBe('celsius'));
  });

  it('shows the saved choice', () => {
    renderWithServices(<UnitsCard />, createFakeServicesIn('fahrenheit'));
    expect(screen.getByTestId(TID.temperatureUnit('fahrenheit'))).toHaveAttribute('aria-pressed', 'true');
  });

  it('a tap on the chosen unit saves nothing', async () => {
    const services = createFakeServices();
    const update = vi.spyOn(services.storage.settings, 'update');
    renderWithServices(<UnitsCard />, services);
    await userEvent.click(screen.getByTestId(TID.temperatureUnit('celsius')));
    expect(update).not.toHaveBeenCalled();
  });

  it('a failed save says so, and the choice stays on screen for now', async () => {
    const services = createFakeServices();
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    renderWithServices(<UnitsCard />, services);
    await userEvent.click(screen.getByTestId(TID.temperatureUnit('fahrenheit')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the temperature unit: Storage is full.');
    expect(screen.getByTestId(TID.temperatureUnit('fahrenheit'))).toHaveAttribute('aria-pressed', 'true');
  });
});
