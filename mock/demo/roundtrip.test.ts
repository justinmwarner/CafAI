/**
 * The demo, opened in the real app's engine: CafAI's IndexedDB storage as
 * startDemo() seeded it, CafAI's own Decaid client and Anthropic client over
 * fetch, answered through MSW in Node by the mock Decaid (seeded the same
 * way) and the real scripted coach (its default timing and voice, played
 * without delays).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDecaidClient } from '../../src/api/client.ts';
import { createApiPort, createCoachPort, createLlmPort } from '../../src/app/adapters.ts';
import { createCoachEngine, type CoachEngine } from '../../src/app/engine/engine.ts';
import type { OutboxTimers } from '../../src/app/engine/outbox.ts';
import type { CoachUiPart } from '../../src/app/types.ts';
import { DEFAULT_MODEL } from '../../src/llm/models.ts';
import { createIdbStorage, type IdbStorage } from '../../src/storage/index.ts';
import { createFakeTelemetry } from '../../src/ui/testing/fakeServices.ts';
import { newId } from '../../src/util/id.ts';
import { anthropicHandlers, resetAnthropicMock } from '../anthropic/handlers.ts';
import { createMockServer, type MockServer } from '../node.ts';
import type { NoteDocument } from './guard.ts';
import { startDemo, type DemoHost } from './index.ts';

let run = 0;
let mock: MockServer;
let storage: IdbStorage;
let engine: CoachEngine;
/** The engine's 30 s looks at the machine, fired by hand. */
let beats: Array<() => void>;

const NO_TIMERS: OutboxTimers = { setTimeout: () => 0, clearTimeout: () => undefined };
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function nodeHost(): DemoHost {
  const values = new Map<string, string>();
  return {
    location: { pathname: '/', search: '?demo=1', hash: '#/', replace: () => undefined },
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) },
    // The guard lets an empty address seed, so no note is ever shown here.
    document: {} as NoteDocument,
  };
}

/** Wait for everything the engine has queued (a refused 0-star rating waits its turn). */
async function idle(): Promise<void> {
  await engine.rateShot('', 0);
  await settle();
}

function allParts(): CoachUiPart[] {
  return engine.getState().messages.flatMap((message) => message.parts);
}

function openQuestion(): Extract<CoachUiPart, { kind: 'options' }> {
  const open = allParts().filter((part): part is Extract<CoachUiPart, { kind: 'options' }> => part.kind === 'options' && part.answer === null);
  expect(open).toHaveLength(1);
  return open[0]!;
}

function pendingChange(): Extract<CoachUiPart, { kind: 'diff' }> {
  const pending = allParts().filter((part): part is Extract<CoachUiPart, { kind: 'diff' }> => part.kind === 'diff' && part.status === 'pending');
  expect(pending).toHaveLength(1);
  return pending[0]!;
}

beforeEach(async () => {
  run += 1;
  const names = { dbName: `cafai-roundtrip-${run}`, secretsDbName: `cafai-roundtrip-secrets-${run}` };
  resetAnthropicMock();
  mock = createMockServer(anthropicHandlers({ speed: Infinity }), { seedExamples: false, uploadMs: 0 });
  mock.server.listen({ onUnhandledRequest: 'error' });
  expect(await startDemo(mock.state, nodeHost(), names)).toEqual({ seeded: true });

  const decaid = createDecaidClient({ origin: 'http://localhost:8080' });
  storage = await createIdbStorage({ kv: decaid.kv, appVersion: 'roundtrip', defaultModel: DEFAULT_MODEL, ...names });
  beats = [];
  engine = createCoachEngine({
    storage,
    telemetry: createFakeTelemetry(),
    api: createApiPort(decaid),
    coach: createCoachPort(),
    llm: createLlmPort(storage.secrets),
    clock: { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    newId,
    timers: NO_TIMERS,
    checkTimers: {
      setTimeout(callback) {
        beats.push(callback);
        return beats.length;
      },
      clearTimeout: () => undefined,
    },
  });
  await engine.start();
  await idle();
});

afterEach(() => {
  engine.dispose();
  storage.close();
  mock.close();
});

describe('opening the demo', () => {
  it('adds no message and raises no banner, also when the 30 s look repeats', async () => {
    const kiambu = engine.getState().activeBag!;
    const stored = await storage.conversations.get(kiambu.conversationId);
    const state = engine.getState();
    expect(state.messages).toEqual(stored!.uiMessages);
    expect(state.error).toBeNull();
    expect(state.phase).toBe('awaiting_feedback');
    expect(state.activeVersion?.title).toBe('Kiambu AA v4');
    expect(state.canUndo).toBe(true);
    expect(state.hasApiKey).toBe(true);

    beats.shift()!();
    await idle();
    expect(engine.getState().error).toBeNull();
    expect(engine.getState().messages).toEqual(stored!.uiMessages);
  });

  it('switches to Santos and loads its v1 on the mock machine', async () => {
    const santos = engine.getState().bags.find((bag) => bag.name === 'Santos')!;
    await engine.selectBag(santos.id);
    const state = engine.getState();
    expect(state.activeBag?.name).toBe('Santos');
    expect(state.error).toBeNull();
    const notices = allParts().filter((part) => part.kind === 'notice').map((part) => (part as { text: string }).text);
    expect(notices[notices.length - 1]).toBe('Loaded Santos v1 on the machine.');
    expect(mock.state.getWorkflow().profile.title).toBe('Santos v1');
  });
});

describe('answering the open question', () => {
  it('"Sour / sharp" ends with a pending Kiambu AA v5, 1 °C hotter, which Confirm creates and loads', async () => {
    const coachTexts = () => engine.getState().messages.filter((message) => message.role === 'assistant').length;
    const before = coachTexts();
    await engine.answerOptions(openQuestion().requestId, ['Sour / sharp'], null);
    await idle();
    expect(engine.getState().error).toBeNull();
    expect(coachTexts()).toBeGreaterThan(before);
    const card = pendingChange();
    expect(card.versionLabel).toBe('Kiambu AA v5');
    expect(card.lines).toEqual(['Brew temperature: 93.0 °C -> 94.0 °C (every step +1.0 °C)']);

    await engine.confirmChange(card.requestId);
    await idle();
    const state = engine.getState();
    expect(state.error).toBeNull();
    expect(state.activeVersion?.title).toBe('Kiambu AA v5');
    expect(allParts().some((part) => part.kind === 'notice' && part.text === 'Loaded Kiambu AA v5 on the machine.')).toBe(true);
    expect(mock.state.getWorkflow().profile.title).toBe('Kiambu AA v5');
    const versions = await storage.versions.listByBag(state.activeBag!.id);
    expect(versions.map((version) => [version.version, version.status])).toEqual([
      [1, 'superseded'],
      [2, 'superseded'],
      [3, 'undone'],
      [4, 'superseded'],
      [5, 'active'],
    ]);
  });

  /** Shot four ran out of steps short of its 50 g stop, so a yield move would never be reached: the grind moves instead. */
  const byHand = (setting: string) => (card: Extract<CoachUiPart, { kind: 'diff' }>) => {
    expect(card.versionLabel).toBeNull();
    expect(card.manualSteps).toEqual([`Set the grinder to ${setting} before the next shot (Decaid lists 0.5 steps for your Niche Zero).`]);
  };
  const others: Array<[string[], string | null, (card: Extract<CoachUiPart, { kind: 'diff' }>) => void]> = [
    [['Bitter / harsh'], null, (card) => expect(card.lines).toEqual(['Brew temperature: 93.0 °C -> 92.0 °C (every step -1.0 °C)'])],
    [['Balanced, sweet'], null, (card) => expect(card).toMatchObject({ versionLabel: null, summary: 'Keep everything as it is' })],
    [['Weak / watery'], null, byHand('14.0')],
    [['Other'], 'Too strong', byHand('15.0')],
    [['Other'], 'A bit flat and dull', byHand('14.0')],
  ];

  for (const [selected, other, check] of others) {
    it(`"${other ?? selected[0]}" gets a coach reply with a change to confirm, and no error banner`, async () => {
      await engine.answerOptions(openQuestion().requestId, selected, other);
      await idle();
      expect(engine.getState().error).toBeNull();
      check(pendingChange());
    });
  }

  it('a taste typed instead of tapped is read like the answer: "sour" ends with v5, 1 °C hotter', async () => {
    await engine.sendText('It tasted a bit sour, sharp at the end');
    await idle();
    expect(engine.getState().error).toBeNull();
    const card = pendingChange();
    expect(card.versionLabel).toBe('Kiambu AA v5');
    expect(card.lines).toEqual(['Brew temperature: 93.0 °C -> 94.0 °C (every step +1.0 °C)']);
  });

  it('typed text without a taste word is the taste too, read as the same words under Other: one step finer', async () => {
    await engine.sendText('Flat and a bit dull, the fruit is hiding');
    await idle();
    expect(engine.getState().error).toBeNull();
    byHand('14.0')(pendingChange());
  });

  it('text typed with no taste question open gets the usual reply and no change', async () => {
    await engine.answerOptions(openQuestion().requestId, ['Balanced, sweet'], null);
    await idle();
    // The keep card is open now, not the taste question: the text sets the card aside.
    await engine.sendText('Should it drip during the bloom?');
    await idle();
    expect(engine.getState().error).toBeNull();
    expect(allParts().some((part) => part.kind === 'diff' && part.status === 'pending')).toBe(false);
    const coach = engine.getState().messages.filter((message) => message.role === 'assistant');
    const last = coach[coach.length - 1]!.parts.find((part) => part.kind === 'text') as { text: string } | undefined;
    expect(last?.text).toBe('Got it. Pull a shot when you are ready, or tell me more about the coffee.');
  });
});
