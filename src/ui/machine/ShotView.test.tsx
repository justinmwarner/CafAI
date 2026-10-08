// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { ShotView } from './ShotView.tsx';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

describe('ShotView', () => {
  it('is the full graph, with the coach note under it once a shot runs', () => {
    const { services } = renderWithServices(<ShotView awaitingOutcome={false} />);
    const view = screen.getByTestId(TID.shotView);
    expect(within(view).getByTestId(TID.liveGraph)).toBeInTheDocument();
    expect(within(view).getByRole('list', { name: 'Shot readouts' })).toBeInTheDocument();
    expect(within(view).queryByTestId(TID.coachNote)).not.toBeInTheDocument();

    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    expect(view.lastElementChild).toBe(within(view).getByTestId(TID.coachNote));
  });

  it('shows the note while the chat waits for the outcome', () => {
    renderWithServices(<ShotView awaitingOutcome />);
    expect(screen.getByTestId(TID.coachNote)).toHaveTextContent('Done. Reading the shot');
  });
});
