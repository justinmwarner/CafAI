// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestReveal, takeReveal } from '../care/careReveal.ts';
import { servicesWithCare } from '../testing/careServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { CARE_LINE, CareSection } from './CareSection.tsx';

afterEach(() => cleanup());

describe('Settings > Machine care', () => {
  it('says what the guide is, and links to it', () => {
    renderWithServices(<CareSection />);
    const section = screen.getByRole('region', { name: 'Machine care' });
    expect(within(section).getByText(CARE_LINE)).toBeInTheDocument();
    const open = within(section).getByRole('link', { name: 'Cleaning guide' });
    expect(open).toHaveAttribute('href', '#/care');
    expect(open).toBe(screen.getByTestId(TID.careOpen));
  });

  it('asks the water and the intake filter in Decent’s words, not sure until answered, and the switch on (D187)', async () => {
    const services = await servicesWithCare();
    renderWithServices(<CareSection />, services);
    const water = screen.getByRole('combobox', { name: 'Your water' });
    expect(water).toHaveValue('');
    expect([...(water as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Not sure',
      'Under 30 ppm (distilled, RO, very soft)',
      '30 to 120 ppm',
      'Over 120 ppm',
    ]);
    const filter = screen.getByRole('combobox', { name: 'Intake filter' });
    expect([...(filter as HTMLSelectElement).options].map((option) => option.text)).toEqual(['Not sure', 'V1 (citric acid)', 'V2 (baking soda)']);
    const reminders = screen.getByTestId(TID.careReminders);
    expect(reminders).toBeChecked();
    expect(reminders).toHaveAccessibleName('Remind me on the stats card');
    services.care.dispose();
  });

  it('a change applies at once and is kept, field by field', async () => {
    const services = await servicesWithCare();
    renderWithServices(<CareSection />, services);
    await userEvent.selectOptions(screen.getByTestId(TID.careWater), 'over120');
    await userEvent.selectOptions(screen.getByTestId(TID.careFilter), 'v2');
    await userEvent.click(screen.getByTestId(TID.careReminders));
    expect(services.care.getState().settings).toEqual({ water: 'over120', filter: 'v2', reminders: false });
    expect((await services.storage.settings.get()).care).toEqual({ water: 'over120', filter: 'v2', reminders: false });
    await userEvent.selectOptions(screen.getByTestId(TID.careWater), '');
    expect(services.care.getState().settings.water).toBeNull();
    services.care.dispose();
  });

  it('says so when a change could not be kept', async () => {
    const services = await servicesWithCare();
    vi.spyOn(services.storage.settings, 'update').mockRejectedValueOnce(new Error('disk full'));
    renderWithServices(<CareSection />, services);
    await userEvent.selectOptions(screen.getByTestId(TID.careWater), 'to120');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that. Try again.');
    expect(screen.getByTestId(TID.careWater)).toHaveValue('');
    services.care.dispose();
  });

  it('opened from the Care screen, takes its ask to come into view, once (the e2e sees it scrolled there)', async () => {
    const services = await servicesWithCare();
    requestReveal('settings-care');
    renderWithServices(<CareSection />, services);
    expect(takeReveal('settings-care')).toBe(false);
    services.care.dispose();
  });
});
