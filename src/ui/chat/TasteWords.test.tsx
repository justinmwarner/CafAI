// @vitest-environment jsdom
import './testing/setup.ts';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TID } from '../testIds.ts';
import { renderThemed } from './testing/render.tsx';
import { TastePrompts } from './TasteWords.tsx';

/** The prompts over a draft of their own, as the composer would hold it. */
function Harness({ initial, onDraft }: { initial: string; onDraft(next: string): void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <TastePrompts
        draft={draft}
        onDraft={(next) => {
          onDraft(next);
          setDraft(next);
        }}
      />
      <output data-testid="draft">{draft}</output>
    </>
  );
}

function setup(initial = '') {
  const onDraft = vi.fn();
  renderThemed(<Harness initial={initial} onDraft={onDraft} />);
  return { onDraft, draft: () => screen.getByTestId('draft').textContent };
}

const wordChip = (label: string) => screen.getByTestId(TID.tasteWord(label));

async function openWords() {
  await userEvent.click(screen.getByTestId(TID.tastePrompt));
  return screen.getByRole('region', { name: 'Taste words' });
}

describe('TastePrompts (D127)', () => {
  it('offers Taste words and Need help?, the words closed until asked for', () => {
    setup();
    const prompt = screen.getByTestId(TID.tastePrompt);
    expect(prompt).toHaveAccessibleName('Taste words');
    expect(prompt).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId(TID.tasteHelp)).toHaveAccessibleName('Need help?');
    expect(screen.queryByTestId(TID.tasteWords)).toBeNull();
  });

  it('opens the words one group of what to notice at a time, and closes them again', async () => {
    setup();
    const panel = await openWords();
    const prompt = screen.getByTestId(TID.tastePrompt);
    expect(prompt).toHaveAttribute('aria-expanded', 'true');
    expect(prompt).toHaveAttribute('aria-controls', panel.id);

    const tabs = within(panel).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Acidity', 'Sweetness', 'Bitterness', 'Body', 'Finish']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const words = () => within(within(panel).getByRole('tabpanel')).getAllByRole('button').map((chip) => chip.textContent);
    expect(within(panel).getByText('Does it make your mouth water?')).toBeInTheDocument();
    expect(words()).toEqual(['mild', 'bright', 'tangy', 'sharp', 'sour']);

    await userEvent.click(screen.getByTestId(TID.tasteGroup('body')));
    expect(within(panel).getByRole('tabpanel')).toHaveAccessibleName('Body');
    expect(within(panel).getByText('How heavy does it feel on your tongue?')).toBeInTheDocument();
    expect(words()).toEqual(['watery', 'thin', 'round', 'creamy', 'heavy']);

    await userEvent.click(prompt);
    expect(screen.queryByTestId(TID.tasteWords)).toBeNull();
    expect(prompt).toHaveAttribute('aria-expanded', 'false');
  });

  it('puts a tapped word in the draft and shows it chosen; a second tap takes it out', async () => {
    const { onDraft, draft } = setup();
    await openWords();
    await userEvent.click(wordChip('sharp'));
    expect(draft()).toBe('sharp');
    expect(wordChip('sharp')).toHaveAttribute('aria-pressed', 'true');
    expect(wordChip('sour')).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByTestId(TID.tasteGroup('finish')));
    await userEvent.click(wordChip('short'));
    expect(draft()).toBe('sharp, short finish');

    await userEvent.click(screen.getByTestId(TID.tasteGroup('acidity')));
    expect(wordChip('sharp')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(wordChip('sharp'));
    expect(draft()).toBe('short finish');
    expect(onDraft.mock.calls.map(([next]) => next)).toEqual(['sharp', 'sharp, short finish', 'short finish']);
  });

  it('adds a word after what the barista typed, and shows a word they typed on its own as chosen', async () => {
    const { draft } = setup('Quite sharp, thin');
    await openWords();
    expect(wordChip('sharp')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByTestId(TID.tasteGroup('body')));
    expect(wordChip('thin')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(wordChip('round'));
    expect(draft()).toBe('Quite sharp, thin, round');
  });

  it('teaches how to taste from Need help?: what to notice, no wrong answers, the last shot as the guide', async () => {
    setup();
    await userEvent.click(screen.getByTestId(TID.tasteHelp));
    const dialog = screen.getByRole('dialog', { name: 'How to taste' });
    for (const what of ['Acidity', 'Sweetness', 'Bitterness', 'Astringency', 'Body', 'Finish']) expect(dialog).toHaveTextContent(what);
    expect(dialog).toHaveTextContent('does it make your mouth water?');
    expect(dialog).toHaveTextContent('does your mouth feel dry or rough');
    expect(dialog).toHaveTextContent('how heavy does it feel on your tongue?');
    expect(dialog).toHaveTextContent('There are no wrong answers. Say what you notice, in any words.');
    expect(dialog).toHaveTextContent('Your last shot is the best guide: compare the two, and say what changed.');
    // How to taste, never what this coffee should taste like.
    expect(dialog).not.toHaveTextContent(/should taste|will taste|sweeter|chocolate|fruity/i);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the guidance with the words closed too, and leaves the draft alone', async () => {
    const { onDraft } = setup('sharp');
    await userEvent.click(screen.getByTestId(TID.tasteHelp));
    expect(screen.getByTestId(TID.tasteHelpDialog)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDraft).not.toHaveBeenCalled();
  });
});
