// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { previewTheme } from '../chat/testing/previewTheme.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { TID } from '../testIds.ts';
import { revealSetting } from './revealSetting.ts';
import { MAX_RESULTS } from './settingsIndex.ts';
import { SettingsSearch } from './SettingsSearch.tsx';

vi.mock('./revealSetting.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./revealSetting.ts')>()),
  revealSetting: vi.fn(() => () => undefined),
}));

/** The search as SettingsScreen holds it: the words in its state. */
function Search({ initial = '' }: { initial?: string }) {
  const [query, setQuery] = useState(initial);
  return <SettingsSearch query={query} onQueryChange={setQuery} />;
}

const field = () => screen.getByRole('combobox', { name: 'Search settings' });
const results = () => screen.queryAllByRole('option');

/** A theme colour as getComputedStyle gives it back. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.location.hash = '#/settings';
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.location.hash = '';
  vi.mocked(revealSetting).mockClear();
});

describe('Settings search (D236)', () => {
  it('is a field of its own: "Search settings", a search icon, 44 px on the raised colour, its input carrying the test id', () => {
    renderWithServices(<Search />);
    const input = field();
    expect(input).toHaveAttribute('data-testid', TID.settingsSearch);
    expect(input).toHaveAttribute('placeholder', 'Search settings');
    const box = input.closest<HTMLElement>('[data-search-field]')!;
    expect(box.querySelector('[data-testid="SearchRoundedIcon"]')).not.toBeNull();
    expect(getComputedStyle(box).height).toBe('44px');
    expect(getComputedStyle(box).backgroundColor).toBe(rgb(previewTheme.palette.cafai.raised));
    expect(screen.getByRole('search')).toContainElement(input);
    // Nothing to clear yet, nothing found, nothing said.
    expect(screen.queryByRole('button', { name: 'Clear the search' })).toBeNull();
    expect(results()).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('lists what it finds as the words are typed, each its name over its group, best first', async () => {
    renderWithServices(<Search />);
    await userEvent.type(field(), 'tint');
    const [first] = results();
    expect(first).toHaveAccessibleName('Tint');
    expect(first).toHaveAccessibleDescription('Display');
    expect(first).toHaveAttribute('data-testid', TID.settingsSearchResult('tint'));
    expect(within(first!).getByText('Tint')).toBeInTheDocument();
    expect(within(first!).getByText('Display')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', screen.getByRole('listbox', { name: 'Settings found' }).id);
    // Said to a screen reader too.
    const count = results().length;
    expect(screen.getByRole('status')).toHaveTextContent(`${count} ${count === 1 ? 'setting' : 'settings'} found`);
  });

  it('shows at most eight', async () => {
    renderWithServices(<Search />);
    await userEvent.type(field(), 'e');
    expect(results()).toHaveLength(MAX_RESULTS);
  });

  it('says so when no setting matches the words', async () => {
    renderWithServices(<Search />);
    await userEvent.type(field(), 'zzz');
    expect(results()).toEqual([]);
    expect(screen.getByTestId(TID.settingsSearchNone)).toHaveTextContent('No setting matches “zzz”.');
    expect(screen.getByRole('status')).toBe(screen.getByTestId(TID.settingsSearchNone));
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears with its clear button, the focus back in the field', async () => {
    renderWithServices(<Search />);
    await userEvent.type(field(), 'steam');
    const clear = screen.getByRole('button', { name: 'Clear the search' });
    expect(clear).toHaveAttribute('data-testid', TID.settingsSearchClear);
    await userEvent.click(clear);
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(results()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Clear the search' })).toBeNull();
  });

  it('clears with Escape', async () => {
    renderWithServices(<Search />);
    await userEvent.type(field(), 'steam{Escape}');
    expect(field()).toHaveValue('');
  });

  it('moves between the results with the arrow keys from the field, round the ends, and Enter opens the one chosen', async () => {
    renderWithServices(<Search />);
    await userEvent.type(field(), 'budget');
    const found = results();
    expect(found.map((option) => option.getAttribute('data-testid'))).toEqual(
      ['coach-budget', 'coach-budget-pause', 'coach-usage'].map((id) => TID.settingsSearchResult(id)),
    );
    expect(field()).not.toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', found[0]!.id);
    expect(found[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', found[0]!.id);
    await userEvent.keyboard('{ArrowUp}');
    expect(field()).toHaveAttribute('aria-activedescendant', found[2]!.id);
    expect(found[0]).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/settings/coach');
    expect(revealSetting).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-usage' }), { wash: previewTheme.palette.cafai.accentSoft });
  });

  it('opens the best match on Enter when none was chosen, and a result with a tap', async () => {
    renderWithServices(<Search />);
    await userEvent.type(field(), 'tint{Enter}');
    expect(window.location.hash).toBe('#/settings/display');
    expect(revealSetting).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'tint' }), expect.anything());

    await userEvent.clear(field());
    await userEvent.type(field(), 'export');
    await userEvent.click(screen.getByTestId(TID.settingsSearchResult('export')));
    expect(window.location.hash).toBe('#/settings/data');
    expect(revealSetting).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'export' }), expect.anything());
  });

  it('washes no card under reduced motion', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    renderWithServices(<Search />);
    await userEvent.type(field(), 'tint{Enter}');
    expect(revealSetting).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'tint' }), { wash: null });
  });

  it('keeps its words while the list comes and goes, as SettingsScreen keeps them', () => {
    renderWithServices(<Search initial="wake" />);
    expect(field()).toHaveValue('wake');
    expect(results()[0]).toHaveAccessibleName('Wake times');
  });
});
