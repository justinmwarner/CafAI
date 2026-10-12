import { describe, expect, it } from 'vitest';
import type { BeanPickerOption, CoachUiMessage, CoachUiPart } from '../types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import {
  bagConfirmPart,
  beanPickerPart,
  diffPart,
  filledBeanCard,
  grinderOfferPart,
  isLoadingBeanCard,
  isOpenBagConfirm,
  isOpenBeanCard,
  isTransient,
  loadingBeanPickerPart,
  message,
  noticePart,
  optionsPart,
  progressNoticePart,
  removeMessage,
  replaceParts,
  setAside,
  setGrinderOfferStatus,
  setShotRating,
  setVisualizerLink,
  shotPart,
  startingYieldText,
  templatesPart,
  withoutTransient,
  type StartingDose,
} from './uiMessages.ts';

const at = '2026-10-03T08:00:00.000Z';
const summary = { shotId: 'shot-1' } as ShotSummary;

const change = {
  requestId: 'tu-adj',
  summary: 'Keep this recipe',
  lines: [],
  manualSteps: [],
  rationale: 'Balanced and sweet.',
  expectedEffect: 'The same cup again.',
  versionLabel: null,
};

describe('cards', () => {
  it('marks whether a question asks for the taste', () => {
    expect(optionsPart('tu-ask', 'How did it taste?', ['Sour', 'Other'], false, true)).toEqual({
      kind: 'options',
      requestId: 'tu-ask',
      question: 'How did it taste?',
      options: ['Sour', 'Other'],
      multiSelect: false,
      answer: null,
      taste: true,
    });
    expect(optionsPart('tu-puck', 'What does the puck look like?', ['Pinholes', 'Other'], true, false)).toMatchObject({ taste: false });
  });

  it('marks a change card that keeps the recipe, and only that one', () => {
    expect(diffPart({ ...change, keep: true })).toEqual({ kind: 'diff', ...change, keep: true, status: 'pending', error: null });
    expect(diffPart(change)).toEqual({ kind: 'diff', ...change, status: 'pending', error: null });
    expect(diffPart({ ...change, keep: false })).not.toHaveProperty('keep');
  });

  it('sets a card aside with the reason, and leaves a decided change and other parts alone', () => {
    const question = optionsPart('tu-ask', 'How did it taste?', ['Sour', 'Other'], false, true);
    expect(setAside(question, 'typed')).toEqual({ ...question, expired: true, setAsideReason: 'typed' });
    const cards = templatesPart('tu-tpl', []);
    expect(setAside(cards, 'shot')).toEqual({ ...cards, expired: true, setAsideReason: 'shot' });
    const pending = diffPart(change) as Extract<CoachUiPart, { kind: 'diff' }>;
    expect(setAside(pending, 'undo')).toEqual({ ...pending, status: 'expired', setAsideReason: 'undo' });
    const applied = { ...pending, status: 'applied' as const };
    expect(setAside(applied, 'other')).toBe(applied);
    const shot = shotPart('shot-1', summary);
    expect(setAside(shot, 'other')).toBe(shot);
  });

  it('opens the bean card and the photo confirm card unanswered, and sets them aside only while open (6.1, 6.8)', () => {
    const card = beanPickerPart([]);
    expect(card).toEqual({ kind: 'beanPicker', options: [], choice: null });
    expect(isOpenBeanCard(card)).toBe(true);
    expect(setAside(card, 'typed')).toEqual({ ...card, expired: true, setAsideReason: 'typed' });
    expect(isOpenBeanCard(setAside(card, 'typed'))).toBe(false);
    const picked = { ...card, choice: { kind: 'other' as const } };
    expect(isOpenBeanCard(picked)).toBe(false);
    expect(setAside(picked, 'typed')).toBe(picked);

    const details = { name: '', roaster: 'Square Mile', origin: null, roastLevel: null, process: null, notes: null, roastDate: null };
    const confirm = bagConfirmPart(details);
    expect(confirm).toEqual({ kind: 'bagConfirm', details, confirmed: false });
    expect(isOpenBagConfirm(confirm)).toBe(true);
    expect(setAside(confirm, 'typed')).toEqual({ ...confirm, expired: true, setAsideReason: 'typed' });
    const confirmed = { ...confirm, confirmed: true };
    expect(isOpenBagConfirm(confirmed)).toBe(false);
    expect(setAside(confirmed, 'typed')).toBe(confirmed);
  });

  it("opens the coach's grinder card waiting for a tap, records each answer, and sets it aside only while it waits (D125)", () => {
    const grinder = { model: 'Mazzer Philos', burrs: null, settingType: null, smallStep: null, bigStep: null, values: null };
    const offer = grinderOfferPart('tu-grinder', grinder) as Extract<CoachUiPart, { kind: 'grinderOffer' }>;
    expect(offer).toEqual({ kind: 'grinderOffer', requestId: 'tu-grinder', grinder, status: 'pending', error: null });
    const failed = { ...offer, error: 'Could not reach Decaid.' };
    expect(setAside(failed, 'typed')).toEqual({ ...offer, status: 'expired', error: null, setAsideReason: 'typed' });
    const added = { ...offer, status: 'added' as const };
    expect(setAside(added, 'shot')).toBe(added);

    const messages: CoachUiMessage[] = [message('m1', 'assistant', [offer], at)];
    const failedNow = setGrinderOfferStatus(messages, 'tu-grinder', 'pending', { error: 'Could not reach Decaid.' });
    expect(failedNow[0]!.parts[0]).toMatchObject({ status: 'pending', error: 'Could not reach Decaid.' });
    const linked = setGrinderOfferStatus(failedNow, 'tu-grinder', 'existing', { linkedName: 'Niche Zero (63 mm conical)' });
    expect(linked[0]!.parts[0]).toEqual({ ...offer, status: 'existing', error: null, linkedName: 'Niche Zero (63 mm conical)' });
    expect(setGrinderOfferStatus(messages, 'tu-other', 'declined')).toEqual(messages);
  });

  it("puts the bean card up before Decaid's batches are read, open, then fills it, answered or not (6.1)", () => {
    const card = loadingBeanPickerPart();
    expect(card).toEqual({ kind: 'beanPicker', options: [], choice: null, loading: true });
    expect(isOpenBeanCard(card)).toBe(true);
    expect(isLoadingBeanCard(card)).toBe(true);
    expect(isLoadingBeanCard(beanPickerPart([]))).toBe(false);
    const option = { beanId: 'bean-1', batchId: 'batch-1', name: 'Red Brick' } as BeanPickerOption;
    expect(filledBeanCard(card, [option])).toEqual({ kind: 'beanPicker', options: [option], choice: null });
    const skipped = { ...card, choice: { kind: 'other' as const } };
    expect(filledBeanCard(skipped, [option])).toEqual({ kind: 'beanPicker', options: [option], choice: { kind: 'other' } });
    const shot = shotPart('shot-1', summary);
    expect(filledBeanCard(shot, [option])).toBe(shot);
  });
});

describe('transient notices', () => {
  const loading = progressNoticePart('Loading Kiambu AA v2 on the machine…', { value: null, label: null });

  it('marks a notice with progress as transient', () => {
    expect(loading).toEqual({
      kind: 'notice',
      tone: 'info',
      text: 'Loading Kiambu AA v2 on the machine…',
      progress: { value: null, label: null },
    });
    expect(isTransient(loading)).toBe(true);
    expect(isTransient(noticePart('success', 'Loaded Kiambu AA v2 on the machine.'))).toBe(false);
    expect(isTransient(shotPart('shot-1', summary))).toBe(false);
  });

  it('drops transient notices and the messages left empty, keeping everything else as it was', () => {
    const kept = message('m-1', 'system', [noticePart('success', 'Loaded.')], at);
    const mixed = message('m-2', 'system', [noticePart('info', 'Saved.'), loading], at);
    const gone = message('m-3', 'system', [loading], at);
    const result = withoutTransient([kept, mixed, gone]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(kept);
    expect(result[1]).toEqual({ ...mixed, parts: [noticePart('info', 'Saved.')] });
  });

  it('returns the same array when nothing is transient', () => {
    const messages = [message('m-1', 'system', [noticePart('success', 'Loaded.')], at)];
    expect(withoutTransient(messages)).toBe(messages);
  });
});

describe('message updates', () => {
  const messages: CoachUiMessage[] = [
    message('m-1', 'system', [shotPart('shot-1', summary)], at),
    message('m-2', 'system', [noticePart('info', 'Looking…')], at),
  ];

  it('replaces the parts of one message in place', () => {
    const next: CoachUiPart[] = [noticePart('info', 'Still looking…')];
    const result = replaceParts(messages, 'm-2', next);
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toEqual({ ...messages[1], parts: next });
  });

  it('removes one message', () => {
    expect(removeMessage(messages, 'm-2').map((m) => m.id)).toEqual(['m-1']);
  });

  it("puts the verdict and what it was compared with on a shot's card (D126)", () => {
    const baseline = { kind: 'previous', shotId: 'shot-0' } as const;
    const result = setShotRating(messages, 'shot-1', baseline, { verdict: 'better', score: 6 });
    expect(result[0]!.parts[0]).toEqual({ kind: 'shot', shotId: 'shot-1', summary, baseline, rating: { verdict: 'better', score: 6 } });
    expect(result[1]).toBe(messages[1]);
    expect(setShotRating(messages, 'shot-unknown', baseline, { verdict: 'better', score: 6 })).toEqual(messages);
  });

  it("puts the Visualizer link on a shot's card (6.4)", () => {
    const url = 'https://visualizer.coffee/shots/viz-1';
    const result = setVisualizerLink(messages, 'shot-1', url);
    expect(result[0]!.parts[0]).toEqual({ kind: 'shot', shotId: 'shot-1', summary, visualizerUrl: url });
    expect(result[1]).toBe(messages[1]);
  });
});

describe("where v1 stops (D57)", () => {
  const dose = (decaidG: number | null, knownG: number | null): StartingDose => ({
    decaidG,
    knownG,
    assumedG: 18,
    range: { min: 12, max: 25 },
  });

  it('names the dose in Decaid that v1 was worked out from', () => {
    expect(startingYieldText('Kiambu AA v1', 50, dose(18, 18))).toBe('Kiambu AA v1 stops at 50 g: 2.8 x the 18.0 g dose in Decaid.');
    expect(startingYieldText('Kiambu AA v1', 45, dose(16, 16))).toBe('Kiambu AA v1 stops at 45 g: 2.8 x the 16.0 g dose in Decaid.');
    expect(startingYieldText('Sumatra v1', 37, dose(18.5, 18.5))).toBe('Sumatra v1 stops at 37 g: 2.0 x the 18.5 g dose in Decaid.');
  });

  it("gives the ratio of the stop itself when the lever's bounds moved it", () => {
    // Londonium at 12 g: 2.0 x 12 = 24 g sits under its 25 g minimum, so v1 stops at 25 g.
    expect(startingYieldText('Sumatra v1', 25, dose(12, 12))).toBe('Sumatra v1 stops at 25 g: 2.1 x the 12.0 g dose in Decaid.');
  });

  it('says v1 assumes 18 g when Decaid has no dose, and how to change that', () => {
    expect(startingYieldText('Kiambu AA v1', 50, dose(null, null))).toBe(
      'Kiambu AA v1 stops at 50 g: 2.8 x 18 g. CafAI found no dose in Decaid, so v1 assumes 18 g. Set your real dose in Decaid and CafAI will use it.',
    );
  });

  it("says v1 assumes 18 g when Decaid's dose is outside 12-25 g", () => {
    expect(startingYieldText('Kiambu AA v1', 50, dose(7, null))).toBe(
      'Kiambu AA v1 stops at 50 g: 2.8 x 18 g. The 7.0 g dose in Decaid is outside 12-25 g, so v1 assumes 18 g. Set your real dose in Decaid and CafAI will use it.',
    );
    expect(startingYieldText('Kiambu AA v1', 90, dose(30, null))).toContain('The 30.0 g dose in Decaid is outside 12-25 g');
  });
});
