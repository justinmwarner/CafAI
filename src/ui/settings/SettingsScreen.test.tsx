// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryCoachSourceStore } from '../../storage/coachSource.ts';
import { createFakeServices, createFakeSpend, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { useRoute } from '../router.ts';
import { ScreenModeContext } from '../shell/screenMode.ts';
import { knownDecaidVersion } from './decaidVersion.ts';
import { SETTINGS_GROUP_IDS } from './groupIds.ts';
import { forgetOpenedGroup, SettingsScreen } from './SettingsScreen.tsx';

const JSDOM_VIEWPORT = { width: window.innerWidth, height: window.innerHeight };

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  forgetOpenedGroup();
  window.location.hash = '#/settings';
  // The groups read Decaid's grinders and more with the global fetch; no test may reach a real network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Route not found', { status: 404 })),
  );
});

afterEach(() => {
  setViewport(JSDOM_VIEWPORT.width, JSDOM_VIEWPORT.height);
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const list = () => screen.queryByTestId(TID.settingsList);
const pane = (id: string) => screen.queryByTestId(TID.settingsPane(id));
const anyPane = () => SETTINGS_GROUP_IDS.map((id) => pane(id)).filter((element) => element !== null);

describe('Settings on a tablet (D232)', () => {
  beforeEach(() => setViewport(1280, 800));

  it('shows its list beside the group chosen, the group marked current there', () => {
    renderWithServices(<SettingsScreen group="display" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId(TID.settingsGroupRow('display'))).toHaveAttribute('aria-current', 'page');
    const display = pane('display')!;
    expect(within(display).getByRole('heading', { level: 2, name: 'Display' })).toBeInTheDocument();
    expect(within(display).getByText('How CafAI looks, the units it shows, and the screensaver.')).toBeInTheDocument();
    // A card's title sits under the group's h2.
    expect(within(display).getByRole('heading', { level: 3, name: 'Appearance' })).toBeInTheDocument();
    expect(within(display).getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    expect(anyPane()).toEqual([display]);
    // Rows open their group's page; beside the pane they end in no chevron.
    expect(screen.getByTestId(TID.settingsGroupRow('coach')).querySelector('[data-testid="ChevronRightRoundedIcon"]')).toBeNull();
  });

  it('opens Coach on a bare #/settings and puts it in the address, replacing it so Back is no trap', () => {
    const entries = window.history.length;
    renderWithServices(<SettingsScreen group={null} />);
    expect(pane('coach')).toBeInTheDocument();
    expect(screen.getByTestId(TID.settingsGroupRow('coach'))).toHaveAttribute('aria-current', 'page');
    expect(window.location.hash).toBe('#/settings/coach');
    expect(window.history.length).toBe(entries);
  });

  it('opens the group opened last in this page’s life on a bare #/settings', () => {
    window.location.hash = '#/settings/data';
    const { unmount } = renderWithServices(<SettingsScreen group="data" />);
    unmount();
    window.location.hash = '#/settings';
    renderWithServices(<SettingsScreen group={null} />);
    expect(pane('data')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings/data');
  });

  it('scrolls the list and the group each inside itself, never the page', () => {
    renderWithServices(<SettingsScreen group="machine" />);
    expect(getComputedStyle(list()!).overflowY).toBe('auto');
    expect(getComputedStyle(pane('machine')!).overflowY).toBe('auto');
  });

  it('lays itself out as the shell does, not the window: a keyboard shortening a tablet keeps its panes', () => {
    setViewport(1280, 380);
    renderWithServices(
      <ScreenModeContext.Provider value="tablet">
        <SettingsScreen group="grinder" />
      </ScreenModeContext.Provider>,
    );
    expect(list()).toBeInTheDocument();
    expect(pane('grinder')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.settingsBack)).toBeNull();
  });
});

describe('Settings on a phone (D232)', () => {
  beforeEach(() => setViewport(390, 844));

  it('is its list alone on #/settings, each row ending in a chevron, and puts nothing in the address', () => {
    renderWithServices(<SettingsScreen group={null} />);
    expect(list()).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(anyPane()).toEqual([]);
    for (const id of SETTINGS_GROUP_IDS) {
      const row = screen.getByTestId(TID.settingsGroupRow(id));
      expect(row).not.toHaveAttribute('aria-current');
      expect(row.querySelector('[data-testid="ChevronRightRoundedIcon"]')).not.toBeNull();
    }
    expect(window.location.hash).toBe('#/settings');
  });

  it("opens a group as a page of its own: a back arrow to the list, the group's name as the h1, its cards under it", () => {
    renderWithServices(<SettingsScreen group="grinder" />);
    expect(list()).toBeNull();
    const page = pane('grinder')!;
    expect(within(page).getByRole('heading', { level: 1, name: 'Grinder' })).toBeInTheDocument();
    const back = screen.getByTestId(TID.settingsBack);
    expect(back).toHaveAccessibleName('Back to Settings');
    expect(back).toHaveAttribute('href', '#/settings');
    expect(within(page).getByText('Your grinder and its setting, so the coach can say how far to turn it.')).toBeInTheDocument();
    expect(within(page).getByRole('heading', { level: 2, name: 'Your grinder' })).toBeInTheDocument();
  });

  it('scrolls the page under its header, never the page itself', () => {
    renderWithServices(<SettingsScreen group="about" />);
    const header = screen.getByRole('heading', { level: 1, name: 'About' });
    const scroller = within(pane('about')!).getByRole('region', { name: 'CafAI and Decaid' }).closest<HTMLElement>('[class*="MuiBox-root"]')!;
    expect(header).toBeInTheDocument();
    let element: HTMLElement | null = scroller;
    while (element && getComputedStyle(element).overflowY !== 'auto') element = element.parentElement;
    expect(element).not.toBeNull();
    expect(element).not.toContainElement(header);
  });
});

describe('Settings across the line', () => {
  it("keeps its route: a tablet's pane becomes a phone's page, and back", () => {
    setViewport(1280, 800);
    renderWithServices(<SettingsScreen group="machine" />);
    expect(list()).toBeInTheDocument();
    act(() => setViewport(390, 844));
    expect(list()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Machine' })).toBeInTheDocument();
    act(() => setViewport(1280, 800));
    expect(list()).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Machine' })).toBeInTheDocument();
  });

  it("a phone's list, made a tablet, shows the group opened last beside it", () => {
    setViewport(390, 844);
    renderWithServices(<SettingsScreen group={null} />, createFakeServices());
    expect(anyPane()).toEqual([]);
    act(() => setViewport(962, 602));
    expect(pane('coach')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings/coach');
  });
});

describe("Settings and Decaid's version", () => {
  it("asks Decaid's version as it opens, whichever group shows, so the log's header carries it (D139)", async () => {
    setViewport(1280, 800);
    const services = createFakeServices();
    renderWithServices(<SettingsScreen group="data" />, services);
    await waitFor(() => expect(knownDecaidVersion(services.decaid)).toBe('0.9.0+1'));
    expect(services.decaid.calls.filter((call) => call.method === 'getInfo')).toHaveLength(1);
  });

  it("asks again on the phone's list", async () => {
    setViewport(390, 844);
    const services = createFakeServices();
    renderWithServices(<SettingsScreen group={null} />, services);
    await waitFor(() => expect(knownDecaidVersion(services.decaid)).toBe('0.9.0+1'));
  });
});

/** Settings as the app routes it: the group from the address, the same screen kept while the address moves within Settings. */
function RoutedSettings() {
  const route = useRoute();
  return route.name === 'settings' ? <SettingsScreen group={route.group ?? null} /> : null;
}

/** Services with what the Coach group's usage card and budget need: the spend and where the coach runs. */
function servicesWithSpend(): FakeServices {
  const services = createFakeServices({ spend: createFakeSpend() });
  services.coachSource = createMemoryCoachSourceStore({ kind: 'anthropic' });
  return services;
}

const searchField = () => screen.getByRole('combobox', { name: 'Search settings' });

describe('Settings search (D236)', () => {
  it("puts its field over the list's rows, and what it finds in their place until it is cleared", async () => {
    setViewport(1280, 800);
    window.location.hash = '#/settings/coach';
    renderWithServices(<RoutedSettings />);
    const field = searchField();
    expect(field).toHaveAttribute('data-testid', TID.settingsSearch);
    const list = screen.getByTestId(TID.settingsList);
    expect(list).toContainElement(field);
    await userEvent.type(field, 'zzz');
    expect(within(list).queryAllByRole('link')).toEqual([]);
    expect(screen.getByTestId(TID.settingsSearchNone)).toHaveTextContent('No setting matches “zzz”.');
    await userEvent.click(screen.getByTestId(TID.settingsSearchClear));
    expect(within(list).getAllByRole('link')).toHaveLength(SETTINGS_GROUP_IDS.length);
  });

  it('opens a result on a tablet: its group beside the list, the chosen tint focused, its card washed for a moment', async () => {
    setViewport(1280, 800);
    window.location.hash = '#/settings/coach';
    renderWithServices(<RoutedSettings />);
    await userEvent.type(searchField(), 'tint{Enter}');
    expect(window.location.hash).toBe('#/settings/display');
    const display = await screen.findByTestId(TID.settingsPane('display'));
    const crema = within(display).getByTestId(TID.tintSwatch('crema'));
    await waitFor(() => expect(crema).toHaveFocus());
    const appearance = within(display).getByRole('region', { name: 'Appearance' });
    expect(appearance.style.backgroundColor).not.toBe('');
    // The search keeps its words, and the list what it found.
    expect(searchField()).toHaveValue('tint');
    expect(screen.getByTestId(TID.settingsSearchResult('tint'))).toBeInTheDocument();
  });

  it("opens a result on a phone as the group's page, the setting focused once its card has read it", async () => {
    setViewport(390, 844);
    window.location.hash = '#/settings';
    renderWithServices(<RoutedSettings />, servicesWithSpend());
    await userEvent.type(searchField(), 'budget');
    await userEvent.click(screen.getByTestId(TID.settingsSearchResult('coach-budget')));
    expect(window.location.hash).toBe('#/settings/coach');
    expect(screen.queryByTestId(TID.settingsList)).toBeNull();
    const budget = await screen.findByTestId(TID.coachBudgetAmount);
    await waitFor(() => expect(budget).toHaveFocus());
    // Back on the list, the search still says what it found.
    act(() => {
      window.location.hash = '#/settings';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByTestId(TID.settingsSearchResult('coach-budget'))).toBeInTheDocument();
    expect(searchField()).toHaveValue('budget');
  });
});

describe('Settings saves as it changes (D234)', () => {
  // The credentials keep theirs (Save key; the bridge's address and code, absent here): a key is never saved half typed.
  it('has no Save settings, nor any other Save, in any group', () => {
    setViewport(1280, 800);
    for (const id of SETTINGS_GROUP_IDS) {
      const { unmount } = renderWithServices(<SettingsScreen group={id} />);
      expect(screen.queryByRole('button', { name: /^save( settings)?$/i }), id).toBeNull();
      unmount();
    }
  });
});
