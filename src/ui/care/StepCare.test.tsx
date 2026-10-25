// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { doneRecord, servicesWithCare } from '../testing/careServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { routineOf } from './careGuide.ts';
import { takeReveal } from './careReveal.ts';
import { RoutineCard } from './RoutineCard.tsx';
import type { RoutineId } from './routines.ts';
import { StepCare } from './StepCare.tsx';

function routine(id: RoutineId, services: Awaited<ReturnType<typeof servicesWithCare>>) {
  return renderWithServices(
    <RoutineCard routine={routineOf(id)} numbered links={false} linkProps={{}} playingKey={null} onPlay={() => undefined} panelId="panel" tabId="tab" />,
    services,
  );
}

describe("a step's last time on the Care screen (D183, D186)", () => {
  it('every step beyond Daily has one, with Mark done; Daily’s steps have none', async () => {
    const services = await servicesWithCare();
    const weekly = routine('weekly', services);
    for (const step of ['detergent-clean', 'rinza', 'tank-tray', 'intake-filter']) {
      expect(screen.getByTestId(TID.careMarkDone(step))).toHaveAccessibleName(expect.stringMatching(/^Mark done: /));
    }
    weekly.unmount();
    routine('daily', services);
    expect(screen.queryByText('Mark done')).not.toBeInTheDocument();
    services.care.dispose();
  });

  it('a step never marked done says since when CafAI counts it; Mark done makes it today, and Undo takes it back', async () => {
    const services = await servicesWithCare({ shots: 100 });
    renderWithServices(<StepCare stepId="tank-tray" title="Wash the water tank and drip tray" />, services);
    const line = screen.getByTestId(TID.careStepLine('tank-tray'));
    expect(line).toHaveTextContent(/^Not marked done since \d{1,2} [A-Z][a-z]{2}$/);
    await userEvent.click(screen.getByRole('button', { name: 'Mark done: Wash the water tank and drip tray' }));
    expect(await screen.findByText('Done today')).toBeInTheDocument();
    expect((await services.storage.care.list()).find((record) => record.id === 'tank-tray')).toMatchObject({ by: 'tick', shotTotal: 100 });
    await userEvent.click(screen.getByRole('button', { name: 'Undo: Wash the water tank and drip tray' }));
    expect(await screen.findByText(/^Not marked done since/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
    services.care.dispose();
  });

  it('a due step says so first, in the warning colour, with the shots since', async () => {
    const services = await servicesWithCare({ records: [doneRecord('detergent-clean', 9)], shots: 141 });
    renderWithServices(<StepCare stepId="detergent-clean" title="Clean the group head with detergent" />, services);
    const line = screen.getByTestId(TID.careStepLine('detergent-clean'));
    expect(line).toHaveTextContent('Due · Last done 9 days ago · 41 shots since');
    expect(line).toHaveAttribute('data-due', 'true');
    expect(within(line).getByText(/^Due/)).toHaveStyle({ fontWeight: '600' });
    services.care.dispose();
  });

  it('the descale says what the water sets, and links to Settings > Machine, asking it to bring Machine care into view (D187, D233)', async () => {
    const services = await servicesWithCare();
    renderWithServices(<StepCare stepId="descale" title="Descale" />, services);
    expect(screen.getByText(/does not know your water/)).toBeInTheDocument();
    const link = screen.getByTestId(TID.careSetIn('descale'));
    expect(link).toHaveAttribute('href', '#/settings/machine');
    expect(link).toHaveTextContent('Set it in Settings');
    await userEvent.click(link);
    expect(takeReveal('settings-care')).toBe(true);
    await act(() => services.care.setSettings({ water: 'over120' }));
    expect(screen.getByText(/over 120 ppm: CafAI reminds you after six months, or 800 shots/)).toBeInTheDocument();
    expect(link).toHaveTextContent('Change it in Settings');
    services.care.dispose();
  });

  it('the intake filter says what the filter sets', async () => {
    const services = await servicesWithCare({ settings: { filter: 'v2' } });
    renderWithServices(<StepCare stepId="intake-filter" title="Clean the intake filter" />, services);
    expect(screen.getByText('Your filter is V2: CafAI reminds you every month.')).toBeInTheDocument();
    services.care.dispose();
  });

  it('a mark that could not be saved says so, and the step stays as it was', async () => {
    const services = await servicesWithCare();
    vi.spyOn(services.storage.care, 'put').mockRejectedValueOnce(new Error('disk full'));
    renderWithServices(<StepCare stepId="gasket" title="Look at the group gasket" />, services);
    await userEvent.click(screen.getByTestId(TID.careMarkDone('gasket')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that. Try again.');
    expect(screen.getByTestId(TID.careStepLine('gasket'))).toHaveTextContent(/^Not marked done since/);
    expect(screen.getByTestId(TID.careMarkDone('gasket'))).toBeEnabled();
    services.care.dispose();
  });

  it('shows nothing without a care service', () => {
    renderWithServices(<StepCare stepId="descale" title="Descale" />);
    expect(screen.queryByText('Mark done')).not.toBeInTheDocument();
  });
});
