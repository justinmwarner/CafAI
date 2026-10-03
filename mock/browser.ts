/**
 * The mock Decaid in the browser (dev mock mode and Playwright).
 *
 * Starts an MSW service worker with Decaid's REST and WebSocket handlers
 * (plus any extra handlers, e.g. the scripted Anthropic stream) and exposes
 * the live mock as `window.__CAFAI_MOCK__ = { state, player, setSpeed }` so a
 * test can pull a shot, drop the machine or inspect requests:
 *
 *   await page.evaluate(() => window.__CAFAI_MOCK__.player.start());
 *   await page.evaluate(() => window.__CAFAI_MOCK__.state.setMachineConnected(false));
 *
 * URL switches, read once at start: ?mockSpeed=N (wall-clock compression),
 * ?mockMachine=0 and ?mockScale=0 (start disconnected), ?mockGhc=1 (shots
 * start on the machine), ?mockExamples=0 (no example shot or CafAI profile).
 */
import { setupWorker, type SetupWorker } from 'msw/browser';
import { createDecaidMock, type CreateDecaidMockOptions, type MockHandler } from './decaid/index.ts';
import type { MockDecaid } from './decaid/state.ts';
import type { ShotPlayer } from './decaid/shotPlayer.ts';

export interface CafaiMockHandle {
  state: MockDecaid;
  player: ShotPlayer;
  setSpeed(speed: number): void;
}

export interface StartMockWorkerOptions {
  extraHandlers?: MockHandler[];
  /** Overrides ?mockSpeed. */
  speed?: number;
  /** Resting machine and scale frames, in wall-clock ms (0 = none). Default 1000. */
  idleFrameMs?: number;
  /** Extra mock state options; URL switches fill the rest. */
  mock?: CreateDecaidMockOptions;
}

/** How e2e code can type the global: `(window as CafaiMockWindow).__CAFAI_MOCK__`. */
export type CafaiMockWindow = Window & { __CAFAI_MOCK__?: CafaiMockHandle };

function urlOptions(search: string): CreateDecaidMockOptions {
  const params = new URLSearchParams(search);
  const options: CreateDecaidMockOptions = {};
  const speed = Number(params.get('mockSpeed'));
  if (params.has('mockSpeed') && Number.isFinite(speed) && speed > 0) options.speed = speed;
  if (params.get('mockMachine') === '0') options.machineConnected = false;
  if (params.get('mockScale') === '0') options.scaleConnected = false;
  if (params.get('mockGhc') === '1') options.ghc = true;
  if (params.get('mockExamples') === '0') options.seedExamples = false;
  return options;
}

/**
 * Chromium 91 (the floor of Decent's tablets) has no crypto.randomUUID, which
 * MSW's page runtime may call. Mock builds only; the app itself uses newId().
 */
function polyfillRandomUuid(): void {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (!c || typeof c.randomUUID === 'function') return;
  c.randomUUID = () => {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => (x + 0x100).toString(16).slice(1)).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as ReturnType<Crypto['randomUUID']>;
  };
}

export async function startMockWorker(options: StartMockWorkerOptions = {}): Promise<CafaiMockHandle & { worker: SetupWorker }> {
  polyfillRandomUuid();
  const fromUrl = urlOptions(window.location.search);
  const mock = createDecaidMock({ ...fromUrl, ...options.mock, speed: options.speed ?? options.mock?.speed ?? fromUrl.speed ?? 1 });
  const worker = setupWorker(...mock.handlers, ...(options.extraHandlers ?? []), ...mock.fallback);
  await worker.start({
    serviceWorker: { url: './mockServiceWorker.js' },
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
  const idleFrameMs = options.idleFrameMs ?? 1000;
  if (idleFrameMs > 0) mock.player.startIdleFrames(idleFrameMs);

  const handle: CafaiMockHandle = {
    state: mock.state,
    player: mock.player,
    setSpeed: (speed) => mock.player.setSpeed(speed),
  };
  (window as CafaiMockWindow).__CAFAI_MOCK__ = handle;
  return { ...handle, worker };
}
