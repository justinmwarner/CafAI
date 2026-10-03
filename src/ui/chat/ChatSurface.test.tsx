// @vitest-environment jsdom
import './testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachUiMessage } from '../../app/types.ts';
import { TID } from '../testIds.ts';
import { ChatSurface, latestAppliedDiffId, toChatMessages, type ChatSurfaceProps } from './ChatSurface.tsx';
import { conversation } from './testing/fixtures.ts';
import { renderThemed } from './testing/render.tsx';

function textMessage(id: string, role: CoachUiMessage['role'], text: string, streaming = false): CoachUiMessage {
  return { id, role, parts: [{ kind: 'text', text, ...(streaming ? { streaming } : {}) }], createdAt: '2026-10-03T08:00:00.000Z' };
}

function renderSurface(props: Partial<ChatSurfaceProps> = {}) {
  const handlers = {
    onSend: vi.fn(),
    onPickTemplate: vi.fn(),
    onAnswerOptions: vi.fn(),
    onConfirm: vi.fn(),
    onDecline: vi.fn(),
    onUndo: vi.fn(),
  };
  const all: ChatSurfaceProps = {
    messages: conversation('diff'),
    busy: false,
    placeholder: 'Ask the coach',
    canUndo: false,
    ...handlers,
    ...props,
  };
  const result = renderThemed(<ChatSurface {...all} />);
  const rerender = (next: Partial<ChatSurfaceProps>) => result.rerender(<ChatSurface {...all} {...next} />);
  return { ...result, handlers, rerender };
}

describe('ChatSurface', () => {
  it('renders the messages in order', () => {
    renderSurface({
      messages: [
        textMessage('a', 'assistant', 'First from the coach'),
        textMessage('b', 'user', 'Second, typed by me'),
        textMessage('c', 'assistant', 'Third from the coach'),
      ],
    });
    const texts = screen.getAllByText(/First from|Second, typed|Third from/).map((el) => el.textContent);
    expect(texts).toEqual(['First from the coach', 'Second, typed by me', 'Third from the coach']);
    expect(screen.getByTestId(TID.chat)).toBeInTheDocument();
  });

  it('renders every part kind through the cafai part components', () => {
    renderSurface({ messages: conversation('applied') });
    expect(screen.getByTestId(TID.templateCard('blooming-espresso'))).toBeInTheDocument();
    expect(screen.getByTestId(TID.shotCard)).toBeInTheDocument();
    expect(screen.getByTestId(TID.optionChip('Sour / sharp'))).toBeInTheDocument();
    expect(screen.getByTestId(TID.diffCard)).toBeInTheDocument();
    expect(screen.getByText('Kiambu AA v1 is on the machine.')).toBeInTheDocument();
  });

  it('sends typed text with Enter and with the send button', async () => {
    const { handlers } = renderSurface();
    const input = screen.getByTestId(TID.composerInput);
    expect(input.tagName).toBe('TEXTAREA');
    expect(input).toHaveAttribute('placeholder', 'Ask the coach');
    await userEvent.type(input, 'Kenya, washed{Enter}');
    await waitFor(() => expect(handlers.onSend).toHaveBeenCalledWith('Kenya, washed'));

    await userEvent.type(screen.getByTestId(TID.composerInput), 'Why the bloom?');
    await userEvent.click(screen.getByTestId(TID.composerSend));
    await waitFor(() => expect(handlers.onSend).toHaveBeenLastCalledWith('Why the bloom?'));
  });

  it('keeps typing allowed but blocks sending while busy', async () => {
    const { handlers } = renderSurface({ busy: true });
    const input = screen.getByTestId(TID.composerInput);
    expect(input).toBeEnabled();
    await userEvent.type(input, 'Is it done?{Enter}');
    expect(input).toHaveValue('Is it done?');
    expect(screen.getByTestId(TID.composerSend)).toBeDisabled();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('blocks sending when input is disabled, then sends the kept draft once enabled', async () => {
    const { handlers, rerender } = renderSurface({ inputDisabled: true });
    await userEvent.type(screen.getByTestId(TID.composerInput), 'Hello{Enter}');
    expect(handlers.onSend).not.toHaveBeenCalled();
    rerender({ inputDisabled: false });
    await userEvent.click(screen.getByTestId(TID.composerSend));
    await waitFor(() => expect(handlers.onSend).toHaveBeenCalledWith('Hello'));
  });

  it('has no attach button or file input', () => {
    renderSurface();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull();
  });

  it('reports a template pick with its request id', async () => {
    const { handlers } = renderSurface({ messages: conversation('templates') });
    await userEvent.click(screen.getByTestId(TID.templatePick('d-flow')));
    expect(handlers.onPickTemplate).toHaveBeenCalledWith('tu-templates', 'd-flow');
  });

  it('reports an option answer with its request id', async () => {
    const { handlers } = renderSurface({ messages: conversation('options') });
    await userEvent.click(screen.getByTestId(TID.optionChip('Sour / sharp')));
    expect(handlers.onAnswerOptions).toHaveBeenCalledWith('tu-ask', ['Sour / sharp'], null);
  });

  it('reports Confirm and Not now with the request id', async () => {
    const { handlers } = renderSurface({ messages: conversation('diff') });
    await userEvent.click(screen.getByTestId(TID.diffConfirm));
    await userEvent.click(screen.getByTestId(TID.diffCancel));
    expect(handlers.onConfirm).toHaveBeenCalledWith('tu-adjust');
    expect(handlers.onDecline).toHaveBeenCalledWith('tu-adjust');
  });

  it('blocks card taps while busy', () => {
    renderSurface({ messages: conversation('diff'), busy: true });
    expect(screen.getByTestId(TID.diffConfirm)).toBeDisabled();
  });

  it('offers Undo only on the latest applied card, and only when undo is possible', async () => {
    const applied = conversation('applied');
    const older = applied.map((m) =>
      m.parts.some((p) => p.kind === 'diff')
        ? { ...m, id: 'older', parts: m.parts.map((p) => (p.kind === 'diff' ? { ...p, requestId: 'tu-old' } : p)) }
        : m,
    );
    const messages = [...older.filter((m) => m.id === 'older'), ...applied];
    const { handlers, rerender } = renderSurface({ messages, canUndo: true });
    const cards = screen.getAllByTestId(TID.diffCard);
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).queryByTestId(TID.diffUndo)).toBeNull();
    await userEvent.click(within(cards[1]!).getByTestId(TID.diffUndo));
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);

    rerender({ messages, canUndo: false });
    expect(screen.queryByTestId(TID.diffUndo)).toBeNull();
  });

  it('never turns model text into HTML', () => {
    renderSurface({
      messages: [textMessage('a', 'assistant', '<img src=x onerror="alert(1)"> **Grind finer** [site](https://example.com)')],
    });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a[href]')).toBeNull();
    expect(screen.getByText('Grind finer').tagName).toBe('STRONG');
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
  });

  it('shows a thinking row while busy until text starts streaming', () => {
    const base = [textMessage('a', 'user', 'Kenya, washed')];
    const { rerender } = renderSurface({ messages: base, busy: true });
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    rerender({ messages: [...base, textMessage('b', 'assistant', 'Lovely', true)], busy: true });
    expect(screen.queryByText('Thinking…')).toBeNull();
    expect(screen.getByText('Lovely')).toBeInTheDocument();
    rerender({ messages: [...base, textMessage('b', 'assistant', 'Lovely')], busy: false });
    expect(screen.queryByText('Thinking…')).toBeNull();
  });
});

describe('toChatMessages', () => {
  it('maps text to text parts and everything else to data parts', () => {
    const [first, second] = toChatMessages(
      [textMessage('a', 'assistant', 'Hi', true), ...conversation('templates').slice(2, 3)],
      false,
    );
    expect(first).toMatchObject({ id: 'a', role: 'assistant', status: 'streaming', parts: [{ type: 'text', text: 'Hi', state: 'streaming' }] });
    expect(second?.parts.map((p) => p.type)).toEqual(['text', 'data-cafai-templates']);
  });

  it('reuses the mapped object of an unchanged message', () => {
    const messages = conversation('diff');
    const a = toChatMessages(messages, false);
    const b = toChatMessages([...messages], false);
    expect(b[0]).toBe(a[0]);
  });

  it('appends a thinking row only while busy and nothing streams', () => {
    const idle = [textMessage('a', 'user', 'Hi')];
    expect(toChatMessages(idle, true).map((m) => m.id)).toEqual(['a', 'cafai-thinking']);
    expect(toChatMessages(idle, false).map((m) => m.id)).toEqual(['a']);
    expect(toChatMessages([...idle, textMessage('b', 'assistant', 'Hel', true)], true).map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('latestAppliedDiffId', () => {
  it('finds the most recent applied diff', () => {
    expect(latestAppliedDiffId(conversation('applied'))).toBe('tu-adjust');
    expect(latestAppliedDiffId(conversation('diff'))).toBeNull();
  });
});
