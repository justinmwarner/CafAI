/**
 * The frame every screen sits in: a top bar with navigation and the ways out
 * to Decaid, the machine panel on the left and the routed screen on the right.
 *
 * The page itself never scrolls (each column scrolls inside itself), there are
 * no edge gestures (Android edge swipes leave the skin), and the Exit control
 * is on every screen: Crema hid its exit on focus screens and people got stuck.
 */
import { useLayoutEffect, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import LocalCafeRounded from '@mui/icons-material/LocalCafeRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import type { HostEnvironment } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import { MachinePanel } from '../machine/MachinePanel.tsx';
import { dismissEngineWarning, engineWarning, isEngineWarningDismissed, readEngineCheck } from '../platform/engineCheck.ts';
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

const TOP_BAR_HEIGHT = 56;

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
      <Typography component="span" sx={{ fontSize: '1.1875rem', fontWeight: 750, letterSpacing: '0.005em' }}>
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
      variant="tonal"
      aria-label={host.insideDecaid ? 'Exit to Decaid' : 'Exit to the skin switcher'}
      startIcon={<LogoutRounded />}
      onClick={() => host.exitToSkinSwitcher()}
      sx={{ flex: 'none', px: 1.5 }}
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
                bgcolor: active ? 'cafai.accentSoft' : 'transparent',
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
        startIcon={<OpenInNewRounded />}
        sx={{ flex: 'none', px: 1.5, color: 'text.secondary' }}
      >
        Decaid settings
      </Button>
      <ExitButton host={host} />
    </Box>
  );
}

/**
 * An engine older than Chromium 91 (D58): CafAI started, but parts of it may
 * not work. In the flow under the top bar, so it pushes the columns down
 * instead of covering a control; dismissed once per engine version.
 */
function EngineWarning() {
  // index.html's inline check ran before the bundle; the verdict holds for the page's life.
  const [check] = useState(() => readEngineCheck(window.__CAFAI_ENGINE__));
  const [dismissed, setDismissed] = useState(() => check !== null && isEngineWarningDismissed(check));
  const text = engineWarning(check);
  if (check === null || text === null || dismissed) return null;
  return (
    <Alert
      severity="warning"
      action={
        <IconButton
          color="inherit"
          aria-label="Dismiss the browser engine warning"
          onClick={() => {
            dismissEngineWarning(check);
            setDismissed(true);
          }}
        >
          <CloseRounded />
        </IconButton>
      }
      sx={{
        flex: 'none',
        borderRadius: 0,
        borderBottom: 1,
        borderColor: 'divider',
        alignItems: 'center',
        py: 0,
        px: 1.5,
        '& .MuiAlert-icon': { py: 0.5 },
        '& .MuiAlert-message': { py: 0.5, fontSize: '0.875rem', lineHeight: 1.35 },
        '& .MuiAlert-action': { py: 0, mr: 0, pl: 1, alignItems: 'center' },
      }}
    >
      {text}
    </Alert>
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
      <EngineWarning />
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
