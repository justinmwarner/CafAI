// @vitest-environment jsdom
import './testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { TID } from '../testIds.ts';
import { createFakeServicesIn } from '../testing/temperatureServices.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { HistoryScreen } from '../history/HistoryScreen.tsx';
import { KIAMBU, KIAMBU_ITERATIONS, KIAMBU_VERSIONS, SANTOS } from './testing/fixtures.ts';
import { renderWithServices } from './testing/render.tsx';
import { DiffCard } from './parts/DiffCard.tsx';
import { OptionChips } from './parts/OptionChips.tsx';
import { TemplateCards } from './parts/TemplateCards.tsx';
import type { DiffPart } from './parts/types.ts';
import { RichText } from './RichText.tsx';

/**
 * The coach's words, and CafAI's own change lines, in the barista's unit
 * (D-TEMP-6): kept as written, read in °F once the barista chose it, and in
 * °C again after a switch back.
 */
const diff = (overrides: Partial<DiffPart> = {}): DiffPart => ({
  kind: 'diff',
  requestId: 'tu-1',
  summary: 'Raise brew temperature by 1 °C',
  lines: ['Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)'],
  manualSteps: [],
  rationale: 'You found it sour. Rounded 92.3 to 92.5 °C: brew temperature moves in steps of 0.5 °C.',
  expectedEffect: 'Hotter water extracts more; the group reads 1-3 °C under its target.',
  versionLabel: 'Kiambu AA v3',
  status: 'pending',
  error: null,
  ...overrides,
});

const handlers = () => ({ onConfirm: vi.fn(), onDecline: vi.fn(), onUndo: vi.fn() });

describe('the change card in °F', () => {
  it('writes its title, lines, why and what it changes in °F, a change without the 32', () => {
    renderWithServices(<DiffCard part={diff()} showUndo={false} {...handlers()} />, createFakeServicesIn('fahrenheit'));
    const card = screen.getByTestId(TID.diffCard);
    expect(within(card).getByRole('heading', { name: 'Raise brew temperature by 1.8 °F' })).toBeInTheDocument();
    expect(within(card).getByText('197.6 °F')).toHaveStyle({ textDecoration: 'line-through' });
    expect(within(card).getByText('199.4 °F (every step +1.8 °F)')).toBeInTheDocument();
    expect(card).toHaveTextContent('Rounded 198.1 to 198.5 °F: brew temperature moves in steps of 0.9 °F.');
    expect(card).toHaveTextContent('the group reads 1.8-5.4 °F under its target');
    expect(card).not.toHaveTextContent('°C');
  });

  it('reads the coach\'s °F words in °C again after a switch back, and CafAI\'s lines as they were kept', async () => {
    const part = diff({ summary: 'Raise brew temperature by 1.8 °F' });
    const { services } = renderWithServices(<DiffCard part={part} showUndo={false} {...handlers()} />, createFakeServicesIn('fahrenheit'));
    expect(screen.getByRole('heading', { name: 'Raise brew temperature by 1.8 °F' })).toBeInTheDocument();
    await act(() => services.temperatureUnit.set('celsius'));
    expect(screen.getByRole('heading', { name: 'Raise brew temperature by 1.0 °C' })).toBeInTheDocument();
    expect(screen.getByText('92.0 °C')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getByText('93.0 °C (every step +1.0 °C)')).toBeInTheDocument();
  });

  it('changes nothing for a barista on °C', () => {
    renderWithServices(<DiffCard part={diff()} showUndo={false} {...handlers()} />, createFakeServices());
    expect(screen.getByRole('heading', { name: 'Raise brew temperature by 1 °C' })).toBeInTheDocument();
    expect(screen.getByText('92.0 °C')).toBeInTheDocument();
    expect(screen.getByTestId(TID.diffCard)).not.toHaveTextContent('°F');
  });
});

describe("the coach's words elsewhere in °F", () => {
  it('in the chat, bold and all', () => {
    renderWithServices(<RichText text={"Let's go **1 °C hotter**: 93 °C, up from 92 °C."} />, createFakeServicesIn('fahrenheit'));
    expect(screen.getByText('1.8 °F hotter').tagName).toBe('STRONG');
    expect(document.body).toHaveTextContent("Let's go 1.8 °F hotter: 199 °F, up from 198 °F.");
  });

  it('in a question and its answers, the answer sent being the coach\'s own', () => {
    const onAnswer = vi.fn();
    renderWithServices(
      <OptionChips question="Try 94 °C next?" options={['Yes, 94 °C', 'No', 'Other']} multiSelect={false} answer={null} onAnswer={onAnswer} />,
      createFakeServicesIn('fahrenheit'),
    );
    expect(screen.getByText('Try 201 °F next?')).toBeInTheDocument();
    const chip = screen.getByTestId(TID.optionChip('Yes, 94 °C'));
    expect(chip).toHaveTextContent('Yes, 201 °F');
    chip.click();
    expect(onAnswer).toHaveBeenCalledWith(['Yes, 94 °C'], null);
  });

  it("in a starting profile's reason", () => {
    renderWithServices(
      <TemplateCards
        items={[{ templateId: 'blooming-espresso', name: 'Blooming Espresso', style: 'Blooming', shape: 'Bloom, then a flat pour', confidence: 'high', reason: 'Its 92 °C pour suits a light roast.' }]}
        pickedTemplateId={null}
        onPick={vi.fn()}
      />,
      createFakeServicesIn('fahrenheit'),
    );
    expect(screen.getByText('Its 198 °F pour suits a light roast.')).toBeInTheDocument();
  });

  it('in History: the change, its lines and what was proposed', async () => {
    const services = createFakeServicesIn('fahrenheit', { storage: { bags: [SANTOS, KIAMBU], versions: KIAMBU_VERSIONS, iterations: KIAMBU_ITERATIONS } });
    renderWithServices(<HistoryScreen bagId={KIAMBU.id} onSelectBag={vi.fn()} />, services);
    const v2 = await screen.findByTestId(TID.historyVersion(2));
    expect(v2).toHaveTextContent('Raise brew temperature by 1.8 °F');
    expect(within(v2).getByText('197.6 °F')).toHaveStyle({ textDecoration: 'line-through' });
    expect(v2).not.toHaveTextContent('°C');
  });
});
