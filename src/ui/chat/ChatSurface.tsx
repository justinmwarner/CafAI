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
 *
 * The live stats card (D91) is one more row at the end, on screen only: it
 * is never one of `messages`, so it is never stored or sent to the coach.
 * So are the taste words above the composer (D127): they only fill the draft.
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
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SpeedRounded from '@mui/icons-material/SpeedRounded';
import { ChatBox, type ChatBoxFeatures, type ChatBoxSlotProps, type ChatBoxSlots } from '@mui/x-chat';
import {
  useChatComposer,
  type ChatAdapter,
  type ChatLocaleText,
  type ChatMessage,
  type ChatMessagePart,
  type ChatPartRendererMap,
  type ChatPartRendererProps,
} from '@mui/x-chat/headless';
import type { CoachUiMessage, CoachUiPart, ShotVerdict } from '../../app/types.ts';
import type { SaveBagDetails } from '../../coach/contract.ts';
import type { BagPhoto } from '../../llm/extractBag.ts';
import { StatsCard } from '../machine/StatsCard.tsx';
import { useLayout } from '../shell/layout.ts';
import { TID } from '../testIds.ts';
import { RichText } from './RichText.tsx';
import { BagConfirmCard } from './parts/BagConfirmCard.tsx';
import { BeanCard } from './parts/BeanCard.tsx';
import { DiffCard } from './parts/DiffCard.tsx';
import { Notice } from './parts/Notice.tsx';
import { OptionChips } from './parts/OptionChips.tsx';
import { ShotCard } from './parts/ShotCard.tsx';
import { TemplateCards } from './parts/TemplateCards.tsx';
import { createFollowNewest, type FollowNewest, type NewestMessage } from './followNewest.ts';
import { promptChipSx } from './promptChip.ts';
import { TastePrompts } from './TasteWords.tsx';
import { tasteQuestionOpen } from './tasteWords.ts';

export interface ChatSurfaceProps {
  messages: readonly CoachUiMessage[];
  /** The model is streaming or tools are running: sending is blocked, typing is not. */
  busy: boolean;
  /** Block sending for another reason (e.g. no API key); typing stays allowed. */
  inputDisabled?: boolean;
  placeholder: string;
  canUndo: boolean;
  /** The one shot whose card may open the big graph (the live/last shot the app-wide trace holds); null or absent when none can. */
  graphShotId?: string | null;
  onSend(text: string): void;
  onPickTemplate(requestId: string, templateId: string): void;
  onAnswerOptions(requestId: string, selected: string[], otherText: string | null): void;
  onConfirm(requestId: string): void;
  onDecline(requestId: string): void;
  onUndo(): void;
  /** A word tapped under "Compared with ...?" on a shot card (D126). */
  onRateShot(shotId: string, verdict: ShotVerdict): void;
  /** A batch of Decaid's bean library picked on "Which coffee is it?" (6.1). */
  onPickBean?(batchId: string): void;
  /** The bean card's Something else. */
  onSkipBeanPick?(): void;
  /** A photo of the bag, ready to send (6.8). */
  onBagPhoto?(photo: BagPhoto): void;
  /** The details read from the photo, as the barista confirmed them. */
  onConfirmBag?(details: SaveBagDetails): void;
  /** Opens the shot route (#/shot) from graphShotId's card. Without it no card shows Graph. */
  onOpenGraph?(): void;
  /** Show the live stats card after the newest message (statsCard.ts decides when). */
  statsCard?: boolean;
  /** The Stats prompt above the composer was tapped: post the card. Without it there is no prompt. */
  onStats?(): void;
}

// ---------------------------------------------------------------------------
// CoachUiMessage -> x-chat message mapping
// ---------------------------------------------------------------------------

type CardKind = Exclude<CoachUiPart['kind'], 'text'>;
const DATA_PREFIX = 'data-cafai-';
const THINKING_TYPE = `${DATA_PREFIX}thinking` as const;
const THINKING_ID = 'cafai-thinking';
const STATS_TYPE = `${DATA_PREFIX}stats` as const;
const STATS_ID = 'cafai-stats';

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

/** The live stats card: a row of the thread, never a CoachUiMessage, and CafAI's own, not the coach's. */
const STATS_MESSAGE: ChatMessage = {
  id: STATS_ID,
  role: 'system',
  status: 'sent',
  parts: [{ type: STATS_TYPE, data: null }],
};

function showsProgress(message: CoachUiMessage): boolean {
  return message.parts.some((part) => part.kind === 'notice' && part.progress !== undefined);
}

function applyingChange(messages: readonly CoachUiMessage[]): boolean {
  return messages.some((message) => message.parts.some((part) => part.kind === 'diff' && part.status === 'applying'));
}

/**
 * x-chat messages for the thread, then the stats card when it shows, then a
 * "thinking" row while busy with nothing streaming yet. A progress notice
 * already says what CafAI is doing (loading a profile, looking for a shot),
 * and a change card that is being applied shows its own bar, so neither gets
 * a thinking row. Both are read from the real messages, never the card.
 */
export function toChatMessages(messages: readonly CoachUiMessage[], busy: boolean, statsCard = false): ChatMessage[] {
  const result = messages.map(toChatMessage);
  if (statsCard) result.push(STATS_MESSAGE);
  const last = messages[messages.length - 1];
  const streamingNow = last !== undefined && last.role !== 'user' && isStreaming(last);
  const working = (last !== undefined && showsProgress(last)) || applyingChange(messages);
  if (busy && !streamingNow && !working) result.push(THINKING_MESSAGE);
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
  rateShot(shotId: string, verdict: ShotVerdict): void;
  openGraph(): void;
  /** The Stats prompt (it lives in x-chat's slot above the composer, so it reaches ChatSurface through here too). */
  askStats(): void;
  pickBean(batchId: string): void;
  skipBeanPick(): void;
  bagPhoto(photo: BagPhoto): void;
  confirmBag(details: SaveBagDetails): void;
}

interface PartsContextValue {
  busy: boolean;
  canUndo: boolean;
  latestAppliedDiff: string | null;
  /** The shot whose card may show Graph; compared against each shot part's id. */
  graphShotId: string | null;
  /** Whether a graph handler was given at all (ShotView still gates on graphShotId matching). */
  hasOpenGraph: boolean;
  /** Whether a Stats handler was given: without one the prompt row has no Stats. */
  hasStats: boolean;
  /** The taste question waits for its answer: the prompt row offers Taste words and Need help? (D127). */
  tasteOpen: boolean;
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
      setAsideReason={part.setAsideReason}
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
      setAsideReason={part.setAsideReason}
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
  const { busy, graphShotId, hasOpenGraph, actions } = usePartsContext();
  const part = cardOf(data, 'shot');
  if (!part) return null;
  // The trace holds one shot: only the card of that shot may open its graph.
  const showGraph = hasOpenGraph && part.shotId === graphShotId;
  return (
    <ShotCard
      summary={part.summary}
      baseline={part.baseline ?? null}
      verdict={part.rating?.verdict ?? null}
      stars={part.stars ?? null}
      disabled={busy}
      onRate={(verdict) => actions.rateShot(part.shotId, verdict)}
      onOpenGraph={showGraph ? actions.openGraph : undefined}
      visualizerUrl={part.visualizerUrl ?? null}
    />
  );
}

function BeanPickerView({ data }: { data: unknown }) {
  const { busy, actions } = usePartsContext();
  const part = cardOf(data, 'beanPicker');
  if (!part) return null;
  return (
    <BeanCard
      options={part.options}
      choice={part.choice}
      disabled={busy}
      expired={part.expired ?? false}
      setAsideReason={part.setAsideReason}
      loading={part.loading ?? false}
      onPick={actions.pickBean}
      onSomethingElse={actions.skipBeanPick}
      onPhoto={actions.bagPhoto}
    />
  );
}

function BagConfirmView({ data }: { data: unknown }) {
  const { busy, actions } = usePartsContext();
  const part = cardOf(data, 'bagConfirm');
  if (!part) return null;
  return (
    <BagConfirmCard
      details={part.details}
      confirmed={part.confirmed}
      disabled={busy}
      expired={part.expired ?? false}
      setAsideReason={part.setAsideReason}
      onConfirm={actions.confirmBag}
    />
  );
}

function NoticeView({ data }: { data: unknown }) {
  const part = cardOf(data, 'notice');
  return part ? <Notice tone={part.tone} text={part.text} progress={part.progress} /> : null;
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
  return message.role === 'user' ? <>{part.text}</> : <RichText text={part.text} streaming={part.state === 'streaming'} />;
}

type DataRendererProps = ChatPartRendererProps<Extract<ChatMessagePart, { type: `data-${string}` }>>;

const PART_RENDERERS: ChatPartRendererMap = {
  text: (props) => <TextView {...props} />,
  [`${DATA_PREFIX}templates`]: ({ part }: DataRendererProps) => <TemplatesView data={part.data} />,
  [`${DATA_PREFIX}options`]: ({ part }: DataRendererProps) => <OptionsView data={part.data} />,
  [`${DATA_PREFIX}diff`]: ({ part }: DataRendererProps) => <DiffView data={part.data} />,
  [`${DATA_PREFIX}shot`]: ({ part }: DataRendererProps) => <ShotView data={part.data} />,
  [`${DATA_PREFIX}notice`]: ({ part }: DataRendererProps) => <NoticeView data={part.data} />,
  [`${DATA_PREFIX}beanPicker`]: ({ part }: DataRendererProps) => <BeanPickerView data={part.data} />,
  [`${DATA_PREFIX}bagConfirm`]: ({ part }: DataRendererProps) => <BagConfirmView data={part.data} />,
  [THINKING_TYPE]: () => <ThinkingView />,
  [STATS_TYPE]: () => <StatsCard />,
};

/** x-chat's own grouping key: the author, else the role. */
function authorKey(message: ChatMessage): string {
  return message.author?.id ?? message.role;
}

// ---------------------------------------------------------------------------
// The prompt row
// ---------------------------------------------------------------------------

/** The Stats chip as drawn: a prompt chip (promptChip.ts) with the accent icon, one of the few marks of CafAI itself. */
const statsChipSx = { ...promptChipSx, '& .MuiChip-icon': { color: 'primary.main', fontSize: 18, ml: '10px' } } as const;

/**
 * The composer's lane: at most 760 px, centred, never closer than 8 px to the
 * pane's sides. It wraps, so the open taste words take a line of their own.
 */
const promptRowSx = {
  display: 'flex',
  flexWrap: 'wrap',
  flexShrink: 0,
  gap: 1,
  mx: 'max(8px, calc((100% - 760px) / 2))',
  pt: '2px',
  pb: 1,
} as const;

/**
 * A phone on its side is too short for the open taste words and the composer
 * together: there the row gives way and scrolls, and the composer stays whole.
 * 5 px on top keeps the chips' touch bands inside the row.
 */
const shortPromptRowSx = { ...promptRowSx, flexShrink: 1, minHeight: 0, overflowY: 'auto', pt: '5px' } as const;

/**
 * The prompts above the composer: Stats (D91), on every chat, and while the
 * taste question is open Taste words and Need help? (D127). A tap on Stats
 * posts the stats card at the end of the thread; a taste word goes into the
 * draft. Nothing is sent, and the composer's draft is never lost.
 */
function PromptRow() {
  const { actions, hasStats, tasteOpen } = usePartsContext();
  const short = useLayout().nav === 'rail';
  return (
    <Box sx={short ? shortPromptRowSx : promptRowSx}>
      {hasStats ? (
        <Chip
          variant="outlined"
          icon={<SpeedRounded />}
          label="Stats"
          data-testid={TID.statsPrompt}
          onClick={actions.askStats}
          sx={statsChipSx}
        />
      ) : null}
      {tasteOpen ? <TasteRow /> : null}
    </Box>
  );
}

/** The taste prompts with x-chat's draft: mounted only while the taste question is open, so only then does a keystroke reach it. */
function TasteRow() {
  const composer = useChatComposer();
  return <TastePrompts draft={composer.value} onDraft={composer.setValue} />;
}

/** An empty thread shows nothing of x-chat's own: a chat opens with the coach's first words, or the stats card. */
function EmptyThread() {
  return null;
}

// ---------------------------------------------------------------------------
// ChatBox configuration
// ---------------------------------------------------------------------------

const FEATURES: ChatBoxFeatures = {
  attachments: false,
  conversationHeader: false,
  helperText: false,
  // x-chat's slot between the thread and the composer, for the prompt row (SLOTS).
  suggestions: true,
  scrollToBottom: true,
  // ChatSurface follows new content itself (followNewest.ts): x-chat's
  // buffer-based follow lets go when a tall card lands on a 602 px screen.
  autoScroll: false,
};

const SCROLLER_SELECTOR = '.MuiChatMessageList-scroller';
const CONTENT_SELECTOR = '.MuiChatMessageList-content';
const MESSAGE_SELECTOR = '.MuiChatMessage-root';

function newestMessage(scroller: HTMLElement): NewestMessage | null {
  const all = scroller.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR);
  const element = all[all.length - 1];
  if (!element) return null;
  const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  return { key: element, top, height: element.offsetHeight };
}

/**
 * A new bag's chat opens on "Which coffee is it?" still to answer (6.1): it
 * is shown from that card's top, the thread's start, not from its end.
 */
function opensOnBeanCard(messages: readonly CoachUiMessage[]): boolean {
  return messages[0]?.parts.some((part) => part.kind === 'beanPicker' && part.choice === null && part.expired !== true) ?? false;
}

/**
 * Wire followNewest.ts to x-chat's scroller: follow every resize of the
 * thread (a card that grows after it renders included) and of the view, and
 * every scroll. `open` shows the thread the first time, once the follower
 * exists; `newestRow` is the id of the thread's newest row as handed to
 * x-chat, which draws it a moment later.
 */
function useFollowNewest(
  rootRef: { current: HTMLElement | null },
  open: (follower: FollowNewest) => void,
  newestRow: { current: string | null },
): { current: FollowNewest | null } {
  const followerRef = useRef<FollowNewest | null>(null);
  useEffect(() => {
    const scroller = rootRef.current?.querySelector<HTMLElement>(SCROLLER_SELECTOR) ?? null;
    const content = rootRef.current?.querySelector<HTMLElement>(CONTENT_SELECTOR) ?? null;
    if (!scroller) return undefined;
    const follower = createFollowNewest(scroller, () => newestMessage(scroller), () => newestRow.current);
    followerRef.current = follower;
    const onScroll = () => follower.onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => follower.update()) : null;
    if (observer && content) observer.observe(content);
    // The view itself shrinks when a banner appears above the chat (or an
    // on-screen keyboard resizes the page): keep the newest prompt in view.
    if (observer) observer.observe(scroller);
    open(follower);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      followerRef.current = null;
    };
  }, [rootRef, open, newestRow]);
  return followerRef;
}

const SLOTS: ChatBoxSlots = {
  composerAttachButton: null,
  messageAvatar: null,
  messageInlineMeta: null,
  messageActions: null,
  // Our own row in the suggestions slot: x-chat's chips would only fill the composer.
  suggestions: PromptRow,
  // x-chat moves its suggestions to the middle of an empty thread unless it has an empty state to show there.
  emptyState: EmptyThread,
};

/** x-chat draws the suggestions slot only while it has suggestions; PromptRow never hands them to the composer. */
const PROMPTS = ['Stats'];
const PROMPTS_WITH_TASTE = ['Stats', 'Taste words', 'Need help?'];

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
  const {
    messages,
    busy,
    inputDisabled = false,
    placeholder,
    canUndo,
    graphShotId = null,
    onOpenGraph,
    statsCard = false,
    onStats,
  } = props;
  const sendBlocked = busy || inputDisabled;
  // A boolean, not the raw (often inline, identity-changing) callback: keeps
  // partsContext stable so part renderers do not re-render on every parent render.
  const hasOpenGraph = onOpenGraph !== undefined;
  const hasStats = onStats !== undefined;

  // Latest-ref: the adapter and part actions stay stable while the parent
  // passes fresh callbacks on every render (every streamed token).
  const propsRef = useRef(props);
  const sendBlockedRef = useRef(sendBlocked);
  useLayoutEffect(() => {
    propsRef.current = props;
    sendBlockedRef.current = sendBlocked;
  });

  const followNextRef = useRef(false);
  // Counts the taps on Stats, so each one brings the card into view (below).
  const [statsAsked, setStatsAsked] = useState(0);

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
      // A rating is often given on an older card: the view stays where the barista is reading.
      rateShot: (shotId: string, verdict: ShotVerdict) => propsRef.current.onRateShot(shotId, verdict),
      // Navigation, not a chat append: no need to follow the thread for it either.
      openGraph: () => propsRef.current.onOpenGraph?.(),
      // No message and no coach call: the card is screen-only (statsCard.ts).
      askStats: () => {
        setStatsAsked((count) => count + 1);
        propsRef.current.onStats?.();
      },
      pickBean: act((batchId: string) => propsRef.current.onPickBean?.(batchId)),
      skipBeanPick: act(() => propsRef.current.onSkipBeanPick?.()),
      bagPhoto: act((photo: BagPhoto) => propsRef.current.onBagPhoto?.(photo)),
      confirmBag: act((details: SaveBagDetails) => propsRef.current.onConfirmBag?.(details)),
    };
  }, []);

  const latestAppliedDiff = useMemo(() => latestAppliedDiffId(messages), [messages]);
  const tasteOpen = useMemo(() => tasteQuestionOpen(messages), [messages]);
  const partsContext = useMemo<PartsContextValue>(
    () => ({ busy, canUndo, latestAppliedDiff, graphShotId, hasOpenGraph, hasStats, tasteOpen, actions }),
    [busy, canUndo, latestAppliedDiff, graphShotId, hasOpenGraph, hasStats, tasteOpen, actions],
  );

  const chatMessages = useMemo(() => toChatMessages(messages, busy, statsCard), [messages, busy, statsCard]);
  // The thread's newest row as handed to x-chat, the stats card included: what a new thread held at its start waits on.
  const newestRowRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    newestRowRef.current = chatMessages[chatMessages.length - 1]?.id ?? null;
  }, [chatMessages]);

  // The card joins the run of messages above it, so it never carries an
  // author label of its own ("Coach" over the machine's numbers would read as
  // advice). Only an empty chat leaves it nothing to join.
  const lastRole = messages[messages.length - 1]?.role ?? null;
  const messageGroup = useMemo<ChatBoxSlotProps['messageGroup']>(
    () => ({
      groupKey: (message: ChatMessage) => (message.id === STATS_ID && lastRole !== null ? lastRole : authorKey(message)),
    }),
    [lastRole],
  );

  // Keep the newest message in view (followNewest.ts): on mount and on a bag
  // switch (the thread is replaced), after the barista acted (sent, tapped a
  // card), and for everything that arrives while they follow the thread. A
  // new bag's chat opens on its bean card's top instead (opensOnBeanCard).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openThread = useCallback((follower: FollowNewest) => {
    follower.reset();
    if (opensOnBeanCard(propsRef.current.messages)) follower.showStart();
    else follower.update();
  }, []);
  const followerRef = useFollowNewest(rootRef, openThread, newestRowRef);
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    if (followerRef.current) openThread(followerRef.current);
  }, [firstId, followerRef, openThread]);
  useLayoutEffect(() => {
    if (followNextRef.current) {
      followNextRef.current = false;
      followerRef.current?.resume();
    }
    followerRef.current?.update();
  }, [chatMessages, followerRef]);
  // Stats: the card is (or has just become) the newest row. Shown afresh, as
  // a new thread is, so a card taller than the view shows from its start
  // again, however far the reader had scrolled. After the effect above, which
  // runs in the same commit when the card has just been added.
  useLayoutEffect(() => {
    if (statsAsked === 0) return;
    followerRef.current?.reset();
    followerRef.current?.update();
  }, [statsAsked, followerRef]);

  const onComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends unless sending is blocked; then it does nothing, and the draft stays.
    if (event.key === 'Enter' && !event.shiftKey && sendBlockedRef.current) event.preventDefault();
  }, []);
  const onComposerSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    if (sendBlockedRef.current) event.preventDefault();
  }, []);

  const slotProps = useMemo<ChatBoxSlotProps>(
    () => ({
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
      messageGroup,
    }),
    [placeholder, sendBlocked, onComposerKeyDown, onComposerSubmit, messageGroup],
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
          suggestions={tasteOpen ? PROMPTS_WITH_TASTE : hasStats ? PROMPTS : undefined}
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
  // A comfortable line length on a wide pane: the thread and the composer centre.
  '& .MuiChatMessageList-content': { maxWidth: 680, width: '100%', mx: 'auto' },
  // The composer at most 760 px, centred, and never closer than x-chat's 8 px
  // to the pane's edges. Its own compact-variant margin would win over a plain
  // selector, and a full width beside that margin pushed Send off the pane.
  '& .MuiChatComposer-root.MuiChatComposer-variantCompact': {
    mx: 'max(8px, calc((100% - 760px) / 2))',
  },
  // The barista's own words sit on a quiet tonal bubble; the accent is kept for actions.
  '& .MuiChatMessage-roleUser .MuiChatMessage-bubble': { bgcolor: 'cafai.raised', color: 'text.primary' },
  // The placeholder in the muted ink at full strength: x-chat draws MUI's
  // faded text.disabled, a colour the contrast sweep cannot check.
  '& .MuiChatComposer-textArea': { fontSize: '1rem', '&::placeholder': { color: 'text.secondary', opacity: 1 } },
  // followNewest.ts owns the scroll position; the browser's scroll anchoring
  // would move it on its own when content above the view changes size.
  '& .MuiChatMessageList-scroller': { overflowAnchor: 'none' },
  // Matches x-chat's compact-composer selector so the 48 px touch target wins.
  '& .MuiChatComposer-root.MuiChatComposer-variantCompact .MuiChatComposer-sendButton': { width: 48, height: 48 },
} as const;
