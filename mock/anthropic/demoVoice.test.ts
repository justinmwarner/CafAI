// The demo voice (D76) against the terse test voice, branch by branch of the
// script: fuller text, the same decisions, and nothing the request does not say.
import { describe, expect, it } from 'vitest';
import {
  ProposeAdjustmentInput,
  TOOL,
  TOOL_INPUTS,
  type ProposeAdjustment,
  type ProposeTemplates,
  type ToolName,
} from '../../src/coach/contract.ts';
import { applyLever } from '../../src/coach/levers.ts';
import { pourTime } from '../../src/coach/summary/pourClock.ts';
import { TEMPLATES } from '../../src/coach/templates/index.ts';
import { proposalWordingError, validateProposal } from '../../src/coach/validator.ts';
import { createScenarioMemory, respond, type ScenarioResponse } from './scenario.ts';

type Block = Record<string, unknown>;
type Message = { role: 'user' | 'assistant'; content: Block[] };
type Voice = 'terse' | 'demo';

const HEADERS = new Headers({
  'content-type': 'application/json',
  'x-api-key': 'sk-ant-test',
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
const toolResult = (id: string, payload: unknown, isError = false): Block => ({
  type: 'tool_result',
  tool_use_id: id,
  content: typeof payload === 'string' ? payload : JSON.stringify(payload),
  ...(isError ? { is_error: true } : {}),
});
const user = (...content: Block[]): Message => ({ role: 'user', content });
const assistant = (...content: Block[]): Message => ({ role: 'assistant', content });

function call(messages: Message[], voice: Voice): ScenarioResponse {
  const body = { model: 'claude-opus-5-5', max_tokens: 16000, stream: true, messages, tools: TOOLS, tool_choice: { type: 'auto' } };
  return respond(body, HEADERS, createScenarioMemory({ session: 'voice' }), { voice });
}

interface Reply {
  text: string;
  stopReason: string;
  tools: Array<{ id: string; name: ToolName; input: Record<string, unknown> }>;
}

function reply(messages: Message[], voice: Voice): Reply {
  const result = call(messages, voice);
  if (!('content' in result)) throw new Error(`expected a reply, got ${JSON.stringify(result)}`);
  const content = result.content as Block[];
  return {
    text: content.filter((b) => b.type === 'text').map((b) => b.text as string).join(''),
    stopReason: (result.events.at(-2)?.data.delta as { stop_reason: string }).stop_reason,
    tools: content.filter((b) => b.type === 'tool_use') as Reply['tools'],
  };
}

const FREE_TEXT = ['summary', 'rationale', 'expectedEffect'] as const;

/** A tool call without the proposal's free-text fields: what the coach decided. */
function decisionOf(tool: Reply['tools'][number]) {
  if (tool.name !== TOOL.proposeAdjustment) return tool;
  const input = { ...tool.input };
  for (const field of FREE_TEXT) delete input[field];
  return { ...tool, input };
}

const numbersIn = (value: string) => (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
/** The script's own steps: 1 °C, 2 g, one grind step. */
const STEPS = [1, 2];

/** The shot card shows a peak's time from the start of the pour, in whole seconds; the coach says it the same way. */
function peakSecondsIn(messages: Message[]): number[] {
  return messages
    .flatMap((message) => message.content)
    .flatMap((block) => (typeof block.text === 'string' && block.text.startsWith('[event:shot_completed]\n') ? [block.text] : []))
    .map((event) => (JSON.parse(event.slice(event.indexOf('\n') + 1)) as { summary?: { peakPressureAtS?: unknown; pourStartS?: unknown } }).summary)
    .flatMap((summary) => {
      const at = typeof summary?.peakPressureAtS === 'number' ? summary.peakPressureAtS : null;
      const seconds = pourTime(at, typeof summary?.pourStartS === 'number' ? summary.pourStartS : undefined);
      return seconds === null ? [] : [Math.round(seconds)];
    });
}

/**
 * Both voices answer the same request. The demo text is new and non-empty,
 * the decision is the same, and every number the demo writes is one the
 * request carries (to its one-decimal rounding, or a peak's whole second as
 * the shot card shows it), a step of the script, or the decision itself (a
 * new grind setting in the card's summary).
 */
function compare(messages: Message[]) {
  const terse = reply(messages, 'terse');
  const demo = reply(messages, 'demo');
  expect(demo.text.trim()).not.toBe('');
  expect(demo.text).not.toBe(terse.text);
  expect(demo.stopReason).toBe(terse.stopReason);
  expect(demo.tools.map(decisionOf)).toEqual(terse.tools.map(decisionOf));
  for (const tool of demo.tools) expect(TOOL_INPUTS[tool.name].safeParse(tool.input).success, tool.name).toBe(true);

  const proposal = demo.tools.find((t) => t.name === TOOL.proposeAdjustment)?.input as ProposeAdjustment | undefined;
  const known = [
    ...numbersIn(JSON.stringify(messages)),
    ...peakSecondsIn(messages),
    ...numbersIn(JSON.stringify(demo.tools.map(decisionOf))),
    ...STEPS,
  ];
  const written = [demo.text, ...(proposal ? FREE_TEXT.map((field) => proposal[field]) : [])];
  for (const line of written) {
    for (const n of numbersIn(line)) expect(known.some((k) => Math.abs(k - n) <= 0.05 + 1e-9), `${n} in ${JSON.stringify(line)}`).toBe(true);
  }
  // The chat renders paragraphs, lists, bold, em and code: never links or HTML.
  expect(demo.text).not.toMatch(/<[a-z/]|\]\(|https?:/i);
  // Both voices leave the taste to the barista (D127): what a change or a
  // profile does at the machine, never a taste the app would send back.
  for (const tool of [...terse.tools, ...demo.tools]) {
    if (tool.name === TOOL.proposeAdjustment) {
      const { expectedEffect } = tool.input as ProposeAdjustment;
      expect(proposalWordingError({ expectedEffect }), expectedEffect).toBeNull();
    }
    if (tool.name === TOOL.proposeTemplates) {
      for (const { reason } of (tool.input as ProposeTemplates).suggestions) expect(proposalWordingError({ expectedEffect: reason }), reason).toBeNull();
    }
  }
  // Deterministic: the same request, the same words.
  expect(reply(messages, 'demo')).toEqual(demo);
  return { terse, demo, proposal };
}

/** The demo proposal's free text: new, inside the app's limits with room to spare, and plain (the card shows it as text). */
function expectDemoProposalText(demo: ProposeAdjustment, terse: ProposeAdjustment) {
  expect(ProposeAdjustmentInput.safeParse(demo).success).toBe(true);
  const limits = { summary: 120, rationale: 400, expectedEffect: 200 };
  for (const field of FREE_TEXT) {
    expect(demo[field], field).not.toBe(terse[field]);
    expect(demo[field].length, field).toBeLessThanOrEqual(limits[field] * 0.75);
    expect(demo[field], field).not.toMatch(/[*`_#\n]/);
  }
  expect(demo.tips).toEqual(terse.tips);
}

// ---------------------------------------------------------------------------
// A conversation the engine could have sent (ENGINE_PROTOCOL.md)
// ---------------------------------------------------------------------------

const intakeOf = (description: string, grinder: Record<string, unknown> = { name: 'Niche Zero', setting: '14' }) =>
  user(text(description), text(`[context]\n${JSON.stringify({ grinder, scaleConnected: true, doseG: 18 })}`));
const INTAKE = intakeOf('Kiambu AA, light roast, washed, from Kenya. Blackcurrant and grapefruit.');
const INTAKE_REPLY = assistant(
  text('Lovely.'),
  toolUse('t_save', TOOL.saveBagDetails, { name: 'Kiambu AA', roaster: null, origin: 'Kenya', roastLevel: 'light', process: 'washed', notes: null }),
  toolUse('t_tpl', TOOL.proposeTemplates, { suggestions: [] }),
);
const pick = (over: Record<string, unknown> = {}) =>
  user(
    toolResult('t_save', { saved: true }),
    toolResult('t_tpl', {
      picked: 'blooming-espresso',
      version: 1,
      title: 'Kiambu AA v1',
      yieldG: 50,
      doseG: 18,
      uploaded: true,
      onMachine: true,
      loadError: null,
      note: null,
      ...over,
    }),
  );
const LOADED_REPLY = assistant(text('Loaded Kiambu AA v1.'));
const UP_TO_SHOT = [INTAKE, INTAKE_REPLY, pick(), LOADED_REPLY];

const BLOOMING = { temp: 92, yield: 50, bloom: 30, piExit: 4, flow: 2.2 };
const shot = (levers: Record<string, number> = BLOOMING, templateId = 'blooming-espresso', summary: Record<string, unknown> = {}) =>
  user(
    text(
      '[event:shot_completed]\n' +
        JSON.stringify({
          shotRef: 'latest',
          shotId: 'shot-1',
          version: 1,
          templateId,
          levers,
          doseG: 18,
          targetYieldG: levers.yield ?? null,
          summary: { shotId: 'shot-1', durationS: 41.2, yieldG: 49.6, doseG: 18, ratio: 2.76, channelingFlags: [], ...summary },
        }),
    ),
  );
const SHOT_REPLY = assistant(text('Got it.'), toolUse('t_ask', TOOL.askUser, { question: 'How did it taste?' }));
const answer = (selected: string[], other: string | null = null) => user(toolResult('t_ask', { selected, other }));
const ANSWER_REPLY = assistant(text('Thanks.'), toolUse('t_series', TOOL.getShotSeries, { shot: 'latest' }));
const SERIES = user(
  toolResult('t_series', {
    shotId: 'shot-1',
    metric: 'pressure',
    unit: 'bar',
    tS: [0, 4, 8, 12, 30, 34, 38],
    values: [0, 2.1, 4.04, 1.2, 6.5, 8.62, 7.9],
  }),
);
const ADJUST_REPLY = assistant(toolUse('t_adj', TOOL.proposeAdjustment, { variable: 'profile' }));

/** Up to the change proposed after a taste answer; `summary` overrides the shot summary's fields. */
const toProposal = (
  selected: string[],
  other: string | null = null,
  levers: Record<string, number> = BLOOMING,
  templateId = 'blooming-espresso',
  summary: Record<string, unknown> = {},
  series: Message = SERIES,
) => [...UP_TO_SHOT, shot(levers, templateId, summary), SHOT_REPLY, answer(selected, other), ANSWER_REPLY, series];
/** It ran out of steps at 41.5 g of its 50 g: a yield move is never reached (like the demo's shot four). */
const STOPPED_SHORT = { yieldG: 41.5, stopReason: 'machineEnded' };
const typedPast = { answered: false, note: 'The user typed a message instead.' };
const typed = (words: string) => user(toolResult('t_ask', typedPast), text(words));
const AFTER_PROPOSAL = [...toProposal(['Sour / sharp']), ADJUST_REPLY];
const decided = (payload: unknown) => [...AFTER_PROPOSAL, user(toolResult('t_adj', payload))];

// ---------------------------------------------------------------------------

describe('the demo voice, branch by branch', () => {
  it('the new-bag reply names the bag and the first pick, and saves and offers the same', () => {
    const light = compare([INTAKE]);
    expect(light.demo.text).toContain('**Kiambu AA**');
    expect(light.demo.text).toContain('a washed light roast from Kenya');
    expect(light.demo.text).toContain('**Blooming Espresso**');
    expect(compare([user(text('Italian Job, dark roast, natural'))]).demo.text).toContain('**Londonium**');
    expect(compare([user(text('Mystery beans'))]).demo.text).toContain('**D-Flow**');
    expect(compare([user(text('Some blend, medium-light, anaerobic'))]).demo.text).toContain('an anaerobic medium-light roast');
  });

  it('the cards offered again', () => {
    const typedPast = { answered: false, note: 'The user typed a message instead.' };
    const { demo } = compare([INTAKE, INTAKE_REPLY, user(toolResult('t_save', { saved: true }), toolResult('t_tpl', typedPast), text('Which is sweetest?'))]);
    expect(demo.tools.map((t) => t.name)).toEqual([TOOL.proposeTemplates]);
    expect(demo.text).toContain('**Blooming Espresso**');
  });

  it('the template pick: loaded, not uploaded, not confirmed, and saved while offline', () => {
    const loaded = compare([INTAKE, INTAKE_REPLY, pick()]).demo.text;
    expect(loaded).toContain('**Kiambu AA v1**');
    expect(loaded).toContain('50 g');
    expect(loaded).toContain('18 g');
    expect(compare([INTAKE, INTAKE_REPLY, pick({ uploaded: false, onMachine: null })]).demo.text).toMatch(/didn't load.*Retry/);
    expect(compare([INTAKE, INTAKE_REPLY, pick({ onMachine: null, loadError: 'No answer over Bluetooth.' })]).demo.text).toMatch(
      /hasn't confirmed.*Retry/,
    );
    expect(compare([INTAKE, INTAKE_REPLY, pick({ onMachine: false })]).demo.text).toMatch(/machine connects/);
    // Without the yield and dose (an older payload) the sentence goes without them.
    const bare = compare([INTAKE, INTAKE_REPLY, pick({ yieldG: undefined, doseG: undefined })]).demo.text;
    expect(bare).not.toMatch(/ g\b/);
  });

  it('a finished shot: its time and yield, then the same taste question', () => {
    const { demo } = compare([...UP_TO_SHOT, shot()]);
    expect(demo.text).toContain('41.2 s');
    expect(demo.text).toContain('49.6 g');
    expect(demo.tools[0]?.input).toEqual({
      question: 'How did it taste?',
      options: ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery'],
      multiSelect: false,
    });
    // A number the event lacks is left out, never guessed.
    const noYield = compare([...UP_TO_SHOT, shot(BLOOMING, 'blooming-espresso', { yieldG: null })]).demo.text;
    expect(noYield).toContain('41.2 s');
    expect(noYield).not.toMatch(/\d g/);
  });

  it('a TDS reading: what it heard first, the extraction in bold, a doubt about one no coffee gives, and the same decision (D170)', () => {
    const measured = (tdsPct: number | null, eyPct: number | null) =>
      text(`[event:shot_measured]\n${JSON.stringify({ shotId: 'shot-1', tdsPct, eyPct, doseG: 18, yieldG: 49.6 })}`);
    const tasted = (...readings: Block[]) =>
      compare([...UP_TO_SHOT, shot(), SHOT_REPLY, user(toolResult('t_ask', { selected: ['Sour / sharp'], other: null }), ...readings)]).demo.text;
    // 9.25 % x 49.6 g / 18 g = 25.5 %.
    expect(tasted(measured(9.25, 25.5))).toMatch(/^Thanks for measuring: TDS 9\.25 % puts that shot's extraction at \*\*25\.5 %\*\*\. Sour on a light roast/);
    expect(tasted(measured(9.25, null))).toMatch(/^Thanks for measuring: TDS 9\.25 %\. That shot has no dose or yield to go with it/);
    expect(tasted(measured(null, null))).toMatch(/^Got it: I'll leave that TDS reading out\./);
    expect(tasted(measured(12, 33.1))).toMatch(/^Thanks for measuring, but TDS 12\.00 % works out to an extraction of 33\.1 %, more than coffee can give: check the reading/);
  });

  it('the taste answer, before the pressure curve', () => {
    const base = [...UP_TO_SHOT, shot(), SHOT_REPLY];
    const sour = compare([...base, answer(['Sour / sharp'])]).demo.text;
    expect(sour).toMatch(/Sour on a light roast usually means \*\*under-extraction\*\*/);
    expect(compare([...base, answer(['Bitter / harsh'])]).demo.text).toMatch(/over-extraction/);
    expect(compare([...base, answer(['Weak / watery'])]).demo.text).toMatch(/dilute/);
    expect(compare([...base, answer(['Balanced, sweet'])]).demo.text).toMatch(/You found it balanced and sweet: that's a recipe worth keeping/);
    expect(compare([...base, answer(['Other'], 'Too strong')]).demo.text).toMatch(/concentrated/);
    expect(compare([...base, answer(['Other'], 'Sweeter, but a little thin')]).demo.text).toMatch(/pressure curve/);
  });

  describe('the proposal', () => {
    function proposalFor(messages: Message[]) {
      const { terse, demo, proposal } = compare(messages);
      expect(terse.text).toBe('');
      const terseProposal = terse.tools[0]?.input as ProposeAdjustment;
      expectDemoProposalText(proposal!, terseProposal);
      return { lead: demo.text, proposal: proposal! };
    }

    it('sour: 1 °C hotter, after reading the curve', () => {
      const { lead, proposal } = proposalFor(toProposal(['Sour / sharp']));
      expect(proposal).toMatchObject({ variable: 'profile', lever: 'temp', value: 93 });
      // No peak in the shot event: the series' top, without a time (a rounded series can tie along a plateau).
      expect(lead).toContain('The pressure peaked at 8.6 bar, with no sign of channeling.');
      expect(lead).not.toMatch(/ s in\b/);
      expect(lead).toContain('**brew temperature**');
    });

    it("the peak is the shot card's: the summary's peak and its time, in whole seconds as the card shows it", () => {
      // The rounded 1 Hz series holds 5.7 bar from 58 s on; the summary's peak came at 61.4 s (the card: "5.7 bar at 61 s").
      const plateau = user(
        toolResult('t_series', { shotId: 'shot-1', metric: 'pressure', unit: 'bar', tS: [0, 30, 58, 59, 60, 61, 62], values: [0, 3.1, 5.7, 5.7, 5.7, 5.7, 5.6] }),
      );
      const peak = { peakPressureBar: 5.7, peakPressureAtS: 61.4 };
      const { lead } = proposalFor(toProposal(['Sour / sharp'], null, BLOOMING, 'blooming-espresso', peak, plateau));
      expect(lead).toContain('The pressure peaked at 5.7 bar, 61 s in, with no sign of channeling.');
      expect(lead).not.toContain('58');
      // The summary's figure wins over the series' own top, and a whole bar shows its decimal as the card does.
      const whole = proposalFor(toProposal(['Sour / sharp'], null, BLOOMING, 'blooming-espresso', { peakPressureBar: 6, peakPressureAtS: 12.6 })).lead;
      expect(whole).toContain('The pressure peaked at 6.0 bar, 13 s in');
      // A summary peak without its time: no time.
      const untimed = proposalFor(toProposal(['Sour / sharp'], null, BLOOMING, 'blooming-espresso', { peakPressureBar: 5.7, peakPressureAtS: null })).lead;
      expect(untimed).toContain('The pressure peaked at 5.7 bar, with no sign of channeling.');
    });

    it('counts the peak from the start of the pour, as the shot card does: never after a shot that ended', () => {
      // The demo's shot four: a 60.6 s pour after 2 s of preheat, its peak at 61.6 s on the record's clock (the card: "5.4 bar at 60 s").
      const four = { durationS: 60.6, pourStartS: 2, peakPressureBar: 5.4, peakPressureAtS: 61.6 };
      const { lead } = proposalFor(toProposal(['Sour / sharp'], null, BLOOMING, 'blooming-espresso', four));
      expect(lead).toContain('The pressure peaked at 5.4 bar, 60 s in, with no sign of channeling.');
      expect(lead).not.toContain('62');
      // Santos: 7.2 bar at 4.2 s on the record's clock, 2.2 s into its pour.
      const santos = proposalFor(toProposal(['Sour / sharp'], null, BLOOMING, 'blooming-espresso', { pourStartS: 2, peakPressureBar: 7.2, peakPressureAtS: 4.2 }));
      expect(santos.lead).toContain('The pressure peaked at 7.2 bar, 2 s in');
      // A peak before the pour began: the card says 0 s, and the coach names no time.
      const early = proposalFor(toProposal(['Sour / sharp'], null, BLOOMING, 'blooming-espresso', { pourStartS: 4.6, peakPressureBar: 3.1, peakPressureAtS: 1.8 }));
      expect(early.lead).toContain('The pressure peaked at 3.1 bar, with no sign of channeling.');
    });

    it('after a shot that stopped short of its yield: weak goes one step finer, too strong one step coarser, and says why', () => {
      const weak = proposalFor(toProposal(['Weak / watery'], null, BLOOMING, 'blooming-espresso', STOPPED_SHORT));
      expect(weak.proposal).toMatchObject({ variable: 'grind', grind: { direction: 'finer', amount: 1, setting: '13' }, summary: 'Grind one step finer, to 13' });
      expect(weak.lead).toContain('41.5 g');
      expect(weak.lead).toContain('50 g');
      expect(weak.lead).toContain('**One step finer**');
      expect(weak.proposal.rationale).toMatch(/weak/i);

      const strong = proposalFor(toProposal(['Other'], 'Too strong', BLOOMING, 'blooming-espresso', STOPPED_SHORT));
      expect(strong.proposal).toMatchObject({
        variable: 'grind',
        grind: { direction: 'coarser', amount: 1, setting: '15' },
        summary: 'Grind one step coarser, to 15',
      });
      expect(strong.lead).toContain('41.5 g');
      expect(strong.lead).toContain('**One step coarser**');
      expect(strong.proposal.rationale).toMatch(/strong/i);

      // Sour with the temperature at the top: one step finer, and the lead says the stop was never reached.
      const dflow = { temp: 94, yield: 50, soak: 3, soakWeight: 4, pourFlow: 1.7, pourPmax: 8.5 };
      const sour = proposalFor(toProposal(['Sour / sharp'], null, dflow, 'd-flow', STOPPED_SHORT));
      expect(sour.proposal).toMatchObject({ variable: 'grind', grind: { direction: 'finer' } });
      expect(sour.lead).toContain('41.5 g');
      expect(sour.lead).toContain('**One step finer**');
    });

    it('too strong with the yield already at its top: one step coarser, and says the stop cannot go later', () => {
      const allonge = { temp: 96, yield: 135, flow: 4.5, maxPressure: 8.6 };
      const reached = { yieldG: 135.2, stopReason: 'targetWeight' };
      const { lead, proposal } = proposalFor(toProposal(['Other'], 'Too strong', allonge, 'allonge', reached));
      expect(proposal).toMatchObject({ variable: 'grind', grind: { direction: 'coarser', amount: 1 } });
      expect(lead).toContain('**One step coarser**');
      expect(lead).toMatch(/can't run any longer/);
      // It reached its stop: nothing may say otherwise.
      expect(lead).not.toMatch(/didn't stop|before its/);
      expect(proposal.rationale).not.toMatch(/did not stop/);
    });

    it('a typed taste: read like the answer, in the same words', () => {
      const look = compare([...UP_TO_SHOT, shot(), SHOT_REPLY, typed('It tasted a bit sour, sharp at the end')]);
      expect(look.demo.tools.map((t) => t.name)).toEqual([TOOL.getShotSeries]);
      expect(look.demo.text).toMatch(/Sour on a light roast usually means \*\*under-extraction\*\*/);
      const { proposal } = proposalFor([...UP_TO_SHOT, shot(), SHOT_REPLY, typed('It tasted a bit sour, sharp at the end'), ANSWER_REPLY, SERIES]);
      expect(proposal).toMatchObject({ variable: 'profile', lever: 'temp', value: 93 });
    });

    it('a typed taste without a taste word: read like the same words under Other, one step finer', () => {
      const words = 'Flat and a bit dull, the fruit is hiding';
      const look = compare([...UP_TO_SHOT, shot(), SHOT_REPLY, typed(words)]);
      expect(look.demo.tools.map((t) => t.name)).toEqual([TOOL.getShotSeries]);
      expect(look.demo.text).toBe(compare([...UP_TO_SHOT, shot(), SHOT_REPLY, answer(['Other'], words)]).demo.text);
      const fromTyped = proposalFor([...UP_TO_SHOT, shot(), SHOT_REPLY, typed(words), ANSWER_REPLY, SERIES]);
      const fromOther = proposalFor(toProposal(['Other'], words));
      expect(fromTyped.proposal).toMatchObject({ variable: 'grind', grind: { direction: 'finer', amount: 1, setting: '13' } });
      expect(fromTyped.proposal).toEqual(fromOther.proposal);
      expect(fromTyped.lead).toBe(fromOther.lead);
    });

    it('text typed with no taste question open keeps the usual reply', () => {
      const noted = "Noted. Pull a shot when you're ready and I'll read its curves with you, or tell me more about the coffee.";
      const words = 'Flat and a bit dull, the fruit is hiding';
      expect(compare([...UP_TO_SHOT, user(text(words))]).demo.text).toBe(noted);
      // The change card set aside, not the taste question.
      expect(compare([...AFTER_PROPOSAL, user(toolResult('t_adj', typedPast), text(words))]).demo.text).toBe(noted);
    });

    it('sour at the top temperature: 2 g longer', () => {
      const dflow = { temp: 94, yield: 50, soak: 3, soakWeight: 4, pourFlow: 1.7, pourPmax: 8.5 };
      const { lead, proposal } = proposalFor(toProposal(['Sour / sharp'], null, dflow, 'd-flow'));
      expect(proposal).toMatchObject({ lever: 'yield', value: 52 });
      expect(lead).toContain('**2 g longer**');
    });

    it('bitter, weak, strong and balanced', () => {
      expect(proposalFor(toProposal(['Bitter / harsh'])).proposal).toMatchObject({ lever: 'temp', value: 91 });
      expect(proposalFor(toProposal(['Weak / watery'])).proposal).toMatchObject({ lever: 'yield', value: 48 });
      expect(proposalFor(toProposal(['Other'], 'Too strong')).proposal).toMatchObject({ lever: 'yield', value: 52 });
      const balanced = proposalFor(toProposal(['Balanced, sweet']));
      expect(balanced.proposal).toMatchObject({ variable: 'none' });
      expect(balanced.lead).toMatch(/lock it in/);
    });

    it('anything else, or a lever with no room: one grind step finer', () => {
      const other = proposalFor(toProposal(['Other'], 'Sweeter, but a little thin'));
      expect(other.proposal).toMatchObject({ variable: 'grind', grind: { direction: 'finer', amount: 1, setting: '13' } });
      expect(other.proposal.summary).toBe('Grind one step finer, to 13');
      expect(other.lead).toContain('**One step finer**');
      const allonge = { temp: 96, yield: 135, flow: 4.5, maxPressure: 8.6 };
      expect(proposalFor(toProposal(['Sour / sharp'], null, allonge, 'allonge')).proposal).toMatchObject({ variable: 'grind' });
      const shortest = { temp: 92, yield: 30, bloom: 30, piExit: 4, flow: 2.2 };
      expect(proposalFor(toProposal(['Weak / watery'], null, shortest)).proposal).toMatchObject({ variable: 'grind' });
    });

    it('says what the curve does not show: no peak without a series, a caution with channeling flags', () => {
      const withoutSeries = [...UP_TO_SHOT, shot(), SHOT_REPLY, answer(['Sour / sharp']), ANSWER_REPLY, user(toolResult('t_series', 'No shots recorded for this bag yet.', true))];
      expect(proposalFor(withoutSeries).lead).not.toMatch(/peaked/);
      const channeled = [...UP_TO_SHOT, shot(BLOOMING, 'blooming-espresso', { channelingFlags: ['pressure_dip_after_peak'] }), SHOT_REPLY, answer(['Sour / sharp']), ANSWER_REPLY, SERIES];
      const lead = proposalFor(channeled).lead;
      expect(lead).not.toMatch(/no sign of channeling/);
      expect(lead).toMatch(/channeling/);
    });

    it("passes the app's own proposal validation, and the card carries the demo summary", () => {
      const { proposal } = proposalFor(toProposal(['Sour / sharp']));
      const template = TEMPLATES.find((t) => t.id === 'blooming-espresso')!;
      const profile = applyLever(template, applyLever(template, template.profile, 'temp', 92), 'yield', 50);
      const validation = validateProposal(proposal, { template, profile, doseG: 18, scaleConnected: true, grinderSetting: '14' });
      expect(validation.ok && validation.plan).toMatchObject({ summary: 'Brew 1 °C hotter', from: 92, to: 93, createsVersion: true });
    });
  });

  it('applied: on the machine, not confirmed, saved while offline, by hand, and kept', () => {
    const loaded = compare(decided({ applied: true, variable: 'profile', version: 2, title: 'Kiambu AA v2', onMachine: true, loadError: null })).demo.text;
    expect(loaded).toContain('**Kiambu AA v2**');
    expect(loaded).toMatch(/\n- /);
    expect(compare(decided({ applied: true, variable: 'profile', version: 2, title: 'Kiambu AA v2', onMachine: null, loadError: 'No answer.' })).demo.text).toMatch(
      /hasn't confirmed.*Retry/,
    );
    expect(compare(decided({ applied: true, variable: 'profile', version: 2, title: 'Kiambu AA v2', onMachine: false, loadError: null })).demo.text).toMatch(
      /machine connects/,
    );
    expect(compare(decided({ applied: true, variable: 'grind', version: null, title: null, onMachine: null, loadError: null })).demo.text).toMatch(/change/);
    expect(compare(decided({ applied: true, variable: 'dose', version: null, title: null, onMachine: null, loadError: null })).demo.text).toMatch(/change/);
    expect(compare(decided({ applied: true, variable: 'none', version: null, title: null, onMachine: null, loadError: null })).demo.text).toMatch(/Locked in/);
    // An older payload without a title still names the version.
    expect(compare(decided({ applied: true, variable: 'profile', version: 2 })).demo.text).toContain('**v2**');
  });

  it('declined, or not uploaded: we stay on the current version', () => {
    expect(compare(decided({ applied: false, reason: 'The user declined.' })).demo.text).toContain('**v1**');
    expect(compare(decided({ applied: false, error: 'The machine did not take the profile.' })).demo.text).toContain('**v1**');
  });

  it('a rejected change, and the fallback offer that replaces it', () => {
    const rejected = [...AFTER_PROPOSAL, user(toolResult('t_adj', 'temp: 137 °C is above this template', true))];
    const grind = compare(rejected);
    expect(grind.demo.tools[0]?.input).toMatchObject({ variable: 'grind', grind: { setting: '13' } });
    expectDemoProposalText(grind.proposal!, grind.terse.tools[0]?.input as ProposeAdjustment);

    const grindReply = assistant(toolUse('t_adj2', TOOL.proposeAdjustment, { variable: 'grind' }));
    const rejectedAgain = [...rejected, grindReply, user(toolResult('t_adj2', 'grind.setting is current', true))];
    const keep = compare(rejectedAgain);
    expect(keep.demo.tools[0]?.input).toMatchObject({ variable: 'none' });
    expectDemoProposalText(keep.proposal!, keep.terse.tools[0]?.input as ProposeAdjustment);
  });

  it('undo', () => {
    const { demo } = compare([...UP_TO_SHOT, user(text('[event:undo]\n{"from":2,"to":1,"title":"Kiambu AA v1"}'))]);
    expect(demo.text).toContain('**Kiambu AA v1**');
    expect(compare([...UP_TO_SHOT, user(text('[event:undo]\n{"from":3,"to":2}'))]).demo.text).toContain('**v2**');
  });

  it('the fallback line', () => {
    expect(compare([...UP_TO_SHOT, user(text('It smells amazing'))]).demo.tools).toEqual([]);
  });
});
