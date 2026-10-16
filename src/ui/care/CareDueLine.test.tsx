// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StatsCard } from '../machine/StatsCard.tsx';
import { doneRecord, servicesWithCare } from '../testing/careServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { takeReveal } from './careReveal.ts';

describe("the stats card's line (D-CARE-6)", () => {
  it('says nothing while nothing is due', async () => {
    const services = await servicesWithCare({ records: [doneRecord('detergent-clean', 2)], shots: 110 });
    renderWithServices(<StatsCard />, services);
    expect(screen.getByTestId(TID.statsCard)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.careDueLine)).not.toBeInTheDocument();
    services.care.dispose();
  });

  it('names the most overdue step, and links to its routine with the step brought into view', async () => {
    const services = await servicesWithCare({
      records: [doneRecord('detergent-clean', 9), doneRecord('intake-filter', 40), doneRecord('descale', 100)],
      shots: 141,
    });
    renderWithServices(<StatsCard />, services);
    const line = screen.getByTestId(TID.careDueLine);
    // The filter, 40 days into its 14, is further past than the weekly clean, 9 into 7.
    expect(line).toHaveTextContent('Intake filter due: 5 weeks since the last');
    expect(line).toHaveAttribute('href', '#/care/weekly');
    await userEvent.click(line);
    expect(takeReveal({ step: 'intake-filter' })).toBe(true);
    services.care.dispose();
  });

  it('a step marked done goes from the line; the switch off takes the line away', async () => {
    const services = await servicesWithCare({ records: [doneRecord('detergent-clean', 9)], shots: 141 });
    renderWithServices(<StatsCard />, services);
    expect(screen.getByTestId(TID.careDueLine)).toHaveTextContent('Weekly clean due: 41 shots since the last');
    await act(() => services.care.setSettings({ reminders: false }));
    expect(screen.queryByTestId(TID.careDueLine)).not.toBeInTheDocument();
    await act(() => services.care.setSettings({ reminders: true }));
    await act(() => services.care.markDone('detergent-clean'));
    expect(screen.queryByTestId(TID.careDueLine)).not.toBeInTheDocument();
    services.care.dispose();
  });

  it('shows nothing without a care service', () => {
    renderWithServices(<StatsCard />);
    expect(screen.queryByTestId(TID.careDueLine)).not.toBeInTheDocument();
  });
});
