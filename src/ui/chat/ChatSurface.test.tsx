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

function progressMessage(id: string, text: string, value: number | null, label: string | null): CoachUiMessage {
  return {
    id,
    role: 'system',
    parts: [{ kind: 'notice', tone: 'info', text, progress: { value, label } }],
    createdAt: '2026-10-03T08:00:00.000Z',
  };
}

function renderSurface(props: Partial<ChatSurfaceProps> = {}) {
  const handlers = {
    onSend: vi.fn(),
    onPickTemplate: vi.fn(),
    onAnswerOptions: vi.fn(),
    onConfirm: vi.fn(),
    onDecline: vi.fn(),
    onUndo: vi.fn(),
    onRateShot: vi.fn(),
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

  it('reports a star rating with the shot id, and blocks it while busy', async () => {
    const { handlers, rerender } = renderSurface({ messages: conversation('options') });
    const card = screen.getByTestId(TID.shotCard);
    await userEvent.click(within(card).getByRole('radio', { name: 'Rate 4 out of 5' }));
    expect(handlers.onRateShot).toHaveBeenCalledWith('shot-1', 4);
    rerender({ messages: conversation('options'), busy: true });
    expect(within(screen.getByTestId(TID.shotCard)).getByRole('radio', { name: 'Rate 4 out of 5' })).toBeDisabled();
  });

  it('shows the stars a shot was given', () => {
    const rated = conversation('options').map((m) => ({
      ...m,
      parts: m.parts.map((p) => (p.kind === 'shot' ? { ...p, stars: 4 } : p)),
    }));
    renderSurface({ messages: rated });
    expect(screen.getByRole('radio', { name: 'Rate 4 out of 5' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows progress notices with their bar, and no thinking row beside them', () => {
    const messages = [...conversation('templates'), progressMessage('p', 'Loading Kiambu AA v1 on the machine…', null, null)];
    renderSurface({ messages, busy: true });
    expect(screen.getByRole('progressbar', { name: 'Loading Kiambu AA v1 on the machine…' })).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).toBeNull();
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

  it('shows no thinking row while a change card applies: the card has its own bar', () => {
    renderSurface({ messages: conversation('applying'), busy: true });
    expect(screen.getByText('Loading Kiambu AA v2 onto the machine…')).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('never shows the marker of bold that is still streaming, and shows the text bold once it closes', () => {
    const base = [textMessage('a', 'user', 'Sour / sharp')];
    const { rerender } = renderSurface({ messages: [...base, textMessage('b', 'assistant', 'That usually means **under-extr', true)], busy: true });
    expect(screen.getByTestId(TID.chat)).toHaveTextContent('That usually means under-extr');
    expect(screen.getByTestId(TID.chat).textContent).not.toContain('*');

    rerender({ messages: [...base, textMessage('b', 'assistant', 'That usually means **under-extraction**.')], busy: false });
    expect(screen.getByText('under-extraction').tagName).toBe('STRONG');
    expect(screen.getByTestId(TID.chat).textContent).not.toContain('*');
  });

  it('shows finished text exactly as the coach wrote it, an unclosed marker included', () => {
    renderSurface({ messages: [textMessage('a', 'assistant', 'Keep the **ratio')] });
    expect(screen.getByText('Keep the **ratio')).toBeInTheDocument();
  });

  it('spaces paragraphs and lists apart, and keeps a single line break inside its paragraph', () => {
    renderSurface({ messages: [textMessage('a', 'assistant', 'It ran fast.\nAnd sour.\n\nGrind finer next.\n- same dose')] });
    const first = screen.getByText(/It ran fast\./);
    expect(first.tagName).toBe('P');
    expect(first.querySelectorAll('br')).toHaveLength(1);
    expect(getComputedStyle(first).marginTop).toBe('0px');
    const second = screen.getByText('Grind finer next.');
    expect(second.tagName).toBe('P');
    expect(getComputedStyle(second).marginTop).toBe('12px');
    const list = screen.getByText('same dose').closest('ul')!;
    expect(getComputedStyle(list).marginTop).toBe('12px');
    expect(getComputedStyle(list).marginBottom).toBe('0px');
  });

  it('tells each card why it was set aside', () => {
    const setAside = (stage: 'templates' | 'options', reason: 'shot' | 'undo') =>
      conversation(stage).map((m) => ({
        ...m,
        parts: m.parts.map((p) => (p.kind === stage ? { ...p, expired: true, setAsideReason: reason } : p)),
      }));
    const { rerender } = renderSurface({ messages: setAside('options', 'shot') });
    expect(screen.getByText('Set aside: a new shot came in.')).toBeInTheDocument();
    rerender({ messages: setAside('templates', 'undo') });
    expect(screen.getByText('Set aside when you tapped Undo. Ask the coach to suggest again.')).toBeInTheDocument();
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

  it('leaves the thinking row out while a progress notice says what CafAI is doing', () => {
    const searching = [textMessage('a', 'user', 'Hi'), progressMessage('p', 'Looking for that shot in Decaid…', 1 / 6, 'Try 2 of 6')];
    expect(toChatMessages(searching, true).map((m) => m.id)).toEqual(['a', 'p']);
  });
});

describe('latestAppliedDiffId', () => {
  it('finds the most recent applied diff', () => {
    expect(latestAppliedDiffId(conversation('applied'))).toBe('tu-adjust');
    expect(latestAppliedDiffId(conversation('diff'))).toBeNull();
  });
});
