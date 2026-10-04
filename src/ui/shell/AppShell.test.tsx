// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Route } from '../router.ts';
import { TID } from '../testIds.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { AppShell } from './AppShell.tsx';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

function renderShell(route: Route = { name: 'coach' }, options: { insideDecaid?: boolean; panel?: boolean } = {}) {
  const onNavigate = vi.fn();
  const services = createFakeServices({ insideDecaid: options.insideDecaid });
  const view = renderWithServices(
    <AppShell route={route} onNavigate={onNavigate} machinePanel={options.panel ? undefined : <div>panel</div>}>
      <p>routed screen</p>
    </AppShell>,
    services,
  );
  return { ...view, onNavigate };
}

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--safe-bottom');
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
