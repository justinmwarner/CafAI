// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { keepDrinkPresets } from './statusReads.ts';
import { SETTINGS_GROUP_IDS } from './groupIds.ts';
import { SETTINGS_GROUPS, settingsGroup } from './groups.tsx';
import { SettingsList } from './SettingsList.tsx';

afterEach(() => {
  window.location.hash = '';
});

const rows = () => SETTINGS_GROUP_IDS.map((id) => screen.getByTestId(TID.settingsGroupRow(id)));

describe('SettingsList (D232)', () => {
  it('titles the list and shows the seven groups in order, each with how it stands', async () => {
    renderWithServices(<SettingsList chosen={null} chevrons />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(nav).toBe(screen.getByTestId(TID.settingsList));
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(SETTINGS_GROUP_IDS.map((id) => `#/settings/${id}`));
    expect(SETTINGS_GROUPS.map((group) => group.name)).toEqual(['Coach', 'Grinder', 'Drinks', 'Machine', 'Display', 'Data and privacy', 'About']);
    // Each row is named by its group and described by its status line (groupStatus.ts): the group's
    // contents while there is nothing live to say, as for the drinks and the machine until their groups read Decaid.
    const described = {
      coach: 'Opus 5.5',
      grinder: 'Not set yet',
      drinks: settingsGroup('drinks').contents,
      machine: settingsGroup('machine').contents,
      display: 'Dark · Crema · °C',
      data: 'Not backed up yet',
      about: 'CafAI 0.1.0-test · Decaid 0.9.0',
    } as const;
    for (const group of SETTINGS_GROUPS) {
      const row = screen.getByTestId(TID.settingsGroupRow(group.id));
      expect(row).toHaveAccessibleName(group.name);
      await waitFor(() => expect(row).toHaveAccessibleDescription(described[group.id]));
    }
  });

  it('marks the chosen group as the current page, and no other', () => {
    renderWithServices(<SettingsList chosen="display" chevrons={false} />);
    const display = screen.getByTestId(TID.settingsGroupRow('display'));
    expect(display).toHaveAttribute('aria-current', 'page');
    for (const row of rows().filter((each) => each !== display)) expect(row).not.toHaveAttribute('aria-current');
  });

  it('keeps one tab stop, the chosen row, and moves the focus with the arrow keys, Home and End, round the ends', async () => {
    renderWithServices(<SettingsList chosen="grinder" chevrons={false} />);
    const [coach, grinder, drinks, , , , about] = rows();
    expect(rows().filter((row) => row.tabIndex === 0)).toEqual([grinder]);

    await userEvent.tab();
    expect(grinder).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(drinks).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(coach).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(about).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(coach).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(about).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(coach).toHaveFocus();
    // The row last focused is the tab stop now, and the arrows never open a group.
    expect(rows().filter((row) => row.tabIndex === 0)).toEqual([coach]);
    expect(window.location.hash).toBe('');
  });

  it('opens a group by its address with a tap', async () => {
    renderWithServices(<SettingsList chosen={null} chevrons />);
    await userEvent.click(screen.getByTestId(TID.settingsGroupRow('data')));
    expect(window.location.hash).toBe('#/settings/data');
  });

  it("ends each row in a chevron on a phone's list, where a row opens a page, and not beside the tablet's pane", () => {
    const { unmount } = renderWithServices(<SettingsList chosen={null} chevrons />);
    for (const row of rows()) expect(row.querySelector('[data-testid="ChevronRightRoundedIcon"]')).not.toBeNull();
    unmount();
    renderWithServices(<SettingsList chosen="coach" chevrons={false} />);
    for (const row of rows()) expect(row.querySelector('[data-testid="ChevronRightRoundedIcon"]')).toBeNull();
  });

  it('puts the search field, when there is one, between the title and the rows', () => {
    renderWithServices(<SettingsList chosen={null} chevrons search={<input aria-label="Search settings" />} />);
    const search = screen.getByRole('textbox', { name: 'Search settings' });
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByRole('heading', { name: 'Settings' }), search)).toBe(true);
    expect(follows(search, rows()[0]!)).toBe(true);
  });

  it('keeps each fact of a status line whole, so a line too long for a tablet breaks only after a middle dot', () => {
    const { services } = renderWithServices(<SettingsList chosen={null} chevrons />);
    act(() => keepDrinkPresets(services.decaid, SAMPLE_WORKFLOW));
    const drinks = screen.getByTestId(TID.settingsGroupRow('drinks'));
    expect(drinks).toHaveAccessibleDescription('Steam 50 s · Water 50 ml · Flush 10 s');
    const facts = Array.from(drinks.querySelectorAll<HTMLElement>('.status-fact'));
    expect(facts.map((fact) => fact.textContent)).toEqual(['Steam 50 s ·', 'Water 50 ml ·', 'Flush 10 s']);
    for (const fact of facts) expect(getComputedStyle(fact).whiteSpace).toBe('nowrap');
    // A line of one fact wraps where it must.
    expect(screen.getByTestId(TID.settingsGroupRow('grinder')).querySelector('.status-fact')).toBeNull();
  });

  it('hides the rows while the search has words, what it finds taking their place', () => {
    const search = <input aria-label="Search settings" />;
    const { rerender } = renderWithServices(<SettingsList chosen={null} chevrons search={search} searching />);
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toEqual([]);
    rerender(<SettingsList chosen={null} chevrons search={search} searching={false} />);
    expect(screen.getAllByRole('link')).toHaveLength(SETTINGS_GROUP_IDS.length);
  });

  it('names each group once, its page and its row alike', () => {
    for (const id of SETTINGS_GROUP_IDS) expect(settingsGroup(id)).toBe(SETTINGS_GROUPS.find((group) => group.id === id));
  });
});
