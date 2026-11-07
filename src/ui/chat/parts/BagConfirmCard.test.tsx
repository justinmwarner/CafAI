// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Box from '@mui/material/Box';
import { TID } from '../../testIds.ts';
import { fadedElements, renderThemed } from '../testing/render.tsx';
import { previewTheme } from '../testing/previewTheme.ts';
import { BLANK_BAG } from '../../../app/engine/uiMessages.ts';
import { BAG_FROM_PHOTO } from '../testing/fixtures.ts';
import { BagConfirmCard, type BagConfirmCardProps } from './BagConfirmCard.tsx';

function renderCard(props: Partial<BagConfirmCardProps> = {}) {
  const onConfirm = vi.fn();
  renderThemed(<BagConfirmCard details={BAG_FROM_PHOTO} confirmed={false} onConfirm={onConfirm} {...props} />);
  return { onConfirm, card: screen.getByTestId(TID.bagConfirm) };
}

const confirmButton = () => screen.getByRole('button', { name: 'Confirm' });

describe('BagConfirmCard (6.8)', () => {
  it('shows what was read from the photo, each detail in a field to fix', () => {
    const { card } = renderCard();
    expect(within(card).getByRole('heading', { name: "Check the bag's details" })).toBeInTheDocument();
    expect(within(card).getByText('Read from your photo. Fix anything that is wrong, then confirm.')).toBeInTheDocument();
    expect(within(card).getByLabelText('Name')).toHaveValue('Kiambu AA');
    expect(within(card).getByLabelText('Roaster')).toHaveValue('Square Mile');
    expect(within(card).getByLabelText('Origin')).toHaveValue('Kenya, Kiambu');
    expect(within(card).getByLabelText('Process')).toHaveValue('washed');
    expect(within(card).getByLabelText('Roast level')).toHaveValue('light');
    expect(within(card).getByLabelText('Roast date')).toHaveValue('2026-09-28');
    expect(within(card).getByLabelText('Tasting notes')).toHaveValue('blackcurrant, grapefruit, brown sugar');
    // The later details (D278).
    expect(within(card).getByLabelText('Producer or farm')).toHaveValue('Kiambu Farmers Cooperative');
    expect(within(card).getByLabelText('Variety')).toHaveValue('SL28, SL34');
    expect(within(card).getByLabelText('Altitude')).toHaveValue('1,700 masl');
    expect(within(card).getByLabelText('Other details')).toHaveValue('');
  });

  it('fills the later details blank on a card stored before them (D278)', () => {
    const { producer: _p, variety: _v, altitude: _a, other: _o, ...older } = BAG_FROM_PHOTO;
    const { card } = renderCard({ details: older as typeof BAG_FROM_PHOTO });
    for (const label of ['Producer or farm', 'Variety', 'Altitude', 'Other details']) expect(within(card).getByLabelText(label)).toHaveValue('');
  });

  it('confirms the details as they were fixed, a cleared field as unknown', async () => {
    const { onConfirm, card } = renderCard();
    const name = within(card).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Kiambu AA Peaberry ');
    await userEvent.clear(within(card).getByLabelText('Origin'));
    await userEvent.selectOptions(within(card).getByLabelText('Roast level'), 'medium-light');
    fireEvent.change(within(card).getByLabelText('Roast date'), { target: { value: '2026-09-30' } });
    await userEvent.clear(within(card).getByLabelText('Altitude'));
    await userEvent.type(within(card).getByLabelText('Other details'), 'Lot 7, a gift from Sam');
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Kiambu AA Peaberry',
      roaster: 'Square Mile',
      origin: null,
      roastLevel: 'medium-light',
      process: 'washed',
      notes: 'blackcurrant, grapefruit, brown sugar',
      roastDate: '2026-09-30',
      producer: 'Kiambu Farmers Cooperative',
      variety: 'SL28, SL34',
      altitude: null,
      other: 'Lot 7, a gift from Sam',
    });
  });

  it('confirms an unknown roast level and date as unknown', async () => {
    const { onConfirm, card } = renderCard({ details: { ...BAG_FROM_PHOTO, roastLevel: null, roastDate: null } });
    expect(within(card).getByLabelText('Roast level')).toHaveValue('');
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ roastLevel: null, roastDate: null }));
  });

  it('asks for a name first when the bag showed none', async () => {
    const { onConfirm, card } = renderCard({ details: { ...BAG_FROM_PHOTO, name: '' } });
    expect(confirmButton()).toBeDisabled();
    expect(within(card).getByText('Needed: it names the profiles.')).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText('Name'), '   ');
    expect(confirmButton()).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('Name'), 'Kiambu');
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kiambu' }));
  });

  it('keeps each detail within what a bag holds', () => {
    const { card } = renderCard();
    expect(within(card).getByLabelText('Name')).toHaveAttribute('maxlength', '40');
    expect(within(card).getByLabelText('Roaster')).toHaveAttribute('maxlength', '60');
    expect(within(card).getByLabelText('Origin')).toHaveAttribute('maxlength', '80');
    expect(within(card).getByLabelText('Process')).toHaveAttribute('maxlength', '40');
    expect(within(card).getByLabelText('Tasting notes')).toHaveAttribute('maxlength', '300');
    expect(within(card).getByLabelText('Producer or farm')).toHaveAttribute('maxlength', '80');
    expect(within(card).getByLabelText('Variety')).toHaveAttribute('maxlength', '80');
    expect(within(card).getByLabelText('Altitude')).toHaveAttribute('maxlength', '40');
    expect(within(card).getByLabelText('Other details')).toHaveAttribute('maxlength', '500');
  });

  it('once confirmed, shows the details as text, marked confirmed, with nothing left to edit', () => {
    const { card } = renderCard({ confirmed: true });
    expect(within(card).queryAllByRole('textbox')).toEqual([]);
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(card).getByText('Kiambu AA')).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Square Mile · Kenya, Kiambu · Produced by Kiambu Farmers Cooperative · SL28, SL34 · 1,700 masl · washed · light roast · Roasted 28 Sep 2026',
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText('Tasting notes: blackcurrant, grapefruit, brown sugar')).toBeInTheDocument();
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
  });

  it('shows the other details once confirmed, on a line of their own', () => {
    const { card } = renderCard({ confirmed: true, details: { ...BAG_FROM_PHOTO, other: 'Lot 7; thermal shock' } });
    expect(within(card).getByText('Other details: Lot 7; thermal shock')).toBeInTheDocument();
  });

  it('says why it was set aside, in the muted ink, never faded, and saved nothing', () => {
    const { card } = renderCard({ expired: true, setAsideReason: 'typed' });
    expect(within(card).getByText('Set aside: you described the bag in the chat. These details were not saved.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(card).toHaveStyle({ color: previewTheme.palette.text.secondary });
    expect(fadedElements(card)).toEqual([]);
  });

  it('blocks Confirm while the coach is busy', () => {
    renderCard({ disabled: true });
    expect(confirmButton()).toBeDisabled();
  });

  it("keeps each field's own height inside the chat, so the roast level read from the photo shows", () => {
    // x-chat's ChatBox (ChatBox.js): border-box, and every element inside inherits it. That took the
    // select's 12.5 px paddings out of its 25 px height, leaving no room for the level.
    renderThemed(
      <Box sx={{ boxSizing: 'border-box', '& *': { boxSizing: 'inherit' } }}>
        <BagConfirmCard details={BAG_FROM_PHOTO} confirmed={false} onConfirm={vi.fn()} />
      </Box>,
    );
    const card = screen.getByTestId(TID.bagConfirm);
    // Not the hidden copy of the notes that measures their height.
    const fields = [...card.querySelectorAll<HTMLInputElement>('.MuiInputBase-input:not([aria-hidden="true"])')];
    const label = (field: HTMLInputElement) => field.labels?.[0]?.textContent ?? '';
    expect(fields.map(label)).toEqual([
      'Name',
      'Roaster',
      'Origin',
      'Producer or farm',
      'Variety',
      'Altitude',
      'Process',
      'Roast level',
      'Roast date',
      'Tasting notes',
      'Other details',
    ]);
    for (const field of fields) expect(getComputedStyle(field).boxSizing, label(field)).toBe('content-box');
  });
});

describe('BagConfirmCard: typed (D279)', () => {
  it('asks for the details blank, with examples, and the name only as needed', () => {
    const { card } = renderCard({ details: BLANK_BAG, source: 'typed' });
    expect(within(card).getByRole('heading', { name: "The bag's details" })).toBeInTheDocument();
    expect(within(card).getByText('Type what the bag says. Only the name is needed; leave blank what it does not say.')).toBeInTheDocument();
    expect(within(card).queryByText('Read from your photo. Fix anything that is wrong, then confirm.')).toBeNull();
    expect(within(card).getByLabelText('Name')).toHaveValue('');
    expect(within(card).getByLabelText('Producer or farm')).toHaveAttribute('placeholder', 'e.g. El Paraíso');
    expect(within(card).getByLabelText('Altitude')).toHaveAttribute('placeholder', 'e.g. 1,950 masl');
    // Not in red before the barista has been to it: a blank card is no mistake yet.
    expect(within(card).getByText('Needed: it names the profiles.')).toBeInTheDocument();
    expect(within(card).getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
    expect(confirmButton()).toBeDisabled();
  });

  it('marks the name in red once left blank, and confirms what was typed', async () => {
    const { onConfirm, card } = renderCard({ details: BLANK_BAG, source: 'typed' });
    const name = within(card).getByLabelText('Name');
    await userEvent.click(name);
    await userEvent.click(within(card).getByLabelText('Roaster'));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(name, 'Pink Bourbon');
    await userEvent.type(within(card).getByLabelText('Producer or farm'), 'El Paraíso');
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith({ ...BLANK_BAG, name: 'Pink Bourbon', producer: 'El Paraíso' });
  });

  it('keeps what is typed as a field is left, so it is kept before the barista turns to the chat or a tab', async () => {
    const onDraft = vi.fn();
    const { card } = renderCard({ details: BLANK_BAG, source: 'typed', onDraft });
    await userEvent.type(within(card).getByLabelText('Name'), 'Pink Bourbon');
    await userEvent.type(within(card).getByLabelText('Other details'), 'Thermal shock; a gift from Sam');
    await userEvent.click(document.body);
    expect(onDraft).toHaveBeenLastCalledWith({ ...BLANK_BAG, name: 'Pink Bourbon', other: 'Thermal shock; a gift from Sam' });
  });

  it('keeps what is typed half a second after the last change, a field still in hand', () => {
    vi.useFakeTimers();
    try {
      const onDraft = vi.fn();
      const { card } = renderCard({ details: BLANK_BAG, source: 'typed', onDraft });
      fireEvent.change(within(card).getByLabelText('Name'), { target: { value: 'Pink Bourbon' } });
      act(() => vi.advanceTimersByTime(499));
      expect(onDraft).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onDraft).toHaveBeenCalledWith({ ...BLANK_BAG, name: 'Pink Bourbon' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps what was typed last as the card goes, and comes back with it', async () => {
    const onDraft = vi.fn();
    const view = renderThemed(<BagConfirmCard details={BLANK_BAG} source="typed" confirmed={false} onConfirm={vi.fn()} onDraft={onDraft} />);
    await userEvent.type(screen.getByLabelText('Altitude'), '1,950 masl');
    view.unmount();
    const kept: unknown = onDraft.mock.lastCall?.[0];
    expect(kept).toEqual({ ...BLANK_BAG, altitude: '1,950 masl' });
    renderThemed(<BagConfirmCard details={kept as typeof BLANK_BAG} source="typed" confirmed={false} onConfirm={vi.fn()} />);
    expect(screen.getByLabelText('Altitude')).toHaveValue('1,950 masl');
  });

  it('keeps nothing that was not changed', () => {
    const onDraft = vi.fn();
    const view = renderThemed(<BagConfirmCard details={BLANK_BAG} source="typed" confirmed={false} onConfirm={vi.fn()} onDraft={onDraft} />);
    view.unmount();
    expect(onDraft).not.toHaveBeenCalled();
  });
});
