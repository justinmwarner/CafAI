/**
 * Builds the demo by playing the story (mock/demo/story.ts) through CafAI's
 * own coach engine, so what it stores is exactly what the engine stores:
 * the chat (cards, notices, the user's bubbles), the API transcript with its
 * tool_use / tool_result pairs, versions, iterations, settings, and in Decaid
 * the profiles, the shot records with CafAI's notes and ratings, and the
 * workflow with the active version tagged as the engine tags it.
 *
 * The engine runs on in-memory ports: CafAI's storage in memory, a mock
 * Decaid of its own (instant uploads, a clock that follows the story), a
 * telemetry fake with the machine and scale connected, and a model that
 * streams the story's coach turns in order. Only the clock, the ids and the
 * model's words are the demo's; the rest is the app's code.
 *
 * Deterministic: fixed ids, and times at fixed offsets before `nowMs`.
 */
import { createCoachPort } from '../../src/app/adapters.ts';
import { createCoachEngine, type CoachEngine } from '../../src/app/engine/engine.ts';
import type { OutboxTimers } from '../../src/app/engine/outbox.ts';
import type { CoachUiPart } from '../../src/app/types.ts';
import { DEFAULT_MODEL, resolveModel, runConversation, toToolDefinition, zodValidator } from '../../src/llm/index.ts';
import { LlmError, type ContentBlock, type LlmMessage, type LlmProvider, type LlmStreamEvent } from '../../src/llm/types.ts';
import type { CafaiExport } from '../../src/storage/types.ts';
import { createFakeTelemetry } from '../../src/ui/testing/fakeServices.ts';
import { createMockDecaid } from '../decaid/state.ts';
import { snapshotStore, type MockStoreSnapshot } from '../persist.ts';
import { demoCare } from './care.ts';
import { mockDecaidPort } from './decaidPort.ts';
import { createMemoryStorage } from './memoryStorage.ts';
import { pullShot } from './shots.ts';
import { DEMO_API_KEY, STARTING_GRINDER, STORY, type CoachReply, type StoryStep } from './story.ts';

export interface DemoBuild {
  /** CafAI's records after the story, as its export file holds them. */
  data: CafaiExport;
  /** The mock Decaid's store after the story: shots, CafAI's profiles, the workflow. */
  decaid: MockStoreSnapshot;
}

/** The app version written into the export (it is the demo's, not a release). */
const DEMO_APP_VERSION = 'demo';
/** How long the coach "thinks" before each turn, in data time. */
const THINK_MS = 2_500;
/** Each time the engine reads the clock, a little time passes, so records made together keep their order. */
const TICK_MS = 40;

/** Timers that never fire: the engine's 30 s retries and machine checks have nothing to do here. */
const NO_TIMERS: OutboxTimers = { setTimeout: () => 0, clearTimeout: () => undefined };

/** Let the engine's background writes (shot notes and ratings) finish: they only wait on promises. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function storyClock(startMs: number) {
  let current = startMs;
  return {
    /** For the engine: each read moves time on a little. */
    now(): Date {
      const at = current;
      current += TICK_MS;
      return new Date(at);
    },
    /** For the mock Decaid's data clock: a read never moves time. */
    peek: () => current,
    /** Jump to a moment of the story (never backwards). */
    set(ms: number) {
      current = Math.max(current, Math.round(ms));
    },
    advance(ms: number) {
      current += ms;
    },
  };
}

type Clock = ReturnType<typeof storyClock>;

/** A model that streams the story's coach turns, in the order the engine asks for them. */
function storyModel(clock: Clock) {
  const queue: CoachReply[] = [];
  let turns = 0;
  let tools = 0;
  const pad = (n: number) => String(n).padStart(2, '0');

  const provider: LlmProvider = {
    id: 'fake',
    async *stream(request): AsyncIterable<LlmStreamEvent> {
      const reply = queue.shift();
      if (!reply) throw new LlmError('protocol', `The demo story has no coach turn for this request (turn ${turns + 1}).`);
      clock.advance(THINK_MS);
      turns += 1;
      const turn = typeof reply === 'function' ? reply(request.messages) : reply;
      const content: ContentBlock[] = [{ type: 'thinking', thinking: '', signature: `demo-sig-${pad(turns)}` }];
      if (turn.text) content.push({ type: 'text', text: turn.text });
      for (const tool of turn.tools ?? []) {
        tools += 1;
        content.push({ type: 'tool_use', id: `toolu_demo_${pad(tools)}`, name: tool.name, input: tool.input });
      }
      const id = `msg_demo_${pad(turns)}`;
      yield { type: 'message_start', id, model: request.model };
      if (turn.text) yield { type: 'text_delta', index: 1, text: turn.text };
      yield {
        type: 'message_done',
        turn: {
          id,
          model: request.model,
          content,
          stopReason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    },
  };

  return {
    llm: {
      provider,
      run: (request: Parameters<typeof runConversation>[0]) => runConversation({ ...request, model: resolveModel(request.model) }),
      toolDefinition: toToolDefinition,
      validator: zodValidator,
    },
    expect(replies: readonly CoachReply[]) {
      queue.push(...replies);
    },
    /** Every turn the step wrote was asked for. */
    done(label: string) {
      if (queue.length > 0) throw new Error(`The demo story's ${label} has ${queue.length} coach turn(s) the engine never asked for.`);
    },
  };
}

function lastPart<K extends CoachUiPart['kind']>(
  engine: CoachEngine,
  kind: K,
  open: (part: Extract<CoachUiPart, { kind: K }>) => boolean,
): Extract<CoachUiPart, { kind: K }> {
  const parts = engine.getState().messages.flatMap((message) => message.parts);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]!;
    if (part.kind === kind && open(part as Extract<CoachUiPart, { kind: K }>)) return part as Extract<CoachUiPart, { kind: K }>;
  }
  throw new Error(`The demo story expected an open ${kind} card in the chat.`);
}

function describeStep(step: StoryStep, index: number): string {
  return `step ${index + 1} (${step.kind}, ${step.minutesAgo} min before)`;
}

/** Play the story through the coach engine and collect what it stored, and what Decaid holds. */
export async function buildDemo(nowMs: number): Promise<DemoBuild> {
  const first = STORY[0];
  const clock = storyClock(nowMs - (first ? first.minutesAgo : 0) * 60_000 - 60_000);
  const decaid = createMockDecaid({ seedExamples: false, uploadMs: 0, now: () => clock.peek() });
  const storage = createMemoryStorage({ defaultModel: DEFAULT_MODEL, settings: STARTING_GRINDER, apiKey: DEMO_API_KEY });
  const telemetry = createFakeTelemetry();
  const model = storyModel(clock);
  let ids = 0;
  const engine = createCoachEngine({
    storage,
    telemetry,
    api: mockDecaidPort(decaid),
    coach: createCoachPort(),
    llm: model.llm,
    clock: {
      now: () => clock.now(),
      sleep: async (ms) => clock.advance(ms),
    },
    newId: (prefix) => `${prefix}_demo_${String(++ids).padStart(3, '0')}`,
    shotFetch: { attempts: 1, delayMs: 0 },
    timers: NO_TIMERS,
    checkTimers: NO_TIMERS,
  });

  // A rating the engine refuses (a shot no card shows) waits its turn on the
  // engine's queue: awaiting it waits for a shot the engine took from telemetry.
  const drain = () => engine.rateShot('', 'same');

  try {
    await engine.start();
    await settle();
    for (const [index, step] of STORY.entries()) {
      const label = describeStep(step, index);
      clock.set(nowMs - step.minutesAgo * 60_000);
      switch (step.kind) {
        case 'newBag':
          await engine.newBag();
          break;
        case 'say':
          model.expect(step.coach);
          await engine.sendText(step.text);
          break;
        case 'pick': {
          model.expect(step.coach);
          const cards = lastPart(engine, 'templates', (part) => part.pickedTemplateId === null && !part.expired);
          await engine.pickTemplate(cards.requestId, step.templateId);
          break;
        }
        case 'shot':
        case 'strayShot': {
          const { record, endMs } = await pullShot(decaid, step.shot, clock.peek());
          telemetry.emitShot({ type: 'started', shotId: record.id });
          clock.set(endMs + 1_000);
          if (step.kind === 'shot') model.expect(step.coach);
          telemetry.emitShot({ type: 'finished', shotId: record.id, stopReason: record.stopReason ?? null });
          await drain();
          break;
        }
        case 'otherProfile':
          decaid.updateWorkflow({ profile: decaid.getProfile(step.profileId).profile });
          break;
        case 'retry':
          await engine.retry();
          break;
        case 'rate': {
          const card = lastPart(engine, 'shot', () => true);
          await engine.rateShot(card.shotId, step.verdict);
          break;
        }
        case 'measure': {
          const card = lastPart(engine, 'shot', () => true);
          await engine.setShotTds(card.shotId, step.tdsPct);
          break;
        }
        case 'answer': {
          model.expect(step.coach);
          const question = lastPart(engine, 'options', (part) => part.answer === null && !part.expired);
          await engine.answerOptions(question.requestId, step.selected, step.other);
          break;
        }
        case 'confirm':
        case 'decline': {
          model.expect(step.coach);
          const card = lastPart(engine, 'diff', (part) => part.status === 'pending');
          await (step.kind === 'confirm' ? engine.confirmChange(card.requestId) : engine.declineChange(card.requestId));
          break;
        }
        case 'undo':
          model.expect(step.coach);
          await engine.undo();
          break;
      }
      await settle();
      model.done(label);
      const state = engine.getState();
      // A stray shot puts "the machine is not running ..." on the banner, with Retry; nothing else may.
      if (state.error !== null && step.kind !== 'strayShot') throw new Error(`The demo story's ${label} ended with an error: ${state.error}`);
      if (state.busy) throw new Error(`The demo story's ${label} left the coach busy.`);
    }
    // The outbox keeps nothing: every note and rating reached Decaid.
    await settle();
    // Machine care's last times, the weekly clean due (mock/demo/care.ts).
    for (const record of demoCare(nowMs)) await storage.care.put(record);
    const exportedAt = new Date(nowMs).toISOString();
    return { data: storage.snapshot(exportedAt, DEMO_APP_VERSION), decaid: snapshotStore(decaid) };
  } finally {
    engine.dispose();
    decaid.dispose();
  }
}

/** The transcript of a built demo's bag, by its name (for tests and the seed's checks). */
export function conversationOf(build: DemoBuild, bagName: string): { apiMessages: LlmMessage[]; uiMessages: CafaiExport['conversations'][number]['uiMessages'] } {
  const bag = build.data.bags.find((candidate) => candidate.name === bagName);
  const conversation = bag ? build.data.conversations.find((candidate) => candidate.id === bag.conversationId) : undefined;
  if (!conversation) throw new Error(`The demo has no bag named ${bagName}.`);
  return { apiMessages: conversation.apiMessages, uiMessages: conversation.uiMessages };
}
