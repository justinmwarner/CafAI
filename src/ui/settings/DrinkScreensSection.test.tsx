// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Services } from '../../app/types.ts';
import { applySettingsPatch, normalizeSettings } from '../../storage/settings.ts';
import type { DrinkScreensSettings } from '../../storage/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import type { DrinkKind } from '../drinks/kinds.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { DrinkScreensSection } from './DrinkScreensSection.tsx';

const MODEL = 'claude-opus-5-5';
const HELP = "What each drink's screen shows while it runs, and whether it goes back by itself once it's done. Kept on this device.";
const STAYS = 'The screen stays until you tap Go back.';

/**
 * The section over CafAI's own settings rules (src/storage/settings.ts), which
 * change one field of one drink at a time, as the app saves them: the fake's
 * settings would swap the whole block for each change.
 */
function renderSection(drinkScreens?: DrinkScreensSettings) {
  let stored = normalizeSettings({ model: MODEL, drinkScreens }, MODEL);
  const services = createFakeServices({ storage: { settings: stored } });
  services.storage.settings.get = async () => stored;
  services.storage.settings.update = async (patch) => (stored = applySettingsPatch(stored, patch, MODEL));
  renderWithServices(<DrinkScreensSection />, services);
  return { services, saved: () => stored.drinkScreens, user: userEvent.setup() };
}

const group = (name: string) => within(screen.getByRole('group', { name }));
const animation = (kind: DrinkKind) => screen.getByTestId(TID.drinkScene(kind));
const goBack = (kind: DrinkKind) => screen.getByTestId(TID.drinkGoBackSwitch(kind));
/** After, the drinks' stepper named for its drink ("Steam go back after"); null while Go back by itself is off. */
const after = (drink: string) => screen.queryByRole('spinbutton', { name: `${drink} go back after` });

describe('Settings > Drink screens (D-SCENE-1, D-BACK-2)', () => {
  it('has a group for each drink, as the section above, each on its default scene and going back after 10 s', () => {
    renderSection();
    expect(screen.getByRole('region', { name: 'Drink screens' })).toBeInTheDocument();
    expect(screen.getByText(HELP)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Steam', 'Hot water', 'Flush']);
    expect(animation('steam')).toHaveDisplayValue('Wand and spray');
    expect(animation('hotWater')).toHaveDisplayValue('Pour');
    expect(animation('flush')).toHaveDisplayValue('Shower');
    for (const kind of ['steam', 'hotWater', 'flush'] as const) expect(goBack(kind)).toBeChecked();
    for (const drink of ['Steam', 'Hot water', 'Flush']) {
      expect(after(drink)).toHaveValue('10');
      expect(after(drink)).toHaveAttribute('aria-valuetext', '10 seconds');
      expect(after(drink)).toBeEnabled();
    }
    expect(screen.queryByText(STAYS)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("offers each drink's scenes by name, the default first, and names every control for its drink", () => {
    renderSection();
    const names = (kind: DrinkKind) => within(animation(kind)).getAllByRole('option').map((option) => option.textContent);
    expect(names('steam')).toEqual(['Wand and spray', 'Whirlpool', 'Rosetta', 'Simple']);
    expect(names('hotWater')).toEqual(['Pour', 'From above', 'Simple']);
    expect(names('flush')).toEqual(['Shower', 'Screen', 'Simple']);
    // The label shown says what, the heading says which drink; each control's name says both.
    const steam = group('Steam');
    expect(steam.getByRole('combobox', { name: 'Steam animation' })).toBe(animation('steam'));
    expect(steam.getByText('Animation').closest('label')).toHaveAttribute('for', animation('steam').id);
    expect(steam.getByRole('switch', { name: 'Go back by itself after Steam' })).toBe(goBack('steam'));
    expect(steam.getByText('After').closest('label')).toHaveAttribute('for', after('Steam')!.id);
    expect(group('Hot water').getByRole('switch', { name: 'Go back by itself after Hot water' })).toBe(goBack('hotWater'));
    expect(group('Flush').getByRole('combobox', { name: 'Flush animation' })).toBe(animation('flush'));
  });

  it('shows what was chosen on this device, and a scene this build does not know as the default', () => {
    renderSection({ steam: { scene: 'tornado' }, hotWater: { scene: 'above', goBackSeconds: 45 }, flush: { scene: 'simple', goBack: false } });
    expect(animation('steam')).toHaveDisplayValue('Wand and spray');
    expect(animation('hotWater')).toHaveDisplayValue('From above');
    expect(after('Hot water')).toHaveValue('45');
    expect(animation('flush')).toHaveDisplayValue('Simple');
    expect(goBack('flush')).not.toBeChecked();
    expect(after('Flush')).toBeNull();
    expect(group('Flush').getByText(STAYS)).toBeInTheDocument();
  });

  it("a scene picked applies at once and is saved with CafAI's settings", async () => {
    const { services, saved, user } = renderSection();
    await user.selectOptions(animation('steam'), 'Whirlpool');
    expect(animation('steam')).toHaveValue('whirlpool');
    // The drink's view reads the store, so its next run draws it.
    expect(services.drinkScreens.get().steam.scene).toBe('whirlpool');
    await waitFor(() => expect(saved()).toEqual({ steam: { scene: 'whirlpool' } }));
  });

  it('Go back by itself off puts the line in place of After; on again brings After back with its time', async () => {
    const { services, saved, user } = renderSection({ flush: { goBackSeconds: 25 } });
    await user.click(goBack('flush'));
    expect(goBack('flush')).not.toBeChecked();
    expect(services.drinkScreens.get().flush.goBack).toBe(false);
    expect(after('Flush')).toBeNull();
    expect(group('Flush').getByText(STAYS)).toBeInTheDocument();
    await waitFor(() => expect(saved()).toEqual({ flush: { goBack: false, goBackSeconds: 25 } }));
    // A tap on its label toggles it too.
    await user.click(group('Flush').getByText('Go back by itself'));
    expect(goBack('flush')).toBeChecked();
    expect(after('Flush')).toHaveValue('25');
    expect(screen.queryByText(STAYS)).toBeNull();
    await waitFor(() => expect(saved()).toEqual({ flush: { goBack: true, goBackSeconds: 25 } }));
    expect(goBack('steam')).toBeChecked();
  });

  it('After moves 5 s a tap within 5 to 60 s and takes any whole second typed', async () => {
    const { saved, user } = renderSection({ flush: { goBackSeconds: 5 } });
    await user.click(screen.getByRole('button', { name: 'More steam go back after' }));
    expect(after('Steam')).toHaveValue('15');
    await waitFor(() => expect(saved()?.steam).toEqual({ goBackSeconds: 15 }));

    const hotWater = after('Hot water')!;
    await user.clear(hotWater);
    await user.type(hotWater, '22');
    await user.tab();
    await waitFor(() => expect(saved()?.hotWater).toEqual({ goBackSeconds: 22 }));
    await user.clear(hotWater);
    await user.type(hotWater, '90');
    await user.tab();
    expect(hotWater).toHaveValue('60');
    await waitFor(() => expect(saved()?.hotWater).toEqual({ goBackSeconds: 60 }));

    // At the floor Less sends nothing.
    await user.click(screen.getByRole('button', { name: 'Less flush go back after' }));
    expect(after('Flush')).toHaveValue('5');
    expect(saved()?.flush).toEqual({ goBackSeconds: 5 });
  });

  it('a failed save says why and keeps the change on screen; the next change that saves clears it', async () => {
    const { services, saved, user } = renderSection();
    const update = services.storage.settings.update;
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    await user.selectOptions(animation('steam'), 'Rosetta');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not save the drink screens: Storage is full.');
    expect(screen.getByTestId(TID.drinkScreensError)).toBe(alert);
    expect(animation('steam')).toHaveValue('rosetta');
    expect(services.drinkScreens.get().steam.scene).toBe('rosetta');

    services.storage.settings.update = update;
    await user.click(goBack('hotWater'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saved()).toEqual({ hotWater: { goBack: false } });
  });

  it('is left out without the store, as in a preview', () => {
    const services = createFakeServices();
    delete (services as Services).drinkScreens;
    renderWithServices(<DrinkScreensSection />, services);
    expect(screen.queryByRole('region', { name: 'Drink screens' })).toBeNull();
  });
});
