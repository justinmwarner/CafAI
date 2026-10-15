// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { CARE_SOURCES, routineOf, watchUrl } from './careGuide.ts';
import { CareSegments } from './CareSegments.tsx';
import { RoutineCard } from './RoutineCard.tsx';
import type { RoutineId } from './routines.ts';

afterEach(() => cleanup());

const tabIdOf = (routine: RoutineId) => `tab-${routine}`;

describe('CareSegments', () => {
  function segments(routine: RoutineId = 'daily') {
    const onChange = vi.fn();
    renderWithServices(<CareSegments routine={routine} onChange={onChange} panelId="panel" tabIdOf={tabIdOf} />);
    return { onChange };
  }

  it('is a tab list of the four routines, the chosen one selected and the only tab stop', () => {
    segments('weekly');
    const list = screen.getByRole('tablist', { name: 'How often' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Daily', 'Weekly', 'Monthly', 'As needed']);
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Daily' })).toHaveAttribute('aria-selected', 'false');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-controls', 'panel');
    expect(screen.getByTestId(TID.careSegment('asNeeded'))).toHaveTextContent('As needed');
  });

  it('a tap asks for that routine', async () => {
    const { onChange } = segments();
    await userEvent.click(screen.getByRole('tab', { name: 'Monthly' }));
    expect(onChange).toHaveBeenCalledWith('monthly');
  });

  it('the arrow keys, Home and End move the choice and the focus, round the ends', async () => {
    const { onChange } = segments('daily');
    screen.getByRole('tab', { name: 'Daily' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('weekly');
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('asNeeded');
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('daily');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('asNeeded');
  });
});

describe('RoutineCard', () => {
  function card(routine: RoutineId, options: { numbered?: boolean; links?: boolean; playingKey?: string | null } = {}) {
    const onPlay = vi.fn();
    renderWithServices(
      <RoutineCard
        routine={routineOf(routine)}
        numbered={options.numbered ?? true}
        links={options.links ?? false}
        linkProps={{}}
        playingKey={options.playingKey ?? null}
        onPlay={onPlay}
        panelId="panel"
        tabId="tab-x"
      />,
    );
    return { onPlay };
  }

  it("is the routine's tab panel: its name, how often, its steps in order and the sources", () => {
    card('daily');
    const panel = screen.getByTestId(TID.careRoutine);
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('id', 'panel');
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-x');
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Daily');
    expect(within(panel).getByText('On days you pull shots.')).toBeInTheDocument();
    const steps = within(panel).getAllByRole('listitem');
    expect(steps.map((step) => within(step).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Purge and wipe the steam wand',
      'Flush the group head',
      'Wipe the shower screen',
      'Rinse the steam wand',
    ]);
    expect(within(panel).getByText(CARE_SOURCES)).toBeInTheDocument();
  });

  it('numbers the steps on a wide screen only', () => {
    card('daily', { numbered: true });
    expect(within(screen.getByTestId(TID.careStep('flush-group'))).getByText('2')).toBeInTheDocument();
    cleanup();
    card('daily', { numbered: false });
    expect(within(screen.getByTestId(TID.careStep('flush-group'))).queryByText('2')).toBeNull();
  });

  it('shows a step whole: when, how, where, the note and the link', () => {
    card('asNeeded');
    const step = screen.getByTestId(TID.careStep('descale'));
    expect(step).toHaveTextContent('Sooner if the steam starts to pulse.');
    expect(step).toHaveTextContent('Citric acid only.');
    expect(step).toHaveTextContent('From streamline for now: Settings > Maintenance > Machine Descaling.');
    expect(step).toHaveTextContent("Decent's pages say every year or two.");
    expect(within(step).getByRole('link', { name: "Decent's descaling steps" })).toHaveAttribute(
      'href',
      'https://decentespresso.com/docs/de1_descaling_instructions',
    );
    expect(screen.getByTestId(TID.careLink('descale'))).toBeInTheDocument();
  });

  it("plays a step's moment, and the routine's own", async () => {
    const { onPlay } = card('weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Play from 11:11: Steam Rinza through the wand' }));
    expect(onPlay).toHaveBeenLastCalledWith(671, 'rinza', 'Steam Rinza through the wand');
    await userEvent.click(screen.getByTestId(TID.careMoment('weekly')));
    expect(onPlay).toHaveBeenLastCalledWith(460, 'weekly', 'Weekly');
  });

  it('marks the moment playing', () => {
    card('weekly', { playingKey: 'rinza' });
    expect(screen.getByTestId(TID.careMoment('rinza'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(TID.careMoment('tank-tray'))).toHaveAttribute('aria-pressed', 'false');
  });

  it('as links, each moment is YouTube at its time', () => {
    card('monthly', { links: true });
    expect(screen.getByTestId(TID.careMoment('group-parts'))).toHaveAttribute('href', watchUrl(1016));
    expect(screen.getByTestId(TID.careMoment('monthly'))).toHaveAttribute('href', watchUrl(996));
  });

  it('a step without a moment has none', () => {
    card('monthly');
    expect(screen.queryByTestId(TID.careMoment('gasket'))).toBeNull();
  });
});
