// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiffStatus } from '../../../app/types.ts';
import { TID } from '../../testIds.ts';
import { renderThemed } from '../testing/render.tsx';
import { DiffCard } from './DiffCard.tsx';
import type { DiffPart } from './types.ts';

function part(overrides: Partial<DiffPart> = {}): DiffPart {
  return {
    kind: 'diff',
    requestId: 'tu-1',
    summary: 'Raise brew temperature by 1 °C',
    lines: ['Brew temperature: 92.0 °C -> 93.0 °C (all steps)', 'Profile notes updated'],
    manualSteps: [],
    rationale: 'Sour and fast.',
    expectedEffect: 'Rounder acidity.',
    versionLabel: 'Kiambu AA v3',
    status: 'pending',
    error: null,
    ...overrides,
  };
}

function setup(diff: DiffPart, extra: { showUndo?: boolean; disabled?: boolean } = {}) {
  const handlers = { onConfirm: vi.fn(), onDecline: vi.fn(), onUndo: vi.fn() };
  renderThemed(<DiffCard part={diff} showUndo={extra.showUndo ?? false} disabled={extra.disabled} {...handlers} />);
  return handlers;
}

describe('DiffCard', () => {
  it('shows the change in plain words with before and after', () => {
    setup(part());
    const card = screen.getByTestId(TID.diffCard);
    expect(within(card).getByRole('heading', { name: 'Raise brew temperature by 1 °C' })).toBeInTheDocument();
    expect(within(card).getByText('92.0 °C')).toHaveStyle({ textDecoration: 'line-through' });
    expect(within(card).getByText('93.0 °C (all steps)')).toBeInTheDocument();
    expect(within(card).getByText('Profile notes updated')).toBeInTheDocument();
    expect(within(card).getByText('Sour and fast.')).toBeInTheDocument();
    expect(within(card).getByText('Rounder acidity.')).toBeInTheDocument();
    expect(within(card).getByText(/saves this as Kiambu AA v3/)).toBeInTheDocument();
  });

  it('lists the manual steps of a grinder change', () => {
    setup(part({ lines: [], manualSteps: ['Grind 1 step finer'], versionLabel: null }));
    expect(screen.getByRole('list', { name: 'By hand' })).toHaveTextContent('Grind 1 step finer');
    expect(screen.getByText(/change you make by hand/)).toBeInTheDocument();
  });

  it('confirms or declines while pending', async () => {
    const handlers = setup(part());
    await userEvent.click(screen.getByTestId(TID.diffConfirm));
    await userEvent.click(screen.getByTestId(TID.diffCancel));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onDecline).toHaveBeenCalledTimes(1);
  });

  it('blocks Confirm and Not now while the coach is busy', () => {
    setup(part(), { disabled: true });
    expect(screen.getByTestId(TID.diffConfirm)).toBeDisabled();
    expect(screen.getByTestId(TID.diffCancel)).toBeDisabled();
  });

  it('shows progress while applying, without buttons', () => {
    setup(part({ status: 'applying' }));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Loading Kiambu AA v3 onto the machine…')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.diffConfirm)).toBeNull();
  });

  it('offers Undo only when asked to', async () => {
    const handlers = setup(part({ status: 'applied' }), { showUndo: true });
    expect(screen.getByText('Loaded as Kiambu AA v3')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(TID.diffUndo));
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it('hides Undo on an applied card that is not the latest', () => {
    setup(part({ status: 'applied' }), { showUndo: false });
    expect(screen.getByText('Loaded as Kiambu AA v3')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.diffUndo)).toBeNull();
  });

  it.each<[DiffStatus, string | RegExp]>([
    ['declined', 'Not applied. Nothing changed on the machine.'],
    ['undone', 'Undone. Back on the previous version.'],
  ])('describes the %s status', (status, text) => {
    setup(part({ status }));
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.diffConfirm)).toBeNull();
    expect(screen.getByTestId(TID.diffCard)).toHaveAttribute('data-status', status);
  });

  it('shows the error of a failed change', () => {
    setup(part({ status: 'failed', error: 'Decaid did not answer.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Decaid did not answer.');
  });

  it('confirms a manual change without a version label', () => {
    setup(part({ status: 'applied', versionLabel: null }));
    expect(screen.getByText('Confirmed. Make the change before your next shot.')).toBeInTheDocument();
  });
});
