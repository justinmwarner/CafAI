// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Settings } from '../../storage/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { FINER_IS_LINE, GRINDER_DIRECTION_TID, GrinderDirectionRow, NAME_GRINDER_FIRST } from './GrinderDirectionRow.tsx';

const NICHE = 'id:g-niche';

const lower = () => screen.getByTestId(GRINDER_DIRECTION_TID.grinderFinerLower);
const higher = () => screen.getByTestId(GRINDER_DIRECTION_TID.grinderFinerHigher);
const group = () => screen.getByRole('group', { name: 'Finer is' });
const refreshes = (services: FakeServices) => services.coach.calls.filter((call) => call.method === 'refresh').length;

function servicesWith(settings: Partial<Settings> = {}): FakeServices {
  return createFakeServices({
    storage: { settings: { model: 'claude-opus-5-5', grinderName: 'Niche Zero', grinderSetting: '15', grinderId: 'g-niche', activeBagId: null, ...settings } },
  });
}

describe('Settings > Grinder > Finer is (D241)', () => {
  it('says Lower numbers until someone chooses, under a label, with what it is for', async () => {
    renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled={false} />, servicesWith());
    await waitFor(() => expect(lower()).toHaveAttribute('aria-pressed', 'true'));
    expect(higher()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Finer is')).toBeInTheDocument();
    expect(lower()).toHaveAccessibleName('Lower numbers');
    expect(higher()).toHaveAccessibleName('Higher numbers');
    expect(group()).toHaveAccessibleDescription(FINER_IS_LINE);
    expect(FINER_IS_LINE).toBe('So the coach turns the dial the right way.');
    expect(lower()).toBeEnabled();
  });

  it("shows the answer saved for this grinder, and only this grinder's", async () => {
    const services = servicesWith({ grinderFinerHigher: [NICHE] });
    const { rerender } = renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled={false} />, services);
    await waitFor(() => expect(higher()).toHaveAttribute('aria-pressed', 'true'));
    // The card's form now names another grinder: its own answer, Lower numbers until chosen.
    rerender(<GrinderDirectionRow grinderKey="name:df64" disabled={false} />);
    expect(lower()).toHaveAttribute('aria-pressed', 'true');
    expect(higher()).toHaveAttribute('aria-pressed', 'false');
  });

  it('a tap saves at once, for this grinder, then the coach reads its settings again', async () => {
    const services = servicesWith({ grinderFinerHigher: ['name:df64'] });
    renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled={false} />, services);
    await waitFor(() => expect(lower()).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(higher());
    expect(higher()).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () => expect((await services.storage.settings.get()).grinderFinerHigher).toEqual(['name:df64', NICHE]));
    await waitFor(() => expect(refreshes(services)).toBe(1));

    // And back: Lower numbers takes this grinder off the list, the other grinder's answer kept.
    await userEvent.click(lower());
    await waitFor(async () => expect((await services.storage.settings.get()).grinderFinerHigher).toEqual(['name:df64']));
    await waitFor(() => expect(refreshes(services)).toBe(2));
    expect(lower()).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves on what storage holds then, so an answer saved elsewhere since this row read is kept', async () => {
    const services = servicesWith();
    renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled={false} />, services);
    await waitFor(() => expect(lower()).toHaveAttribute('aria-pressed', 'true'));
    // The coach's grinder card linked another grinder meanwhile, and kept its answer.
    await services.storage.settings.update({ grinderFinerHigher: ['id:g-philos'] });
    await userEvent.click(higher());
    await waitFor(async () => expect((await services.storage.settings.get()).grinderFinerHigher).toEqual(['id:g-philos', NICHE]));
  });

  it('a tap on the chosen one saves nothing', async () => {
    const services = servicesWith();
    const update = vi.spyOn(services.storage.settings, 'update');
    renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled={false} />, services);
    await waitFor(() => expect(lower()).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(lower());
    expect(update).not.toHaveBeenCalled();
    expect(refreshes(services)).toBe(0);
  });

  it('is held, with nothing chosen and a line saying why, until the grinder has a name', async () => {
    const services = servicesWith({ grinderName: null, grinderId: null, grinderSetting: null });
    const update = vi.spyOn(services.storage.settings, 'update');
    renderWithServices(<GrinderDirectionRow grinderKey={null} disabled={false} />, services);
    await waitFor(() => expect(group()).toHaveAccessibleDescription(NAME_GRINDER_FIRST));
    expect(NAME_GRINDER_FIRST).toBe('Name your grinder first.');
    expect(lower()).toBeDisabled();
    expect(higher()).toBeDisabled();
    expect(lower()).toHaveAttribute('aria-pressed', 'false');
    expect(higher()).toHaveAttribute('aria-pressed', 'false');
    // Even a tap that got through (the button lets none through) saves nothing.
    await userEvent.setup({ pointerEventsCheck: 0 }).click(higher());
    expect(update).not.toHaveBeenCalled();
  });

  it('is held while the card holds its grinder fields, keeping its answer and its line', async () => {
    renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled />, servicesWith({ grinderFinerHigher: [NICHE] }));
    await waitFor(() => expect(higher()).toHaveAttribute('aria-pressed', 'true'));
    expect(higher()).toBeDisabled();
    expect(lower()).toBeDisabled();
    expect(group()).toHaveAccessibleDescription(FINER_IS_LINE);
  });

  it('is held, saying so, when the settings cannot be read', async () => {
    const services = servicesWith({ grinderFinerHigher: [NICHE] });
    services.storage.settings.get = async () => {
      throw new Error('IndexedDB is closed.');
    };
    renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled={false} />, services);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read which way is finer: IndexedDB is closed.');
    expect(higher()).toBeDisabled();
    expect(higher()).toHaveAttribute('aria-pressed', 'false');
    expect(lower()).toHaveAttribute('aria-pressed', 'false');
  });

  it('a failed save says so under it, and the control goes back to what the coach still uses', async () => {
    const services = servicesWith();
    const update = services.storage.settings.update;
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    renderWithServices(<GrinderDirectionRow grinderKey={NICHE} disabled={false} />, services);
    await waitFor(() => expect(lower()).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(higher());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save which way is finer: Storage is full.');
    expect(lower()).toHaveAttribute('aria-pressed', 'true');
    expect(refreshes(services)).toBe(0);
    // A later save that works clears it.
    services.storage.settings.update = update;
    await userEvent.click(higher());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(higher()).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () => expect((await services.storage.settings.get()).grinderFinerHigher).toEqual([NICHE]));
  });
});
