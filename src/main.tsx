import './ui/fonts.ts';
import { createRoot } from 'react-dom/client';
import { App, restoreRoute } from './app/App.tsx';
import { APP_VERSION, createServices } from './app/createServices.ts';
import { watchStart } from './app/startWatch.ts';
import { defaultGatewayOrigin, detectHost } from './api/host.ts';
import { createKvClient } from './api/kv.ts';
import { DebugReportButton } from './debug/DebugReportButton.tsx';
import { startDebug } from './debug/session.ts';
import { openCoachSourceStore } from './storage/coachSource.ts';
import { bootColors, loadBootColors } from './ui/appearance.ts';
import { buildPalette, DEFAULT_TINT_ID, namedTint } from './ui/palette.ts';
import { FONT_FAMILY } from './ui/theme.ts';

/** localStorage, where the DEBUG flag's last answer is kept; null where storage is blocked. */
function deviceStorage(): globalThis.Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Where the coach runs, read once: a debug report goes to CafAI Bridge when it runs on a computer. */
async function readCoachSource() {
  const store = await openCoachSourceStore();
  try {
    return await store.get();
  } finally {
    store.close();
  }
}

// Before anything opens a database: with the DEBUG flag on, its watch sees every transaction (docs/DEBUG.md).
const debug = startDebug({
  win: window,
  appVersion: APP_VERSION,
  kv: createKvClient(defaultGatewayOrigin(window)),
  deviceStorage: deviceStorage(),
  coachSource: readCoachSource,
  forced: import.meta.env.VITE_CAFAI_DEBUG === '1',
});
/** What the start waits on now, for a debug report sent from the start screen. */
let startStage: () => string | null = () => null;

/** The colours of the last look the app showed (AppTheme keeps them), or null. */
function readBootColors() {
  try {
    return loadBootColors(window.localStorage);
  } catch {
    // Where storage is blocked, reading window.localStorage itself throws.
    return null;
  }
}

// Before the app (and its appearance setting) loads: the look it showed last, or the default.
const BOOT = readBootColors() ?? bootColors(buildPalette('dark', namedTint(DEFAULT_TINT_ID)));

const rootElement = document.getElementById('root')!;
const root = createRoot(rootElement);

const buttonStyle = {
  minHeight: 48,
  padding: '0 24px',
  borderRadius: 8,
  border: `1px solid ${BOOT.line}`,
  background: 'transparent',
  color: BOOT.ink,
  fontSize: 16,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
} as const;

const STARTING = 'Starting CafAI…';

/** Once the start is slow (D274): what it waits on, and that Try again starts over. */
function slowDetail(stage: string | null): string {
  const waiting = stage ? `still ${stage}` : 'nothing has started yet';
  return `This is taking longer than usual: ${waiting}. Try again starts CafAI over.`;
}

function Message({ title, detail, retry = false }: { title: string; detail?: string; retry?: boolean }) {
  const host = detectHost(window);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: FONT_FAMILY,
        color: BOOT.ink,
        background: BOOT.background,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 500 }}>{title}</div>
      {detail ? <div style={{ fontSize: 16, maxWidth: 520, color: BOOT.inkMuted }}>{detail}</div> : null}
      {/* A way back to the skin switcher and Decaid's settings even before (or without) the app. */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {retry ? (
          <button type="button" data-testid="start-try-again" onClick={() => window.location.reload()} style={buttonStyle}>
            Try again
          </button>
        ) : null}
        <button type="button" data-testid="exit-to-skins" onClick={() => host.exitToSkinSwitcher()} style={buttonStyle}>
          Exit to Decaid
        </button>
        <a data-testid="open-decaid-settings" href={host.settingsUrl} style={buttonStyle}>
          Decaid settings
        </a>
      </div>
      {/* Only while the DEBUG flag is on. */}
      <DebugReportButton
        debug={debug}
        stage={() => startStage()}
        buttonStyle={buttonStyle}
        noteStyle={{ fontSize: 14, maxWidth: 520, color: BOOT.inkMuted }}
      />
    </div>
  );
}

/** sessionStorage, where the start watch notes its one automatic retry; null where storage is blocked. */
function startStorage(): globalThis.Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

async function startMocks(): Promise<void> {
  // Mock mode only (npm run dev:mock, dev:sim, demo, build:mock); this branch
  // and the mocks are compiled out of the production bundle. mock/plan.ts
  // decides which mocks start.
  const [
    { mockPlanFromUrl, demoIgnoredNote },
    { anthropicHandlers },
    { bridgeHandlers },
    { startCoachOnlyMock },
    { startMockWorker },
    { startMockPersistence },
    { startDemo },
    { clarityHandlers },
  ] = await Promise.all([
    import('../mock/plan.ts'),
    import('../mock/anthropic/handlers.ts'),
    import('../mock/anthropic/bridge.ts'),
    import('../mock/coachOnly.ts'),
    import('../mock/browser.ts'),
    import('../mock/persist.ts'),
    import('../mock/demo/index.ts'),
    import('../mock/clarity.ts'),
  ]);
  const plan = mockPlanFromUrl(window.location.search);
  // Spread: the demo's timing and voice options, empty outside the demo.
  const coachOptions = { speed: plan.coachSpeed, ...plan.coachOptions };
  // The same scripted coach behind CafAI Bridge on this computer (127.0.0.1:8877), for "Claude on my computer";
  // and Clarity's stand-in tag for ?mockUsage=1 (D215), so mock mode never reaches Clarity.
  const coach = [...anthropicHandlers(coachOptions), ...bridgeHandlers(coachOptions), ...clarityHandlers()];
  if (!plan.decaid) {
    const note = demoIgnoredNote(window.location.search);
    if (note) console.info(note);
    // The scripted coach alone, against a real Decaid (docs/SIMULATOR.md).
    startCoachOnlyMock(coach);
    return;
  }
  const mock = await startMockWorker({ extraHandlers: coach });
  // ?demo=1 (npm run demo): CafAI's storage and the mock Decaid hold the demo
  // before createServices() opens them, and every load starts it over, so
  // nothing is persisted. Where the demo's guard refuses, the normal mock app runs.
  if (plan.demo && (await startDemo(mock.state)).seeded) return;
  // ?mockPersist=1: the store an earlier page load saved is back before
  // createServices() makes the app's first request.
  startMockPersistence(mock.state);
}

async function boot(): Promise<void> {
  restoreRoute();
  root.render(<Message title={STARTING} />);
  // A start that hangs (the page Decaid reloads after the tablet slept, say) is said so, retried once
  // by itself, and left with Try again (D274): never "Starting CafAI…" for good.
  const watch = watchStart({
    storage: startStorage(),
    reload: () => window.location.reload(),
    onSlow: (stage) => {
      root.render(<Message title={STARTING} detail={slowDetail(stage)} retry />);
      // With the DEBUG flag on, a slow start reports what it waits on by itself, before the one automatic retry.
      if (debug.enabled()) void debug.report('slow-start', { stage, probe: true });
    },
  });
  startStage = watch.current;
  try {
    if (import.meta.env.MODE === 'mock') {
      watch.stage('starting the mocks');
      await startMocks();
    }
    const services = await createServices(window, { onStage: watch.stage });
    watch.done();
    root.render(<App services={services} />);
  } catch (error) {
    watch.failed();
    const detail = error instanceof Error && error.message ? error.message : 'Something went wrong while starting.';
    root.render(<Message title="CafAI could not start" detail={detail} retry />);
  }
}

void boot();
