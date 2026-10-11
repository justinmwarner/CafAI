// @vitest-environment jsdom
import './testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachUiMessage } from '../../app/types.ts';
import { TID } from '../testIds.ts';
import { ChatSurface, latestAppliedDiffId, toChatMessages, type ChatSurfaceProps } from './ChatSurface.tsx';
import { BAG_FROM_PHOTO, BEAN_OPTIONS, conversation, sampleSummary } from './testing/fixtures.ts';
import { previewTheme } from './testing/previewTheme.ts';
import { renderWithServices } from './testing/render.tsx';

function textMessage(id: string, role: CoachUiMessage['role'], text: string, streaming = false): CoachUiMessage {
  return { id, role, parts: [{ kind: 'text', text, ...(streaming ? { streaming } : {}) }], createdAt: '2026-10-03T08:00:00.000Z' };
}

function shotMessage(id: string, shotId: string): CoachUiMessage {
  return { id, role: 'assistant', parts: [{ kind: 'shot', shotId, summary: sampleSummary({ shotId }) }], createdAt: '2026-10-03T08:00:00.000Z' };
}

function progressMessage(id: string, text: string, value: number | null, label: string | null): CoachUiMessage {
  return {
    id,
    role: 'system',
    parts: [{ kind: 'notice', tone: 'info', text, progress: { value, label } }],
    createdAt: '2026-10-03T08:00:00.000Z',
  };
}

function noticeMessage(id: string, text: string): CoachUiMessage {
  return { id, role: 'system', parts: [{ kind: 'notice', tone: 'success', text }], createdAt: '2026-10-03T08:00:00.000Z' };
}

/** The thread's rows (x-chat's articles), oldest first. */
function rows(): HTMLElement[] {
  return within(screen.getByTestId(TID.chat)).getAllByRole('article');
}

function lastRow(): HTMLElement {
  const all = rows();
  return all[all.length - 1]!;
}

// With services: the stats card reads the machine.
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
  const result = renderWithServices(<ChatSurface {...all} />);
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

  it("draws the composer's placeholder in the muted ink at full strength, not x-chat's faded grey", () => {
    renderSurface();
    // jsdom computes no ::placeholder style, so read the rule the page was given.
    const css = [...document.head.querySelectorAll('style')].map((style) => style.textContent).join('');
    const muted = previewTheme.palette.text.secondary;
    expect(css).toContain(` .MuiChatComposer-textArea::placeholder{color:${muted};opacity:1;}`);
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

  describe("a new bag's first cards (6.1, 6.8)", () => {
    const beanCard: CoachUiMessage = {
      id: 'm-bean',
      role: 'assistant',
      parts: [{ kind: 'beanPicker', options: BEAN_OPTIONS, choice: null }],
      createdAt: '2026-10-03T08:00:00.000Z',
    };
    const confirmCard: CoachUiMessage = {
      id: 'm-confirm',
      role: 'assistant',
      parts: [{ kind: 'bagConfirm', details: BAG_FROM_PHOTO, confirmed: false }],
      createdAt: '2026-10-03T08:01:00.000Z',
    };

    it('shows "Which coffee is it?" and passes a pick and Something else on', async () => {
      const onPickBean = vi.fn();
      const onSkipBeanPick = vi.fn();
      renderSurface({ messages: [beanCard, textMessage('m-q', 'assistant', 'New bag!')], onPickBean, onSkipBeanPick });
      const card = screen.getByTestId(TID.beanCard);
      await userEvent.click(within(card).getAllByTestId(TID.beanOption)[0]!);
      expect(onPickBean).toHaveBeenCalledWith('batch-red');
      await userEvent.click(within(card).getByTestId(TID.beanSomethingElse));
      expect(onSkipBeanPick).toHaveBeenCalledTimes(1);
    });

    it('blocks the bean card while the coach works', () => {
      renderSurface({ messages: [beanCard], busy: true });
      expect(screen.getByTestId(TID.bagPhoto)).toBeDisabled();
    });

    it("opens a new bag's chat at the top of the card, keeps it there while its rows arrive, and follows once it is answered", async () => {
      const onSkipBeanPick = vi.fn();
      const question = textMessage('m-q', 'assistant', 'New bag! Tell me about it.');
      const looking: CoachUiMessage = { ...beanCard, parts: [{ kind: 'beanPicker', options: [], choice: null, loading: true }] };
      const { rerender } = renderSurface({ messages: conversation('options'), onSkipBeanPick, statsCard: true });
      const scroller = screen.getByTestId(TID.chat).querySelector<HTMLElement>('.MuiChatMessageList-scroller')!;
      // jsdom lays nothing out: a 300 px view over 1000 px of thread, read to its end.
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1000 });
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 300 });
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 700 });

      rerender({ messages: [looking, question], onSkipBeanPick, statsCard: true });
      expect(scroller.scrollTop).toBe(0);
      rerender({ messages: [beanCard, question], onSkipBeanPick, statsCard: true });
      expect(scroller.scrollTop).toBe(0);

      await userEvent.click(screen.getByTestId(TID.beanSomethingElse));
      expect(onSkipBeanPick).toHaveBeenCalledTimes(1);
      const skipped: CoachUiMessage = { ...beanCard, parts: [{ kind: 'beanPicker', options: BEAN_OPTIONS, choice: { kind: 'other' } }] };
      rerender({ messages: [skipped, question], onSkipBeanPick, statsCard: true });
      expect(scroller.scrollTop).toBe(700);
    });

    it("keeps a new bag's card at its top when x-chat draws the new thread only after it was handed over", () => {
      // As in a browser: the thread's resizes reach the follower (jsdom has no ResizeObserver).
      const observers: ResizeObserverCallback[] = [];
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: ResizeObserverCallback) {
            observers.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      );
      const resized = () => act(() => observers.forEach((callback) => callback([], {} as ResizeObserver)));
      try {
        const question = textMessage('m-q', 'assistant', 'New bag! Tell me about it.');
        const looking: CoachUiMessage = { ...beanCard, parts: [{ kind: 'beanPicker', options: [], choice: null, loading: true }] };
        const { rerender } = renderSurface({ messages: conversation('options') });
        const scroller = screen.getByTestId(TID.chat).querySelector<HTMLElement>('.MuiChatMessageList-scroller')!;
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1000 });
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 300 });
        Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 700 });

        // The old bag's thread, read to its end, gives way to the new bag's: drawn by x-chat a moment later.
        rerender({ messages: [looking, question] });
        resized();
        expect(scroller.scrollTop).toBe(0);
        rerender({ messages: [beanCard, question] });
        resized();
        expect(scroller.scrollTop).toBe(0);
        // Something newer than the coach's question: followed.
        rerender({ messages: [beanCard, question, noticeMessage('m-n', "Added to Decaid's beans.")] });
        resized();
        expect(scroller.scrollTop).toBe(700);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('opens a chat at its end when its bean card was answered', () => {
      const { rerender } = renderSurface({ messages: conversation('options') });
      const scroller = screen.getByTestId(TID.chat).querySelector<HTMLElement>('.MuiChatMessageList-scroller')!;
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1000 });
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 300 });
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 0 });
      const picked: CoachUiMessage = { ...beanCard, parts: [{ kind: 'beanPicker', options: BEAN_OPTIONS, choice: { kind: 'batch', batchId: 'batch-red' } }] };
      rerender({ messages: [picked, textMessage('m-q', 'assistant', 'New bag!'), textMessage('m-r', 'assistant', 'Lovely.')] });
      expect(scroller.scrollTop).toBe(700);
    });

    it("shows the photo's details to confirm and passes them on as confirmed", async () => {
      const onConfirmBag = vi.fn();
      renderSurface({ messages: [{ ...beanCard, parts: [{ kind: 'beanPicker', options: [], choice: { kind: 'photo' } }] }, confirmCard], onConfirmBag });
      await userEvent.click(within(screen.getByTestId(TID.bagConfirm)).getByRole('button', { name: 'Confirm' }));
      expect(onConfirmBag).toHaveBeenCalledWith(BAG_FROM_PHOTO);
    });
  });

  it("shows On Visualizer on a shot's card once it has the link (6.4)", () => {
    const url = 'https://visualizer.coffee/shots/viz-1';
    renderSurface({ messages: [{ ...shotMessage('m-shot', 'shot-1'), parts: [{ kind: 'shot', shotId: 'shot-1', summary: sampleSummary(), visualizerUrl: url }] }] });
    expect(within(screen.getByTestId(TID.shotCard)).getByTestId(TID.visualizerLink)).toHaveAttribute('href', url);
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

  it('shows Graph only on the card matching graphShotId, and opens it from there', async () => {
    const onOpenGraph = vi.fn();
    renderSurface({
      messages: [shotMessage('m1', 'shot-1'), shotMessage('m2', 'shot-2')],
      graphShotId: 'shot-2',
      onOpenGraph,
    });
    const cards = screen.getAllByTestId(TID.shotCard);
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).queryByTestId(TID.openShotGraph)).toBeNull();
    await userEvent.click(within(cards[1]!).getByTestId(TID.openShotGraph));
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
  });

  it('shows no Graph button when no shot matches graphShotId, or no onOpenGraph was given', () => {
    const { rerender } = renderSurface({ messages: [shotMessage('m1', 'shot-1')], graphShotId: 'shot-2', onOpenGraph: vi.fn() });
    expect(screen.queryByTestId(TID.openShotGraph)).toBeNull();
    rerender({ graphShotId: 'shot-1', onOpenGraph: undefined });
    expect(screen.queryByTestId(TID.openShotGraph)).toBeNull();
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

describe('ChatSurface: the stats card and the Stats prompt', () => {
  it('shows the stats card once, after the newest message', () => {
    renderSurface({ messages: conversation('options'), statsCard: true });
    expect(screen.getAllByTestId(TID.statsCard)).toHaveLength(1);
    expect(within(lastRow()).getByTestId(TID.statsCard)).toBeInTheDocument();
    const all = rows();
    expect(within(all[all.length - 2]!).getByTestId(TID.optionChip('Sour / sharp'))).toBeInTheDocument();
  });

  it('shows no stats card unless it is asked for', () => {
    renderSurface({ messages: conversation('options') });
    expect(screen.queryByTestId(TID.statsCard)).toBeNull();
  });

  it('keeps the thinking row last while busy', () => {
    renderSurface({ messages: [textMessage('a', 'user', 'Kenya, washed')], busy: true, statsCard: true });
    const all = rows();
    expect(all).toHaveLength(3);
    expect(within(all[1]!).getByTestId(TID.statsCard)).toBeInTheDocument();
    expect(all[2]).toHaveTextContent('Thinking…');
  });

  it('never puts an author label of its own over the card', () => {
    // "Coach" over the machine's numbers would read as advice: the card joins whatever it follows.
    const { rerender } = renderSurface({ messages: [textMessage('a', 'user', 'Kenya, washed')], statsCard: true });
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Coach')).toBeNull();
    rerender({ messages: [noticeMessage('n', 'Loaded Kiambu AA v4 on the machine.')], statsCard: true });
    expect(screen.getByText('CafAI')).toBeInTheDocument();
    expect(screen.queryByText('Coach')).toBeNull();
    // A thinking row after it is the coach's, and says so.
    rerender({ messages: [textMessage('a', 'user', 'Kenya, washed')], statsCard: true, busy: true });
    expect(screen.getAllByText('Coach')).toHaveLength(1);
  });

  it('leaves Graph and Undo on the newest real cards', () => {
    renderSurface({
      messages: conversation('applied'),
      statsCard: true,
      canUndo: true,
      graphShotId: 'shot-1',
      onOpenGraph: vi.fn(),
    });
    expect(screen.getByTestId(TID.diffUndo)).toBeInTheDocument();
    expect(within(screen.getByTestId(TID.shotCard)).getByTestId(TID.openShotGraph)).toBeInTheDocument();
  });

  it('puts the Stats prompt between the thread and the composer, in an empty chat and mid-conversation', () => {
    const { rerender } = renderSurface({ messages: [], onStats: vi.fn() });
    const thread = screen.getByRole('log', { name: 'Conversation with the coach' });
    const check = () => {
      const prompt = screen.getByTestId(TID.statsPrompt);
      expect(prompt).toHaveTextContent('Stats');
      expect(prompt).toHaveAttribute('role', 'button');
      expect(thread.contains(prompt)).toBe(false);
      expect(thread.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(prompt.compareDocumentPosition(screen.getByTestId(TID.composerInput)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };
    check();
    rerender({ messages: conversation('options'), onStats: vi.fn() });
    check();
    expect(screen.getAllByTestId(TID.statsPrompt)).toHaveLength(1);
  });

  it('shows no Stats prompt without a handler for it', () => {
    renderSurface({ messages: conversation('options') });
    expect(screen.queryByTestId(TID.statsPrompt)).toBeNull();
  });

  it('asks for the card from the prompt: no message, and the draft stays', async () => {
    const onStats = vi.fn();
    const { handlers } = renderSurface({ messages: conversation('options'), onStats });
    await userEvent.type(screen.getByTestId(TID.composerInput), 'Half a thought');
    await userEvent.click(screen.getByTestId(TID.statsPrompt));
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId(TID.composerInput)).toHaveValue('Half a thought');
  });

  it('asks for the card even while the coach works', async () => {
    const onStats = vi.fn();
    renderSurface({ messages: [textMessage('a', 'user', 'Kenya, washed')], busy: true, onStats });
    await userEvent.click(screen.getByTestId(TID.statsPrompt));
    expect(onStats).toHaveBeenCalledTimes(1);
  });

  it('brings the card into view from Stats, even after the reader scrolled up', async () => {
    const messages = conversation('options');
    const { rerender } = renderSurface({ messages, onStats: vi.fn() });
    const scroller = screen.getByTestId(TID.chat).querySelector<HTMLElement>('.MuiChatMessageList-scroller')!;
    // jsdom lays nothing out: a 300 px view over 1000 px of thread.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 300 });
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 700 });
    fireEvent.scroll(scroller);
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);

    await userEvent.click(screen.getByTestId(TID.statsPrompt));
    rerender({ messages, onStats: vi.fn(), statsCard: true });
    expect(scroller.scrollTop).toBe(700);
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

  it('puts the stats card after the messages and before the thinking row', () => {
    const idle = [textMessage('a', 'user', 'Hi')];
    expect(toChatMessages(idle, false, true).map((m) => m.id)).toEqual(['a', 'cafai-stats']);
    expect(toChatMessages(idle, true, true).map((m) => m.id)).toEqual(['a', 'cafai-stats', 'cafai-thinking']);
    expect(toChatMessages([], false, true)).toEqual([
      { id: 'cafai-stats', role: 'system', status: 'sent', parts: [{ type: 'data-cafai-stats', data: null }] },
    ]);
  });

  it('reads what the coach is doing from the real messages, not the card', () => {
    // Streaming text or a progress notice before the card still holds the thinking row back.
    const streaming = [textMessage('a', 'user', 'Hi'), textMessage('b', 'assistant', 'Hel', true)];
    expect(toChatMessages(streaming, true, true).map((m) => m.id)).toEqual(['a', 'b', 'cafai-stats']);
    const searching = [textMessage('a', 'user', 'Hi'), progressMessage('p', 'Looking for that shot in Decaid…', null, null)];
    expect(toChatMessages(searching, true, true).map((m) => m.id)).toEqual(['a', 'p', 'cafai-stats']);
  });
});

describe('latestAppliedDiffId', () => {
  it('finds the most recent applied diff', () => {
    expect(latestAppliedDiffId(conversation('applied'))).toBe('tu-adjust');
    expect(latestAppliedDiffId(conversation('diff'))).toBeNull();
  });
});
