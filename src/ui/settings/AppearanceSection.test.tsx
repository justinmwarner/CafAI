// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Appearance } from '../../storage/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { buildPalette, namedTint } from '../palette.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { AppearanceSection } from './AppearanceSection.tsx';

const TINT_NAMES = ['Crema', 'Matcha', 'Lagoon', 'Ocean', 'Plum', 'Cherry', 'Steel', 'Custom'];

function renderAppearance(appearance?: Appearance): FakeServices {
  const services = createFakeServices(
    appearance ? { storage: { settings: { model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, activeBagId: null, appearance } } } : {},
  );
  renderWithServices(<AppearanceSection />, services);
  return services;
}

const saved = async (services: FakeServices) => (await services.storage.settings.get()).appearance;
const modeGroup = () => screen.getByRole('group', { name: 'Mode' });
const tintGroup = () => screen.getByRole('radiogroup', { name: 'Tint' });
const tint = (name: string) => within(tintGroup()).getByRole('radio', { name });
const checkedTints = () =>
  within(tintGroup())
    .getAllByRole('radio')
    .filter((radio) => radio.getAttribute('aria-checked') === 'true')
    .map((radio) => radio.getAttribute('aria-label'));

describe('AppearanceSection mode', () => {
  it('offers Dark, Light and Auto as one choice, Dark by default, and says what Auto does', () => {
    renderAppearance();
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    const buttons = within(modeGroup()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Dark', 'Light', 'Auto']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByTestId(TID.appearanceMode('dark'))).toBe(buttons[0]);
    expect(screen.getByTestId(TID.appearanceMode('auto'))).toBe(buttons[2]);
    expect(screen.getByText("Auto follows this device's light or dark setting.")).toBeInTheDocument();
  });

  it('a tap on Light shows it at once and saves it with the tint kept; a tap on the chosen mode changes nothing', async () => {
    const services = renderAppearance();
    const set = vi.spyOn(services.appearance, 'set');
    await userEvent.click(within(modeGroup()).getByRole('button', { name: 'Light' }));
    expect(services.appearance.get()).toEqual({ mode: 'light', tint: 'crema' });
    await waitFor(async () => expect(await saved(services)).toEqual({ mode: 'light', tint: 'crema' }));
    expect(within(modeGroup()).getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(modeGroup()).getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(within(modeGroup()).getByRole('button', { name: 'Light' }));
    expect(services.appearance.get()).toEqual({ mode: 'light', tint: 'crema' });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('keeps a custom hue when the mode changes', async () => {
    const services = renderAppearance({ mode: 'dark', tint: { hue: 200 } });
    await userEvent.click(screen.getByTestId(TID.appearanceMode('auto')));
    expect(services.appearance.get()).toEqual({ mode: 'auto', tint: { hue: 200 } });
    await waitFor(async () => expect(await saved(services)).toEqual({ mode: 'auto', tint: { hue: 200 } }));
    expect(checkedTints()).toEqual(['Custom']);
  });
});

describe('AppearanceSection tint', () => {
  it('lists the tints and Custom as one choice, Crema checked; a tap on Matcha shows and saves it', async () => {
    const services = renderAppearance();
    const radios = within(tintGroup()).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(TINT_NAMES);
    for (const name of TINT_NAMES) expect(tint(name)).toBeInTheDocument();
    expect(checkedTints()).toEqual(['Crema']);
    expect(screen.getByTestId(TID.tintSwatch('matcha'))).toBe(tint('Matcha'));
    expect(screen.getByTestId(TID.tintSwatch('custom'))).toBe(tint('Custom'));

    await userEvent.click(tint('Matcha'));
    expect(services.appearance.get()).toEqual({ mode: 'dark', tint: 'matcha' });
    await waitFor(async () => expect(await saved(services)).toEqual({ mode: 'dark', tint: 'matcha' }));
    expect(checkedTints()).toEqual(['Matcha']);
  });

  it('Custom takes the hue the slider shows: the named tint until it is moved', async () => {
    const services = renderAppearance({ mode: 'light', tint: 'ocean' });
    const ocean = namedTint('ocean').hue;
    expect(screen.getByRole('slider', { name: 'Custom hue' })).toHaveAttribute('aria-valuenow', String(ocean));
    await userEvent.click(tint('Custom'));
    expect(services.appearance.get()).toEqual({ mode: 'light', tint: { hue: ocean } });
    await waitFor(async () => expect(await saved(services)).toEqual({ mode: 'light', tint: { hue: ocean } }));
    expect(checkedTints()).toEqual(['Custom']);
  });

  it('draws each tint in the mode on screen, and rings the one chosen', async () => {
    renderAppearance({ mode: 'light', tint: 'plum' });
    for (const [mode, id] of [
      ['light', 'matcha'],
      ['light', 'plum'],
    ] as const) {
      const palette = buildPalette(mode, namedTint(id));
      const swatch = screen.getByTestId(TID.tintSwatch(id));
      expect(swatch.style.getPropertyValue('--swatch-outer')).toBe(palette.accent);
      expect(swatch.style.getPropertyValue('--swatch-inner')).toBe(palette.background);
    }
    await userEvent.click(screen.getByTestId(TID.appearanceMode('dark')));
    const dark = buildPalette('dark', namedTint('matcha'));
    expect(screen.getByTestId(TID.tintSwatch('matcha')).style.getPropertyValue('--swatch-outer')).toBe(dark.accent);
    expect(screen.getByTestId(TID.tintSwatch('custom')).style.getPropertyValue('--swatch-outer')).toMatch(/^conic-gradient\(#[0-9a-f]{6}(, #[0-9a-f]{6}){12}\)$/);
  });

  it('reads a tint this build does not know as Crema, as the theme does', () => {
    renderAppearance({ mode: 'dark', tint: 'sunset' });
    expect(checkedTints()).toEqual(['Crema']);
  });

  it('every tint is in the tab order, and the arrow keys move between them', async () => {
    renderAppearance();
    const radios = within(tintGroup()).getAllByRole('radio');
    for (const radio of radios) expect(radio.tabIndex).toBe(0);
    act(() => tint('Crema').focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(tint('Matcha')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tint('Custom')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(tint('Crema')).toHaveFocus();
  });
});

describe('AppearanceSection custom hue', () => {
  it('shows each hue while the slider moves and saves where it stops, as the Custom tint', async () => {
    const services = renderAppearance();
    const preview = vi.spyOn(services.appearance, 'preview');
    const set = vi.spyOn(services.appearance, 'set');
    const slider = screen.getByRole('slider', { name: 'Custom hue' });
    expect(screen.getByTestId(TID.tintHue)).toBe(slider);
    expect(slider).toHaveAttribute('aria-valuenow', String(namedTint('crema').hue));

    act(() => slider.focus());
    await userEvent.keyboard('{ArrowRight}');

    const next = { mode: 'dark', tint: { hue: namedTint('crema').hue + 1 } };
    expect(preview).toHaveBeenCalledWith(next);
    expect(set).toHaveBeenCalledWith(next);
    expect(preview.mock.invocationCallOrder[0]).toBeLessThan(set.mock.invocationCallOrder[0] ?? 0);
    expect(services.appearance.get()).toEqual(next);
    await waitFor(async () => expect(await saved(services)).toEqual(next));
    expect(checkedTints()).toEqual(['Custom']);
    expect(slider).toHaveAttribute('aria-valuenow', String(namedTint('crema').hue + 1));
  });
});

describe('AppearanceSection save failure', () => {
  it('says the appearance could not be saved, keeps the change on screen, and can be dismissed', async () => {
    const services = renderAppearance();
    vi.spyOn(services.storage.settings, 'update').mockRejectedValue(new Error('The tablet storage is full'));
    await userEvent.click(within(modeGroup()).getByRole('button', { name: 'Light' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not save the appearance: The tablet storage is full');
    expect(services.appearance.get()).toEqual({ mode: 'light', tint: 'crema' });
    await userEvent.click(within(alert).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
