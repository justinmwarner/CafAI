// @vitest-environment jsdom
import './testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachState } from '../../app/types.ts';
import type { ShotStateEvent } from '../../api/types.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { CoachScreen } from './CoachScreen.tsx';
import { KIAMBU, SANTOS, coachStateFor } from './testing/fixtures.ts';
import { renderWithServices } from './testing/render.tsx';

function renderCoach(coach: Partial<CoachState>): FakeServices {
  const services = createFakeServices({ coach });
  renderWithServices(<CoachScreen />, services);
  return services;
}

const methods = (services: FakeServices) => services.coach.calls.map((c) => c.method);

function shotStateEvent(state: ShotStateEvent['state']): ShotStateEvent {
  return {
    event: 'state',
    timestamp: '2026-10-03T08:00:00.000000',
    shotId: 'shot-1',
    state,
    machineState: null,
    machineSubstate: null,
    profileFrame: null,
    scaleConnected: true,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision: null,
  };
}

describe('CoachScreen', () => {
  it('waits for the engine to load', () => {
    renderCoach({ ready: false });
    expect(screen.getByText('Loading your bags…')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.chat)).toBeNull();
  });

  it('asks for an API key before anything else', () => {
    renderCoach({ ...coachStateFor('diff'), hasApiKey: false });
    expect(screen.getByText('Add your Anthropic API key to start coaching')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings');
    expect(screen.queryByTestId(TID.chat)).toBeNull();
    expect(screen.queryByTestId(TID.newBag)).toBeNull();
  });

  it('offers one large New bag button when there are no bags', async () => {
    const services = renderCoach({ ready: true, hasApiKey: true, bags: [], phase: 'no_bag' });
    expect(screen.getByText('Dial in your first bag')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.bagPicker)).toBeNull();
    expect(screen.getAllByTestId(TID.newBag)).toHaveLength(1);
    await userEvent.click(screen.getByTestId(TID.newBag));
    expect(methods(services)).toEqual(['newBag']);
  });

  it('lets an existing bag be picked when none is active', async () => {
    const services = renderCoach({ ready: true, hasApiKey: true, bags: [KIAMBU, SANTOS], activeBag: null, phase: 'no_bag' });
    expect(screen.getByText('Pick a bag above, or start a new one')).toBeInTheDocument();
    expect(screen.getAllByTestId(TID.newBag)).toHaveLength(1);
    await userEvent.selectOptions(screen.getByTestId(TID.bagPicker), SANTOS.id);
    expect(services.coach.calls).toEqual([{ method: 'selectBag', args: [SANTOS.id] }]);
  });

  it('shows the bag, its active version and the chat', async () => {
    const services = renderCoach(coachStateFor('options'));
    const picker = screen.getByTestId(TID.bagPicker);
    expect(picker).toHaveValue(KIAMBU.id);
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Kiambu AA', 'Brazil Santos']);
    expect(screen.getByTestId(TID.activeVersion)).toHaveTextContent('Kiambu AA v1');
    expect(screen.getByTestId(TID.chat)).toBeInTheDocument();
    expect(screen.getByTestId(TID.composerInput)).toHaveAttribute('placeholder', 'Tap an answer, or say how it tasted');

    await userEvent.selectOptions(picker, SANTOS.id);
    expect(services.coach.calls).toEqual([{ method: 'selectBag', args: [SANTOS.id] }]);
  });

  it('tells same-named bags apart in the picker by when they were started', () => {
    const twin = { ...SANTOS, id: 'bag-twin', name: 'Kiambu AA', createdAt: '2026-09-20T07:00:00.000Z' };
    renderCoach({ ...coachStateFor('options'), bags: [KIAMBU, twin] });
    const labels = within(screen.getByTestId(TID.bagPicker))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => label.startsWith('Kiambu AA · '))).toBe(true);
    expect(new Set(labels).size).toBe(2);
  });

  it('says when no profile is loaded yet', () => {
    renderCoach(coachStateFor('templates'));
    expect(screen.getByTestId(TID.activeVersion)).toHaveTextContent('No profile yet');
  });

  it('starts a new bag from the header', async () => {
    const services = renderCoach(coachStateFor('shot'));
    await userEvent.click(screen.getByTestId(TID.newBag));
    expect(methods(services)).toEqual(['newBag']);
  });

  it('shows Undo in the header only when the change can be undone', async () => {
    const services = renderCoach(coachStateFor('shot'));
    expect(screen.queryByTestId(TID.undoButton)).toBeNull();
    act(() => services.coach.setState({ canUndo: true }));
    await userEvent.click(screen.getByTestId(TID.undoButton));
    expect(methods(services)).toEqual(['undo']);
  });

  it('shows errors with Retry and dismiss', async () => {
    const services = renderCoach(coachStateFor('diff'));
    expect(screen.queryByTestId(TID.errorBanner)).toBeNull();
    act(() => services.coach.setState({ error: 'The coach could not be reached.' }));
    expect(screen.getByTestId(TID.errorBanner)).toHaveTextContent('The coach could not be reached.');
    await userEvent.click(screen.getByTestId(TID.retryButton));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(methods(services)).toEqual(['retry', 'dismissError']);
  });

  it('sends what the barista types', async () => {
    const services = renderCoach(coachStateFor('intake'));
    await userEvent.type(screen.getByTestId(TID.composerInput), 'Kiambu AA, washed, light{Enter}');
    await waitFor(() => expect(services.coach.calls).toEqual([{ method: 'sendText', args: ['Kiambu AA, washed, light'] }]));
  });

  it('passes card taps to the controller', async () => {
    const services = renderCoach(coachStateFor('templates'));
    await userEvent.click(screen.getByTestId(TID.templatePick('blooming-espresso')));
    act(() => services.coach.setState(coachStateFor('diff')));
    await userEvent.click(screen.getByTestId(TID.diffConfirm));
    expect(services.coach.calls).toEqual([
      { method: 'pickTemplate', args: ['tu-templates', 'blooming-espresso'] },
      { method: 'confirmChange', args: ['tu-adjust'] },
    ]);
  });

  it('keeps the bag on screen while a shot is pulled', () => {
    const services = createFakeServices({ coach: coachStateFor('applied') });
    renderWithServices(<CoachScreen />, services);
    expect(screen.getByTestId(TID.bagPicker)).toBeEnabled();
    act(() => services.telemetry.setState({ shotState: shotStateEvent('pouring') }));
    expect(screen.getByTestId(TID.newBag)).toBeDisabled();
    expect(screen.getByTestId(TID.bagPicker)).toBeDisabled();
    act(() => services.telemetry.setState({ shotState: shotStateEvent('finished') }));
    expect(screen.getByTestId(TID.bagPicker)).toBeEnabled();
  });

  it('disables the header actions while the coach is busy', () => {
    renderCoach({ ...coachStateFor('applied'), busy: true });
    expect(screen.getByTestId(TID.newBag)).toBeDisabled();
    expect(screen.getByTestId(TID.bagPicker)).toBeDisabled();
    for (const undo of [...screen.getAllByTestId(TID.undoButton), ...screen.queryAllByTestId(TID.diffUndo)]) expect(undo).toBeDisabled();
  });
});
