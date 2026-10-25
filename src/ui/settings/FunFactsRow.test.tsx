// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryCoachSourceStore, type CoachSource } from '../../storage/coachSource.ts';
import { applySettingsPatch, normalizeSettings } from '../../storage/settings.ts';
import type { Settings } from '../../storage/types.ts';
import { renderThemed, renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { FunFactsRow } from './FunFactsRow.tsx';
import { ModelCard } from './ModelCard.tsx';
import { SAVED } from './SaveLine.tsx';

// What each choice does, as the spec words it (section 4).
const OFF = 'No fun facts.';
const LIST = "From CafAI's own list of over 300 checked facts, picked for the bag where one fits. Free, and works without the coach.";
const COACH = "The coach shares a fact about this bag when it knows one for sure; the rest come from CafAI's list.";
const WEB =
  'The coach may also look the roaster, farm or producer up on the web: one search per fact, about one US cent each, plus a few cents for the pages it reads.';
const WEB_BRIDGE =
  "The coach may also look the roaster, farm or producer up on the web, once per fact. Through the CafAI Bridge, Claude Code searches on your Claude plan: nothing to pay per search, though it counts toward the plan's limits.";

const select = () => screen.getByTestId(TID.funFacts);

describe('FunFactsRow (D198)', () => {
  it('offers the four choices in order, and says under the one chosen what it does', () => {
    renderThemed(<FunFactsRow value="coach" onComputer={false} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Fun facts')).toBe(select());
    expect(select().tagName).toBe('SELECT');
    expect(within(select()).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Off',
      "CafAI's facts",
      "CafAI's and the coach's",
      "CafAI's, the coach's and a web search",
    ]);
    expect(select()).toHaveValue('coach');
    expect(select()).toHaveAccessibleDescription(COACH);
  });

  it('reports a choice, and the line follows the one shown', async () => {
    const onChange = vi.fn();
    const { rerender } = renderThemed(<FunFactsRow value="coach" onComputer={false} onChange={onChange} />);
    await userEvent.selectOptions(select(), 'off');
    expect(onChange).toHaveBeenCalledWith('off');
    for (const [value, line] of [
      ['off', OFF],
      ['list', LIST],
      ['web', WEB],
    ] as const) {
      rerender(<FunFactsRow value={value} onComputer={false} onChange={onChange} />);
      expect(select()).toHaveValue(value);
      expect(select(), value).toHaveAccessibleDescription(line);
    }
  });

  it('says what the CafAI Bridge does with the web search while the coach runs on the computer, and only there', () => {
    const { rerender } = renderThemed(<FunFactsRow value="web" onComputer onChange={vi.fn()} />);
    expect(select()).toHaveAccessibleDescription(WEB_BRIDGE);
    rerender(<FunFactsRow value="coach" onComputer onChange={vi.fn()} />);
    expect(select()).toHaveAccessibleDescription(COACH);
    rerender(<FunFactsRow value="web" onComputer={false} onChange={vi.fn()} />);
    expect(select()).toHaveAccessibleDescription(WEB);
  });

  it('says Loading… and holds the choice until the settings are read, and is held while they save', () => {
    const { rerender } = renderThemed(<FunFactsRow value={null} onComputer={false} onChange={vi.fn()} />);
    expect(select()).toBeDisabled();
    expect(select()).toHaveValue('');
    expect(within(select()).getAllByRole('option').map((option) => option.textContent)).toEqual(['Loading…']);
    rerender(<FunFactsRow value="list" onComputer={false} disabled onChange={vi.fn()} />);
    expect(select()).toBeDisabled();
    expect(select()).toHaveValue('list');
  });
});

describe('Settings > Coach > Model and replies > Fun facts (D198)', () => {
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const BASE: Settings = { model: DEFAULT_MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag-1' };

  // Nothing here reads the network; no test may reach a real one.
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Route not found', { status: 404 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The card over a settings store that keeps what CafAI's storage would (src/storage/settings.ts). */
  function renderSettings(settings: Settings = BASE, coachSource?: Partial<CoachSource>) {
    const services: FakeServices = createFakeServices({ storage: { settings } });
    let stored = normalizeSettings(settings, DEFAULT_MODEL);
    services.storage.settings = {
      get: async () => stored,
      update: async (patch) => (stored = applySettingsPatch(stored, patch, DEFAULT_MODEL)),
    };
    if (coachSource) services.coachSource = createMemoryCoachSourceStore(coachSource);
    renderWithServices(<ModelCard />, services);
    return services;
  }

  const loaded = () => waitFor(() => expect(select()).toBeEnabled());
  const saved = () => waitFor(() => expect(screen.getByTestId(TID.settingsSaved('model'))).toHaveTextContent(SAVED));
  /** Another model the fakes offer: the catalog changes, the test does not. */
  const another = (services: FakeServices) => services.models.find((each) => each.id !== DEFAULT_MODEL)!.id;

  it('sits after the model in the Model and replies card', async () => {
    renderSettings();
    await loaded();
    const card = screen.getByRole('region', { name: 'Model and replies' });
    expect(card).toContainElement(select());
    const after = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(screen.getByTestId(TID.modelSelect), select())).toBe(true);
  });

  it("reads CafAI's and the coach's while none was chosen here, and a model's save writes no choice for it", async () => {
    const services = renderSettings();
    await loaded();
    expect(select()).toHaveValue('coach');
    expect(select()).toHaveAccessibleDescription(COACH);
    const model = another(services);
    await userEvent.selectOptions(screen.getByTestId(TID.modelSelect), model);
    await saved();
    const stored = await services.storage.settings.get();
    expect(stored.model).toBe(model);
    // Absent until someone chooses on this device, so a restore can still fill it (D198, as D171).
    expect(stored).not.toHaveProperty('funFacts');
  });

  it('saves a choice at once, refreshes the coach, and shows what was saved', async () => {
    const services = renderSettings();
    await loaded();
    await userEvent.selectOptions(select(), 'off');
    expect(select()).toHaveAccessibleDescription(OFF);
    await saved();
    expect((await services.storage.settings.get()).funFacts).toBe('off');
    expect(services.coach.calls.map((call) => call.method)).toEqual(['refresh']);
    expect(select()).toHaveValue('off');
  });

  it("shows a choice made before, and keeps it through a model's save", async () => {
    const services = renderSettings({ ...BASE, funFacts: 'list' });
    await waitFor(() => expect(select()).toHaveValue('list'));
    expect(select()).toHaveAccessibleDescription(LIST);
    await userEvent.selectOptions(screen.getByTestId(TID.modelSelect), another(services));
    await saved();
    expect((await services.storage.settings.get()).funFacts).toBe('list');
  });

  it('says what the CafAI Bridge does with the web search while the coach runs on the computer', async () => {
    renderSettings({ ...BASE, funFacts: 'web' }, { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' });
    await waitFor(() => expect(select()).toHaveAccessibleDescription(WEB_BRIDGE));
  });
});
