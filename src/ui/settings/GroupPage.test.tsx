// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { createMemoryCoachSourceStore } from '../../storage/coachSource.ts';
import { createFakeServices, createFakeUsage, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import type { SettingsGroupId } from './groupIds.ts';
import { GroupPage, TWO_COLUMNS_FROM } from './GroupPage.tsx';

beforeEach(() => {
  // The groups read Decaid's grinders with the global fetch; no test may reach a real network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every card a group holds, in order, by the region name e2e finds it by. */
const cards = (id: SettingsGroupId) =>
  within(screen.getByTestId(TID.settingsPane(id)))
    .getAllByRole('region')
    .map((region) => region.getAttribute('aria-label'));

function servicesWithAll(): FakeServices {
  const services = createFakeServices();
  services.coachSource = createMemoryCoachSourceStore({ kind: 'anthropic' });
  services.usage = createFakeUsage().usage;
  return services;
}

describe('Settings groups and what moved where (D233)', () => {
  it('Coach: where the coach runs, the Anthropic API key while it runs there, and the model and its replies', async () => {
    renderWithServices(<GroupPage id="coach" layout="pane" />, servicesWithAll());
    await waitFor(() => expect(cards('coach')).toEqual(['Where the coach runs', 'Anthropic API key', 'Model and replies']));
    for (const testId of [TID.coachSourceAnthropic, TID.apiKeyInput, TID.keyInDecaid, TID.modelSelect, TID.funFacts]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('Grinder: your grinder, its setting and Add a grinder, in one card', async () => {
    renderWithServices(<GroupPage id="grinder" layout="pane" />, servicesWithAll());
    expect(cards('grinder')).toEqual(['Your grinder']);
    expect(await screen.findByTestId(TID.grinderName)).toBeInTheDocument();
    expect(screen.getByTestId(TID.grinderSetting)).toBeInTheDocument();
    expect(await screen.findByTestId(TID.addGrinder)).toBeInTheDocument();
  });

  it('Drinks: one card each, with the line over the three', () => {
    renderWithServices(<GroupPage id="drinks" layout="pane" />, servicesWithAll());
    expect(cards('drinks')).toEqual(['Steam', 'Hot water', 'Flush']);
    for (const testId of [TID.drinkSettings, TID.drinkScreens, TID.drinkScene('steam'), TID.drinkGoBackSwitch('flush')]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('Machine: sleep and wake, then machine care', () => {
    renderWithServices(<GroupPage id="machine" layout="pane" />, servicesWithAll());
    expect(cards('machine')).toEqual(['Sleep and wake', 'Machine care']);
    expect(screen.getByTestId(TID.sleepWake)).toBeInTheDocument();
    expect(screen.getByTestId(TID.careOpen)).toBeInTheDocument();
  });

  it('Display: appearance, units with the temperatures (no longer in appearance), and the screensaver', () => {
    renderWithServices(<GroupPage id="display" layout="pane" />, servicesWithAll());
    expect(cards('display')).toEqual(['Appearance', 'Units', 'Screensaver']);
    const pane = screen.getByTestId(TID.settingsPane('display'));
    const units = within(pane).getByRole('region', { name: 'Units' });
    expect(within(units).getByTestId(TID.temperatureUnit('celsius'))).toBeInTheDocument();
    expect(within(within(pane).getByRole('region', { name: 'Appearance' })).queryByTestId(TID.temperatureUnit('celsius'))).toBeNull();
    for (const testId of [TID.appearanceMode('dark'), TID.tintSwatch('crema'), TID.tintHue, TID.saverSection, TID.saverPreview]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('Data and privacy: the backup and what it holds, sharing usage, and the log', async () => {
    renderWithServices(<GroupPage id="data" layout="pane" />, servicesWithAll());
    expect(cards('data')).toEqual(['Backup in Decaid', 'Share usage', 'Log']);
    expect(await screen.findByTestId(TID.backupHealth)).toBeInTheDocument();
    for (const testId of [TID.usageSwitch, TID.logSection, TID.logOpen]) expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('Data and privacy leaves sharing out where the build shares nothing', () => {
    renderWithServices(<GroupPage id="data" layout="pane" />, createFakeServices());
    expect(cards('data')).toEqual(['Backup in Decaid', 'Log']);
  });

  it("About: CafAI's and Decaid's versions, the backup line no longer among them", async () => {
    renderWithServices(<GroupPage id="about" layout="pane" />, servicesWithAll());
    expect(cards('about')).toEqual(['CafAI and Decaid']);
    expect(screen.getByText('CafAI 0.1.0-test')).toBeInTheDocument();
    expect(await screen.findByText('Decaid 0.9.0+1 (CafAI was verified with 0.8.8)')).toBeInTheDocument();
    expect(screen.getByTestId(TID.aboutDecaid)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.backupHealth)).toBeNull();
  });

  it("About prefers the version Decaid reports to the skin", () => {
    const services = createFakeServices({ insideDecaid: true });
    renderWithServices(<GroupPage id="about" layout="pane" />, services);
    expect(screen.getByText('Decaid 0.9.0 (CafAI was verified with 0.8.8)')).toBeInTheDocument();
    expect(services.decaid.calls.map((c) => c.method)).not.toContain('getInfo');
  });
});

describe("A group's page", () => {
  it("as the tablet's pane: the group's name as an h2 over its line, and each card's title an h3", () => {
    renderWithServices(<GroupPage id="machine" layout="pane" />, servicesWithAll());
    const pane = screen.getByTestId(TID.settingsPane('machine'));
    expect(within(pane).getByRole('heading', { level: 2, name: 'Machine' })).toBeInTheDocument();
    expect(within(pane).getByText('When the machine sleeps and wakes, and how to keep it clean.')).toBeInTheDocument();
    expect(within(pane).getByRole('heading', { level: 3, name: 'Sleep and wake' })).toBeInTheDocument();
    expect(within(pane).getByRole('heading', { level: 3, name: 'Machine care' })).toBeInTheDocument();
    expect(screen.queryByTestId(TID.settingsBack)).toBeNull();
  });

  it("as a phone's page: a header with the back arrow and the group's name as the h1, each card's title an h2", () => {
    renderWithServices(<GroupPage id="machine" layout="page" />, servicesWithAll());
    const page = screen.getByTestId(TID.settingsPane('machine'));
    expect(within(page).getByRole('heading', { level: 1, name: 'Machine' })).toBeInTheDocument();
    expect(within(page).getByRole('heading', { level: 2, name: 'Sleep and wake' })).toBeInTheDocument();
    expect(screen.getByTestId(TID.settingsBack)).toHaveAttribute('href', '#/settings');
    // The back arrow is a 48 px target, as Machine care's.
    expect(getComputedStyle(screen.getByTestId(TID.settingsBack)).minWidth).not.toBe('');
  });

  /** jsdom has no layout: give every element the pane's own width. */
  function paneWidth(width: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  }
  const grid = (element: HTMLElement) => getComputedStyle(element).gridTemplateColumns;

  it(`sets the cards in two columns from ${TWO_COLUMNS_FROM} px of the pane's own width`, () => {
    paneWidth(TWO_COLUMNS_FROM);
    renderWithServices(<GroupPage id="display" layout="pane" />, servicesWithAll());
    const appearance = screen.getByRole('region', { name: 'Appearance' });
    const columns = appearance.parentElement!.parentElement!;
    expect(grid(columns)).toBe('repeat(2, minmax(0, 1fr))');
    expect(columns).toContainElement(screen.getByRole('region', { name: 'Screensaver' }));
  });

  it('keeps them in one column of at most 760 px under that, and on a phone whatever the width', () => {
    paneWidth(TWO_COLUMNS_FROM - 1);
    const { unmount } = renderWithServices(<GroupPage id="display" layout="pane" />, servicesWithAll());
    const column = screen.getByRole('region', { name: 'Appearance' }).parentElement!.parentElement!;
    expect(grid(column)).not.toContain('repeat(2');
    expect(getComputedStyle(column).maxWidth).toBe('760px');
    unmount();
    paneWidth(1200);
    renderWithServices(<GroupPage id="display" layout="page" />, servicesWithAll());
    expect(grid(screen.getByRole('region', { name: 'Appearance' }).parentElement!.parentElement!)).not.toContain('repeat(2');
  });

  it("sets the drinks' three cards side by side from the same width, each setting's label over its control", () => {
    paneWidth(TWO_COLUMNS_FROM);
    renderWithServices(<GroupPage id="drinks" layout="pane" />, servicesWithAll());
    expect(grid(screen.getByTestId(TID.drinkScreens))).toBe('repeat(3, minmax(0, 1fr))');
  });

  it("keeps a group of one column to one column on a wide pane", () => {
    paneWidth(1200);
    renderWithServices(<GroupPage id="grinder" layout="pane" />, servicesWithAll());
    const column = screen.getByRole('region', { name: 'Your grinder' }).parentElement!.parentElement!;
    expect(getComputedStyle(column).maxWidth).toBe('760px');
  });
});
