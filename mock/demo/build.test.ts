import { beforeAll, describe, expect, it } from 'vitest';
import type { ShotRecord } from '../../src/api/types.ts';
import { NEW_BAG_PROMPT } from '../../src/app/engine/uiMessages.ts';
import { EXTRAS_KEY } from '../../src/app/engine/shotNotes.ts';
import type { CoachUiMessage, CoachUiPart } from '../../src/app/types.ts';
import { OTHER_OPTION, TOOL } from '../../src/coach/contract.ts';
import { getTemplate, profileId, readLeverValues } from '../../src/coach/index.ts';
import { pourTime } from '../../src/coach/summary/pourClock.ts';
import { parseTimestampMicros } from '../../src/coach/summary/time.ts';
import { parseCafaiExport } from '../../src/storage/porter.ts';
import { DEFAULT_PUCK_RESISTANCE } from '../decaid/shotPlayer.ts';
import { createMockDecaid } from '../decaid/state.ts';
import { buildDemo, conversationOf, type DemoBuild } from './build.ts';
import { pullShot } from './shots.ts';
import { DEMO_API_KEY, SHOTS, STARTING_GRINDER, TASTE_OPTIONS } from './story.ts';
import { transcriptProblems } from './transcript.ts';

const NOW = Date.UTC(2026, 9, 6, 9, 30, 0);

let demo: DemoBuild;

beforeAll(async () => {
  demo = await buildDemo(NOW);
});

type Part<K extends CoachUiPart['kind']> = Extract<CoachUiPart, { kind: K }>;

function allMessages(): CoachUiMessage[] {
  return demo.data.conversations.flatMap((conversation) => conversation.uiMessages);
}

function parts<K extends CoachUiPart['kind']>(kind: K, messages: CoachUiMessage[] = allMessages()): Part<K>[] {
  return messages.flatMap((message) => message.parts).filter((part): part is Part<K> => part.kind === kind);
}

function noticeTexts(tone: Part<'notice'>['tone'], messages?: CoachUiMessage[]): string[] {
  return parts('notice', messages)
    .filter((part) => part.tone === tone)
    .map((part) => part.text);
}

function shotRecord(id: string): ShotRecord {
  const record = demo.decaid.shots.find((shot) => shot.id === id);
  if (!record) throw new Error(`no shot ${id}`);
  return record;
}

describe('the demo story, played through the coach engine', () => {
  it('has the two bags, Kiambu AA active and last touched', () => {
    const names = demo.data.bags.map((bag) => bag.name);
    expect(names.sort()).toEqual(['Kiambu AA', 'Santos']);
    const kiambu = demo.data.bags.find((bag) => bag.name === 'Kiambu AA')!;
    const santos = demo.data.bags.find((bag) => bag.name === 'Santos')!;
    expect(demo.data.settings.activeBagId).toBe(kiambu.id);
    expect(kiambu.updatedAt > santos.updatedAt).toBe(true);
    expect(kiambu).toMatchObject({ origin: 'Kenya', roastLevel: 'light', process: 'washed', templateId: 'blooming-espresso' });
    expect(santos).toMatchObject({ origin: 'Brazil', roastLevel: 'medium-dark', process: 'natural', templateId: 'gentle-and-sweet' });
  });

  it('ends with the Niche Zero linked at 14.5 and the default model', () => {
    expect(demo.data.settings).toMatchObject({
      grinderName: STARTING_GRINDER.grinderName,
      grinderId: STARTING_GRINDER.grinderId,
      grinderSetting: '14.5',
      model: 'claude-opus-5-5',
    });
    // The key is never part of the records.
    expect(JSON.stringify(demo.data)).not.toContain(DEMO_API_KEY);
  });

  it('passes the app import schema', () => {
    expect(() => parseCafaiExport(JSON.parse(JSON.stringify(demo.data)))).not.toThrow();
  });

  it('is the same on every build for the same moment, and moves with it', async () => {
    const again = await buildDemo(NOW);
    expect(again).toEqual(demo);
    const later = await buildDemo(NOW + 3_600_000);
    expect(later.data.bags.map((bag) => Date.parse(bag.createdAt) - Date.parse(demo.data.bags.find((b) => b.id === bag.id)!.createdAt))).toEqual(
      later.data.bags.map(() => 3_600_000),
    );
    // Data times move; the shots themselves are the same.
    const summary = (build: DemoBuild) => build.data.iterations.map((record) => ({ ...record.summary, timestamp: null }));
    expect(summary(later)).toEqual(summary(demo));
  });

  it('started about a day ago, and the last shot was a few minutes ago', () => {
    const created = demo.data.bags.map((bag) => Date.parse(bag.createdAt));
    expect(NOW - Math.min(...created)).toBeGreaterThan(22 * 3_600_000);
    expect(NOW - Math.min(...created)).toBeLessThan(30 * 3_600_000);
    const lastShot = Math.max(...demo.data.iterations.map((record) => Date.parse(record.createdAt)));
    expect(NOW - lastShot).toBeGreaterThan(60_000);
    expect(NOW - lastShot).toBeLessThan(10 * 60_000);
    for (const record of demo.data.iterations) expect(Date.parse(record.updatedAt)).toBeLessThan(NOW);
  });
});

describe('the coverage list (D76)', () => {
  it('has user text, the local intro, and coach text with a paragraph, bold and a bullet list', () => {
    const userTexts = allMessages()
      .filter((message) => message.role === 'user')
      .flatMap((message) => message.parts)
      .filter((part) => part.kind === 'text');
    expect(userTexts.length).toBeGreaterThan(0);
    const coachTexts = allMessages()
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => parts('text', [message]))
      .map((part) => part.text);
    expect(coachTexts.filter((text) => text === NEW_BAG_PROMPT)).toHaveLength(2);
    expect(coachTexts.some((text) => text.includes('\n\n') && /\*\*[^*]+\*\*/.test(text) && /\n- /.test(text))).toBe(true);
  });

  it('has template cards with one in use in each bag', () => {
    for (const conversation of demo.data.conversations) {
      const cards = parts('templates', conversation.uiMessages);
      expect(cards).toHaveLength(1);
      expect(cards[0]!.pickedTemplateId).not.toBeNull();
      expect(cards[0]!.items.length).toBe(3);
    }
    const kiambu = parts('templates', conversationOf(demo, 'Kiambu AA').uiMessages)[0]!;
    expect(kiambu.items.map((item) => [item.templateId, item.confidence])).toEqual([
      ['blooming-espresso', 'high'],
      ['allonge', 'medium'],
      ['d-flow', 'low'],
    ]);
    expect(kiambu.pickedTemplateId).toBe('blooming-espresso');
  });

  it('has info, success and warning notices from the engine', () => {
    const kiambu = conversationOf(demo, 'Kiambu AA').uiMessages;
    expect(noticeTexts('info', kiambu)).toEqual([
      'Kiambu AA v1 stops at 50 g: 2.8 x the 18.0 g dose in Decaid.',
      'Back on Kiambu AA v2.',
    ]);
    expect(noticeTexts('success', kiambu)).toEqual([
      'Loaded Kiambu AA v1 on the machine.',
      'Loaded Kiambu AA v2 on the machine.',
      'Loaded Kiambu AA v2 on the machine.',
      'Loaded Kiambu AA v3 on the machine.',
      'Loaded Kiambu AA v2 on the machine.',
      'Loaded Kiambu AA v4 on the machine.',
    ]);
    expect(noticeTexts('warning', kiambu)).toEqual([
      'That shot ran "D-Flow / default", not Kiambu AA v2, so it is not part of this dial-in.',
    ]);
    const santos = conversationOf(demo, 'Santos').uiMessages;
    expect(noticeTexts('info', santos)).toEqual(['Santos v1 stops at 36 g: 2.0 x the 18.0 g dose in Decaid.']);
    expect(noticeTexts('success', santos)).toEqual(['Loaded Santos v1 on the machine.']);
    // Progress notices are never stored.
    expect(parts('notice').every((part) => part.progress === undefined)).toBe(true);
  });

  it('has shot cards with a graph, each saying what it is compared with, rated and not, and one with a channeling warning', () => {
    const cards = parts('shot');
    expect(cards).toHaveLength(5);
    expect(cards.every((card) => card.summary.series.tS.length > 20 && card.summary.series.pressure.some((p) => p !== null && p > 1))).toBe(true);
    expect(cards.map((card) => card.baseline)).toEqual([
      { kind: 'usual' },
      { kind: 'otherCoffee', shotId: SHOTS.santos.id, coffee: 'Santos' },
      { kind: 'previous', shotId: SHOTS.kiambu1.id },
      { kind: 'previous', shotId: SHOTS.kiambu2.id },
      { kind: 'previous', shotId: SHOTS.kiambu3.id },
    ]);
    expect(cards.map((card) => card.rating ?? null)).toEqual([
      { verdict: 'better', score: 5 },
      { verdict: 'muchWorse', score: 5 },
      { verdict: 'better', score: 6 },
      { verdict: 'better', score: 7 },
      null,
    ]);
    expect(cards.some((card) => card.stars !== undefined)).toBe(false);
    const flagged = cards.filter((card) => card.summary.channelingFlags.length > 0);
    expect(flagged.map((card) => card.shotId)).toEqual([SHOTS.santos.id]);
    expect(flagged[0]!.summary.channelingFlags).toContain('pressure_dip_after_peak');
  });

  it('has option chips answered single, multi-select and Other, and the open question last', () => {
    const questions = parts('options');
    const answered = questions.filter((part) => part.answer !== null);
    expect(answered.some((part) => !part.multiSelect && part.answer!.selected.length === 1 && part.answer!.otherText === null)).toBe(true);
    expect(answered.some((part) => part.multiSelect && part.answer!.selected.length >= 2)).toBe(true);
    expect(answered.some((part) => part.answer!.selected.includes(OTHER_OPTION) && part.answer!.otherText === 'Sweeter, but a little thin')).toBe(true);
    const open = questions.filter((part) => part.answer === null);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ question: 'How did it taste?', options: [...TASTE_OPTIONS, OTHER_OPTION], multiSelect: false });
    expect(open[0]!.expired).toBeUndefined();
    const kiambu = conversationOf(demo, 'Kiambu AA').uiMessages;
    expect(kiambu[kiambu.length - 1]!.parts).toEqual([open[0]]);
  });

  it('has change cards applied (versioned and by hand), declined, undone, and v4 as the latest applied version', () => {
    const cards = parts('diff', conversationOf(demo, 'Kiambu AA').uiMessages);
    expect(cards.map((card) => [card.versionLabel, card.status])).toEqual([
      ['Kiambu AA v2', 'applied'],
      [null, 'applied'],
      ['Kiambu AA v3', 'declined'],
      ['Kiambu AA v3', 'undone'],
      ['Kiambu AA v4', 'applied'],
    ]);
    const grind = cards[1]!;
    expect(grind.manualSteps).toEqual(['Set the grinder to 14.5 before the next shot (Decaid lists 0.5 steps for your Niche Zero).']);
    expect(grind.lines).toEqual(['Grind 1 step finer: 15 -> 14.5']);
    expect(cards[0]!.lines).toEqual(['Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)']);
    expect(cards[4]!.lines).toEqual(['Extraction flow: 2.2 ml/s -> 2.0 ml/s (ramp and flat flow)']);
    expect(cards.every((card) => card.error === null)).toBe(true);
  });

  it('has Santos kept as it is: the coach proposes keeping the recipe and the barista confirms it', () => {
    const { apiMessages, uiMessages } = conversationOf(demo, 'Santos');
    const cards = parts('diff', uiMessages);
    expect(cards.map((card) => [card.versionLabel, card.status])).toEqual([[null, 'applied']]);
    const proposals = apiMessages
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'tool_use' && block.name === TOOL.proposeAdjustment);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ input: { variable: 'none', lever: null, value: null, grind: null } });
    // The keep came after the "Balanced, sweet" answer, and the coach's last word follows the confirm.
    const santos = demo.data.iterations.filter((record) => record.bagName === 'Santos');
    expect(santos.map((record) => [record.feedback?.selected, record.outcome])).toEqual([[['Balanced, sweet'], 'kept']]);
    const last = uiMessages[uiMessages.length - 1]!;
    expect(last.role).toBe('assistant');
    expect(parts('text', [last])[0]?.text).toMatch(/Locked in/);
  });

  it('shows each tap as the user bubble the engine writes', () => {
    const bubbles = conversationOf(demo, 'Kiambu AA')
      .uiMessages.filter((message) => message.role === 'user')
      .flatMap((message) => parts('text', [message]).map((part) => part.text));
    expect(bubbles).toEqual([
      'Kiambu AA from Kenya, washed, light roast. Notes of blackcurrant, grapefruit and brown sugar.',
      'Sour / sharp',
      'Pinholes, Wet patches',
      'Sweeter, but a little thin',
      "Actually, let's try the slower pour after all.",
      '1.8 feels like a big jump. Could we meet halfway, at 2.0?',
    ]);
  });
});

describe('the transcript', () => {
  it('pairs every tool_use with a tool_result, alternates roles, and signs every assistant turn', () => {
    for (const conversation of demo.data.conversations) {
      const { problems } = transcriptProblems(conversation.apiMessages);
      expect(problems).toEqual([]);
    }
  });

  it('ends with the open "How did it taste?" and its four options, which the engine rebuilds as the pending call', () => {
    const { apiMessages, uiMessages } = conversationOf(demo, 'Kiambu AA');
    const { open } = transcriptProblems(apiMessages);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ name: TOOL.askUser, input: { question: 'How did it taste?', options: [...TASTE_OPTIONS], multiSelect: false } });
    const card = parts('options', uiMessages).find((part) => part.answer === null)!;
    expect(card.requestId).toBe(open[0]!.id);
    // Santos's conversation ends with the coach's reply: nothing waits there.
    expect(transcriptProblems(conversationOf(demo, 'Santos').apiMessages).open).toEqual([]);
  });

  it('gives every card the id of the tool_use that produced it', () => {
    for (const conversation of demo.data.conversations) {
      const uses = new Map(
        conversation.apiMessages.flatMap((message) => message.content).flatMap((block) => (block.type === 'tool_use' ? [[block.id, block.name] as const] : [])),
      );
      const cards = conversation.uiMessages.flatMap((message) => message.parts).filter((part) => 'requestId' in part);
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        const name = uses.get((card as { requestId: string }).requestId);
        const expected = { templates: TOOL.proposeTemplates, options: TOOL.askUser, diff: TOOL.proposeAdjustment }[card.kind as 'templates'];
        expect(name, card.kind).toBe(expected);
      }
    }
  });

  it('keeps the coach look at the pressure curve out of the chat', () => {
    const { apiMessages, uiMessages } = conversationOf(demo, 'Kiambu AA');
    const series = apiMessages.flatMap((message) => message.content).filter((block) => block.type === 'tool_use' && block.name === TOOL.getShotSeries);
    expect(series).toHaveLength(1);
    expect(JSON.stringify(uiMessages)).not.toContain('get_shot_series');
  });

  it('only quotes coach text the engine stored as it streamed', () => {
    for (const conversation of demo.data.conversations) {
      const streamed = conversation.apiMessages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.content)
        .flatMap((block) => (block.type === 'text' ? [block.text.trim()] : []));
      const shown = conversation.uiMessages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => parts('text', [message]))
        .map((part) => part.text)
        .filter((text) => text !== NEW_BAG_PROMPT);
      expect(shown).toEqual(streamed);
    }
  });
});

describe('the versions and iterations', () => {
  it('records Kiambu AA v1-v4 from the template, v4 active from v2', () => {
    const kiambu = demo.data.bags.find((bag) => bag.name === 'Kiambu AA')!;
    const versions = demo.data.versions.filter((version) => version.bagId === kiambu.id).sort((a, b) => a.version - b.version);
    expect(versions.map((version) => [version.title, version.status])).toEqual([
      ['Kiambu AA v1', 'superseded'],
      ['Kiambu AA v2', 'superseded'],
      ['Kiambu AA v3', 'undone'],
      ['Kiambu AA v4', 'active'],
    ]);
    expect(kiambu.activeVersionId).toBe(versions[3]!.id);
    expect(versions[3]!.parentVersionId).toBe(versions[1]!.id);
    const template = getTemplate('blooming-espresso')!;
    const levers = versions.map((version) => readLeverValues(template, version.profile));
    expect(levers.map((values) => [values.temp, values.flow, values.yield])).toEqual([
      [92, 2.2, 50],
      [93, 2.2, 50],
      [93, 1.8, 50],
      [93, 2, 50],
    ]);
    // "Sour / sharp" on the open question raises v4's temperature by 1 °C: still inside the template.
    expect(levers[3]!.temp! + 1).toBeLessThanOrEqual(template.levers.find((lever) => lever.id === 'temp')!.max);
  });

  it('logs one iteration per credited shot, each pointing at its Decaid record', () => {
    const outcomes = demo.data.iterations.map((record) => [record.bagName, record.profileVersion, record.outcome]);
    expect(outcomes).toEqual([
      // The keep card was confirmed: History says the recipe was kept, not "No decision yet".
      ['Santos', 1, 'kept'],
      ['Kiambu AA', 1, 'applied'],
      // v3 was confirmed from a typed request, so no iteration made it and undoing it changes none: the grind move stays applied.
      ['Kiambu AA', 2, 'applied'],
      ['Kiambu AA', 2, 'declined'],
      ['Kiambu AA', 4, 'pending'],
    ]);
    const shotIds = new Set(demo.decaid.shots.map((shot) => shot.id));
    for (const record of demo.data.iterations) expect(shotIds.has(record.shotId!), record.shotId!).toBe(true);
    // The stray shot is in Decaid's history but not in the dial-in.
    expect(shotIds.has(SHOTS.stray.id)).toBe(true);
    expect(demo.data.iterations.some((record) => record.shotId === SHOTS.stray.id)).toBe(false);
  });
});

describe('the mock Decaid after the story', () => {
  it('has every version in its library under the id recorded on it (D59)', () => {
    const ids = new Set(demo.decaid.profiles.map((record) => record.id));
    for (const version of demo.data.versions) {
      expect(version.decaidProfileId, version.title).toBe(profileId(version.profile));
      // Santos v1 is Gentle and Sweet at its own 36 g: Decaid's bundled entry, which every mock has.
      if (version.title === 'Santos v1') expect(version.decaidProfileId).toBe(getTemplate('gentle-and-sweet')!.decaidDefaultId);
      else expect(ids.has(version.decaidProfileId!), version.title).toBe(true);
    }
  });

  it('runs the active version, tagged as the engine tags it', () => {
    const v4 = demo.data.versions.find((version) => version.title === 'Kiambu AA v4')!;
    const kiambu = demo.data.bags.find((bag) => bag.name === 'Kiambu AA')!;
    const { workflow } = demo.decaid;
    expect(workflow.profile.title).toBe('Kiambu AA v4');
    expect(profileId(workflow.profile)).toBe(profileId(v4.profile));
    expect(workflow.context).toMatchObject({
      targetYield: 50,
      targetDoseWeight: 18,
      coffeeName: 'Kiambu AA',
      grinderId: STARTING_GRINDER.grinderId,
      grinderModel: 'Niche Zero',
      grinderSetting: '14.5',
      extras: { [EXTRAS_KEY]: { versionId: v4.id, bagId: kiambu.id } },
    });
    expect(workflow.context?.coffeeRoaster).toBeUndefined();
    expect(workflow.context?.beanBatchId).toBeUndefined();
  });

  it('keeps 5 Hz records with pressure, flow and weight for every shot', () => {
    expect(demo.decaid.shots.map((shot) => shot.id)).toEqual([
      SHOTS.santos.id,
      SHOTS.kiambu1.id,
      SHOTS.kiambu2.id,
      SHOTS.stray.id,
      SHOTS.kiambu3.id,
      SHOTS.kiambu4.id,
    ]);
    for (const shot of demo.decaid.shots) {
      const times = shot.measurements.map((point) => parseTimestampMicros(point.machine.timestamp)!);
      const gaps = times.slice(1).map((t, i) => (t - times[i]!) / 1000);
      expect(Math.min(...gaps), shot.id).toBeGreaterThan(150);
      expect(Math.max(...gaps), shot.id).toBeLessThan(250);
      expect(shot.measurements.some((point) => point.machine.pressure > 1)).toBe(true);
      expect(shot.measurements.some((point) => point.machine.flow > 1)).toBe(true);
      expect(shot.measurements.some((point) => (point.scale?.weight ?? 0) > 20)).toBe(true);
    }
    expect(shotRecord(SHOTS.stray.id).workflow.profile.title).toBe('D-Flow / default');
  });

  it('carries what CafAI wrote on each shot (D61, D126): the taste line, extras.cafai, and the running score when rated', () => {
    const kiambu1 = shotRecord(SHOTS.kiambu1.id);
    expect(kiambu1.annotations).toMatchObject({
      espressoNotes: 'Taste: Sour / sharp. Kiambu AA v1 (CafAI)',
      enjoyment: 5,
      extras: {
        [EXTRAS_KEY]: {
          verdict: 'muchWorse',
          comparedWith: { kind: 'otherCoffee', shotId: SHOTS.santos.id, coffee: 'Santos' },
          selected: ['Sour / sharp'],
          text: null,
          version: 1,
        },
      },
    });
    expect(shotRecord(SHOTS.kiambu3.id).annotations).toMatchObject({
      espressoNotes: 'Taste: Sweeter, but a little thin. Kiambu AA v2 (CafAI)',
      enjoyment: 7,
      extras: {
        [EXTRAS_KEY]: { verdict: 'better', comparedWith: { kind: 'previous', shotId: SHOTS.kiambu2.id }, selected: ['Other'], text: 'Sweeter, but a little thin' },
      },
    });
    expect(shotRecord(SHOTS.santos.id).annotations).toMatchObject({ enjoyment: 5, espressoNotes: 'Taste: Balanced, sweet. Santos v1 (CafAI)' });
    // Not rated and not answered yet: only what Decaid wrote itself.
    expect(Object.keys(shotRecord(SHOTS.kiambu4.id).annotations ?? {}).sort()).toEqual(['actualDoseWeight', 'actualYield']);
  });

  it('summarizes each shot card from its record', async () => {
    const { summarizeShot } = await import('../../src/coach/index.ts');
    for (const card of parts('shot')) expect(card.summary).toEqual(summarizeShot(shotRecord(card.shotId)));
  });
});

describe('the shots, each its own', () => {
  const kiambuShots = () => parts('shot', conversationOf(demo, 'Kiambu AA').uiMessages).map((card) => card.summary);

  it('gives no two Kiambu AA shots the same time, first drop or yield', () => {
    const shots = kiambuShots();
    expect(shots).toHaveLength(4);
    for (const metric of ['durationS', 'timeToFirstDropS', 'yieldG'] as const) {
      const values = shots.map((summary) => summary[metric]);
      expect(values.every((value) => value !== null), metric).toBe(true);
      expect(new Set(values).size, `${metric}: ${values.join(', ')}`).toBe(values.length);
    }
  });

  it('pulls a slower shot after the finer grind: later first drops and less in the cup in more time', () => {
    const [one, , three] = kiambuShots();
    expect(three!.timeToFirstDropS!).toBeGreaterThan(one!.timeToFirstDropS!);
    expect(three!.yieldG!).toBeLessThan(one!.yieldG!);
    expect(three!.durationS).toBeGreaterThan(one!.durationS);
  });

  it('keeps the story true: shots one, three and four end with the profile short of 50 g, and shot two peaks in the fill', () => {
    for (const shot of [SHOTS.kiambu1, SHOTS.kiambu3, SHOTS.kiambu4]) {
      const record = shotRecord(shot.id);
      expect(record.stopReason, shot.id).toBe('machineEnded');
      expect(record.annotations?.actualYield, shot.id).toBeLessThan(49);
    }
    const two = kiambuShots()[1]!;
    expect(two.peakPressureAtS!).toBeLessThan(two.preinfusionEndS! + 2);
    expect(two.channelingFlags).toEqual([]);
  });

  it("has the coach quote a shot's times as its card shows them: from the start of the pour", () => {
    const messages = conversationOf(demo, 'Kiambu AA').uiMessages;
    const coach = parts('text', messages.filter((message) => message.role === 'assistant'))
      .map((part) => part.text)
      .join('\n');
    const [one, two] = kiambuShots();
    expect(one!.pourStartS).toBeGreaterThan(1);
    expect(coach).toContain(`the first drops came at ${pourTime(one!.timeToFirstDropS, one!.pourStartS)!.toFixed(1)} s.`);
    expect(coach).toContain(`came during the fill at ${pourTime(two!.peakPressureAtS, two!.pourStartS)!.toFixed(1)} s.`);
    // Never the record's clock, which counts the preheat too.
    expect(coach).not.toContain(`the first drops came at ${one!.timeToFirstDropS!.toFixed(1)} s.`);
    expect(coach).not.toContain(`came during the fill at ${two!.peakPressureAtS!.toFixed(1)} s.`);
  });

  it('a fresh shot of v4 on the mock (its default puck) matches none of them', async () => {
    const { summarizeShot } = await import('../../src/coach/index.ts');
    const v4 = demo.decaid.profiles.find((record) => record.profile.title === 'Kiambu AA v4')!;
    const state = createMockDecaid({ seedExamples: false, uploadMs: 0, now: () => NOW });
    try {
      state.updateWorkflow({ profile: v4.profile, context: { targetYield: 50, targetDoseWeight: 18 } });
      const { record } = await pullShot(state, { id: 'fresh', puckResistance: DEFAULT_PUCK_RESISTANCE, seed: 1 }, NOW);
      const fresh = summarizeShot(record);
      for (const shot of kiambuShots()) {
        expect([fresh.durationS, fresh.timeToFirstDropS, fresh.yieldG]).not.toEqual([shot.durationS, shot.timeToFirstDropS, shot.yieldG]);
      }
      expect(fresh.timeToFirstDropS).not.toBe(kiambuShots()[3]!.timeToFirstDropS);
    } finally {
      state.dispose();
    }
  });
});
