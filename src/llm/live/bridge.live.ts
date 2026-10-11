/**
 * Opt-in live test of CafAI Bridge (bridge/): the real Claude Code on this
 * computer, signed in with the owner's Claude plan, driven by CafAI's own
 * client, system prompt and coach tools the way the engine drives them
 * (docs/briefs/ENGINE_PROTOCOL.md). The bridge runs in-process on a free
 * loopback port. `npm test` and `npm run test:live` never run it.
 *
 *   npm run test:bridge-live            about eight turns on the plan, one of them on Haiku
 *   LIVE_BRIDGE_MODEL=claude-sonnet-5   coach with another model (default: CafAI's default)
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, assert, beforeAll, describe, expect, inject, it } from 'vitest';
import { startBridgeServer, type BridgeHandle } from '../../../bridge/lib/server.mjs';
import { grinderPayload, intakeBlocks, userMessage, type IntakeContext } from '../../app/engine/protocol.ts';
import { TOOL, TOOL_INPUTS } from '../../coach/contract.ts';
import { TEMPLATES, buildSystemPrompt, todayOf } from '../../coach/index.ts';
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  createAnthropicProvider,
  describeIssues,
  resolveModel,
  runConversation,
  type LlmMessage,
  type LlmProvider,
  type PendingUiCall,
  type ToolResultBlock,
} from '../index.ts';
import {
  bagNameOf,
  coachRunnerTools,
  contractProblems,
  errorResults,
  settle,
  templatePickedPayload,
  templatePickedTurn,
} from './harness.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** True only under vitest.bridge.config.ts. */
    cafaiBridgeLive?: boolean;
  }
}

const enabled = inject('cafaiBridgeLive') === true;
const CODE = 'LIVE-TEST';
const MODEL = resolveModel(process.env.LIVE_BRIDGE_MODEL ?? DEFAULT_MODEL);
const BAG = 'Kiambu AA from Square Mile, a washed Kenyan, light roast. Blackcurrant, grapefruit and brown sugar.';
const INTAKE_CONTEXT: IntakeContext = {
  grinder: grinderPayload('Niche Zero', '15', null, false),
  scaleConnected: true,
  doseG: null,
  bag: null,
  roast: null,
  today: todayOf(new Date()),
};

interface Status {
  claude: { found: boolean; version?: string };
  account: { loggedIn: boolean; authMethod: string | null } | null;
  usage: { status: string; fiveHour?: { utilization: number } } | null;
  problems: string[];
  probe?: { ok: boolean; error?: string };
}

/** A small solid red PNG: the photo request's plumbing, not the model's eyesight. */
function solidPng(size = 32): string {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) value = (table[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([220, 20, 30]))]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

describe.skipIf(!enabled)(`CafAI Bridge, live: this computer's Claude Code coaching on ${MODEL}`, () => {
  let bridge: BridgeHandle | null = null;
  let provider: LlmProvider | null = null;
  let baseUrl = '';
  const log: string[] = [];
  const starts = () => log.filter((line) => line.includes(': started for')).length;

  beforeAll(async () => {
    bridge = await startBridgeServer({
      code: CODE,
      port: 0,
      host: '127.0.0.1',
      workDir: mkdtempSync(path.join(tmpdir(), 'cafai-bridge-live-')),
      version: 'live-test',
      log: (line) => log.push(line),
    });
    baseUrl = `http://127.0.0.1:${bridge.port}`;
    provider = createAnthropicProvider({ baseUrl, getApiKey: () => Promise.resolve(CODE) });
  });
  afterAll(async () => {
    await bridge?.close();
    // The bridge logs timings, counts and model ids, never what was said.
    console.log(`CafAI Bridge log:\n${log.join('\n')}`);
  });

  async function status(probe: boolean): Promise<Status> {
    const response = await fetch(`${baseUrl}/v1/status${probe ? '?probe=1' : ''}`, { headers: { 'x-api-key': CODE } });
    return (await response.json()) as Status;
  }

  const system = buildSystemPrompt(TEMPLATES);
  const tools = coachRunnerTools();
  const transcript: LlmMessage[] = [];
  let intake: { pick: PendingUiCall; held: ToolResultBlock[]; templateId: string } | null = null;

  function run(maxModelCalls: number, signal: AbortSignal, effort = DEFAULT_EFFORT) {
    if (!provider) throw new Error('The bridge did not start.');
    const using = provider;
    return settle(
      () =>
        runConversation({
          provider: using,
          model: MODEL,
          system,
          effort,
          messages: transcript,
          tools,
          signal,
          maxModelCalls,
          onAppend: (message) => {
            transcript.push(message);
          },
        }),
      CODE,
    );
  }

  it('1. finds Claude Code signed in with a Claude plan, and a tiny turn answers', async () => {
    const body = await status(true);
    expect(body.claude.found, 'Claude Code found').toBe(true);
    expect(body.account?.loggedIn, 'signed in').toBe(true);
    expect(body.account?.authMethod, 'signed in with a Claude plan, not an API key').toBe('claude.ai');
    expect(body.probe, 'the probe turn').toMatchObject({ ok: true });
    expect(body.problems).toEqual([]);
  });

  it('2. intake: strict tools through MCP, inputs inside the contract, propose_templates pending', async ({ signal }) => {
    transcript.push(userMessage(intakeBlocks(BAG, INTAKE_CONTEXT)));
    const result = await run(3, signal);
    if (!result.ok) assert.fail(`The intake run failed: ${result.failure}`);
    expect(contractProblems(transcript), 'tool inputs outside the contract').toEqual([]);
    expect(errorResults(transcript, result.value.heldResults), 'tool calls answered with an error').toEqual([]);
    const pick = result.value.pendingUiCalls.find((call) => call.name === TOOL.proposeTemplates);
    if (!pick) assert.fail(`No propose_templates call is pending (stop reason ${result.value.stopReason}).`);
    const parsed = TOOL_INPUTS[TOOL.proposeTemplates].safeParse(pick.input);
    if (!parsed.success) assert.fail(`propose_templates: ${describeIssues(parsed.error.issues)}`);
    const best = parsed.data.suggestions[0]?.templateId;
    if (!best) assert.fail('propose_templates suggested nothing.');
    intake = { pick, held: result.value.heldResults, templateId: best };
    expect(starts(), 'one Claude Code process for the conversation').toBe(1);
  });

  it('3. the template pick answers the held call and the same process carries on', async ({ signal, skip }) => {
    const before = intake;
    if (!before) return skip('needs the pending propose_templates call from check 2');
    const stored = transcript.length;
    transcript.push(templatePickedTurn(transcript, before.held, before.pick.id, templatePickedPayload(before.templateId, bagNameOf(transcript))));
    const result = await run(3, signal);
    if (!result.ok) assert.fail(`The run after the pick failed: ${result.failure}`);
    const reply = transcript.slice(stored + 1);
    expect(reply.length, 'assistant turns after the pick').toBeGreaterThan(0);
    expect(contractProblems(reply), 'tool inputs outside the contract').toEqual([]);
    expect(starts(), 'still one Claude Code process').toBe(1);
  });

  it('4. a conversation the bridge holds no process for is replayed, and the coach answers in context', async ({ signal }) => {
    if (transcript.length === 0) transcript.push(userMessage(intakeBlocks(BAG, INTAKE_CONTEXT)));
    transcript.push(userMessage([{ type: 'text', text: 'Before I pull the first shot: what dose should I use for this coffee, in one sentence?' }]));
    const stored = transcript.length;
    // Another effort is another configuration, so the live process cannot take it: a new one replays the transcript.
    const result = await run(3, signal, 'low');
    if (!result.ok) assert.fail(`The replayed run failed: ${result.failure}`);
    expect(log.some((line) => line.includes('(replayed)')), 'a replayed start').toBe(true);
    const reply = transcript.slice(stored);
    expect(reply.length, 'assistant turns').toBeGreaterThan(0);
    expect(contractProblems(reply), 'tool inputs outside the contract').toEqual([]);
  });

  it('5. a photo reaches the model: the bag-photo request shape, with a red square instead of a bag', async ({ signal }) => {
    if (!provider) assert.fail('The bridge did not start.');
    const using = provider;
    const result = await settle(async () => {
      let text = '';
      // As extractBag sends it (6.8): one user message, the image first, no system prompt, no tools, no cache.
      for await (const event of using.stream({
        model: MODEL,
        system: '',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: solidPng() } },
              { type: 'text', text: 'What single colour fills this picture? Answer with one word.' },
            ],
          },
        ],
        tools: [],
        maxTokens: 4096,
        effort: 'low',
        cache: false,
        signal,
      })) {
        if (event.type === 'text_delta') text += event.text;
      }
      return text;
    }, CODE);
    if (!result.ok) assert.fail(`The photo request failed: ${result.failure}`);
    expect(result.value, 'the colour the model saw').toMatch(/red/i);
  });

  it("6. reports the plan's usage in the shape this Claude Code sends", async () => {
    const body = await status(false);
    expect(body.usage?.status, 'usage seen on the runs').toBeTruthy();
    expect(typeof body.usage?.fiveHour?.utilization, "the 5-hour window's use").toBe('number');
  });
});
