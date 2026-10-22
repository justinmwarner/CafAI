// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { CoachUiMessage } from '../../../app/types.ts';
import { buildPalette, namedTint } from '../../palette.ts';
import { createFakeServicesIn } from '../../testing/temperatureServices.ts';
import { TID } from '../../testIds.ts';
import { createCafaiTheme } from '../../theme.ts';
import { ChatSurface } from '../ChatSurface.tsx';
import { conversation } from '../testing/fixtures.ts';
import { fadedElements, renderWithServices } from '../testing/render.tsx';
import { FactCard } from './FactCard.tsx';

const SL28 = "Kenya's SL28 was selected at Scott Agricultural Laboratories in the 1930s for its drought tolerance.";

const card = () => screen.getByTestId(TID.factCard);

describe('FactCard (D202)', () => {
  it('says "Fun fact", then the fact, then the site it was checked against', () => {
    renderWithServices(<FactCard text={SL28} source="worldcoffeeresearch.org" />);
    expect(card().textContent).toBe(`Fun fact${SL28}Source: worldcoffeeresearch.org`);
  });

  it('has no source line when there is no site to show', () => {
    renderWithServices(<FactCard text={SL28} source={null} />);
    expect(card().textContent).toBe(`Fun fact${SL28}`);
  });

  it('is text to read: no link, no button, no icon, a site name never a link either', () => {
    renderWithServices(<FactCard text="The [SCA](https://sca.coffee) explains it at https://sca.coffee/research." source="sca.coffee" />);
    expect(card().querySelector('a')).toBeNull();
    expect(within(card()).queryByRole('link')).toBeNull();
    expect(within(card()).queryByRole('button')).toBeNull();
    expect(card().querySelector('svg')).toBeNull();
    expect(card()).toHaveTextContent('Source: sca.coffee');
  });

  it("reads the fact through the coach's own text rules: light formatting, never HTML", () => {
    renderWithServices(<FactCard text={'<img src=x onerror="alert(1)"> **SL28** and *SL34* came from one lab.'} source={null} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('SL28').tagName).toBe('STRONG');
    expect(screen.getByText('SL34').tagName).toBe('EM');
    expect(card()).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it("writes a temperature in the barista's unit (D176), and follows a change of it", async () => {
    const { services } = renderWithServices(
      <FactCard text="A light roast is often dropped near 205 °C." source="sca.coffee" />,
      createFakeServicesIn('fahrenheit'),
    );
    expect(card()).toHaveTextContent('A light roast is often dropped near 401 °F.');
    expect(card()).not.toHaveTextContent('°C');
    await act(() => services.temperatureUnit.set('celsius'));
    expect(card()).toHaveTextContent('A light roast is often dropped near 205 °C.');
  });

  it('draws only the pairs the contrast sweep checks, in dark and in light: ink and ink-muted on the surface, nothing faded, no accent', () => {
    for (const mode of ['dark', 'light'] as const) {
      const theme = createCafaiTheme(buildPalette(mode, namedTint('crema')));
      const { unmount } = renderWithServices(
        <ThemeProvider theme={theme}>
          <FactCard text={SL28} source="sca.coffee" />
        </ThemeProvider>,
      );
      expect(card(), mode).toHaveStyle({ backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary });
      expect(screen.getByText('Fun fact'), mode).toHaveStyle({ color: theme.palette.text.secondary });
      expect(screen.getByText('Source: sca.coffee'), mode).toHaveStyle({ color: theme.palette.text.secondary });
      expect(fadedElements(card()), mode).toEqual([]);
      for (const element of [card(), ...card().querySelectorAll<HTMLElement>('*')]) {
        expect(element, mode).not.toHaveStyle({ color: theme.palette.primary.main });
        expect(element, mode).not.toHaveStyle({ backgroundColor: theme.palette.primary.main });
      }
      unmount();
    }
  });
});

describe('ChatSurface: a fun fact in the chat (D202)', () => {
  const fact: CoachUiMessage = {
    id: 'm-fact',
    role: 'assistant',
    parts: [{ kind: 'fact', text: SL28, topic: 'variety', source: 'worldcoffeeresearch.org' }],
    createdAt: '2026-10-16T08:08:30.000Z',
  };
  // The shot, the coach's line on it, then the fact, then the taste question: the order the engine gives them.
  const thread = conversation('options');
  const messages = [...thread.slice(0, -1), fact, thread.at(-1)!];

  function renderChat() {
    return renderWithServices(
      <ChatSurface
        messages={messages}
        busy={false}
        placeholder="Tap an answer, or say how it tasted"
        canUndo={false}
        onSend={vi.fn()}
        onPickTemplate={vi.fn()}
        onAnswerOptions={vi.fn()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
        onUndo={vi.fn()}
        onRateShot={vi.fn()}
      />,
    );
  }

  it("shows a fact part as its block, in a row of its own between the coach's line and the taste question", () => {
    renderChat();
    const block = card();
    expect(block).toHaveTextContent(`Fun fact${SL28}Source: worldcoffeeresearch.org`);
    const row = block.closest<HTMLElement>('[role="article"]')!;
    expect(row).not.toHaveTextContent('Got it');
    expect(within(row).queryByTestId(TID.optionChip('Balanced, sweet'))).toBeNull();
    const line = screen.getByText('Got it: 27.8 s, 36.4 g out.');
    expect(line.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(screen.getByTestId(TID.optionChip('Balanced, sweet'))) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never shows a fact as x-chat's raw data, the way a build without its block would", () => {
    renderChat();
    expect(screen.getByTestId(TID.chat).querySelector('pre')).toBeNull();
    expect(screen.getByTestId(TID.chat)).not.toHaveTextContent('"kind"');
  });
});
