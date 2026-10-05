import './ui/fonts.ts';
import { createRoot } from 'react-dom/client';
import { App, restoreRoute } from './app/App.tsx';
import { createServices } from './app/createServices.ts';
import { detectHost } from './api/host.ts';

const rootElement = document.getElementById('root')!;
const root = createRoot(rootElement);

const buttonStyle = {
  minHeight: 48,
  padding: '0 24px',
  borderRadius: 8,
  border: '1px solid rgba(239, 230, 220, 0.4)',
  background: 'transparent',
  color: '#efe6dc',
  fontSize: 16,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
} as const;

function Message({ title, detail }: { title: string; detail?: string }) {
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
        fontFamily: 'Roboto, sans-serif',
        color: '#efe6dc',
        background: '#16120f',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 500 }}>{title}</div>
      {detail ? <div style={{ fontSize: 16, maxWidth: 520, opacity: 0.8 }}>{detail}</div> : null}
      {/* A way back to the skin switcher and Decaid's settings even before (or without) the app. */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" data-testid="exit-to-skins" onClick={() => host.exitToSkinSwitcher()} style={buttonStyle}>
          Exit to Decaid
        </button>
        <a data-testid="open-decaid-settings" href={host.settingsUrl} style={buttonStyle}>
          Decaid settings
        </a>
      </div>
    </div>
  );
}

async function startMocks(): Promise<void> {
  // Mock mode only (npm run dev:mock, dev:sim, build:mock); this branch and
  // the mocks are compiled out of the production bundle. mock/plan.ts decides
  // which mocks start.
  const [{ mockPlanFromUrl }, { anthropicHandlers }, { startCoachOnlyMock }, { startMockWorker }, { startMockPersistence }] =
    await Promise.all([
      import('../mock/plan.ts'),
      import('../mock/anthropic/handlers.ts'),
      import('../mock/coachOnly.ts'),
      import('../mock/browser.ts'),
      import('../mock/persist.ts'),
    ]);
  const plan = mockPlanFromUrl(window.location.search);
  const coach = anthropicHandlers({ speed: plan.coachSpeed });
  if (!plan.decaid) {
    // The scripted coach alone, against a real Decaid (docs/SIMULATOR.md).
    startCoachOnlyMock(coach);
    return;
  }
  const mock = await startMockWorker({ extraHandlers: coach });
  // ?mockPersist=1: the store an earlier page load saved is back before
  // createServices() makes the app's first request.
  startMockPersistence(mock.state);
}

async function boot(): Promise<void> {
  restoreRoute();
  root.render(<Message title="Starting CafAI…" />);
  try {
    if (import.meta.env.MODE === 'mock') await startMocks();
    const services = await createServices(window);
    root.render(<App services={services} />);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : 'Something went wrong while starting.';
    root.render(<Message title="CafAI could not start" detail={detail} />);
  }
}

void boot();
