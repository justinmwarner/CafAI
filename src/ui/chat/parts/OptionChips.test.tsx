// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TID } from '../../testIds.ts';
import { renderThemed } from '../testing/render.tsx';
import { OptionChips } from './OptionChips.tsx';

const OPTIONS = ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Other'];

function setup(props: Partial<Parameters<typeof OptionChips>[0]> = {}) {
  const onAnswer = vi.fn();
  renderThemed(
    <OptionChips question="How did it taste?" options={OPTIONS} multiSelect={false} answer={null} onAnswer={onAnswer} {...props} />,
  );
  return onAnswer;
}

const chipLabels = () =>
  Array.from(document.querySelectorAll('[data-testid^="option-"]')).map((el) => el.textContent);

describe('OptionChips', () => {
  it('shows the question and the options with Other last', () => {
    setup({ options: ['Other', 'Sour / sharp', 'Bitter / harsh'] });
    expect(screen.getByText('How did it taste?')).toBeInTheDocument();
    expect(chipLabels()).toEqual(['Sour / sharp', 'Bitter / harsh', 'Other']);
    expect(screen.getByTestId(TID.optionChip('Sour / sharp'))).toBeInTheDocument();
  });

  it('adds Other when the list lacks it', () => {
    setup({ options: ['Sour / sharp', 'Bitter / harsh'] });
    expect(chipLabels()).toEqual(['Sour / sharp', 'Bitter / harsh', 'Other']);
  });

  it('answers a single-select question on the first tap', async () => {
    const onAnswer = setup();
    expect(screen.queryByTestId(TID.optionsSubmit)).toBeNull();
    await userEvent.click(screen.getByTestId(TID.optionChip('Bitter / harsh')));
    expect(onAnswer).toHaveBeenCalledWith(['Bitter / harsh'], null);
  });

  it('opens a text field for Other and sends what was typed', async () => {
    const onAnswer = setup();
    expect(screen.queryByTestId(TID.otherInput)).toBeNull();
    await userEvent.click(screen.getByTestId(TID.optionChip('Other')));
    const input = screen.getByTestId(TID.otherInput);
    const send = screen.getByTestId(TID.optionsSubmit);
    expect(send).toBeDisabled();
    await userEvent.type(input, '  Sweet but hollow ');
    await userEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith(['Other'], 'Sweet but hollow');
  });

  it('sends Other with the Enter key', async () => {
    const onAnswer = setup();
    await userEvent.click(screen.getByTestId(TID.optionChip('Other')));
    await userEvent.type(screen.getByTestId(TID.otherInput), 'Salty{Enter}');
    expect(onAnswer).toHaveBeenCalledWith(['Other'], 'Salty');
  });

  it('toggles multi-select answers and sends them in listed order', async () => {
    const onAnswer = setup({ multiSelect: true });
    const send = screen.getByTestId(TID.optionsSubmit);
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByTestId(TID.optionChip('Balanced, sweet')));
    await userEvent.click(screen.getByTestId(TID.optionChip('Sour / sharp')));
    await userEvent.click(screen.getByTestId(TID.optionChip('Bitter / harsh')));
    await userEvent.click(screen.getByTestId(TID.optionChip('Bitter / harsh')));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByTestId(TID.optionChip('Sour / sharp'))).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId(TID.optionChip('Bitter / harsh'))).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith(['Sour / sharp', 'Balanced, sweet'], null);
  });

  it('includes Other and its text in a multi-select answer', async () => {
    const onAnswer = setup({ multiSelect: true });
    await userEvent.click(screen.getByTestId(TID.optionChip('Sour / sharp')));
    await userEvent.click(screen.getByTestId(TID.optionChip('Other')));
    expect(screen.getByTestId(TID.optionsSubmit)).toBeDisabled();
    await userEvent.type(screen.getByTestId(TID.otherInput), 'thin');
    await userEvent.click(screen.getByTestId(TID.optionsSubmit));
    expect(onAnswer).toHaveBeenCalledWith(['Sour / sharp', 'Other'], 'thin');
  });

  it('shows the answer and accepts no more taps once answered', async () => {
    const onAnswer = setup({ answer: { selected: ['Other'], otherText: 'Like tea' } });
    expect(screen.getByText('Other: “Like tea”')).toBeInTheDocument();
    expect(screen.getByTestId(TID.optionChip('Other'))).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId(TID.optionChip('Sour / sharp'))).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId(TID.optionsSubmit)).toBeNull();
    expect(screen.queryByTestId(TID.otherInput)).toBeNull();
    await userEvent.click(screen.getByTestId(TID.optionChip('Other')));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('ignores taps while the coach is busy', async () => {
    const onAnswer = setup({ disabled: true });
    await userEvent.click(screen.getByTestId(TID.optionChip('Sour / sharp')), { pointerEventsCheck: 0 });
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
