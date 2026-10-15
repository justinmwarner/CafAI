// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TDS_NOT_A_NUMBER, TDS_TOO_HIGH, withTds } from '../../../coach/extraction.ts';
import type { ShotSummary } from '../../../coach/types.ts';
import { TID } from '../../testIds.ts';
import { renderThemed } from '../testing/render.tsx';
import { sampleSummary } from '../testing/fixtures.ts';
import { ShotCard } from './ShotCard.tsx';
import { fieldHelp } from './ShotTds.tsx';

/** A shot card that takes a TDS: 18.0 g in, 36.4 g out. */
function card(summary: ShotSummary = sampleSummary(), options: { busy?: boolean } = {}) {
  const onSaveTds = vi.fn();
  const view = renderThemed(<ShotCard summary={summary} onRate={vi.fn()} disabled={options.busy} onSaveTds={onSaveTds} />);
  return { ...view, onSaveTds };
}

const field = () => screen.getByRole('textbox', { name: 'TDS' });
const button = (name: string) => screen.getByRole('button', { name });

describe('ShotTds: the TDS cell and its field (D-TDS-1, D-TDS-3)', () => {
  it('offers Add in one quiet cell among the numbers, and opens a field with the decimal keyboard, focused', async () => {
    card();
    const add = button('Add TDS');
    expect(add).toHaveAttribute('data-testid', TID.tdsCell);
    expect(add).toHaveTextContent('TDSAdd');
    expect(add).toHaveAttribute('aria-expanded', 'false');
    // In the card's grid of numbers, after First drop.
    expect(add.parentElement).toBe(screen.getByText('First drop').parentElement!.parentElement);
    await userEvent.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    const input = field();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('enterkeyhint', 'done');
    expect(input).toHaveAttribute('maxlength', '8');
    expect(input).toHaveValue('');
    // What to type, where the EY comes from, and when the coach hears it.
    expect(input).toHaveAccessibleDescription(fieldHelp(sampleSummary()));
    expect(fieldHelp(sampleSummary())).toBe(
      "What your refractometer reads. CafAI works out the EY from this shot's 18.0 g dose and 36.4 g yield, and the coach gets both with your next tap or message.",
    );
  });

  it('saves a reading typed with a comma, closes, and gives the cell back the focus', async () => {
    const { onSaveTds } = card();
    await userEvent.click(button('Add TDS'));
    await userEvent.type(field(), '9,25');
    await userEvent.click(button('Save'));
    expect(onSaveTds).toHaveBeenCalledWith(9.25);
    expect(screen.queryByRole('textbox', { name: 'TDS' })).toBeNull();
    expect(button('Add TDS')).toHaveFocus();
  });

  it('saves on Enter, the keyboard’s Done', async () => {
    const { onSaveTds } = card();
    await userEvent.click(button('Add TDS'));
    await userEvent.type(field(), '9.3{Enter}');
    expect(onSaveTds).toHaveBeenCalledWith(9.3);
  });

  it('closes on Cancel or Escape and saves nothing; leaving the field keeps the draft', async () => {
    const { onSaveTds } = card();
    await userEvent.click(button('Add TDS'));
    await userEvent.type(field(), '9.3');
    await userEvent.tab();
    expect(field()).toHaveValue('9.3');
    await userEvent.click(button('Cancel'));
    expect(screen.queryByRole('textbox', { name: 'TDS' })).toBeNull();
    await userEvent.click(button('Add TDS'));
    expect(field()).toHaveValue('');
    await userEvent.type(field(), '9.3{Escape}');
    expect(screen.queryByRole('textbox', { name: 'TDS' })).toBeNull();
    expect(onSaveTds).not.toHaveBeenCalled();
  });

  it('says why a typed TDS is not one, in the error colour, and saves nothing until it is', async () => {
    const { onSaveTds } = card();
    await userEvent.click(button('Add TDS'));
    await userEvent.type(field(), '30');
    await userEvent.click(button('Save'));
    expect(screen.getByRole('alert')).toHaveTextContent(TDS_TOO_HIGH);
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(field());
    await userEvent.type(field(), 'nine{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(TDS_NOT_A_NUMBER);
    expect(onSaveTds).not.toHaveBeenCalled();
    // Typing again takes the message away.
    await userEvent.clear(field());
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.type(field(), '9.25{Enter}');
    expect(onSaveTds).toHaveBeenCalledWith(9.25);
  });

  it('closes on an empty field saved, with nothing to remove', async () => {
    const { onSaveTds } = card();
    await userEvent.click(button('Add TDS'));
    await userEvent.click(button('Save'));
    expect(screen.queryByRole('textbox', { name: 'TDS' })).toBeNull();
    expect(onSaveTds).not.toHaveBeenCalled();
  });
});

describe('ShotTds: a reading (D-TDS-2, D-TDS-8)', () => {
  const read = (tdsPct: number, fields: Partial<ShotSummary> = {}) => withTds(sampleSummary(fields), tdsPct);

  it("shows the TDS to 0.01 and the EY to 0.1 among the card's numbers, on a row of their own", () => {
    card(read(9.25));
    const tds = button('TDS 9.25 %, change it');
    expect(tds).toHaveTextContent('TDS9.25 %');
    // 9.25 % x 36.4 g / 18.0 g = 18.7 %.
    expect(screen.getByTestId(TID.tdsEy)).toHaveTextContent('EY18.7 %');
    expect(screen.queryByRole('button', { name: 'Add TDS' })).toBeNull();
    expect(screen.queryByTestId(TID.tdsNote)).toBeNull();
  });

  it('opens the field on the reading to change it, or to remove it', async () => {
    const { onSaveTds } = card(read(9.25));
    await userEvent.click(button('TDS 9.25 %, change it'));
    expect(field()).toHaveValue('9.25');
    await userEvent.clear(field());
    await userEvent.type(field(), '9.6{Enter}');
    expect(onSaveTds).toHaveBeenLastCalledWith(9.6);

    await userEvent.click(button('TDS 9.25 %, change it'));
    await userEvent.click(button('Remove'));
    expect(onSaveTds).toHaveBeenLastCalledWith(null);

    // Emptied and saved removes it too; the same reading again sends nothing.
    await userEvent.click(button('TDS 9.25 %, change it'));
    await userEvent.clear(field());
    await userEvent.click(button('Save'));
    expect(onSaveTds).toHaveBeenLastCalledWith(null);
    onSaveTds.mockClear();
    await userEvent.click(button('TDS 9.25 %, change it'));
    await userEvent.click(button('Save'));
    expect(onSaveTds).not.toHaveBeenCalled();
  });

  it('says why there is no EY, with a dash for it', () => {
    let view = card(read(9.25, { yieldG: null }));
    expect(screen.getByTestId(TID.tdsEy)).toHaveTextContent('EY–');
    expect(screen.getByTestId(TID.tdsNote)).toHaveTextContent('No EY: this shot has no yield from the scale.');
    view.unmount();
    view = card(read(9.25, { doseG: null }));
    expect(screen.getByTestId(TID.tdsNote)).toHaveTextContent('No EY: Decaid had no dose for this shot.');
    view.unmount();
    card(read(9.25, { doseG: null, yieldG: null }));
    expect(screen.getByTestId(TID.tdsNote)).toHaveTextContent('No EY: this shot has no dose or yield.');
    expect(fieldHelp({ doseG: 18, yieldG: null })).toBe(
      'What your refractometer reads. This shot has no yield from the scale, so there is no EY; the coach gets the TDS with your next tap or message.',
    );
  });

  it('warns of an EY no coffee gives, and keeps the reading as typed', () => {
    // 16.5 % x 36.4 g / 18.0 g = 33.4 %.
    card(read(16.5));
    expect(screen.getByTestId(TID.tdsEy)).toHaveTextContent('EY33.4 %');
    expect(screen.getByTestId(TID.tdsNote)).toHaveTextContent('An EY of 33.4 % is more than coffee gives up. Check the TDS, and the dose in Decaid.');
  });
});

describe('ShotTds: while the coach works, and without a handler', () => {
  it('holds Save and Remove while the coach works, never the typing; Enter waits too', async () => {
    const { onSaveTds } = card(withTds(sampleSummary(), 9.25), { busy: true });
    await userEvent.click(button('TDS 9.25 %, change it'));
    expect(field()).toBeEnabled();
    expect(button('Save')).toBeDisabled();
    expect(button('Remove')).toBeDisabled();
    expect(button('Cancel')).toBeEnabled();
    await userEvent.clear(field());
    await userEvent.type(field(), '9.4{Enter}');
    expect(onSaveTds).not.toHaveBeenCalled();
    // The draft waits in the field.
    expect(field()).toHaveValue('9.4');
  });

  it('only shows a reading it has, with no Add and no buttons, without a handler', () => {
    const view = renderThemed(<ShotCard summary={sampleSummary()} />);
    expect(screen.queryByTestId(TID.tdsCell)).toBeNull();
    view.unmount();
    renderThemed(<ShotCard summary={withTds(sampleSummary(), 9.25)} />);
    const cell = screen.getByTestId(TID.tdsCell);
    expect(cell).toHaveTextContent('TDS9.25 %');
    expect(within(screen.getByTestId(TID.shotCard)).queryByRole('button', { name: /TDS/ })).toBeNull();
    expect(screen.getByTestId(TID.tdsEy)).toHaveTextContent('EY18.7 %');
  });
});
