// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TID } from '../../testIds.ts';
import { renderThemed } from '../testing/render.tsx';
import { TEMPLATE_ITEMS } from '../testing/fixtures.ts';
import { TemplateCards } from './TemplateCards.tsx';

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

  it('blocks taps while the coach is busy', () => {
    renderThemed(<TemplateCards items={TEMPLATE_ITEMS} pickedTemplateId={null} disabled onPick={() => {}} />);
    for (const item of TEMPLATE_ITEMS) expect(screen.getByTestId(TID.templatePick(item.templateId))).toBeDisabled();
  });
});
