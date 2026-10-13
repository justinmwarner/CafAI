/**
 * The frame every screen sits in, in the layout the screen size calls for
 * (layout.ts):
 *
 * - Tablet: a top bar with the navigation, the machine row and the ways out
 *   to Decaid, and the routed screen under it at the window's full width.
 *   On the Shot route the main pane shows the big graph (ShotView) over the
 *   coach.
 * - Phone: a slim top bar with the machine row (icons only) and the ways
 *   out, one screen at a time, and four tabs at the bottom (a rail on the
 *   left when the phone is on its side). The Shot tab is the Shot route: the
 *   same Shot view.
 *
 * In both, the machine row (the four starts; the running one turns into
 * Stop) is in the top bar on every screen, and the machine's problems show
 * in one slim alert right under it. The page itself never scrolls (each
 * region scrolls inside itself), there are no edge gestures (Android edge
 * swipes leave the skin), and Exit and Decaid settings are on every screen:
 * Crema hid its exit on focus screens and people got stuck.
 *
 * The coach stays mounted, hidden, under the Shot view, so its scroll
 * position and the composer's draft survive a shot; and every layout puts
 * the routed screen and the machine row at the same places in the tree, so a
 * rotation keeps them mounted too. A drink's view (steam, hot water, flush)
 * lies over the coach the same way while it runs and after (D146): the app
 * switches to it when the machine starts one, as it does for a shot.
 *
 * The shell also keeps two things running for as long as the app does: the
 * scale's revive when the machine wakes (useScaleRevive.ts), and Decaid's
 * time-to-ready channel, followed while Decaid has the plugin loaded.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import LocalCafeRounded from '@mui/icons-material/LocalCafeRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import ShowChartRounded from '@mui/icons-material/ShowChartRounded';
import { PLUGIN } from '../../api/plugins.ts';
import type { HostEnvironment } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import { DrinkView } from '../drinks/DrinkView.tsx';
import { drinkTraceFor } from '../drinks/drinkTrace.ts';
import { useDrinkFocus } from '../drinks/useDrinkFocus.ts';
import { LoadedProfileProvider } from '../machine/LoadedProfileContext.tsx';
import { MachineAlerts } from '../machine/MachineAlerts.tsx';
import { MachineRow } from '../machine/MachineRow.tsx';
import { shotTraceFor } from '../machine/shotTrace.ts';
import { ShotView } from '../machine/ShotView.tsx';
import { useScaleRevive } from '../machine/useScaleRevive.ts';
import { dismissEngineWarning, engineWarning, isEngineWarningDismissed, readEngineCheck } from '../platform/engineCheck.ts';
import { watchSafeArea } from '../platform/safeArea.ts';
import { useHeartbeatOnInteraction } from '../platform/useHeartbeatOnInteraction.ts';
import type { Route, RouteName } from '../router.ts';
import { TID } from '../testIds.ts';
import { layoutFor, useLayout, type Layout } from './layout.ts';
import { LiveStrip } from './LiveStrip.tsx';
import { LiveDot, ShotTime, useShotLive, useShotTimeName } from './ShotTime.tsx';
import { TapGuard } from './TapGuard.tsx';
import { isTextEntry, useShotFocus } from './useShotFocus.ts';

export interface AppShellProps {
  /** The current route (from useRoute()). */
  route: Route;
  /** Called by the navigation buttons (normally router.navigate). */
  onNavigate: (route: Route) => void;
  /** The routed screen: the main pane under the top bar (on a phone, above the tabs or beside the rail). */
  children: ReactNode;
}

const TOP_BAR_HEIGHT = 56;
const PHONE_TOP_BAR_HEIGHT = 52;
const TAB_BAR_HEIGHT = 64;
const RAIL_WIDTH = 80;
/** The brand's cup, and its word's line: one height, so a word that wrapped away is clipped whole. */
const BRAND_LINE = 24;
/**
 * A tablet narrower than Decent's smallest (962 px): an iPad upright, a
 * narrowed window. There the places show their icons alone, their labels
 * kept for screen readers, so the machine row and the ways out keep their
 * room. From 960 px the labels fit, the Shot item counting, inside Decaid.
 */
const NARROW_TABLET = '@media (max-width: 959.98px)';

const visuallyHidden = {
  position: 'absolute',
  // Strings: in sx a bare 1 is 100%, a box as wide and tall as the pane that the frame could be scrolled to.
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

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

// The phone's tabs are the same four places; the machine's buttons are in the top bar.
const TABS: readonly NavItem[] = [
  { name: 'coach', route: { name: 'coach' }, label: 'Coach', icon: <ForumRounded />, testId: TID.tabCoach },
  { name: 'shot', route: { name: 'shot' }, label: 'Shot', icon: <ShowChartRounded />, testId: TID.tabShot },
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
 * phone would trade its top bar for the phone's (and bring the tabs up from
 * the bottom) under the barista mid-sentence. Only the height: the width is
 * always the window's own. A new width (a rotation, a narrowed window) or a
 * taller window is never the keyboard, so it brings the window as it is then.
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

/**
 * The cup and the word. In the phone's bar the word gives way when the room
 * runs out (a narrow phone, the machine row's four buttons beside it): it
 * wraps onto a second line the box clips, so the cup stays, nothing else
 * moves, and the word is back as soon as it fits (the row of a group-head
 * machine, empty between shots, leaves it room).
 */
function Brand({ phone }: { phone: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        color: 'primary.main',
        pr: 1,
        flex: 'none',
        // The first button's own padding makes up the room before the row.
        ...(phone ? { pr: 0.5, flex: '0 1 auto', minWidth: BRAND_LINE + 4, height: BRAND_LINE, flexWrap: 'wrap', overflow: 'hidden' } : null),
      }}
    >
      <LocalCafeRounded />
      <Typography
        component="span"
        sx={{ fontSize: '1.1875rem', fontWeight: 750, letterSpacing: '0.005em', lineHeight: `${BRAND_LINE}px`, whiteSpace: 'nowrap' }}
      >
        CafAI
      </Typography>
    </Box>
  );
}

/** Exit on a tablet: the word over where it goes. */
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

/** The ways out as icons, named for screen readers: ink-muted, as quiet as the bar's other places. */
const barIconSx = {
  flex: 'none',
  // A string: a bare number here would be a multiple of the theme's radius.
  borderRadius: '12px',
  color: 'text.secondary',
} as const;

/** Exit on a phone: the icon alone. */
function PhoneExitButton({ host }: { host: HostEnvironment }) {
  return (
    <IconButton data-testid={TID.exitToSkins} aria-label={exitLabel(host)} onClick={() => host.exitToSkinSwitcher()} sx={barIconSx}>
      <LogoutRounded />
    </IconButton>
  );
}

/** Decaid's settings, a full-page navigation (D13): the "opens elsewhere" icon, in both bars. */
function DecaidSettingsButton({ host }: { host: HostEnvironment }) {
  return (
    <IconButton component="a" href={host.settingsUrl} data-testid={TID.decaidSettings} aria-label="Decaid settings" sx={barIconSx}>
      <OpenInNewRounded />
    </IconButton>
  );
}

/** "Shot", or while a shot runs the live dot and "Shot 42.0 s"; on a narrow tablet the icon (or the dot and the time) alone. */
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
        // Tight enough for the 962 px tablet inside Decaid with the Shot item counting; more room from 1200 px.
        px: { xs: 1, lg: 2 },
        flex: 'none',
        whiteSpace: 'nowrap',
        color: active ? 'primary.main' : 'text.secondary',
        bgcolor: active ? 'cafai.accentSoft' : 'transparent',
        // The dot sits where the icon was, centred in the icon's room.
        '& .MuiButton-startIcon': { minWidth: 20, justifyContent: 'center' },
        [NARROW_TABLET]: { minWidth: 48, px: 1.5, '& .MuiButton-startIcon': { mx: 0 } },
      }}
    >
      <Box component="span" sx={{ [NARROW_TABLET]: visuallyHidden }}>
        {item.label}
      </Box>
      {live && (
        <Box component="span" sx={{ ml: 0.75, color: 'text.primary', [NARROW_TABLET]: { ml: 0.5 } }}>
          <ShotTime />
        </Box>
      )}
    </Button>
  );
}

interface TopBarProps {
  phone: boolean;
  route: Route;
  onNavigate: (route: Route) => void;
  host: HostEnvironment;
  /** Beside the rail: the bar reaches over the rail's inset to the screen's edge. */
  insetLeft: boolean;
}

/**
 * The top bar, one element in both layouts, so a change of layout keeps the
 * machine row, and a command in flight, mounted. Tablet: the brand, the four
 * places, then at the right the machine row, a hairline, Decaid settings and
 * Exit. Phone: the brand, then the row, Decaid settings and Exit as icons;
 * the tabs navigate.
 *
 * Nothing guards it: the tap guard covers the main pane only, so Stop takes
 * a tap the moment it appears.
 */
function TopBar({ phone, route, onNavigate, host, insetLeft }: TopBarProps) {
  return (
    <Box
      component="header"
      sx={{
        flex: 'none',
        height: phone ? PHONE_TOP_BAR_HEIGHT : TOP_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        ...(phone
          ? {
              // Over the rail's inset too, so the bar reaches the edge while the brand clears the notch.
              pl: insetLeft ? 'calc(16px + var(--safe-left, 0px))' : '16px',
              // The last icon's own padding makes up the rest of the edge.
              pr: '4px',
            }
          : { gap: { xs: 0.5, lg: 1 }, px: 1.5 }),
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Brand phone={phone} />
      {phone ? null : (
        <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: { xs: 0.25, lg: 0.5 }, flex: 'none' }}>
          {NAV.map((item) => (
            <NavButton key={item.name} item={item} active={route.name === item.name} onNavigate={onNavigate} />
          ))}
        </Box>
      )}
      <Box sx={{ flex: '1 1 auto' }} />
      {/* Fourth in the bar in both layouts: the same row, its icons alone on a phone. */}
      <MachineRow icons={phone} />
      {phone ? null : <Box sx={{ flex: 'none', width: '1px', height: 30, mx: 0.5, bgcolor: 'divider' }} />}
      <DecaidSettingsButton host={host} />
      {phone ? <PhoneExitButton host={host} /> : <ExitButton host={host} />}
    </Box>
  );
}

/** The Shot tab's name while a shot runs: the time shows in place of its label. */
const shotTabName = (seconds: number) => `Shot, running, ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;

/** A tab: the icon in its pill above the label; while a shot runs the Shot tab shows the dot and the time instead. */
function Tab({ item, active, rail, onNavigate }: { item: NavItem; active: boolean; rail: boolean; onNavigate: (route: Route) => void }) {
  const live = useShotLive() && item.name === 'shot';
  const node = useRef<HTMLButtonElement>(null);
  useShotTimeName(node, live, shotTabName);
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
 * not work. In the flow under the top bar, so it pushes the screen down
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

/**
 * Follows Decaid's time-to-ready channel while Decaid has the plugin loaded
 * (D103), and stops when it goes, for the stats card's countdown (spec 6.3).
 */
function useTimeToReadyChannel(): void {
  const { plugins, telemetry } = useServices();
  const loaded = useSyncExternalStore(plugins.subscribe, () => plugins.isLoaded(PLUGIN.timeToReady));
  useEffect(() => {
    if (!loaded) return;
    telemetry.watchTimeToReady(true);
    return () => telemetry.watchTimeToReady(false);
  }, [loaded, telemetry]);
}

/** The later of two guards: whichever focus switched last guards the pane. */
function laterGuard(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Over the hidden coach: the Shot view, or a drink's. */
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

function Shell({ route, onNavigate, children }: AppShellProps) {
  const { heartbeat, host, telemetry } = useServices();
  useHeartbeatOnInteraction(heartbeat);
  useScaleRevive();
  useTimeToReadyChannel();
  // Before paint, so the first frame already respects the insets.
  useLayoutEffect(() => watchSafeArea(window), []);
  // The app's one recording of the shot starts with the shell (the first call
  // creates it, every later one finds it), so whichever graph opens mid-shot
  // has the shot from its first frame.
  shotTraceFor(telemetry);
  // And its one recording of steam, hot water and flush, for the same reason (D148).
  drinkTraceFor(telemetry);
  const { awaitingOutcome, guardUntil: shotGuard } = useShotFocus(route);
  const drinkFocus = useDrinkFocus();
  const guardUntil = laterGuard(shotGuard, drinkFocus.guardUntil);
  const typing = useTextEntryFocus();
  const layout = useShellLayout(typing);

  const phone = layout.mode === 'phone';
  // The tabs give way to the on-screen keyboard, so the chat keeps its room.
  const tabs = phone && !typing;
  const rail = tabs && layout.nav === 'rail';
  const bar = tabs && layout.nav === 'bar';
  const openShot = () => onNavigate({ name: 'shot' });
  // The Shot route, or a drink's, in both layouts: the view at the main pane's full width, over the coach.
  const overlay =
    route.name === 'shot' ? (
      <ShotView awaitingOutcome={awaitingOutcome} />
    ) : route.name === 'drink' ? (
      <DrinkView key={route.drink} kind={route.drink} back={drinkFocus.back} onGoBack={drinkFocus.goBack} />
    ) : null;

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
      <TopBar phone={phone} route={route} onNavigate={onNavigate} host={host} insetLeft={rail} />
      {/* Right under the bar, over the whole width: what keeps the machine from working, while it lasts. */}
      <MachineAlerts />
      <EngineWarning />
      {/* Every layout keeps <main> (and the routed screen in it) second in this row, so a rotation never remounts the screen. */}
      <Box sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: bar ? 'column' : 'row' }}>
        {rail ? <Tabs route={route} onNavigate={onNavigate} rail /> : null}
        <Box
          component="main"
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            // Its own stacking context: the guard and the Shot view stay over this pane and
            // only this pane, never over the top bar and its Stop.
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
  // One reading of Decaid's workflow for the whole shell: the stats card's
  // profile, the Shot view's step and the coach note all show it.
  return (
    <LoadedProfileProvider>
      <Shell {...props} />
    </LoadedProfileProvider>
  );
}
