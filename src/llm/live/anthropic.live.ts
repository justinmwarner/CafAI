/**
 * Opt-in smoke test against the real Anthropic API: CafAI's own client,
 * system prompt and nine strict tools, driven the way the coach engine drives
 * them (docs/briefs/ENGINE_PROTOCOL.md). `npm test` never runs it.
 *
 *   ANTHROPIC_API_KEY=... npm run test:live   checks 1 and 2: at most 3 API calls
 *   ... plus LIVE_ALL_MODELS=1                check 3: one tiny request per model in Settings
 *   LIVE_DRY_RUN=1 npm run test:live          the same checks against the scripted fake over
 *                                             MSW: no key, no network, even when a key is set
 *
 * Without a key every check is reported as skipped. The key is read from the
 * environment when a request is made and is never logged, printed or stored;
 * every failure message goes through scrubKey(). Nothing else is printed.
 */
import { setupServer } from 'msw/node';
import { afterAll, assert, beforeAll, describe, expect, inject, it } from 'vitest';
import { anthropicHandlers, resetAnthropicMock } from '../../../mock/anthropic/handlers.ts';
import { intakeBlocks, userMessage, type IntakeContext } from '../../app/engine/protocol.ts';
import { TEMPLATE_IDS, TOOL, TOOL_INPUTS } from '../../coach/contract.ts';
import { TEMPLATES, buildSystemPrompt } from '../../coach/index.ts';
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  MODELS,
  createAnthropicProvider,
  describeIssues,
  resolveModel,
  runConversation,
  type LlmAssistantTurn,
  type LlmMessage,
  type PendingUiCall,
  type ToolResultBlock,
} from '../index.ts';
import {
  LIVE_SUITE_FLAG,
  bagNameOf,
  coachRunnerTools,
  contractProblems,
  errorResults,
  liveMode,
  recordBodies,
  sentMessagesJson,
  settle,
  templatePickedPayload,
  templatePickedTurn,
  withCallBudget,
} from './harness.ts';

const mode = liveMode(process.env, inject(LIVE_SUITE_FLAG) === true);

/** What a fresh install coaches with: Settings starts at DEFAULT_MODEL and the app's LLM port resolves it so. */
const COACH_MODEL = resolveModel(DEFAULT_MODEL);
/** The scripted fake accepts any non-empty key; this one is not shaped like a real one. */
const DRY_RUN_KEY = 'dry-run-placeholder';
/** Checks 1 and 2 together never start more model requests than this. */
const CALL_BUDGET = 3;
/** Intake may take two turns: save_bag_details on its own, then propose_templates. */
const INTAKE_CALLS = 2;
/** Room for adaptive thinking before a one-word answer. */
const TINY_MAX_TOKENS = 1024;

const CATALOG: readonly string[] = TEMPLATE_IDS;
const BAG = 'Kiambu AA from Square Mile, a washed Kenyan, light roast. Blackcurrant, grapefruit and brown sugar.';
const INTAKE_CONTEXT: IntakeContext = { grinder: { name: 'Niche Zero', setting: '15' }, scaleConnected: true };
const TINY: LlmMessage = userMessage([{ type: 'text', text: 'Reply with the single word OK.' }]);

/** Read per request and never kept. The dry run never sees the real key. */
function apiKey(): string | null {
  return mode.kind === 'dry-run' ? DRY_RUN_KEY : (process.env.ANTHROPIC_API_KEY ?? null);
}

function suiteTitle(): string {
  if (mode.kind === 'skip') return `Anthropic API, live (skipped: ${mode.reason})`;
  return mode.kind === 'dry-run' ? 'Anthropic API, dry run (the scripted fake model over MSW)' : 'Anthropic API, live';
}

describe.skipIf(mode.kind === 'skip')(suiteTitle(), () => {
  let server: ReturnType<typeof setupServer> | null = null;

  beforeAll(() => {
    if (mode.kind !== 'dry-run') return;
    resetAnthropicMock();
    server = setupServer(...anthropicHandlers({ speed: Infinity }));
    // Nothing leaves the process in a dry run: a request no handler matches fails.
    server.listen({ onUnhandledRequest: 'error' });
  });
  afterAll(() => server?.close());

  const system = buildSystemPrompt(TEMPLATES);
  const tools = coachRunnerTools();
  const recorder = recordBodies();
  const budget = withCallBudget(
    createAnthropicProvider({ getApiKey: () => Promise.resolve(apiKey()), fetch: recorder.fetch }),
    CALL_BUDGET,
  );
  /** The bag's append-only transcript, kept the way the engine keeps it. */
  const transcript: LlmMessage[] = [];
  let intake: { pick: PendingUiCall; held: ToolResultBlock[]; templateId: string; stored: string } | null = null;

  /** One engine run: the model default, effort medium, the full system prompt and all nine tools. */
  function runModel(maxModelCalls: number, signal: AbortSignal) {
    return settle(
      () =>
        runConversation({
          provider: budget.provider,
          model: COACH_MODEL,
          system,
          effort: DEFAULT_EFFORT,
          messages: transcript,
          tools,
          signal,
          maxModelCalls,
          onAppend: (message) => {
            transcript.push(message);
          },
        }),
      apiKey(),
    );
  }

  it(`1. intake on ${COACH_MODEL}: strict tools, inputs inside the contract, propose_templates pending`, async ({
    signal,
  }) => {
    transcript.push(userMessage(intakeBlocks(BAG, INTAKE_CONTEXT)));
    const result = await runModel(INTAKE_CALLS, signal);
    if (!result.ok) assert.fail(`The intake run failed after ${budget.used} API call(s): ${result.failure}`);
    const { pendingUiCalls, heldResults, stopReason } = result.value;

    expect(contractProblems(transcript), 'tool inputs outside the contract').toEqual([]);
    expect(errorResults(transcript, heldResults), 'tool calls answered with an error').toEqual([]);

    const pick = pendingUiCalls.find((call) => call.name === TOOL.proposeTemplates);
    if (!pick) {
      const pending = pendingUiCalls.map((call) => call.name).join(', ') || 'none';
      assert.fail(`No propose_templates call is pending (stop reason ${stopReason}; pending: ${pending}).`);
    }
    const parsed = TOOL_INPUTS[TOOL.proposeTemplates].safeParse(pick.input);
    if (!parsed.success) assert.fail(`propose_templates: ${describeIssues(parsed.error.issues)}`);
    const ids = parsed.data.suggestions.map((suggestion) => suggestion.templateId);
    expect(ids.length, 'number of suggestions').toBeGreaterThanOrEqual(2);
    expect(ids.length, 'number of suggestions').toBeLessThanOrEqual(5);
    expect(ids.filter((id) => !CATALOG.includes(id)), 'template ids outside the catalog').toEqual([]);
    expect(new Set(ids).size, 'each template suggested once').toBe(ids.length);

    const best = ids[0];
    if (best === undefined) assert.fail('propose_templates suggested nothing.');
    intake = { pick, held: heldResults, templateId: best, stored: JSON.stringify(transcript) };
  });

  it('2. after a template pick, the stored transcript replays unchanged and the API accepts it', async ({
    signal,
    skip,
  }) => {
    const before = intake;
    if (!before) return skip('needs the pending propose_templates call from check 1');
    expect(JSON.stringify(transcript) === before.stored, 'the stored transcript is unchanged since check 1').toBe(true);

    // The user taps the best suggestion; the engine answers every pending call in one user turn.
    const payload = templatePickedPayload(before.templateId, bagNameOf(transcript));
    transcript.push(templatePickedTurn(transcript, before.held, before.pick.id, payload));
    const expected = JSON.stringify(transcript);
    const storedLength = transcript.length;
    const sentBefore = recorder.bodies.length;
    const limit = budget.remaining;

    const result = await runModel(limit, signal);
    if (!result.ok) {
      assert.fail(
        transcript.length > storedLength
          ? `The API accepted the replayed transcript, but the run stopped within its ${limit} API call(s): ${result.failure}`
          : `The replayed transcript was rejected: ${result.failure}`,
      );
    }

    const body = recorder.bodies[sentBefore];
    expect(
      body !== undefined && sentMessagesJson(body) === expected,
      'the replay request carries the stored transcript byte for byte',
    ).toBe(true);
    const reply = transcript.slice(storedLength);
    expect(reply.length, 'assistant turns after the pick').toBeGreaterThan(0);
    expect(contractProblems(reply), 'tool inputs outside the contract').toEqual([]);
    expect(errorResults(reply, result.value.heldResults), 'tool calls answered with an error').toEqual([]);
  });

  // Flat rather than a nested describe: Vitest reports tests of a skipped suite
  // inside a skipped suite as neither run nor skipped.
  const picker = createAnthropicProvider({ getApiKey: () => Promise.resolve(apiKey()) });
  for (const model of MODELS) {
    const effort = model.supportsEffort ? `effort ${DEFAULT_EFFORT} sent` : 'no effort sent';
    const title = `3. picker model ${model.id} (${model.label}) answers a tiny streamed request, ${effort}`;
    it.skipIf(!mode.allModels)(`${title}${mode.allModels ? '' : ' (needs LIVE_ALL_MODELS=1)'}`, async ({ signal }) => {
      const result = await settle(async () => {
        let turn: LlmAssistantTurn | null = null;
        const events = picker.stream({
          model: resolveModel(model.id),
          system: '',
          messages: [TINY],
          tools: [],
          effort: DEFAULT_EFFORT,
          maxTokens: TINY_MAX_TOKENS,
          signal,
        });
        for await (const event of events) {
          if (event.type === 'message_done') turn = event.turn;
        }
        return turn;
      }, apiKey());
      if (!result.ok) assert.fail(`${model.id}: ${result.failure}`);
      expect(result.value, `${model.id}: the stream ended without a finished turn`).not.toBeNull();
    });
  }
});
