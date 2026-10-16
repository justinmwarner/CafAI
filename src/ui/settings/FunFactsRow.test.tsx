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
import { SettingsScreen } from './SettingsScreen.tsx';

// What each choice does, as the spec words it (section 4).
const OFF = 'No fun facts.';
const LIST = "From CafAI's own list of about 500 checked facts, picked for the bag where one fits. Free, and works without the coach.";
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

describe('SettingsScreen > Coach > Fun facts (D198)', () => {
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const BASE: Settings = { model: DEFAULT_MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag-1' };

  // The screen reads Decaid's grinders with the global fetch; no test may reach a real network.
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/api/v1/grinders')
          ? new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
          : new Response('Route not found', { status: 404 }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The screen over a settings store that keeps what CafAI's storage would (src/storage/settings.ts). */
  function renderSettings(settings: Settings = BASE, coachSource?: Partial<CoachSource>) {
    const services: FakeServices = createFakeServices({ storage: { settings } });
    let stored = normalizeSettings(settings, DEFAULT_MODEL);
    services.storage.settings = {
      get: async () => stored,
      update: async (patch) => (stored = applySettingsPatch(stored, patch, DEFAULT_MODEL)),
    };
    if (coachSource) services.coachSource = createMemoryCoachSourceStore(coachSource);
    renderWithServices(<SettingsScreen />, services);
    return services;
  }

  const loaded = () => waitFor(() => expect(select()).toBeEnabled());

  it('sits after the model, before the grinder, in the Coach section', async () => {
    renderSettings();
    await loaded();
    const coach = screen.getByRole('region', { name: 'Coach' });
    expect(coach).toContainElement(select());
    const after = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(screen.getByTestId(TID.modelSelect), select())).toBe(true);
    expect(after(select(), screen.getByTestId(TID.grinderName))).toBe(true);
  });

  it("reads CafAI's and the coach's while none was chosen here, and a save of the rest writes no choice for it", async () => {
    const services = renderSettings();
    await loaded();
    expect(select()).toHaveValue('coach');
    expect(select()).toHaveAccessibleDescription(COACH);
    await userEvent.selectOptions(screen.getByTestId(TID.modelSelect), 'claude-haiku-4-5');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    const saved = await services.storage.settings.get();
    expect(saved.model).toBe('claude-haiku-4-5');
    // Absent until someone chooses on this device, so a restore can still fill it (D198, as D171).
    expect(saved).not.toHaveProperty('funFacts');
  });

  it('saves a choice with Save settings, refreshes the coach, and shows what was saved', async () => {
    const services = renderSettings();
    await loaded();
    await userEvent.selectOptions(select(), 'off');
    expect(select()).toHaveAccessibleDescription(OFF);
    // Saved with the rest of the Coach section, not before.
    expect(await services.storage.settings.get()).not.toHaveProperty('funFacts');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect((await services.storage.settings.get()).funFacts).toBe('off');
    expect(services.coach.calls.map((call) => call.method)).toEqual(['refresh']);
    expect(select()).toHaveValue('off');
  });

  it('shows a choice made before, and keeps it through a save of the rest', async () => {
    const services = renderSettings({ ...BASE, funFacts: 'list' });
    await waitFor(() => expect(select()).toHaveValue('list'));
    expect(select()).toHaveAccessibleDescription(LIST);
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect((await services.storage.settings.get()).funFacts).toBe('list');
  });

  it('says what the CafAI Bridge does with the web search while the coach runs on the computer', async () => {
    renderSettings({ ...BASE, funFacts: 'web' }, { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' });
    await waitFor(() => expect(select()).toHaveAccessibleDescription(WEB_BRIDGE));
  });
});
