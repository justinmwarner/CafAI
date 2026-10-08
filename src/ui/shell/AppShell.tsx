/**
 * The frame every screen sits in, in the layout the screen size calls for
 * (layout.ts):
 *
 * - Tablet: a top bar with the navigation and the ways out to Decaid, the
 *   machine column on the left and the routed screen on the right. On the
 *   Shot route the main pane shows the big graph (ShotView) over the coach.
 * - Phone: a slim top bar with the ways out, one screen at a time, and four
 *   tabs at the bottom (a rail on the left when the phone is on its side).
 *   The Machine tab is the Shot route: the machine column at full width.
 *
 * In both, the page itself never scrolls (each region scrolls inside itself),
 * there are no edge gestures (Android edge swipes leave the skin), and Exit
 * and Decaid settings are on every screen: Crema hid its exit on focus
 * screens and people got stuck.
 *
 * The coach stays mounted, hidden, under the Shot view and the Machine tab,
 * so its scroll position and the composer's draft survive a shot; and every
 * layout puts the routed screen at the same place in the tree, so a rotation
 * keeps it mounted too.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CoffeeMakerRounded from '@mui/icons-material/CoffeeMakerRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import LocalCafeRounded from '@mui/icons-material/LocalCafeRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import ShowChartRounded from '@mui/icons-material/ShowChartRounded';
import type { HostEnvironment } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import { LoadedProfileProvider } from '../machine/LoadedProfileContext.tsx';
import { MachinePanel } from '../machine/MachinePanel.tsx';
import { shotTraceFor } from '../machine/shotTrace.ts';
import { ShotView } from '../machine/ShotView.tsx';
import { dismissEngineWarning, engineWarning, isEngineWarningDismissed, readEngineCheck } from '../platform/engineCheck.ts';
import { watchSafeArea } from '../platform/safeArea.ts';
import { useHeartbeatOnInteraction } from '../platform/useHeartbeatOnInteraction.ts';
import type { Route, RouteName } from '../router.ts';
import { TID } from '../testIds.ts';
import { layoutFor, machineColumnWidth, useLayout, type Layout } from './layout.ts';
import { LiveStrip } from './LiveStrip.tsx';
import { LiveDot, ShotTime, useShotLive, useShotTimeName } from './ShotTime.tsx';
import { TapGuard } from './TapGuard.tsx';
import { isTextEntry, useShotFocus } from './useShotFocus.ts';

export interface AppShellProps {
  /** The current route (from useRoute()). */
  route: Route;
  /** Called by the navigation buttons (normally router.navigate). */
  onNavigate: (route: Route) => void;
  /** The routed screen: right of the machine column on a tablet, the whole content on a phone. */
  children: ReactNode;
  /** Replaces the default <MachinePanel /> (tests, previews); null hides it. */
  machinePanel?: ReactNode;
}

const TOP_BAR_HEIGHT = 56;
const PHONE_TOP_BAR_HEIGHT = 52;
const TAB_BAR_HEIGHT = 64;
const RAIL_WIDTH = 80;

interface NavItem {
  name: RouteName;
  route: Route;
  label: string;
  icon: ReactNode;
  testId: string;
}

const NAV: readonly NavItem[] = [
  { name: 'coach', route: { name: 'coach' }, label: 'Coach', icon: <ForumRounded />, testId: TID.navCoach },
  { name: 'shot', route: { name: 'shot' }, label: 'Shot', icon: <ShowChartRounded />, testId: TID.navShot },
  { name: 'history', route: { name: 'history' }, label: 'History', icon: <HistoryRounded />, testId: TID.navHistory },
  { name: 'settings', route: { name: 'settings' }, label: 'Settings', icon: <SettingsRounded />, testId: TID.navSettings },
];

// On a phone the Shot route is the Machine tab: it holds steam, flush and hot water too, not just the shot.
const TABS: readonly NavItem[] = [
  { name: 'coach', route: { name: 'coach' }, label: 'Coach', icon: <ForumRounded />, testId: TID.tabCoach },
  { name: 'shot', route: { name: 'shot' }, label: 'Machine', icon: <CoffeeMakerRounded />, testId: TID.tabMachine },
  { name: 'history', route: { name: 'history' }, label: 'History', icon: <HistoryRounded />, testId: TID.tabHistory },
  { name: 'settings', route: { name: 'settings' }, label: 'Settings', icon: <SettingsRounded />, testId: TID.tabSettings },
];

const exitLabel = (host: HostEnvironment) => (host.insideDecaid ? 'Exit to Decaid' : 'Exit to the skin switcher');

/**
 * True while a field that takes typed text has focus, so a phone's
 * on-screen keyboard is up (the same test as the focus hook's "typing").
 *
 * Leaving the field with a press (a tap on Send while typing) brings the
 * tabs back only after the press's click has landed: they push the content
 * up, and a release over whatever moved there would lose the tap. So from a
 * mousedown to its mouseup the layout holds (a tap's focus change comes
 * between the two), and the tabs follow a task later.
 */
function useTextEntryFocus(): boolean {
  const [typing, setTyping] = useState(() => typeof document !== 'undefined' && isTextEntry(document.activeElement));
  useEffect(() => {
    let pressing = false;
    let release: ReturnType<typeof setTimeout> | null = null;
    const onFocusIn = (event: FocusEvent) => {
      if (isTextEntry(event.target)) setTyping(true);
      // A button a press focused: the tabs wait for the release.
      else if (!pressing) setTyping(false);
    };
    const onFocusOut = (event: FocusEvent) => {
      // Where focus goes next: from one field to another, the keyboard stays up.
      if (pressing || isTextEntry(event.relatedTarget)) return;
      setTyping(false);
    };
    const onMouseDown = () => {
      pressing = true;
    };
    const onMouseUp = () => {
      if (!pressing) return;
      pressing = false;
      if (release !== null) clearTimeout(release);
      // A task later, after the click this release makes, so the tap lands where it was aimed.
      release = setTimeout(() => {
        release = null;
        setTyping(isTextEntry(document.activeElement));
      }, 0);
    };
    // A focused field that leaves the page reports no focusout; the next tap anywhere notices.
    const onPointerDown = () => {
      if (!isTextEntry(document.activeElement)) setTyping(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('mousedown', onMouseDown, { capture: true, passive: true });
    document.addEventListener('mouseup', onMouseUp, { capture: true, passive: true });
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('mousedown', onMouseDown, { capture: true });
      document.removeEventListener('mouseup', onMouseUp, { capture: true });
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      if (release !== null) clearTimeout(release);
    };
  }, []);
  return typing;
}

/** How long the held height outlasts the typing: about as long as a keyboard takes to close. */
const KEYBOARD_CLOSE_MS = 500;

/** The window whose height the layout keeps while the barista types. */
interface Hold {
  width: number;
  height: number;
}

const sameLayout = (a: Layout, b: Layout) => a.mode === b.mode && a.nav === b.nav;

/**
 * The layout for the screen, its height held while the barista types: an
 * on-screen keyboard shortens the window, and a tablet that took that for a
 * phone would drop its machine column (and Stop) from under the barista
 * mid-sentence. Only the height: the width is always the window's own. A new
 * width (a rotation, a narrowed window) or a taller window is never the
 * keyboard, so it brings the window as it is then.
 *
 * Once typing ends the keyboard is still closing: the held height stays until
 * the window is back on its side of the line, or KEYBOARD_CLOSE_MS at most,
 * so a closing keyboard never flashes the other layout.
 */
function useShellLayout(typing: boolean): Layout {
  const live = useLayout();
  const [hold, setHold] = useState<Hold | null>(null);
  let next = hold;
  if (next !== null && (next.width !== live.width || next.height < live.height)) next = null;
  if (typing && next === null) next = { width: live.width, height: live.height };
  // Done typing: the hold ends as soon as it makes no difference.
  if (!typing && next !== null && sameLayout(layoutFor(live.width, next.height), live)) next = null;
  if (next !== hold) setHold(next);

  useEffect(() => {
    if (typing || hold === null) return;
    const timer = setTimeout(() => setHold(null), KEYBOARD_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [typing, hold]);

  return next === null ? live : layoutFor(live.width, next.height);
}

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
      aria-label={exitLabel(host)}
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

/** "Shot", or while a shot runs the live dot and "Shot 42.0 s". */
function NavButton({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: (route: Route) => void }) {
  const live = useShotLive() && item.name === 'shot';
  return (
    <Button
      data-testid={item.testId}
      aria-current={active ? 'page' : undefined}
      color={active ? 'primary' : 'inherit'}
      startIcon={live ? <LiveDot size={9} /> : item.icon}
      onClick={() => onNavigate(item.route)}
      sx={{
        px: 2,
        flex: 'none',
        color: active ? 'primary.main' : 'text.secondary',
        bgcolor: active ? 'cafai.accentSoft' : 'transparent',
        // The dot sits where the icon was, centred in the icon's room.
        '& .MuiButton-startIcon': { minWidth: 20, justifyContent: 'center' },
      }}
    >
      {item.label}
      {live && (
        <Box component="span" sx={{ ml: 0.75, color: 'text.primary' }}>
          <ShotTime />
        </Box>
      )}
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
        {NAV.map((item) => (
          <NavButton key={item.name} item={item} active={route.name === item.name} onNavigate={onNavigate} />
        ))}
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

/** The phone's bar: just the brand and the two ways out; the tabs navigate. */
function PhoneTopBar({ host, insetLeft }: { host: HostEnvironment; insetLeft: boolean }) {
  return (
    <Box
      component="header"
      sx={{
        flex: 'none',
        height: PHONE_TOP_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        // Over the rail's inset too, so the bar reaches the edge while the brand clears the notch.
        pl: insetLeft ? 'calc(16px + var(--safe-left, 0px))' : '16px',
        pr: '10px',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Brand />
      <Box sx={{ flex: '1 1 auto' }} />
      <Button
        component="a"
        href={host.settingsUrl}
        data-testid={TID.decaidSettings}
        aria-label="Decaid settings"
        color="inherit"
        startIcon={<OpenInNewRounded />}
        sx={{ flex: 'none', px: 1.25, color: 'text.secondary' }}
      >
        Decaid
      </Button>
      <Button
        data-testid={TID.exitToSkins}
        variant="tonal"
        aria-label={exitLabel(host)}
        startIcon={<LogoutRounded />}
        onClick={() => host.exitToSkinSwitcher()}
        sx={{ flex: 'none', px: 1.5 }}
      >
        Exit
      </Button>
    </Box>
  );
}

/** The Machine tab's name while a shot runs: the time shows in place of its label. */
const machineTabName = (seconds: number) => `Machine, shot running, ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;

/** A tab: the icon in its pill above the label; while a shot runs the Machine tab shows the dot and the time instead. */
function Tab({ item, active, rail, onNavigate }: { item: NavItem; active: boolean; rail: boolean; onNavigate: (route: Route) => void }) {
  const live = useShotLive() && item.name === 'shot';
  const node = useRef<HTMLButtonElement>(null);
  useShotTimeName(node, live, machineTabName);
  return (
    <ButtonBase
      ref={node}
      data-testid={item.testId}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(item.route)}
      sx={{
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '3px',
        minWidth: 48,
        minHeight: rail ? 60 : 48,
        borderRadius: '14px',
        color: active ? 'primary.main' : 'text.secondary',
        fontFamily: 'inherit',
        fontSize: '0.78125rem',
        fontWeight: 650,
        lineHeight: 1.2,
      }}
    >
      <Box
        component="span"
        sx={{
          width: 58,
          height: 30,
          borderRadius: '15px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: active ? 'cafai.accentSoft' : 'transparent',
        }}
      >
        {item.icon}
      </Box>
      {live ? (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.primary' }}>
          <LiveDot size={7} />
          <ShotTime />
        </Box>
      ) : (
        <span>{item.label}</span>
      )}
    </ButtonBase>
  );
}

/** The phone's four tabs: a bar under the content, or a rail beside it when the phone is on its side. */
function Tabs({ route, onNavigate, rail }: { route: Route; onNavigate: (route: Route) => void; rail: boolean }) {
  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        flex: 'none',
        bgcolor: 'background.paper',
        ...(rail
          ? {
              // The rail reaches the screen's left and bottom edges; its tabs stay clear of the notch and the home indicator.
              width: `calc(${RAIL_WIDTH}px + var(--safe-left, 0px))`,
              pl: 'calc(6px + var(--safe-left, 0px))',
              pr: '6px',
              pt: 1,
              pb: 'calc(8px + var(--safe-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 0.5,
              borderRight: 1,
            }
          : {
              // The bar reaches the screen's bottom edge; its tabs stay clear of the home indicator.
              height: `calc(${TAB_BAR_HEIGHT}px + var(--safe-bottom, 0px))`,
              pt: '6px',
              px: '6px',
              pb: 'calc(6px + var(--safe-bottom, 0px))',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              borderTop: 1,
            }),
        // After the border: `borderTop: 1` and `borderRight: 1` are shorthands that set its colour back to the text's.
        borderColor: 'divider',
      }}
    >
      {TABS.map((item) => (
        <Tab key={item.name} item={item} active={route.name === item.name} rail={rail} onNavigate={onNavigate} />
      ))}
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

/** Over the hidden coach: the Shot view (tablet) or the Machine tab (phone). */
const overlaySx = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  bgcolor: 'background.default',
} as const;

function Shell({ route, onNavigate, children, machinePanel }: AppShellProps) {
  const { heartbeat, host, telemetry } = useServices();
  useHeartbeatOnInteraction(heartbeat);
  // Before paint, so the first frame already respects the insets.
  useLayoutEffect(() => watchSafeArea(window), []);
  // The app's one recording of the shot starts with the shell (the first call
  // creates it, every later one finds it), so whichever graph opens mid-shot
  // has the shot from its first frame.
  shotTraceFor(telemetry);
  const { awaitingOutcome, guardUntil } = useShotFocus(route);
  const typing = useTextEntryFocus();
  const layout = useShellLayout(typing);

  const phone = layout.mode === 'phone';
  // The tabs give way to the on-screen keyboard, so the chat keeps its room.
  const tabs = phone && !typing;
  const rail = tabs && layout.nav === 'rail';
  const bar = tabs && layout.nav === 'bar';
  const onShot = route.name === 'shot';
  const openShot = () => onNavigate({ name: 'shot' });

  let overlay: ReactNode = null;
  if (onShot) {
    overlay = phone ? (
      machinePanel === undefined ? (
        <MachinePanel graph="full" awaitingOutcome={awaitingOutcome} columns={layout.nav === 'rail' ? 2 : 1} />
      ) : (
        machinePanel
      )
    ) : (
      <ShotView awaitingOutcome={awaitingOutcome} />
    );
  }

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
        // The tab bar and the rail take their insets themselves, so their colour reaches the edge.
        pb: bar || rail ? 0 : 'var(--safe-bottom, 0px)',
        pl: rail ? 0 : 'var(--safe-left, 0px)',
      }}
    >
      {phone ? <PhoneTopBar host={host} insetLeft={rail} /> : <TopBar route={route} onNavigate={onNavigate} host={host} />}
      <EngineWarning />
      {/* Every layout keeps <main> (and the routed screen in it) third in this row, so a rotation never remounts the screen. */}
      <Box sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: bar ? 'column' : 'row' }}>
        {rail ? <Tabs route={route} onNavigate={onNavigate} rail /> : null}
        {!phone && machinePanel !== null ? (
          <Box
            component="aside"
            aria-label="Machine"
            sx={{
              flex: 'none',
              width: machineColumnWidth(layout.width),
              minHeight: 0,
              borderRight: 1,
              borderColor: 'divider',
            }}
          >
            {machinePanel === undefined ? (
              // The big graph in the main pane replaces the preview; the controls above it stay where they are.
              <MachinePanel graph={onShot ? 'none' : 'preview'} onOpenGraph={openShot} />
            ) : (
              machinePanel
            )}
          </Box>
        ) : null}
        <Box
          component="main"
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            // Its own stacking context: the guard and the Shot view stay over this pane and only this pane.
            zIndex: 0,
            // Beside the rail, the content (not just its padding) ends above the home indicator.
            mb: rail ? 'var(--safe-bottom, 0px)' : 0,
          }}
        >
          {phone && route.name === 'coach' ? <LiveStrip awaitingOutcome={awaitingOutcome} onOpen={openShot} /> : null}
          <Box
            sx={{
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
              // Whatever the routed screen layers inside itself stays under the overlay and the
              // guard. Isolation, not position: a positioned box here would hold the screen's
              // absolutely placed helpers (its visually hidden labels) and scroll sideways to them.
              isolation: 'isolate',
              // Hidden, not unmounted: the coach keeps its scroll position and its draft under the shot.
              visibility: overlay === null ? 'visible' : 'hidden',
            }}
          >
            {children}
          </Box>
          {overlay === null ? null : <Box sx={overlaySx}>{overlay}</Box>}
          <TapGuard until={guardUntil} />
        </Box>
        {bar ? <Tabs route={route} onNavigate={onNavigate} rail={false} /> : null}
      </Box>
    </Box>
  );
}

export function AppShell(props: AppShellProps) {
  // One reading of Decaid's workflow for the whole shell: the Profile line,
  // the Shot view's step and the coach note all show it.
  return (
    <LoadedProfileProvider>
      <Shell {...props} />
    </LoadedProfileProvider>
  );
}
