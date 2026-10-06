// The demo voice (D76) against the terse test voice, branch by branch of the
// script: fuller text, the same decisions, and nothing the request does not say.
import { describe, expect, it } from 'vitest';
import { ProposeAdjustmentInput, TOOL, TOOL_INPUTS, type ProposeAdjustment, type ToolName } from '../../src/coach/contract.ts';
import { applyLever } from '../../src/coach/levers.ts';
import { TEMPLATES } from '../../src/coach/templates/index.ts';
import { validateProposal } from '../../src/coach/validator.ts';
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

/**
 * Both voices answer the same request. The demo text is new and non-empty,
 * the decision is the same, and every number the demo writes is one the
 * request carries (to its one-decimal rounding), a step of the script, or the
 * decision itself (a new grind setting in the card's summary).
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
  const known = [...numbersIn(JSON.stringify(messages)), ...numbersIn(JSON.stringify(demo.tools.map(decisionOf))), ...STEPS];
  const written = [demo.text, ...(proposal ? FREE_TEXT.map((field) => proposal[field]) : [])];
  for (const line of written) {
    for (const n of numbersIn(line)) expect(known.some((k) => Math.abs(k - n) <= 0.05 + 1e-9), `${n} in ${JSON.stringify(line)}`).toBe(true);
  }
  // The chat renders paragraphs, lists, bold, em and code: never links or HTML.
  expect(demo.text).not.toMatch(/<[a-z/]|\]\(|https?:/i);
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

/** Up to the change proposed after a taste answer. */
const toProposal = (selected: string[], other: string | null = null, levers: Record<string, number> = BLOOMING, templateId = 'blooming-espresso') => [
  ...UP_TO_SHOT,
  shot(levers, templateId),
  SHOT_REPLY,
  answer(selected, other),
  ANSWER_REPLY,
  SERIES,
];
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

  it('the taste answer, before the pressure curve', () => {
    const base = [...UP_TO_SHOT, shot(), SHOT_REPLY];
    const sour = compare([...base, answer(['Sour / sharp'])]).demo.text;
    expect(sour).toMatch(/Sour on a light roast usually means \*\*under-extraction\*\*/);
    expect(compare([...base, answer(['Bitter / harsh'])]).demo.text).toMatch(/over-extraction/);
    expect(compare([...base, answer(['Weak / watery'])]).demo.text).toMatch(/dilute/);
    expect(compare([...base, answer(['Balanced, sweet'])]).demo.text).toMatch(/what we're after/);
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
      expect(lead).toContain('The pressure peaked at 8.6 bar, 34 s in, with no sign of channeling.');
      expect(lead).toContain('**brew temperature**');
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
