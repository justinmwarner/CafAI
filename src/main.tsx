import './ui/fonts.ts';
import { createRoot } from 'react-dom/client';
import { App, restoreRoute } from './app/App.tsx';
import { createServices } from './app/createServices.ts';

const rootElement = document.getElementById('root')!;
const root = createRoot(rootElement);

function Message({ title, detail }: { title: string; detail?: string }) {
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
    </div>
  );
}

async function startMocks(): Promise<void> {
  // Mock mode only (npm run dev:mock / build:mock); this branch and the mocks
  // are compiled out of the production bundle.
  const speed = Number(new URLSearchParams(window.location.search).get('mockSpeed')) || 1;
  const [{ startMockWorker }, { anthropicHandlers }] = await Promise.all([
    import('../mock/browser.ts'),
    import('../mock/anthropic/handlers.ts'),
  ]);
  await startMockWorker({ extraHandlers: anthropicHandlers({ speed }) });
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
