// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LiveSample } from '../../api/types.ts';
import type { Route } from '../router.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { AppShell } from './AppShell.tsx';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

// MachineAlerts in a marked box, so a test finds its place in the frame
// whatever it shows (what it shows is MachineAlerts.test.tsx's business).
const { ALERTS_SLOT } = vi.hoisted(() => ({ ALERTS_SLOT: 'machine-alerts-slot' }));
vi.mock('../machine/MachineAlerts.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../machine/MachineAlerts.tsx')>();
  return {
    ...actual,
    MachineAlerts: () => (
      <div data-testid={ALERTS_SLOT}>
        <actual.MachineAlerts />
      </div>
    ),
  };
});

function renderShell(route: Route = { name: 'coach' }, options: { insideDecaid?: boolean } = {}) {
  const onNavigate = vi.fn();
  const services = createFakeServices({ insideDecaid: options.insideDecaid });
  const view = renderWithServices(
    <AppShell route={route} onNavigate={onNavigate}>
      <p>routed screen</p>
      <textarea aria-label="Draft" />
      <input aria-label="Remember" type="checkbox" />
    </AppShell>,
    services,
  );
  return { ...view, onNavigate };
}

/** jsdom's window is 1024 x 768, a tablet; these make it a phone (or another tablet) for a test. */
function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

/** True when `later` comes after `earlier` in the page and neither holds the other. */
function follows(earlier: Element, later: Element): boolean {
  if (earlier.contains(later) || later.contains(earlier)) return false;
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** A pour frame of the shot, `tS` seconds in. */
function sample(tS: number): LiveSample {
  return {
    tS,
    machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'pouring' }, pressure: 6.04, flow: 2 },
    scale: { timestamp: '', weight: 18.04, weightFlow: 1.5, battery: null, timerValue: null },
  };
}

/** A shot started and poured for 4.2 s. */
function pull(services: FakeServices) {
  act(() => {
    services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    services.telemetry.emitSample(sample(0));
    services.telemetry.emitSample(sample(4.2));
  });
}

/**
 * The guard over the pane the app switched to, and nothing else: it is the
 * main pane's own child, the pane is its containing block, and the top bar,
 * where the machine row and Stop are, is outside the pane.
 */
function expectGuardOverMainOnly() {
  const guard = screen.getByTestId(TID.tapGuard);
  const main = screen.getByRole('main');
  const bar = screen.getByRole('banner');
  expect(guard.parentElement).toBe(main);
  expect(getComputedStyle(main).position).toBe('relative');
  expect(bar).not.toContainElement(guard);
  expect(main).not.toContainElement(bar);
  expect(bar).toContainElement(screen.getByTestId(TID.machineRow));
}

beforeEach(() => {
  // The shell's focus hook switches routes itself; each test starts on the coach.
  window.history.replaceState(null, '', '#/');
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--safe-bottom');
  setViewport(1024, 768);
});

describe('AppShell', () => {
  it('renders the frame, the routed screen and the ready marker', () => {
    renderShell();
    expect(screen.getByTestId(TID.appReady)).toBeInTheDocument();
    expect(screen.getByText('routed screen')).toBeInTheDocument();
  });

  it('has no machine column on a tablet: the main pane is the whole width under the top bar', () => {
    setViewport(962, 602);
    renderShell();
    expect(screen.queryByRole('complementary', { name: 'Machine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    // Alone in its row, so it takes the window's width.
    const main = screen.getByRole('main');
    expect([...main.parentElement!.children]).toEqual([main]);
    expect(follows(screen.getByRole('banner'), main)).toBe(true);
  });

  it("puts the machine row in the tablet's top bar, between the places and Decaid's buttons", () => {
    setViewport(962, 602);
    renderShell();
    const bar = screen.getByRole('banner');
    const places = within(bar).getByRole('navigation', { name: 'Main' });
    const row = within(bar).getByTestId(TID.machineRow);
    const decaid = within(bar).getByTestId(TID.decaidSettings);
    const exit = within(bar).getByTestId(TID.exitToSkins);
    expect(within(places).getAllByRole('button').map((button) => button.textContent)).toEqual(['Coach', 'Shot', 'History', 'Settings']);
    expect(follows(places, row)).toBe(true);
    expect(follows(row, decaid)).toBe(true);
    expect(follows(decaid, exit)).toBe(true);
    // Each button's icon over its label, not the phone's icons alone.
    expect(row).not.toHaveAttribute('data-icons');
  });

  it('shows Decaid settings as an icon, named for screen readers', () => {
    renderShell();
    const decaid = screen.getByTestId(TID.decaidSettings);
    expect(decaid).toHaveAccessibleName('Decaid settings');
    expect(decaid).toHaveTextContent(/^$/);
  });

  it('navigates with the top bar and marks the current screen', async () => {
    const { onNavigate } = renderShell({ name: 'history', bagId: 'bag_1' });
    expect(screen.getByTestId(TID.navHistory)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId(TID.navCoach)).not.toHaveAttribute('aria-current');

    await userEvent.click(screen.getByTestId(TID.navSettings));
    await userEvent.click(screen.getByTestId(TID.navCoach));
    await userEvent.click(screen.getByTestId(TID.navHistory));
    expect(onNavigate.mock.calls.map(([route]) => route)).toEqual([
      { name: 'settings' },
      { name: 'coach' },
      { name: 'history' },
    ]);
  });

  it('Exit calls host.exitToSkinSwitcher(), on every screen', async () => {
    for (const route of [{ name: 'coach' }, { name: 'shot' }, { name: 'history' }, { name: 'settings' }] as Route[]) {
      const { services, unmount } = renderShell(route);
      await userEvent.click(screen.getByTestId(TID.exitToSkins));
      expect(services.host.exits, route.name).toBe(1);
      unmount();
    }
  });

  it('labels Exit for where it goes', () => {
    renderShell({ name: 'coach' }, { insideDecaid: true });
    expect(screen.getByTestId(TID.exitToSkins)).toHaveTextContent('Exitto Decaid');
    cleanup();
    renderShell({ name: 'coach' }, { insideDecaid: false });
    expect(screen.getByTestId(TID.exitToSkins)).toHaveTextContent('ExitSkins');
  });

  it("links to Decaid's settings with a full-page navigation", () => {
    const { services } = renderShell();
    const link = screen.getByTestId(TID.decaidSettings);
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', services.host.settingsUrl);
    expect(link).not.toHaveAttribute('target');
  });

  it('sends a heartbeat on interaction while mounted', () => {
    const { services, unmount } = renderShell();
    fireEvent.pointerDown(screen.getByText('routed screen'));
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(services.heartbeat.count).toBe(2);
    unmount();
    fireEvent.pointerDown(document.body);
    expect(services.heartbeat.count).toBe(2);
  });

  it('publishes the safe-area inset before first paint', () => {
    renderShell();
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('0px');
  });

  it('keeps the machine row mounted when the layout changes, so a command in flight stays in flight', () => {
    renderShell();
    const row = screen.getByTestId(TID.machineRow);
    act(() => setViewport(390, 844));
    expect(screen.getByTestId(TID.machineRow)).toBe(row);
    expect(row).toHaveAttribute('data-icons', 'true');
    act(() => setViewport(844, 390));
    expect(screen.getByTestId(TID.machineRow)).toBe(row);
    act(() => setViewport(1024, 768));
    expect(screen.getByTestId(TID.machineRow)).toBe(row);
    expect(row).not.toHaveAttribute('data-icons');
  });
});

describe('AppShell: the machine alert', () => {
  it('sits directly under the top bar and above the main pane, on a tablet and a phone', () => {
    for (const [width, height] of [
      [962, 602],
      [1280, 800],
      [390, 844],
      [844, 390],
    ] as const) {
      setViewport(width, height);
      const { unmount } = renderShell();
      const where = `${width}x${height}`;
      const slot = screen.getByTestId(ALERTS_SLOT);
      expect(screen.getByRole('banner').nextElementSibling, where).toBe(slot);
      expect(follows(slot, screen.getByRole('main')), where).toBe(true);
      expect(screen.getByRole('main'), where).not.toContainElement(slot);
      unmount();
    }
  });
});

describe('AppShell on a tablet: the shot', () => {
  it('has Shot in the top bar, between Coach and History, and it opens the shot route', async () => {
    const { onNavigate } = renderShell();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('button').map((button) => button.dataset.testid)).toEqual([
      TID.navCoach,
      TID.navShot,
      TID.navHistory,
      TID.navSettings,
    ]);
    expect(screen.getByTestId(TID.navShot)).toHaveTextContent(/^Shot$/);
    await userEvent.click(screen.getByTestId(TID.navShot));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'shot' });
    // The phone's tabs are not here.
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();
  });

  it('the Shot item shows the running pour time while a shot runs', () => {
    const { services } = renderShell();
    pull(services);
    expect(screen.getByTestId(TID.navShot)).toHaveTextContent('Shot4.2 s');
    act(() => services.telemetry.emitSample(sample(9.5)));
    expect(screen.getByTestId(TID.navShot)).toHaveTextContent('Shot9.5 s');
    act(() => services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: null }));
    expect(screen.getByTestId(TID.navShot)).toHaveTextContent(/^Shot$/);
  });

  it('on the shot route the main pane shows the Shot view at full width, the routed screen kept mounted under it, hidden', () => {
    renderShell({ name: 'shot' });
    const main = screen.getByRole('main');
    expect(within(main).getByTestId(TID.shotView)).toBeInTheDocument();
    expect([...main.parentElement!.children]).toEqual([main]);
    const routed = screen.getByText('routed screen');
    expect(main).toContainElement(routed);
    expect(routed).not.toBeVisible();
    expect(screen.getByTestId(TID.navShot)).toHaveAttribute('aria-current', 'page');
    // The machine row stays in the top bar.
    expect(within(screen.getByRole('banner')).getByTestId(TID.machineRow)).toBeInTheDocument();
  });

  it('the coach route shows the routed screen and no Shot view', () => {
    renderShell();
    expect(screen.getByText('routed screen')).toBeVisible();
    expect(screen.queryByTestId(TID.shotView)).not.toBeInTheDocument();
  });

  it('a shot switches the main pane by itself and guards it, never the top bar', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      setViewport(962, 602);
      const { services, onNavigate } = renderShell();
      pull(services);
      expect(window.location.hash).toBe('#/shot');
      expectGuardOverMainOnly();
      // The top bar takes a tap at once.
      fireEvent.click(screen.getByTestId(TID.navCoach));
      expect(onNavigate).toHaveBeenCalledWith({ name: 'coach' });
      act(() => vi.advanceTimersByTime(350));
      expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the tablet layout while a text field has focus (an on-screen keyboard shortens the window), and while the keyboard closes', () => {
    setViewport(962, 602);
    renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    act(() => setViewport(962, 300));
    expect(screen.getByTestId(TID.navCoach)).toBeInTheDocument();
    expect(screen.getByTestId(TID.machineRow)).not.toHaveAttribute('data-icons');

    // Done typing: the keyboard is still closing, the window still short. No phone layout in between.
    act(() => screen.getByLabelText('Draft').blur());
    expect(screen.getByTestId(TID.navCoach)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();
    act(() => setViewport(962, 602));
    expect(screen.getByTestId(TID.navCoach)).toBeInTheDocument();

    // The keyboard has closed and nobody types: a short window now is a short window.
    act(() => setViewport(962, 300));
    expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();
  });

  it('after typing, a window that stays short gets its own layout once a keyboard would have closed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      setViewport(962, 602);
      renderShell();
      act(() => screen.getByLabelText('Draft').focus());
      act(() => setViewport(962, 300));
      act(() => screen.getByLabelText('Draft').blur());
      act(() => vi.advanceTimersByTime(499));
      expect(screen.getByTestId(TID.navCoach)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId(TID.navCoach)).not.toBeInTheDocument();
      expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('while a text field has focus a new width applies at once, and the draft keeps its text and its focus', () => {
    renderShell();
    const draft = screen.getByLabelText('Draft');
    act(() => draft.focus());
    fireEvent.change(draft, { target: { value: 'Still typing' } });

    // A narrowed window: the phone layout, its tabs away while the barista types.
    act(() => setViewport(390, 844));
    expect(screen.queryByTestId(TID.navCoach)).not.toBeInTheDocument();
    expect(screen.getByTestId(TID.machineRow)).toHaveAttribute('data-icons', 'true');
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toBe(draft);
    expect(draft).toHaveFocus();
    expect(draft).toHaveValue('Still typing');

    act(() => setViewport(1024, 768));
    expect(screen.getByTestId(TID.navCoach)).toBeInTheDocument();
    expect(draft).toHaveFocus();
    expect(draft).toHaveValue('Still typing');
  });
});

describe('AppShell on a phone', () => {
  beforeEach(() => setViewport(390, 844));

  it('has the four tabs, Shot among them, and a top bar with the brand, the machine row as icons, Decaid settings and Exit', () => {
    const { services } = renderShell();
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getAllByRole('button').map((tab) => tab.textContent)).toEqual(['Coach', 'Shot', 'History', 'Settings']);
    expect(within(tabs).getAllByRole('button').map((tab) => tab.dataset.testid)).toEqual([
      TID.tabCoach,
      TID.tabShot,
      TID.tabHistory,
      TID.tabSettings,
    ]);
    expect(screen.getByTestId(TID.tabCoach)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId(TID.tabShot)).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId(TID.tabShot)).toHaveAccessibleName('Shot');
    expect(screen.queryByText('Machine')).not.toBeInTheDocument();

    const bar = screen.getByRole('banner');
    const row = within(bar).getByTestId(TID.machineRow);
    expect(row).toHaveAttribute('data-icons', 'true');
    const exit = within(bar).getByTestId(TID.exitToSkins);
    const decaid = within(bar).getByTestId(TID.decaidSettings);
    expect(follows(row, decaid)).toBe(true);
    expect(follows(decaid, exit)).toBe(true);
    // Icons, named for screen readers.
    expect(exit).toHaveTextContent(/^$/);
    expect(exit).toHaveAccessibleName('Exit to the skin switcher');
    expect(decaid).toHaveTextContent(/^$/);
    expect(decaid.tagName).toBe('A');
    expect(decaid).toHaveAttribute('href', services.host.settingsUrl);
    expect(decaid).toHaveAccessibleName('Decaid settings');

    // No top-bar navigation and no machine column: the tabs navigate, the row runs the machine.
    for (const id of [TID.navCoach, TID.navShot, TID.navHistory, TID.navSettings]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    // The bar comes after the content.
    expect(follows(screen.getByRole('main'), tabs)).toBe(true);
  });

  it('names Exit for where it goes', () => {
    renderShell({ name: 'coach' }, { insideDecaid: true });
    expect(screen.getByTestId(TID.exitToSkins)).toHaveAccessibleName('Exit to Decaid');
  });

  it('Exit, Decaid settings and the machine row are on every tab', async () => {
    for (const route of [{ name: 'coach' }, { name: 'shot' }, { name: 'history' }, { name: 'settings' }] as Route[]) {
      const { services, unmount } = renderShell(route);
      const bar = screen.getByRole('banner');
      expect(within(bar).getByTestId(TID.decaidSettings), route.name).toBeInTheDocument();
      expect(within(bar).getByTestId(TID.machineRow), route.name).toBeInTheDocument();
      await userEvent.click(screen.getByTestId(TID.exitToSkins));
      expect(services.host.exits, route.name).toBe(1);
      unmount();
    }
  });

  it('the tabs navigate, and the Shot tab is the shot route', async () => {
    const { onNavigate } = renderShell({ name: 'history', bagId: 'bag_1' });
    expect(screen.getByTestId(TID.tabHistory)).toHaveAttribute('aria-current', 'page');
    for (const id of [TID.tabShot, TID.tabSettings, TID.tabCoach, TID.tabHistory]) {
      await userEvent.click(screen.getByTestId(id));
    }
    expect(onNavigate.mock.calls.map(([route]) => route)).toEqual([
      { name: 'shot' },
      { name: 'settings' },
      { name: 'coach' },
      { name: 'history' },
    ]);
  });

  it('the Shot tab is the Shot view, the one a tablet shows, over the coach kept mounted and hidden', () => {
    renderShell({ name: 'shot' });
    expect(screen.getByTestId(TID.tabShot)).toHaveAttribute('aria-current', 'page');
    const main = screen.getByRole('main');
    const view = within(main).getByTestId(TID.shotView);
    expect(view).toContainElement(screen.getByTestId(TID.liveGraph));
    expect(screen.getByText('routed screen')).not.toBeVisible();
    // The machine's buttons are in the top bar, not on the tab.
    expect(main).not.toContainElement(screen.getByTestId(TID.machineRow));
  });

  it('on its side the Shot tab is the same Shot view', () => {
    setViewport(844, 390);
    renderShell({ name: 'shot' });
    expect(screen.getByTestId(TID.tabShot)).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('main')).getByTestId(TID.shotView)).toBeInTheDocument();
    expect(screen.getByText('routed screen')).not.toBeVisible();
  });

  it('the other tabs show the routed screen', () => {
    for (const route of [{ name: 'coach' }, { name: 'history' }, { name: 'settings' }] as Route[]) {
      const { unmount } = renderShell(route);
      expect(screen.getByText('routed screen')).toBeVisible();
      expect(screen.queryByTestId(TID.shotView)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('the tabs give way while a text field has focus, and come back on blur', () => {
    renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    // The ways out and the machine row stay.
    expect(screen.getByTestId(TID.exitToSkins)).toBeInTheDocument();
    expect(screen.getByTestId(TID.decaidSettings)).toBeInTheDocument();
    expect(screen.getByTestId(TID.machineRow)).toBeInTheDocument();

    act(() => screen.getByLabelText('Draft').blur());
    expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();

    // A checkbox brings up no keyboard.
    act(() => screen.getByLabelText('Remember').focus());
    expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();
  });

  it('a press that leaves the field brings the tabs back only after its release and its click', async () => {
    renderShell();
    const user = userEvent.setup();
    const remember = screen.getByLabelText('Remember');
    // The tabs return under the content, so a click that saw them would land where they pushed it.
    let tabsAtClick: boolean | null = null;
    remember.addEventListener('click', () => {
      tabsAtClick = screen.queryByTestId(TID.tabCoach) !== null;
    });
    act(() => screen.getByLabelText('Draft').focus());
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();

    // Pressed and held: the focus has left the field, the layout has not moved.
    await user.pointer({ keys: '[MouseLeft>]', target: remember });
    expect(remember).toHaveFocus();
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();

    // Released: the click lands on the layout it was aimed at, then the tabs come back.
    await user.pointer({ keys: '[/MouseLeft]', target: remember });
    expect(remember).toBeChecked();
    expect(tabsAtClick).toBe(false);
    expect(await screen.findByTestId(TID.tabCoach)).toBeInTheDocument();
  });

  it('the keyboard closing brings back the bar, never a rail for the moment the window is short', () => {
    renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    act(() => setViewport(390, 450));
    act(() => screen.getByLabelText('Draft').blur());
    // The bar, after the content: the window is short only until the keyboard is down.
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(screen.getByRole('main').compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(tabs).display).toBe('grid');
    act(() => setViewport(390, 844));
    expect(getComputedStyle(screen.getByRole('navigation', { name: 'Main' })).display).toBe('grid');
  });

  it('a rotation while typing turns the layout with the phone, never taking it for a tablet', () => {
    renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    act(() => setViewport(844, 390));
    expect(screen.queryByTestId(TID.navCoach)).not.toBeInTheDocument();
    expect(screen.getByTestId(TID.machineRow)).toHaveAttribute('data-icons', 'true');
    act(() => screen.getByLabelText('Draft').blur());
    // On its side: the rail, before the content, at once.
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(rail.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(rail).flexDirection).toBe('column');
  });

  it('a press from one field to another keeps the tabs away', async () => {
    renderShell();
    const user = userEvent.setup();
    const draft = screen.getByLabelText('Draft');
    const remember = screen.getByLabelText('Remember');
    act(() => remember.focus());
    expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();
    await user.click(draft);
    expect(draft).toHaveFocus();
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();
    // Still typing a task later, once the press is over.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();
  });

  it('on its side (844 x 390) the tabs are a rail before the content, with the same four, and the top bar keeps the row', () => {
    setViewport(844, 390);
    renderShell();
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(within(rail).getAllByRole('button').map((tab) => tab.textContent)).toEqual(['Coach', 'Shot', 'History', 'Settings']);
    expect(within(rail).getAllByRole('button').map((tab) => tab.dataset.testid)).toEqual([
      TID.tabCoach,
      TID.tabShot,
      TID.tabHistory,
      TID.tabSettings,
    ]);
    expect(rail.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(rail).flexDirection).toBe('column');
    const bar = screen.getByRole('banner');
    expect(within(bar).getByTestId(TID.machineRow)).toHaveAttribute('data-icons', 'true');
    expect(within(bar).getByTestId(TID.exitToSkins)).toBeInTheDocument();
    expect(within(bar).getByTestId(TID.decaidSettings)).toBeInTheDocument();
  });

  it("the tab bar's and the rail's dividers are the top bar's line, not the text colour", () => {
    renderShell();
    const line = getComputedStyle(screen.getByRole('banner')).borderBottomColor;
    expect(line).not.toBe(getComputedStyle(screen.getByTestId(TID.appReady)).color);
    expect(getComputedStyle(screen.getByRole('navigation', { name: 'Main' })).borderTopColor).toBe(line);
    cleanup();

    setViewport(844, 390);
    renderShell();
    expect(getComputedStyle(screen.getByRole('navigation', { name: 'Main' })).borderRightColor).toBe(line);
  });

  it('a rotation keeps the routed screen mounted', () => {
    const { container } = renderShell();
    const routed = screen.getByText('routed screen');
    act(() => setViewport(844, 390));
    expect(screen.getByText('routed screen')).toBe(routed);
    act(() => setViewport(390, 844));
    expect(container).toContainElement(routed);
  });

  it('while a shot runs the Shot tab shows the time, and the Coach tab a live strip that opens the Shot tab', async () => {
    const { services, onNavigate } = renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    pull(services);
    // Typing: no switch, and the tabs are away for the keyboard.
    expect(window.location.hash).toBe('#/');
    act(() => screen.getByLabelText('Draft').blur());

    const shotTab = screen.getByTestId(TID.tabShot);
    expect(shotTab).toHaveAccessibleName('Shot, running, 4 seconds');
    expect(shotTab).toHaveTextContent(/^4\.2 s$/);

    const strip = screen.getByTestId(TID.liveStrip);
    expect(strip).toHaveAccessibleName('Open the live shot');
    expect(strip).toHaveTextContent('Live shot');
    expect(strip).toHaveTextContent('4.2 s · 18.0 g · 6.0 bar');
    expect(screen.getByRole('main')).toContainElement(strip);
    await userEvent.click(strip);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'shot' });
  });

  it('the Shot tab counts in tenths as the strip does, and names the whole seconds only as they pass', () => {
    const { services } = renderShell({ name: 'history' });
    pull(services);
    const shotTab = screen.getByTestId(TID.tabShot);
    expect(shotTab).toHaveTextContent(/^4\.2 s$/);
    expect(shotTab).toHaveAccessibleName('Shot, running, 4 seconds');

    // A screen reader is not handed a new name every tenth of a second.
    const renamed = new MutationObserver(() => {});
    renamed.observe(shotTab, { attributes: true, attributeFilter: ['aria-label'] });
    act(() => services.telemetry.emitSample(sample(4.5)));
    act(() => services.telemetry.emitSample(sample(4.9)));
    expect(shotTab).toHaveTextContent(/^4\.9 s$/);
    expect(renamed.takeRecords()).toHaveLength(0);
    act(() => services.telemetry.emitSample(sample(10.04)));
    expect(shotTab).toHaveTextContent(/^10\.0 s$/);
    expect(shotTab).toHaveAccessibleName('Shot, running, 10 seconds');
    expect(renamed.takeRecords()).toHaveLength(1);
    renamed.disconnect();

    act(() => services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: null }));
    expect(shotTab).toHaveTextContent(/^Shot$/);
    expect(shotTab).toHaveAccessibleName('Shot');
  });

  it('the live strip is only on the Coach tab', () => {
    const { services } = renderShell({ name: 'history' });
    pull(services);
    expect(screen.queryByTestId(TID.liveStrip)).not.toBeInTheDocument();
  });

  it('a shot takes the phone to the Shot tab by itself and guards the content, never the top bar or the tabs', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      const { services } = renderShell();
      pull(services);
      expect(window.location.hash).toBe('#/shot');
      expectGuardOverMainOnly();
      expect(screen.getByRole('navigation', { name: 'Main' })).not.toContainElement(screen.getByTestId(TID.tapGuard));
      // The top bar takes a tap at once.
      fireEvent.click(screen.getByTestId(TID.exitToSkins));
      expect(services.host.exits).toBe(1);
      act(() => vi.advanceTimersByTime(350));
      expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('on its side a shot guards the content beside the rail, never the top bar', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      setViewport(844, 390);
      const { services } = renderShell();
      pull(services);
      expect(window.location.hash).toBe('#/shot');
      expectGuardOverMainOnly();
      act(() => vi.advanceTimersByTime(350));
      expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AppShell browser engine warning (D58)', () => {
  const OLD_ENGINE = { chromium: 85, supported: false, reason: 'version' };
  const warningText = /older than CafAI is built for/;

  afterEach(() => {
    delete window.__CAFAI_ENGINE__;
    localStorage.clear();
  });

  it("warns on an engine older than Chromium 91, under the top bar and the machine's alert, above the main pane", () => {
    window.__CAFAI_ENGINE__ = OLD_ENGINE;
    renderShell();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(
      "This device's browser engine (Chromium 85) is older than CafAI is built for (Chromium 91 or newer), so some parts may not work.",
    );
    // In the flow, not over anything: after the top bar and the machine's
    // alert, before the routed screen, and inside none of them.
    const header = screen.getByRole('banner');
    const alerts = screen.getByTestId(ALERTS_SLOT);
    const main = screen.getByRole('main');
    expect(follows(header, warning)).toBe(true);
    expect(follows(alerts, warning)).toBe(true);
    expect(follows(warning, main)).toBe(true);
    for (const region of [header, alerts, main]) expect(region).not.toContainElement(warning);
    expect(getComputedStyle(warning).position).not.toBe('absolute');
    expect(getComputedStyle(warning).position).not.toBe('fixed');
  });

  it('names no version when the engine gave none', () => {
    window.__CAFAI_ENGINE__ = { chromium: null, supported: false, reason: 'probe' };
    renderShell();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "This device's browser engine is older than CafAI is built for (Chromium 91 or newer), so some parts may not work.",
    );
  });

  it('hides on dismiss and stays hidden for that engine version', async () => {
    window.__CAFAI_ENGINE__ = OLD_ENGINE;
    const { unmount } = renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss the browser engine warning' }));
    expect(screen.queryByText(warningText)).not.toBeInTheDocument();
    expect(localStorage.getItem('cafai.engineWarning')).toBe('85');
    unmount();

    renderShell();
    expect(screen.queryByText(warningText)).not.toBeInTheDocument();
  });

  it('warns again on another engine version', () => {
    localStorage.setItem('cafai.engineWarning', '85');
    window.__CAFAI_ENGINE__ = { ...OLD_ENGINE, chromium: 88 };
    renderShell();
    expect(screen.getByRole('alert')).toHaveTextContent('(Chromium 88)');
  });

  it('the dismiss control is a full touch target and leaves the shell working', async () => {
    window.__CAFAI_ENGINE__ = OLD_ENGINE;
    const { onNavigate, services } = renderShell();
    expect(screen.getByRole('button', { name: 'Dismiss the browser engine warning' })).toHaveClass('MuiIconButton-root');
    await userEvent.click(screen.getByTestId(TID.navSettings));
    await userEvent.click(screen.getByTestId(TID.exitToSkins));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'settings' });
    expect(services.host.exits).toBe(1);
  });

  it('is absent on Chromium 91 and newer, on an unknown engine, and without a check', () => {
    for (const engine of [
      { chromium: 91, supported: true, reason: 'probe' },
      { chromium: null, supported: true, reason: 'probe' },
      { chromium: null, supported: null, reason: 'probe' },
      undefined,
    ]) {
      if (engine) window.__CAFAI_ENGINE__ = engine;
      else delete window.__CAFAI_ENGINE__;
      const { unmount } = renderShell();
      expect(screen.queryByText(warningText), JSON.stringify(engine)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      unmount();
    }
  });
});
