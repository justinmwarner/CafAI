/**
 * The chat thread and composer. The ONLY module that imports @mui/x-chat, so
 * the rest of the app (and a core-MUI fallback, if this alpha ever breaks)
 * depends on these props alone.
 *
 * x-chat runs in controlled mode: the coach engine owns every message, this
 * component maps CoachUiMessage[] onto x-chat messages on each render, and
 * the adapter's sendMessage only forwards the text to `onSend` and returns an
 * already-closed stream. Everything except text renders as `data-cafai-*`
 * parts through our own part components.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ChatBox, type ChatBoxFeatures, type ChatBoxSlotProps, type ChatBoxSlots } from '@mui/x-chat';
import type {
  ChatAdapter,
  ChatLocaleText,
  ChatMessage,
  ChatMessagePart,
  ChatPartRendererMap,
  ChatPartRendererProps,
  MessageListRootHandle,
} from '@mui/x-chat/headless';
import type { CoachUiMessage, CoachUiPart } from '../../app/types.ts';
import { TID } from '../testIds.ts';
import { RichText } from './RichText.tsx';
import { DiffCard } from './parts/DiffCard.tsx';
import { Notice } from './parts/Notice.tsx';
import { OptionChips } from './parts/OptionChips.tsx';
import { ShotCard } from './parts/ShotCard.tsx';
import { TemplateCards } from './parts/TemplateCards.tsx';

export interface ChatSurfaceProps {
  messages: readonly CoachUiMessage[];
  /** The model is streaming or tools are running: sending is blocked, typing is not. */
  busy: boolean;
  /** Block sending for another reason (e.g. no API key); typing stays allowed. */
  inputDisabled?: boolean;
  placeholder: string;
  canUndo: boolean;
  onSend(text: string): void;
  onPickTemplate(requestId: string, templateId: string): void;
  onAnswerOptions(requestId: string, selected: string[], otherText: string | null): void;
  onConfirm(requestId: string): void;
  onDecline(requestId: string): void;
  onUndo(): void;
}

// ---------------------------------------------------------------------------
// CoachUiMessage -> x-chat message mapping
// ---------------------------------------------------------------------------

type CardKind = Exclude<CoachUiPart['kind'], 'text'>;
const DATA_PREFIX = 'data-cafai-';
const THINKING_TYPE = `${DATA_PREFIX}thinking` as const;
const THINKING_ID = 'cafai-thinking';

function toChatPart(part: CoachUiPart): ChatMessagePart {
  if (part.kind === 'text') return { type: 'text', text: part.text, state: part.streaming ? 'streaming' : 'done' };
  return { type: `${DATA_PREFIX}${part.kind}`, data: part };
}

function isStreaming(message: CoachUiMessage): boolean {
  return message.parts.some((part) => part.kind === 'text' && part.streaming === true);
}

// The engine updates messages immutably, so an unchanged CoachUiMessage maps
// to the same x-chat object and its row does not re-render while another
// message streams.
const mapped = new WeakMap<CoachUiMessage, ChatMessage>();

export function toChatMessage(message: CoachUiMessage): ChatMessage {
  const cached = mapped.get(message);
  if (cached) return cached;
  const result: ChatMessage = {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    // 'streaming' also makes x-chat follow the growing text to the bottom.
    status: isStreaming(message) ? 'streaming' : 'sent',
    parts: message.parts.map(toChatPart),
  };
  mapped.set(message, result);
  return result;
}

const THINKING_MESSAGE: ChatMessage = {
  id: THINKING_ID,
  role: 'assistant',
  status: 'sent',
  parts: [{ type: THINKING_TYPE, data: null }],
};

/** x-chat messages for the thread, plus a "thinking" row while busy with nothing streaming yet. */
export function toChatMessages(messages: readonly CoachUiMessage[], busy: boolean): ChatMessage[] {
  const result = messages.map(toChatMessage);
  const last = messages[messages.length - 1];
  const streamingNow = last !== undefined && last.role !== 'user' && isStreaming(last);
  if (busy && !streamingNow) result.push(THINKING_MESSAGE);
  return result;
}

/**
 * The request id of the most recent applied diff that created a profile
 * version: only that card may offer Undo, because Undo reverts the version.
 * A manual change (grind, dose) creates no version, so it never offers one.
 */
export function latestAppliedDiffId(messages: readonly CoachUiMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j];
      if (part?.kind === 'diff' && part.status === 'applied' && part.versionLabel !== null) return part.requestId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Part rendering
// ---------------------------------------------------------------------------

interface PartActions {
  pickTemplate(requestId: string, templateId: string): void;
  answerOptions(requestId: string, selected: string[], otherText: string | null): void;
  confirm(requestId: string): void;
  decline(requestId: string): void;
  undo(): void;
}

interface PartsContextValue {
  busy: boolean;
  canUndo: boolean;
  latestAppliedDiff: string | null;
  actions: PartActions;
}

const PartsContext = createContext<PartsContextValue | null>(null);

function usePartsContext(): PartsContextValue {
  const value = useContext(PartsContext);
  if (!value) throw new Error('Chat parts render only inside ChatSurface.');
  return value;
}

function cardOf<K extends CardKind>(data: unknown, kind: K): Extract<CoachUiPart, { kind: K }> | null {
  const part = data as CoachUiPart | null;
  return part !== null && typeof part === 'object' && part.kind === kind ? (part as Extract<CoachUiPart, { kind: K }>) : null;
}

function TemplatesView({ data }: { data: unknown }) {
  const { busy, actions } = usePartsContext();
  const part = cardOf(data, 'templates');
  if (!part) return null;
  return (
    <TemplateCards
      items={part.items}
      pickedTemplateId={part.pickedTemplateId}
      disabled={busy}
      expired={part.expired ?? false}
      onPick={(templateId) => actions.pickTemplate(part.requestId, templateId)}
    />
  );
}

function OptionsView({ data }: { data: unknown }) {
  const { busy, actions } = usePartsContext();
  const part = cardOf(data, 'options');
  if (!part) return null;
  return (
    <OptionChips
      question={part.question}
      options={part.options}
      multiSelect={part.multiSelect}
      answer={part.answer}
      disabled={busy}
      expired={part.expired ?? false}
      onAnswer={(selected, otherText) => actions.answerOptions(part.requestId, selected, otherText)}
    />
  );
}

function DiffView({ data }: { data: unknown }) {
  const { busy, canUndo, latestAppliedDiff, actions } = usePartsContext();
  const part = cardOf(data, 'diff');
  if (!part) return null;
  return (
    <DiffCard
      part={part}
      disabled={busy}
      showUndo={canUndo && latestAppliedDiff === part.requestId}
      onConfirm={() => actions.confirm(part.requestId)}
      onDecline={() => actions.decline(part.requestId)}
      onUndo={actions.undo}
    />
  );
}

function ShotView({ data }: { data: unknown }) {
  const part = cardOf(data, 'shot');
  return part ? <ShotCard summary={part.summary} /> : null;
}

function NoticeView({ data }: { data: unknown }) {
  const part = cardOf(data, 'notice');
  return part ? <Notice tone={part.tone} text={part.text} /> : null;
}

/** "Thinking… 12 s": the elapsed counter updates in place, so a slow reply never looks frozen. */
function ThinkingView() {
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return (
    <Stack direction="row" spacing={1.25} role="status" sx={{ alignItems: 'center', py: 0.25 }}>
      <CircularProgress size={16} thickness={5} aria-hidden />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Thinking…{seconds >= 3 ? ` ${seconds} s` : ''}
      </Typography>
    </Stack>
  );
}

function TextView({ part, message }: ChatPartRendererProps<Extract<ChatMessagePart, { type: 'text' }>>) {
  // What the barista typed stays verbatim; model text gets the safe light formatting.
  return message.role === 'user' ? <>{part.text}</> : <RichText text={part.text} />;
}

type DataRendererProps = ChatPartRendererProps<Extract<ChatMessagePart, { type: `data-${string}` }>>;

const PART_RENDERERS: ChatPartRendererMap = {
  text: (props) => <TextView {...props} />,
  [`${DATA_PREFIX}templates`]: ({ part }: DataRendererProps) => <TemplatesView data={part.data} />,
  [`${DATA_PREFIX}options`]: ({ part }: DataRendererProps) => <OptionsView data={part.data} />,
  [`${DATA_PREFIX}diff`]: ({ part }: DataRendererProps) => <DiffView data={part.data} />,
  [`${DATA_PREFIX}shot`]: ({ part }: DataRendererProps) => <ShotView data={part.data} />,
  [`${DATA_PREFIX}notice`]: ({ part }: DataRendererProps) => <NoticeView data={part.data} />,
  [THINKING_TYPE]: () => <ThinkingView />,
};

// ---------------------------------------------------------------------------
// ChatBox configuration
// ---------------------------------------------------------------------------

const FEATURES: ChatBoxFeatures = {
  attachments: false,
  conversationHeader: false,
  helperText: false,
  suggestions: false,
  scrollToBottom: true,
  // ChatSurface follows new content itself (see useStickToBottom): x-chat's
  // buffer-based follow lets go when a tall card lands on a 602 px screen.
  autoScroll: false,
};

const SCROLLER_SELECTOR = '.MuiChatMessageList-scroller';
const CONTENT_SELECTOR = '.MuiChatMessageList-content';
/** Within this many px of the bottom counts as "reading the newest message". */
const STICK_THRESHOLD_PX = 96;

/**
 * Keep the newest message in view while the reader is at the bottom (or has
 * just acted), including when a card grows after it renders; leave the
 * scroll alone once they scroll up to read.
 */
function useStickToBottom(rootRef: { current: HTMLElement | null }, stickRef: { current: boolean }) {
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.querySelector<HTMLElement>(SCROLLER_SELECTOR) ?? null;
    const content = root?.querySelector<HTMLElement>(CONTENT_SELECTOR) ?? null;
    if (!scroller) return undefined;
    const onScroll = () => {
      stickRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_THRESHOLD_PX;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (stickRef.current) scroller.scrollTop = scroller.scrollHeight;
          })
        : null;
    if (observer && content) observer.observe(content);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [rootRef, stickRef]);
}

const SLOTS: ChatBoxSlots = {
  composerAttachButton: null,
  messageAvatar: null,
  messageInlineMeta: null,
  messageActions: null,
};

const LOCALE_TEXT: Partial<ChatLocaleText> = {
  messageAuthorUserLabel: 'You',
  messageAuthorAssistantLabel: 'Coach',
  messageAuthorSystemLabel: 'CafAI',
  messageListLabel: 'Conversation with the coach',
  composerSendButtonLabel: 'Send',
  composerInputAriaLabel: 'Message to the coach',
};

function closedStream(): ReadableStream<never> {
  return new ReadableStream<never>({
    start(controller) {
      controller.close();
    },
  });
}

export function ChatSurface(props: ChatSurfaceProps) {
  const { messages, busy, inputDisabled = false, placeholder, canUndo } = props;
  const sendBlocked = busy || inputDisabled;

  // Latest-ref: the adapter and part actions stay stable while the parent
  // passes fresh callbacks on every render (every streamed token).
  const propsRef = useRef(props);
  const sendBlockedRef = useRef(sendBlocked);
  useLayoutEffect(() => {
    propsRef.current = props;
    sendBlockedRef.current = sendBlocked;
  });

  const listRef = useRef<MessageListRootHandle | null>(null);
  const followNextRef = useRef(false);

  const adapter = useMemo<ChatAdapter>(
    () => ({
      async sendMessage({ message }) {
        const text = message.parts
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join('\n')
          .trim();
        if (text && !sendBlockedRef.current) {
          followNextRef.current = true;
          propsRef.current.onSend(text);
        }
        return closedStream();
      },
    }),
    [],
  );

  const actions = useMemo<PartActions>(() => {
    const act = <A extends unknown[]>(run: (...args: A) => void) => (...args: A) => {
      followNextRef.current = true;
      run(...args);
    };
    return {
      pickTemplate: act((requestId: string, templateId: string) => propsRef.current.onPickTemplate(requestId, templateId)),
      answerOptions: act((requestId: string, selected: string[], otherText: string | null) =>
        propsRef.current.onAnswerOptions(requestId, selected, otherText),
      ),
      confirm: act((requestId: string) => propsRef.current.onConfirm(requestId)),
      decline: act((requestId: string) => propsRef.current.onDecline(requestId)),
      undo: act(() => propsRef.current.onUndo()),
    };
  }, []);

  const latestAppliedDiff = useMemo(() => latestAppliedDiffId(messages), [messages]);
  const partsContext = useMemo<PartsContextValue>(
    () => ({ busy, canUndo, latestAppliedDiff, actions }),
    [busy, canUndo, latestAppliedDiff, actions],
  );

  const chatMessages = useMemo(() => toChatMessages(messages, busy), [messages, busy]);

  // Keep the newest message in view: on mount and on a bag switch (the
  // thread is replaced), after the barista acted (sent, tapped a card), and
  // for everything that arrives while they are reading at the bottom.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  useStickToBottom(rootRef, stickRef);
  const scrollToNewest = useCallback(() => {
    const scroller = rootRef.current?.querySelector<HTMLElement>(SCROLLER_SELECTOR);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    else listRef.current?.scrollToBottom();
  }, []);
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    stickRef.current = true;
    scrollToNewest();
  }, [firstId, scrollToNewest]);
  useLayoutEffect(() => {
    if (followNextRef.current) {
      followNextRef.current = false;
      stickRef.current = true;
    }
    if (stickRef.current) scrollToNewest();
  }, [chatMessages, scrollToNewest]);

  const onComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends unless sending is blocked; then it does nothing, and the draft stays.
    if (event.key === 'Enter' && !event.shiftKey && sendBlockedRef.current) event.preventDefault();
  }, []);
  const onComposerSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    if (sendBlockedRef.current) event.preventDefault();
  }, []);

  const slotProps = useMemo<ChatBoxSlotProps>(
    () => ({
      // ChatMessageList forwards its ref to MessageListRoot, whose handle scrolls.
      messageList: { ref: listRef } as ChatBoxSlotProps['messageList'],
      composerRoot: { variant: 'compact', onSubmit: onComposerSubmit },
      composerInput: {
        placeholder,
        maxRows: 4,
        onKeyDown: onComposerKeyDown,
        'data-testid': TID.composerInput,
      } as ChatBoxSlotProps['composerInput'],
      composerSendButton: {
        disabled: sendBlocked,
        'data-testid': TID.composerSend,
      } as ChatBoxSlotProps['composerSendButton'],
    }),
    [placeholder, sendBlocked, onComposerKeyDown, onComposerSubmit],
  );

  return (
    <PartsContext.Provider value={partsContext}>
      <Box ref={rootRef} data-testid={TID.chat} data-busy={busy || undefined} sx={chatSx}>
        <ChatBox
          adapter={adapter}
          messages={chatMessages}
          partRenderers={PART_RENDERERS}
          features={FEATURES}
          slots={SLOTS}
          slotProps={slotProps}
          localeText={LOCALE_TEXT}
          sx={{ height: '100%', bgcolor: 'transparent' }}
        />
      </Box>
    </PartsContext.Provider>
  );
}

const chatSx = {
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  // Read at arm's length: body text at 16 px instead of x-chat's 14 px.
  '& .MuiChatMessage-bubble': {
    fontSize: '1rem',
    lineHeight: 1.5,
    maxWidth: '100%',
  },
  // Coach (and app) messages sit on the page without a bubble and use the
  // full lane, so their cards read as cards; only the barista's own
  // messages are bubbles.
  '& .MuiChatMessage-root:not(.MuiChatMessage-roleUser) .MuiChatMessage-bubble': {
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: '2px',
    paddingBottom: '2px',
  },
  '& .MuiChatComposer-textArea': { fontSize: '1rem' },
  // Matches x-chat's compact-composer selector so the 48 px touch target wins.
  '& .MuiChatComposer-root.MuiChatComposer-variantCompact .MuiChatComposer-sendButton': { width: 48, height: 48 },
} as const;
