// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { CoachUiMessage } from '../../../app/types.ts';
import { TID } from '../../testIds.ts';
import { ChatSurface } from '../ChatSurface.tsx';
import { renderWithServices } from '../testing/render.tsx';
import { SourcesLine } from './SourcesLine.tsx';

describe('SourcesLine (D203)', () => {
  it('names the sites the words above cite, as plain text', () => {
    renderWithServices(<SourcesLine sites={['onyxcoffeelab.com', 'sprudge.com']} />);
    const line = screen.getByTestId(TID.sourcesLine);
    expect(line).toHaveTextContent('Sources: onyxcoffeelab.com, sprudge.com');
    expect(line.querySelector('a')).toBeNull();
  });

  it('says Source for one site', () => {
    renderWithServices(<SourcesLine sites={['sca.coffee']} />);
    expect(screen.getByTestId(TID.sourcesLine)).toHaveTextContent('Source: sca.coffee');
  });

  it('shows under the coach words in the chat, never as raw data', () => {
    const reply: CoachUiMessage = {
      id: 'm-cited',
      role: 'assistant',
      parts: [
        { kind: 'text', text: 'Onyx publishes what it pays its farmers.' },
        { kind: 'sources', sites: ['onyxcoffeelab.com'] },
      ],
      createdAt: '2026-10-16T08:08:30.000Z',
    };
    renderWithServices(
      <ChatSurface
        messages={[reply]}
        busy={false}
        placeholder="Say how it tasted"
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
    const line = screen.getByTestId(TID.sourcesLine);
    expect(line).toHaveTextContent('Source: onyxcoffeelab.com');
    const words = screen.getByText('Onyx publishes what it pays its farmers.');
    expect(words.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId(TID.chat).querySelector('pre')).toBeNull();
  });
});
