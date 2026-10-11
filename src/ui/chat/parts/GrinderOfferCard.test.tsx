// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OfferGrinder } from '../../../coach/contract.ts';
import { TID } from '../../testIds.ts';
import { renderThemed } from '../testing/render.tsx';
import { dialLine, GrinderOfferCard } from './GrinderOfferCard.tsx';
import type { GrinderOfferPart } from './types.ts';

const PHILOS: OfferGrinder = { model: 'Mazzer Philos', burrs: '64 mm flat', settingType: 'numeric', smallStep: 0.5, bigStep: 2, values: null };

function renderCard(fields: Partial<GrinderOfferPart> = {}, disabled = false) {
  const onAdd = vi.fn();
  const onDecline = vi.fn();
  const part: GrinderOfferPart = { kind: 'grinderOffer', requestId: 't-grinder', grinder: PHILOS, status: 'pending', error: null, ...fields };
  const { unmount } = renderThemed(<GrinderOfferCard part={part} disabled={disabled} onAdd={onAdd} onDecline={onDecline} />);
  return { onAdd, onDecline, unmount, card: screen.getByTestId(TID.grinderOffer) };
}

describe('GrinderOfferCard (D125)', () => {
  it('says what the coach heard and what Add does, with Add to Decaid and Not now', async () => {
    const { onAdd, onDecline, card } = renderCard();
    expect(within(card).getByRole('heading', { name: "Add Mazzer Philos to Decaid's grinders?" })).toBeInTheDocument();
    expect(within(card).getByText('Burrs: 64 mm flat. A numbered dial, in steps of 0.5 (big steps 2).')).toBeInTheDocument();
    expect(within(card).getByText('Decaid and your other skins will list it, and CafAI uses it from then on.')).toBeInTheDocument();
    await userEvent.click(within(card).getByTestId(TID.grinderOfferAdd));
    expect(onAdd).toHaveBeenCalledTimes(1);
    await userEvent.click(within(card).getByTestId(TID.grinderOfferDecline));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('says when the coach gives directions only, without a step size', () => {
    const { card } = renderCard({ grinder: { ...PHILOS, burrs: null, settingType: null, smallStep: null, bigStep: null } });
    expect(within(card).getByText(/without its step size the coach gives directions only/)).toBeInTheDocument();
  });

  it('says why an Add failed, as a sentence, and offers both buttons again', () => {
    const { card, unmount } = renderCard({ error: 'Could not reach Decaid.' });
    expect(within(card).getByRole('alert')).toHaveTextContent("Couldn't add it: Could not reach Decaid. Try again, or tap Not now.");
    expect(within(card).getByTestId(TID.grinderOfferAdd)).toBeEnabled();
    unmount();
    renderCard({ error: 'database is locked' });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't add it: database is locked. Try again, or tap Not now.");
  });

  it('blocks both buttons while the coach works and while the grinder is on its way', () => {
    renderCard({}, true);
    expect(screen.getByTestId(TID.grinderOfferAdd)).toBeDisabled();
    expect(screen.getByTestId(TID.grinderOfferDecline)).toBeDisabled();
  });

  it('shows Adding… with both buttons blocked while CafAI adds it', () => {
    renderCard({ status: 'adding' });
    expect(screen.getByTestId(TID.grinderOfferAdd)).toHaveTextContent('Adding…');
    expect(screen.getByTestId(TID.grinderOfferAdd)).toBeDisabled();
    expect(screen.getByTestId(TID.grinderOfferDecline)).toBeDisabled();
  });

  it('closes once answered, saying what happened', () => {
    for (const [fields, said] of [
      [{ status: 'added', linkedName: 'Mazzer Philos (64 mm flat)' }, "Added to Decaid's grinders: CafAI uses Mazzer Philos (64 mm flat) now."],
      [{ status: 'existing', linkedName: 'Niche Zero (63 mm conical)' }, 'Decaid already had Niche Zero (63 mm conical): CafAI uses it now.'],
      [{ status: 'declined' }, 'Not added.'],
      [{ status: 'expired', setAsideReason: 'typed' }, 'Set aside: you typed in the chat instead. Nothing was added.'],
      [{ status: 'expired', setAsideReason: 'shot' }, 'Set aside: a new shot came in. Nothing was added.'],
    ] as const) {
      const { card, unmount } = renderCard(fields);
      expect(within(card).getByText(said)).toBeInTheDocument();
      expect(within(card).queryByTestId(TID.grinderOfferAdd)).toBeNull();
      unmount();
    }
  });
});

describe('dialLine', () => {
  it('reads the dial as the coach heard it', () => {
    expect(dialLine(PHILOS)).toBe('A numbered dial, in steps of 0.5 (big steps 2).');
    expect(dialLine({ ...PHILOS, bigStep: null, smallStep: 0.1 + 0.2 })).toBe('A numbered dial, in steps of 0.3.');
    expect(dialLine({ ...PHILOS, smallStep: null, bigStep: null })).toBe('A numbered dial.');
    expect(dialLine({ ...PHILOS, settingType: null, smallStep: null, bigStep: null })).toBeNull();
    const encore = { ...PHILOS, settingType: 'preset' as const, smallStep: null, bigStep: null };
    expect(dialLine({ ...encore, values: ['1', '2', '3'] })).toBe('3 settings: 1, 2, 3.');
    expect(dialLine({ ...encore, values: Array.from({ length: 40 }, (_, i) => String(i + 1)) })).toBe('40 settings: 1, 2, 3 … 40.');
    expect(dialLine({ ...encore, values: null })).toBe('A list of settings.');
    expect(dialLine({ ...encore, settingType: null, values: ['fine'] })).toBe('1 setting: fine.');
  });
});
