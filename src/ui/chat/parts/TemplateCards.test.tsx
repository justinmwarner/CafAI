// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TID } from '../../testIds.ts';
import { fadedElements, renderThemed } from '../testing/render.tsx';
import { previewTheme } from '../testing/previewTheme.ts';
import { TEMPLATE_ITEMS } from '../testing/fixtures.ts';
import { TemplateCards } from './TemplateCards.tsx';

const { palette } = previewTheme;
const chipOf = (card: HTMLElement, label: string) => within(card).getByText(label).closest<HTMLElement>('.MuiChip-root')!;

describe('TemplateCards', () => {
  it('shows each suggestion with its style, shape, confidence and reason', () => {
    renderThemed(<TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId={null} onPick={() => {}} />);
    const card = screen.getByTestId(TID.templateCard('blooming-espresso'));
    expect(within(card).getByText('Blooming Espresso')).toBeInTheDocument();
    expect(within(card).getByText('Blooming · Fill, 30 s bloom, flat 2.2 ml/s flow')).toBeInTheDocument();
    expect(within(card).getByText('High confidence')).toBeInTheDocument();
    expect(within(card).getByText(/long bloom and a gentle flow/)).toBeInTheDocument();
    expect(within(screen.getByTestId(TID.templateCard('londonium'))).getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('reports the tapped template', async () => {
    const onPick = vi.fn();
    renderThemed(<TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId={null} onPick={onPick} />);
    await userEvent.click(screen.getByTestId(TID.templatePick('d-flow')));
    expect(onPick).toHaveBeenCalledWith('d-flow');
  });

  it('marks the pick and disables the others', async () => {
    const onPick = vi.fn();
    renderThemed(<TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId="blooming-espresso" onPick={onPick} />);
    const picked = screen.getByTestId(TID.templateCard('blooming-espresso'));
    expect(within(picked).getByText('In use')).toBeInTheDocument();
    expect(picked).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByTestId(TID.templatePick('blooming-espresso'))).toBeNull();
    expect(screen.getByTestId(TID.templatePick('d-flow'))).toBeDisabled();
    expect(screen.getByTestId(TID.templatePick('londonium'))).toBeDisabled();
  });

  it('sets the others aside in the muted ink at full strength, their chips without colour, never faded', () => {
    renderThemed(<TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId="blooming-espresso" onPick={() => {}} />);
    for (const [id, chip] of [
      ['d-flow', 'Medium confidence'],
      ['londonium', 'Low confidence'],
    ] as const) {
      const card = screen.getByTestId(TID.templateCard(id));
      expect(fadedElements(card)).toEqual([]);
      // The name and the reason take the card's muted ink.
      expect(card).toHaveStyle({ color: palette.text.secondary });
      expect(chipOf(card, chip)).toHaveStyle({ color: palette.text.secondary, borderColor: palette.divider });
    }
    // The pick keeps its ink and its chip's colour.
    const picked = screen.getByTestId(TID.templateCard('blooming-espresso'));
    expect(fadedElements(picked)).toEqual([]);
    expect(picked).toHaveStyle({ color: palette.text.primary });
    expect(chipOf(picked, 'High confidence')).toHaveStyle({ color: palette.success.main, borderColor: palette.success.main });
  });

  it('sets every card aside the same way when the suggestions expire unpicked', () => {
    renderThemed(<TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId={null} expired setAsideReason="typed" onPick={() => {}} />);
    const card = screen.getByTestId(TID.templateCard('blooming-espresso'));
    expect(fadedElements(card)).toEqual([]);
    expect(card).toHaveStyle({ color: palette.text.secondary });
    expect(chipOf(card, 'High confidence')).toHaveStyle({ color: palette.text.secondary, borderColor: palette.divider });
  });

  it('blocks taps while the coach is busy', () => {
    renderThemed(<TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId={null} disabled onPick={() => {}} />);
    for (const item of TEMPLATE_ITEMS) expect(screen.getByTestId(TID.templatePick(item.templateId))).toBeDisabled();
  });

  it.each<[Parameters<typeof TemplateCards>[0]['setAsideReason'], string]>([
    ['typed', 'Set aside: you replied in the chat instead. Ask the coach to suggest again.'],
    ['undo', 'Set aside when you tapped Undo. Ask the coach to suggest again.'],
    ['shot', 'Set aside: a new shot came in. Ask the coach to suggest again.'],
    ['other', 'Set aside: the conversation moved on. Ask the coach to suggest again.'],
    // A chat stored before CafAI recorded why.
    [undefined, 'Set aside: the conversation moved on. Ask the coach to suggest again.'],
  ])('says why the suggestions were set aside (%s)', (reason, text) => {
    renderThemed(
      <TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId={null} expired {...(reason ? { setAsideReason: reason } : {})} onPick={() => {}} />,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
    for (const item of TEMPLATE_ITEMS) expect(screen.getByTestId(TID.templatePick(item.templateId))).toBeDisabled();
  });
});
