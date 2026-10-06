// The scripted coach's stream timing, through the MSW handler itself, on fake
// timers: today's defaults stay exact, and the demo's options (D76) give a
// ~1.5 s "Thinking…", jittered gaps and sentence pauses, scaled by ?mockSpeed.
import { getResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { TOOL, TOOL_INPUTS } from '../../src/coach/contract.ts';
import { anthropicHandlers, type AnthropicMockOptions } from './handlers.ts';
import { createScenarioMemory, type ScenarioMemory } from './scenario.ts';

type Block = Record<string, unknown>;
type Message = { role: 'user' | 'assistant'; content: Block[] };

/** What the demo passes (mock/plan.ts DEMO_COACH_OPTIONS). */
const DEMO: AnthropicMockOptions = { firstEventDelayMs: 1300, eventDelayMs: 50, jitterMs: 20, sentencePauseMs: 150, voice: 'demo' };

const TOOLS = Object.keys(TOOL_INPUTS).map((name) => ({
  name,
  description: name,
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  strict: true,
}));

const text = (t: string): Block => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: unknown = {}): Block => ({ type: 'tool_use', id, name, input });
const toolResult = (id: string, payload: unknown): Block => ({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(payload) });
const user = (...content: Block[]): Message => ({ role: 'user', content });
const assistant = (...content: Block[]): Message => ({ role: 'assistant', content });

const PICKED_CONVERSATION: Message[] = [
  user(
    text('Kiambu AA, light roast, washed, from Kenya.'),
    text('[context]\n{"grinder":{"name":"Niche Zero","setting":"14"},"scaleConnected":true,"doseG":18}'),
  ),
  assistant(
    text('Lovely.'),
    toolUse('t_save', TOOL.saveBagDetails, { name: 'Kiambu AA', roaster: null, origin: 'Kenya', roastLevel: 'light', process: 'washed', notes: null }),
    toolUse('t_tpl', TOOL.proposeTemplates, { suggestions: [] }),
  ),
  user(
    toolResult('t_save', { saved: true }),
    toolResult('t_tpl', { picked: 'blooming-espresso', version: 1, title: 'Kiambu AA v1', yieldG: 50, doseG: 18, uploaded: true, onMachine: true, loadError: null, note: null }),
  ),
];

/** The demo's open question, answered "Sour / sharp". */
const SOUR_CONVERSATION: Message[] = [
  ...PICKED_CONVERSATION,
  assistant(text('Loaded Kiambu AA v1.')),
  user(
    text(
      '[event:shot_completed]\n' +
        JSON.stringify({
          shotRef: 'latest',
          shotId: 'shot-1',
          version: 1,
          templateId: 'blooming-espresso',
          levers: { temp: 92, yield: 50, bloom: 30, piExit: 4, flow: 2.2 },
          doseG: 18,
          targetYieldG: 50,
          summary: { shotId: 'shot-1', durationS: 41.2, yieldG: 49.6, doseG: 18, channelingFlags: [] },
        }),
    ),
  ),
  assistant(text('Got it.'), toolUse('t_ask', TOOL.askUser, { question: 'How did it taste?' })),
  user(toolResult('t_ask', { selected: ['Sour / sharp'], other: null })),
];

function apiRequest(messages: Message[]): Request {
  return new Request('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      stream: true,
      messages,
      tools: TOOLS,
      tool_choice: { type: 'auto' },
    }),
  });
}

interface Frame {
  /** ms after the request, on the fake clock. */
  at: number;
  event: string;
  data: Record<string, unknown>;
}

/**
 * Send `messages` to the handler on fake timers and read the whole stream,
 * noting when each event arrived. Without chunkBytes every chunk is one event.
 */
async function play(options: AnthropicMockOptions, messages: Message[], memory: ScenarioMemory = createScenarioMemory({ session: 'pace' })) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    const start = Date.now();
    const response = await getResponse(anthropicHandlers({ ...options, memory }), apiRequest(messages));
    if (!response?.body) throw new Error('expected a streamed reply');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const frames: Frame[] = [];
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        const [eventLine = '', dataLine = ''] = decoder.decode(value).split('\n');
        frames.push({ at: Date.now() - start, event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) });
      }
    })();
    await vi.runAllTimersAsync();
    await reading;
    return frames;
  } finally {
    vi.useRealTimers();
  }
}

const deltaOf = (frame: Frame | undefined) => (frame?.data.delta ?? {}) as { type?: string; text?: string };
const isText = (frame: Frame) => deltaOf(frame).type === 'text_delta';
const replyText = (frames: Frame[]) => frames.filter(isText).map((frame) => deltaOf(frame).text).join('');
/** gaps[i]: ms between event i - 1 and event i (gaps[0] is the wait for the first event). */
const gapsOf = (frames: Frame[]) => frames.map((frame, i) => frame.at - (frames[i - 1]?.at ?? 0));
/** The brief's sentence end: ., ?, ! or :, then optional closing quotes or brackets and whitespace. */
const endsSentence = (frame: Frame | undefined) => /[.?!:]["'”’)\]]*\s*$/.test(deltaOf(frame).text ?? '');

describe('stream timing', () => {
  it("keeps today's defaults: the first event after 400 ms, then one every 25 ms, with the terse lines", async () => {
    const sour = await play({}, SOUR_CONVERSATION);
    expect(sour[0]?.at).toBe(400);
    expect(gapsOf(sour).slice(1).every((gap) => gap === 25)).toBe(true);
    expect(replyText(sour)).toBe('Thanks. Let me look at the pressure curve.');

    const picked = await play({}, PICKED_CONVERSATION);
    expect(gapsOf(picked)).toEqual([400, ...picked.slice(1).map(() => 25)]);
    expect(replyText(picked)).toBe('Loaded Kiambu AA v1. Pull a shot when you are ready; I will read the curves.');
  });

  it('with the demo options, the first text arrives about 1.5 s after the request', async () => {
    for (const messages of [SOUR_CONVERSATION, PICKED_CONVERSATION]) {
      const frames = await play(DEMO, messages);
      const first = frames.find(isText);
      expect(frames[0]?.at).toBe(1300);
      expect(first?.at).toBeGreaterThanOrEqual(1300);
      expect(first?.at).toBeLessThanOrEqual(1800);
    }
  });

  it('jitters the gaps within eventDelayMs ± jitterMs, and pauses after a sentence', async () => {
    const frames = await play(DEMO, SOUR_CONVERSATION);
    const gaps = gapsOf(frames);
    const plainGaps = gaps.filter((_, i) => i > 0 && !endsSentence(frames[i - 1]));
    for (const gap of plainGaps) {
      expect(gap).toBeGreaterThanOrEqual(30);
      expect(gap).toBeLessThanOrEqual(70);
    }
    expect(new Set(plainGaps).size).toBeGreaterThan(5);

    // The same reply without the pause: only the gaps after a sentence end change, by exactly the pause.
    const unpaused = await play({ ...DEMO, sentencePauseMs: 0 }, SOUR_CONVERSATION);
    const added = gaps.map((gap, i) => gap - (gapsOf(unpaused)[i] ?? Number.NaN));
    const sentenceEnds = frames.map((_, i) => i > 0 && endsSentence(frames[i - 1]));
    expect(sentenceEnds.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(added).toEqual(sentenceEnds.map((ends) => (ends ? 150 : 0)));
  });

  it('divides every delay by the speed (?mockSpeed=25)', async () => {
    const normal = gapsOf(await play(DEMO, SOUR_CONVERSATION));
    const fast = gapsOf(await play({ ...DEMO, speed: 25 }, SOUR_CONVERSATION));
    expect(fast).toHaveLength(normal.length);
    expect(fast[0]).toBe(52);
    // Timers run on whole milliseconds, so each gap may lose up to 1 ms.
    fast.forEach((gap, i) => expect(Math.abs(gap - (normal[i] ?? Number.NaN) / 25)).toBeLessThanOrEqual(1));
  });

  it('sends everything at once at speed Infinity', async () => {
    const frames = await play({ ...DEMO, speed: Infinity }, SOUR_CONVERSATION);
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.every((frame) => frame.at === 0)).toBe(true);
    expect(frames.at(-1)?.event).toBe('message_stop');
  });

  it('streams a conversation with the same rhythm on every run, and the next request with another', async () => {
    const first = await play(DEMO, SOUR_CONVERSATION, createScenarioMemory({ session: 'one' }));
    const again = await play(DEMO, SOUR_CONVERSATION, createScenarioMemory({ session: 'two' }));
    expect(gapsOf(again)).toEqual(gapsOf(first));
    expect(replyText(again)).toBe(replyText(first));

    // The jitter is seeded from the request count: request 2 gets other gaps.
    const memory = createScenarioMemory({ session: 'three' });
    await play(DEMO, SOUR_CONVERSATION, memory);
    const second = await play(DEMO, SOUR_CONVERSATION, memory);
    expect(gapsOf(second)).not.toEqual(gapsOf(first));
  });
});

describe('voice option', () => {
  it('passes the demo voice to the script and keeps the terse one by default', async () => {
    const terse = await play({ speed: Infinity }, SOUR_CONVERSATION);
    const demo = await play({ speed: Infinity, voice: 'demo' }, SOUR_CONVERSATION);
    expect(replyText(terse)).toBe('Thanks. Let me look at the pressure curve.');
    expect(replyText(demo)).not.toBe(replyText(terse));
    expect(replyText(demo).length).toBeGreaterThan(replyText(terse).length);
    const tools = (frames: Frame[]) =>
      frames.filter((frame) => frame.event === 'content_block_start').map((frame) => (frame.data.content_block as { type: string; name?: string }).name ?? null);
    expect(tools(demo)).toEqual(tools(terse));
  });
});
