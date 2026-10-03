/**
 * The frame every screen sits in: a top bar with navigation and the ways out
 * to Decaid, the machine panel on the left and the routed screen on the right.
 *
 * The page itself never scrolls (each column scrolls inside itself), there are
 * no edge gestures (Android edge swipes leave the skin), and the Exit control
 * is on every screen: Crema hid its exit on focus screens and people got stuck.
 */
import { useLayoutEffect, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CoffeeMakerRounded from '@mui/icons-material/CoffeeMakerRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import LocalCafeRounded from '@mui/icons-material/LocalCafeRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import type { HostEnvironment } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import { MachinePanel } from '../machine/MachinePanel.tsx';
import { watchSafeArea } from '../platform/safeArea.ts';
import { useHeartbeatOnInteraction } from '../platform/useHeartbeatOnInteraction.ts';
import type { Route, RouteName } from '../router.ts';
import { TID } from '../testIds.ts';

export interface AppShellProps {
  /** The current route (from useRoute()). */
  route: Route;
  /** Called by the navigation buttons (normally router.navigate). */
  onNavigate: (route: Route) => void;
  /** The routed screen, shown right of the machine panel. */
  children: ReactNode;
  /** Replaces the default <MachinePanel /> (tests, previews); null hides it. */
  machinePanel?: ReactNode;
}

const TOP_BAR_HEIGHT = 64;

interface NavItem {
  name: RouteName;
  route: Route;
  label: string;
  icon: ReactNode;
  testId: string;
}

const NAV: readonly NavItem[] = [
  { name: 'coach', route: { name: 'coach' }, label: 'Coach', icon: <ForumRounded />, testId: TID.navCoach },
  { name: 'history', route: { name: 'history' }, label: 'History', icon: <HistoryRounded />, testId: TID.navHistory },
  { name: 'settings', route: { name: 'settings' }, label: 'Settings', icon: <SettingsRounded />, testId: TID.navSettings },
];

function Brand() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'primary.main', pr: 1, flex: 'none' }}>
      <LocalCafeRounded />
      <Typography component="span" sx={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.02em' }}>
        CafAI
      </Typography>
    </Box>
  );
}

function ExitButton({ host }: { host: HostEnvironment }) {
  const where = host.insideDecaid ? 'to Decaid' : 'Skins';
  return (
    <Button
      data-testid={TID.exitToSkins}
      variant="outlined"
      color="inherit"
      aria-label={host.insideDecaid ? 'Exit to Decaid' : 'Exit to the skin switcher'}
      startIcon={<LogoutRounded />}
      onClick={() => host.exitToSkinSwitcher()}
      sx={{ flex: 'none', px: 1.5, borderColor: 'divider' }}
    >
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
        <span>Exit</span>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
          {where}
        </Typography>
      </Box>
    </Button>
  );
}

function TopBar({ route, onNavigate, host }: { route: Route; onNavigate: (route: Route) => void; host: HostEnvironment }) {
  return (
    <Box
      component="header"
      sx={{
        flex: 'none',
        height: TOP_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Brand />
      <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: 0.5, minWidth: 0 }}>
        {NAV.map((item) => {
          const active = route.name === item.name;
          return (
            <Button
              key={item.name}
              data-testid={item.testId}
              aria-current={active ? 'page' : undefined}
              color={active ? 'primary' : 'inherit'}
              startIcon={item.icon}
              onClick={() => onNavigate(item.route)}
              sx={{
                px: 2,
                flex: 'none',
                color: active ? 'primary.main' : 'text.secondary',
                bgcolor: active ? 'rgba(200, 162, 122, 0.14)' : 'transparent',
              }}
            >
              {item.label}
            </Button>
          );
        })}
      </Box>
      <Box sx={{ flex: '1 1 auto' }} />
      <Button
        component="a"
        href={host.settingsUrl}
        data-testid={TID.decaidSettings}
        color="inherit"
        startIcon={<CoffeeMakerRounded />}
        sx={{ flex: 'none', px: 1.5, color: 'text.secondary' }}
      >
        Decaid settings
      </Button>
      <ExitButton host={host} />
    </Box>
  );
}

export function AppShell({ route, onNavigate, children, machinePanel }: AppShellProps) {
  const { heartbeat, host } = useServices();
  useHeartbeatOnInteraction(heartbeat);
  // Before paint, so the first frame already respects the insets.
  useLayoutEffect(() => watchSafeArea(window), []);

  return (
    <Box
      data-testid={TID.appReady}
      sx={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.default',
        color: 'text.primary',
        pt: 'var(--safe-top, 0px)',
        pr: 'var(--safe-right, 0px)',
        pb: 'var(--safe-bottom, 0px)',
        pl: 'var(--safe-left, 0px)',
      }}
    >
      <TopBar route={route} onNavigate={onNavigate} host={host} />
      <Box sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
        {machinePanel !== null && (
          <Box
            component="aside"
            aria-label="Machine"
            sx={{
              flex: 'none',
              width: { xs: 360, lg: 420, xl: 520 },
              minHeight: 0,
              borderRight: 1,
              borderColor: 'divider',
            }}
          >
            {machinePanel === undefined ? <MachinePanel /> : machinePanel}
          </Box>
        )}
        <Box
          component="main"
          sx={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
