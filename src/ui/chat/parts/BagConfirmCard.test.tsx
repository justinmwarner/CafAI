// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Box from '@mui/material/Box';
import { TID } from '../../testIds.ts';
import { fadedElements, renderThemed } from '../testing/render.tsx';
import { previewTheme } from '../testing/previewTheme.ts';
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
  });

  it('confirms the details as they were fixed, a cleared field as unknown', async () => {
    const { onConfirm, card } = renderCard();
    const name = within(card).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Kiambu AA Peaberry ');
    await userEvent.clear(within(card).getByLabelText('Origin'));
    await userEvent.selectOptions(within(card).getByLabelText('Roast level'), 'medium-light');
    fireEvent.change(within(card).getByLabelText('Roast date'), { target: { value: '2026-09-30' } });
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Kiambu AA Peaberry',
      roaster: 'Square Mile',
      origin: null,
      roastLevel: 'medium-light',
      process: 'washed',
      notes: 'blackcurrant, grapefruit, brown sugar',
      roastDate: '2026-09-30',
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
  });

  it('once confirmed, shows the details as text, marked confirmed, with nothing left to edit', () => {
    const { card } = renderCard({ confirmed: true });
    expect(within(card).queryAllByRole('textbox')).toEqual([]);
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(card).getByText('Kiambu AA')).toBeInTheDocument();
    expect(within(card).getByText('Square Mile · Kenya, Kiambu · washed · light roast · Roasted 28 Sep 2026')).toBeInTheDocument();
    expect(within(card).getByText('Tasting notes: blackcurrant, grapefruit, brown sugar')).toBeInTheDocument();
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
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
    expect(fields.map(label)).toEqual(['Name', 'Roaster', 'Origin', 'Process', 'Roast level', 'Roast date', 'Tasting notes']);
    for (const field of fields) expect(getComputedStyle(field).boxSizing, label(field)).toBe('content-box');
  });
});
