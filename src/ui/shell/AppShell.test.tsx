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

function renderShell(route: Route = { name: 'coach' }, options: { insideDecaid?: boolean; panel?: boolean } = {}) {
  const onNavigate = vi.fn();
  const services = createFakeServices({ insideDecaid: options.insideDecaid });
  const view = renderWithServices(
    <AppShell route={route} onNavigate={onNavigate} machinePanel={options.panel ? undefined : <div>panel</div>}>
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
    expect(screen.getByRole('complementary', { name: 'Machine' })).toHaveTextContent('panel');
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
    for (const route of [{ name: 'coach' }, { name: 'history' }, { name: 'settings' }] as Route[]) {
      const { services, unmount } = renderShell(route);
      await userEvent.click(screen.getByTestId(TID.exitToSkins));
      expect(services.host.exits).toBe(1);
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

  it('shows the machine panel by default', async () => {
    renderShell({ name: 'coach' }, { panel: true });
    await act(async () => {});
    expect(screen.getByTestId(TID.machineState)).toHaveTextContent('Ready');
    expect(screen.getByTestId(TID.liveGraph)).toBeInTheDocument();
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

  it('on the shot route the main pane shows the Shot view, the routed screen kept mounted under it, hidden', () => {
    renderShell({ name: 'shot' });
    const main = screen.getByRole('main');
    expect(within(main).getByTestId(TID.shotView)).toBeInTheDocument();
    const routed = screen.getByText('routed screen');
    expect(main).toContainElement(routed);
    expect(routed).not.toBeVisible();
    expect(screen.getByTestId(TID.navShot)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('complementary', { name: 'Machine' })).toHaveTextContent('panel');
  });

  it('the coach route shows the routed screen and no Shot view', () => {
    renderShell();
    expect(screen.getByText('routed screen')).toBeVisible();
    expect(screen.queryByTestId(TID.shotView)).not.toBeInTheDocument();
  });

  it("the machine column's preview opens the shot route, and gives way to the Shot view there", async () => {
    const { onNavigate, rerenderWith } = renderShell({ name: 'coach' }, { panel: true });
    await act(async () => {});
    const machine = screen.getByRole('complementary', { name: 'Machine' });
    await userEvent.click(within(machine).getByTestId(TID.previewGraph));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'shot' });

    rerenderWith(
      <AppShell route={{ name: 'shot' }} onNavigate={onNavigate}>
        <p>routed screen</p>
      </AppShell>,
    );
    expect(within(machine).queryByTestId(TID.previewGraph)).not.toBeInTheDocument();
    expect(within(machine).queryByTestId(TID.liveGraph)).not.toBeInTheDocument();
    // The controls stay where they were.
    expect(within(machine).getByTestId(TID.espressoButton)).toBeInTheDocument();
    expect(within(machine).getByTestId(TID.stopButton)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByTestId(TID.liveGraph)).toBeInTheDocument();
  });

  it('a shot switches the main pane by itself and guards it, never the machine column', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      const { services } = renderShell();
      pull(services);
      expect(window.location.hash).toBe('#/shot');
      const guard = screen.getByTestId(TID.tapGuard);
      expect(screen.getByRole('main')).toContainElement(guard);
      expect(screen.getByRole('complementary', { name: 'Machine' })).not.toContainElement(guard);
      act(() => vi.advanceTimersByTime(350));
      expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the tablet layout while a text field has focus (an on-screen keyboard shortens the window)', () => {
    renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    act(() => setViewport(1024, 380));
    expect(screen.getByTestId(TID.navCoach)).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Machine' })).toBeInTheDocument();
    act(() => screen.getByLabelText('Draft').blur());
    // Done typing: the window really is that short now, so the layout follows it.
    expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();
  });
});

describe('AppShell on a phone', () => {
  beforeEach(() => setViewport(390, 844));

  it('has the four tabs and a top bar with just the brand, Decaid settings and Exit', () => {
    const { services } = renderShell();
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getAllByRole('button').map((tab) => tab.textContent)).toEqual(['Coach', 'Machine', 'History', 'Settings']);
    expect(screen.getByTestId(TID.tabCoach)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId(TID.tabMachine)).not.toHaveAttribute('aria-current');

    const exit = screen.getByTestId(TID.exitToSkins);
    expect(exit).toHaveTextContent(/^Exit$/);
    expect(exit).toHaveAccessibleName('Exit to the skin switcher');
    const decaid = screen.getByTestId(TID.decaidSettings);
    expect(decaid.tagName).toBe('A');
    expect(decaid).toHaveAttribute('href', services.host.settingsUrl);
    expect(decaid).toHaveAccessibleName('Decaid settings');
    expect(screen.getByRole('banner')).toContainElement(exit);
    expect(screen.getByRole('banner')).toContainElement(decaid);

    // No top-bar navigation and no machine column: the Machine tab is the machine.
    for (const id of [TID.navCoach, TID.navShot, TID.navHistory, TID.navSettings]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('complementary', { name: 'Machine' })).not.toBeInTheDocument();
    // The bar comes after the content.
    expect(screen.getByRole('main').compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Exit and Decaid settings are on every tab', async () => {
    for (const route of [{ name: 'coach' }, { name: 'shot' }, { name: 'history' }, { name: 'settings' }] as Route[]) {
      const { services, unmount } = renderShell(route);
      expect(screen.getByTestId(TID.decaidSettings)).toBeInTheDocument();
      await userEvent.click(screen.getByTestId(TID.exitToSkins));
      expect(services.host.exits, route.name).toBe(1);
      unmount();
    }
  });

  it('the tabs navigate, and the Machine tab is the shot route', async () => {
    const { onNavigate } = renderShell({ name: 'history', bagId: 'bag_1' });
    expect(screen.getByTestId(TID.tabHistory)).toHaveAttribute('aria-current', 'page');
    for (const id of [TID.tabMachine, TID.tabSettings, TID.tabCoach, TID.tabHistory]) {
      await userEvent.click(screen.getByTestId(id));
    }
    expect(onNavigate.mock.calls.map(([route]) => route)).toEqual([
      { name: 'shot' },
      { name: 'settings' },
      { name: 'coach' },
      { name: 'history' },
    ]);
  });

  it('the Machine tab is the machine panel with the big graph, over the coach kept mounted and hidden', async () => {
    renderShell({ name: 'shot' }, { panel: true });
    await act(async () => {});
    expect(screen.getByTestId(TID.tabMachine)).toHaveAttribute('aria-current', 'page');
    const main = screen.getByRole('main');
    expect(within(main).getByTestId(TID.espressoButton)).toBeInTheDocument();
    expect(within(main).getByRole('list', { name: 'Shot readouts' })).toBeInTheDocument();
    expect(screen.queryByTestId(TID.previewGraph)).not.toBeInTheDocument();
    expect(screen.getByText('routed screen')).not.toBeVisible();
  });

  it('the other tabs show the routed screen', () => {
    for (const route of [{ name: 'coach' }, { name: 'history' }, { name: 'settings' }] as Route[]) {
      const { unmount } = renderShell(route);
      expect(screen.getByText('routed screen')).toBeVisible();
      unmount();
    }
  });

  it('the tabs give way while a text field has focus, and come back on blur', () => {
    renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    expect(screen.queryByTestId(TID.tabCoach)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    // The ways out stay.
    expect(screen.getByTestId(TID.exitToSkins)).toBeInTheDocument();
    expect(screen.getByTestId(TID.decaidSettings)).toBeInTheDocument();

    act(() => screen.getByLabelText('Draft').blur());
    expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();

    // A checkbox brings up no keyboard.
    act(() => screen.getByLabelText('Remember').focus());
    expect(screen.getByTestId(TID.tabCoach)).toBeInTheDocument();
  });

  it('on its side (844 x 390) the tabs are a rail before the content', () => {
    setViewport(844, 390);
    renderShell();
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(within(rail).getAllByRole('button')).toHaveLength(4);
    expect(rail.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(rail).flexDirection).toBe('column');
    expect(screen.getByTestId(TID.exitToSkins)).toBeInTheDocument();
    expect(screen.getByTestId(TID.decaidSettings)).toBeInTheDocument();
  });

  it('on its side the Machine tab puts the graph beside the buttons', async () => {
    setViewport(844, 390);
    renderShell({ name: 'shot' }, { panel: true });
    await act(async () => {});
    const controls = screen.getByRole('region', { name: 'Machine controls' });
    const graph = screen.getByTestId(TID.liveGraph);
    // Two columns: the buttons' column and the graph's are siblings in one row.
    const left = controls.parentElement!;
    const right = graph.parentElement!;
    expect(left.parentElement).toBe(right.parentElement);
    expect(getComputedStyle(left.parentElement!).flexDirection).toBe('row');
  });

  it('a rotation keeps the routed screen mounted', () => {
    const { container } = renderShell();
    const routed = screen.getByText('routed screen');
    act(() => setViewport(844, 390));
    expect(screen.getByText('routed screen')).toBe(routed);
    act(() => setViewport(390, 844));
    expect(container).toContainElement(routed);
  });

  it('while a shot runs the Machine tab shows the time, and the Coach tab a live strip that opens the Machine tab', async () => {
    const { services, onNavigate } = renderShell();
    act(() => screen.getByLabelText('Draft').focus());
    pull(services);
    // Typing: no switch, and the tabs are away for the keyboard.
    expect(window.location.hash).toBe('#/');
    act(() => screen.getByLabelText('Draft').blur());

    const machineTab = screen.getByTestId(TID.tabMachine);
    expect(machineTab).toHaveAccessibleName('Machine, shot running');
    expect(machineTab).toHaveTextContent('4 s');

    const strip = screen.getByTestId(TID.liveStrip);
    expect(strip).toHaveAccessibleName('Open the live shot');
    expect(strip).toHaveTextContent('Live shot');
    expect(strip).toHaveTextContent('4.2 s · 18.0 g · 6.0 bar');
    expect(screen.getByRole('main')).toContainElement(strip);
    await userEvent.click(strip);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'shot' });
  });

  it('the live strip is only on the Coach tab', () => {
    const { services } = renderShell({ name: 'history' });
    pull(services);
    expect(screen.queryByTestId(TID.liveStrip)).not.toBeInTheDocument();
  });

  it('a shot takes the phone to the Machine tab by itself and guards the content, not the tabs', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      const { services } = renderShell();
      pull(services);
      expect(window.location.hash).toBe('#/shot');
      const guard = screen.getByTestId(TID.tapGuard);
      expect(screen.getByRole('main')).toContainElement(guard);
      expect(screen.getByRole('navigation', { name: 'Main' })).not.toContainElement(guard);
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

  it('warns on an engine older than Chromium 91, between the top bar and the columns', () => {
    window.__CAFAI_ENGINE__ = OLD_ENGINE;
    renderShell();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(
      "This tablet's browser engine (Chromium 85) is older than CafAI is built for (Chromium 91 or newer), so some parts may not work.",
    );
    // In the flow, not over anything: after the top bar, before the machine
    // column and the routed screen, and inside neither.
    const header = screen.getByRole('banner');
    const machine = screen.getByRole('complementary', { name: 'Machine' });
    const main = screen.getByRole('main');
    expect(header.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warning.compareDocumentPosition(machine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warning.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const region of [header, machine, main]) expect(region).not.toContainElement(warning);
    expect(getComputedStyle(warning).position).not.toBe('absolute');
    expect(getComputedStyle(warning).position).not.toBe('fixed');
  });

  it('names no version when the engine gave none', () => {
    window.__CAFAI_ENGINE__ = { chromium: null, supported: false, reason: 'probe' };
    renderShell();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "This tablet's browser engine is older than CafAI is built for (Chromium 91 or newer), so some parts may not work.",
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
