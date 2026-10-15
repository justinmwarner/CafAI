import { useEffect } from 'react';
import { ServicesProvider } from './services.tsx';
import type { Services } from './types.ts';
import { AppTheme } from '../ui/AppTheme.tsx';
import { AppShell } from '../ui/shell/AppShell.tsx';
import { isRemembered, navigate, replaceRoute, routeHref, useRoute, type Route } from '../ui/router.ts';
import { CareScreen } from '../ui/care/CareScreen.tsx';
import { CoachScreen } from '../ui/chat/CoachScreen.tsx';
import { HistoryScreen } from '../ui/history/HistoryScreen.tsx';
import { LogView } from '../ui/settings/LogView.tsx';
import { SettingsScreen } from '../ui/settings/SettingsScreen.tsx';

const ROUTE_KEY = 'cafai.route';

/**
 * Decaid reloads a backgrounded skin at `/?_=<ms>`, dropping the hash, so the
 * last route is remembered and restored when the page opens without one.
 */
export function restoreRoute(win: Window = window): void {
  try {
    if (win.location.hash && win.location.hash !== '#') return;
    const saved = win.localStorage.getItem(ROUTE_KEY);
    if (saved && saved.startsWith('#/')) win.location.replace(`${win.location.pathname}${win.location.search}${saved}`);
  } catch {
    // Storage blocked: start on the coach.
  }
}

function rememberRoute(route: Route): void {
  if (!isRemembered(route)) return;
  try {
    window.localStorage.setItem(ROUTE_KEY, routeHref(route));
  } catch {
    // Not important enough to surface.
  }
}

function Routed() {
  const route = useRoute();
  useEffect(() => rememberRoute(route), [route]);

  let screen;
  if (route.name === 'history') {
    screen = (
      <HistoryScreen
        bagId={route.bagId ?? null}
        onSelectBag={(bagId) => navigate(bagId ? { name: 'history', bagId } : { name: 'history' })}
      />
    );
  } else if (route.name === 'settings') {
    screen = <SettingsScreen />;
  } else if (route.name === 'care') {
    screen = (
      <CareScreen
        routine={route.routine}
        onRoutine={(routine) => replaceRoute({ name: 'care', routine })}
        onBack={() => navigate({ name: 'settings' })}
      />
    );
  } else {
    // The coach, the shot and the drinks' routes alike: the shell lays the
    // Shot view or a drink's view over the coach, and the same element in the
    // same place keeps the coach mounted across the switch, scroll and draft intact.
    screen = <CoachScreen />;
  }
  return (
    <AppShell route={route} onNavigate={navigate}>
      {screen}
    </AppShell>
  );
}

export function App({ services }: { services: Services }) {
  return (
    <ServicesProvider services={services}>
      <AppTheme>
        <Routed />
        {/* Settings > Log's view (D139) is the app's: a shot that takes the screen under it to the Shot view leaves it open. */}
        <LogView />
      </AppTheme>
    </ServicesProvider>
  );
}
