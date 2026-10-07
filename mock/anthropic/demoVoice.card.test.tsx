// @vitest-environment jsdom
// The demo voice quotes a shot's peak as its shot card shows it: the same
// pressure at the same second of the pour. Checked on the cards CafAI renders
// for the demo's own shots and for real Decaid records, against what the
// scripted coach says after "Sour / sharp" with that shot's event.
import '../../src/ui/chat/testing/setup.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { ShotRecord } from '../../src/api/types.ts';
import { summaryForModel } from '../../src/app/engine/protocol.ts';
import type { CoachUiPart } from '../../src/app/types.ts';
import { TOOL, TOOL_INPUTS } from '../../src/coach/contract.ts';
import shot01 from '../../src/coach/__fixtures__/decaid-mcp/shot-01.json';
import shot07 from '../../src/coach/__fixtures__/decaid-mcp/shot-07.json';
import { summarizeShot } from '../../src/coach/summary/summarize.ts';
import type { ShotSummary } from '../../src/coach/types.ts';
import { ShotCard } from '../../src/ui/chat/parts/ShotCard.tsx';
import { renderThemed } from '../../src/ui/chat/testing/render.tsx';
import { TID } from '../../src/ui/testIds.ts';
import { buildDemo, type DemoBuild } from '../demo/build.ts';
import { createScenarioMemory, respond } from './scenario.ts';

type Block = Record<string, unknown>;
type Message = { role: 'user' | 'assistant'; content: Block[] };

const HEADERS = new Headers({
  'content-type': 'application/json',
  'x-api-key': 'sk-ant-demo',
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});
const TOOLS = Object.keys(TOOL_INPUTS).map((name) => ({
  name,
  description: name,
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  strict: true,
}));

const text = (t: string): Block => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: unknown = {}): Block => ({ type: 'tool_use', id, name, input });
const toolResult = (id: string, payload: unknown): Block => ({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(payload) });

const BLOOMING = { temp: 92, yield: 50, bloom: 30, piExit: 4, flow: 2.2 };
const UP_TO_SHOT: Message[] = [
  { role: 'user', content: [text('Kiambu AA, light roast, washed'), text('[context]\n{"grinder":{"name":"Niche Zero","setting":"14.5"},"scaleConnected":true,"doseG":18}')] },
  { role: 'assistant', content: [text('Lovely.'), toolUse('t_save', TOOL.saveBagDetails, { name: 'Kiambu AA' }), toolUse('t_tpl', TOOL.proposeTemplates)] },
  {
    role: 'user',
    content: [toolResult('t_save', { saved: true }), toolResult('t_tpl', { picked: 'blooming-espresso', version: 1, title: 'Kiambu AA v1', uploaded: true, note: null })],
  },
  { role: 'assistant', content: [text('Loaded Kiambu AA v1.')] },
];

interface Peak {
  bar: string;
  seconds: number | null;
}

/** The card's peak: "5.4 bar at 60 s". */
function cardPeak(summary: ShotSummary): Peak {
  renderThemed(<ShotCard summary={summary} />);
  const value = within(screen.getByTestId(TID.shotCard)).getByText(/^\d+\.\d bar( at \d+ s)?$/).textContent ?? '';
  cleanup();
  const match = /^(\d+\.\d) bar(?: at (\d+) s)?$/.exec(value)!;
  return { bar: match[1]!, seconds: match[2] === undefined ? null : Number(match[2]) };
}

/** What the demo voice says of the same shot's peak, before the change it proposes for "Sour / sharp". */
function voicePeak(summary: ShotSummary): Peak {
  const event = { shotRef: 'latest', shotId: summary.shotId, version: 1, templateId: 'blooming-espresso', levers: BLOOMING, doseG: 18, targetYieldG: 50 };
  const messages: Message[] = [
    ...UP_TO_SHOT,
    { role: 'user', content: [text(`[event:shot_completed]\n${JSON.stringify({ ...event, summary: summaryForModel(summary) })}`)] },
    { role: 'assistant', content: [text('Got it.'), toolUse('t_ask', TOOL.askUser, { question: 'How did it taste?' })] },
    { role: 'user', content: [toolResult('t_ask', { selected: ['Sour / sharp'], other: null })] },
    { role: 'assistant', content: [text('Thanks.'), toolUse('t_series', TOOL.getShotSeries, { shot: 'latest' })] },
    { role: 'user', content: [toolResult('t_series', { metric: 'pressure', tS: [0, 1], values: [0, 1] })] },
  ];
  const body = { model: 'claude-opus-5-5', max_tokens: 16000, stream: true, messages, tools: TOOLS, tool_choice: { type: 'auto' } };
  const result = respond(body, HEADERS, createScenarioMemory({ session: 'card' }), { voice: 'demo' });
  if (!('content' in result)) throw new Error(`expected a reply, got ${JSON.stringify(result)}`);
  const said = result.content.filter((b) => b.type === 'text').map((b) => String(b.text)).join('');
  const match = /The pressure peaked at (\d+\.\d) bar(?:, (\d+) s in)?/.exec(said);
  if (!match) throw new Error(`no peak in ${JSON.stringify(said)}`);
  return { bar: match[1]!, seconds: match[2] === undefined ? null : Number(match[2]) };
}

/** The voice says the card's second; a peak at the very start of the pour (the card's "at 0 s") it leaves untimed. */
function expectSamePeak(summary: ShotSummary, label: string): Peak {
  const card = cardPeak(summary);
  expect(voicePeak(summary), label).toEqual({ bar: card.bar, seconds: card.seconds === 0 ? null : card.seconds });
  return card;
}

let demo: DemoBuild;

beforeAll(async () => {
  demo = await buildDemo(Date.UTC(2026, 9, 6, 9, 30, 0));
});

function demoShots(): ShotSummary[] {
  return demo.data.conversations
    .flatMap((conversation) => conversation.uiMessages)
    .flatMap((message) => message.parts)
    .filter((part): part is Extract<CoachUiPart, { kind: 'shot' }> => part.kind === 'shot')
    .map((part) => part.summary);
}

describe("the demo voice's peak is the shot card's", () => {
  it("on every shot card of the demo, inside the shot's time", () => {
    const shots = demoShots();
    expect(shots).toHaveLength(5);
    for (const summary of shots) {
      expect(summary.pourStartS, summary.shotId).toBeGreaterThan(1);
      const card = expectSamePeak(summary, summary.shotId);
      expect(card.seconds, summary.shotId).not.toBeNull();
      expect(card.seconds!, summary.shotId).toBeLessThanOrEqual(summary.durationS);
    }
  });

  it('on real Decaid records, which preheat for 2.8 and 6.5 s', () => {
    for (const record of [shot07, shot01]) {
      const summary = summarizeShot(record as unknown as ShotRecord);
      expectSamePeak(summary, summary.shotId);
    }
  });

  it('on a summary saved before pourStartS: both keep the time it always had', () => {
    const { pourStartS: _start, ...saved } = summarizeShot(shot07 as unknown as ShotRecord);
    const card = expectSamePeak(saved, 'saved');
    expect(card.seconds).toBe(Math.round(saved.peakPressureAtS!));
  });
});
