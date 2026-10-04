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
 *   await page.evaluate(() => window.__CAFAI_MOCK__.state.getMachineProfile().title);
 *
 * URL switches, read once at start (mock/decaid/urlOptions.ts):
 *   ?mockSpeed=N            wall-clock compression of shots and activities
 *   ?mockMachine=0          start with the machine disconnected
 *   ?mockScale=0            start with the scale disconnected
 *   ?mockGhc=1              shots start on the machine (group-head controller)
 *   ?mockExamples=0         no example shot or example CafAI profile
 *   ?mockUploadMs=N         the machine takes a new profile N ms after a
 *                           workflow PUT (default 800; wall clock, not scaled
 *                           by mockSpeed; 0 is at once)
 *   ?mockNoMachineProfile=1 POST /api/v1/machine/profile answers 404 "Route
 *                           not found", like an older Decaid
 *   ?mockGrinders=0         Decaid's grinder library starts empty (by default
 *                           it holds three test grinders)
 */
import { setupWorker, type SetupWorker } from 'msw/browser';
import { createDecaidMock, type MockHandler, type CreateDecaidMockOptions } from './decaid/index.ts';
import type { MockDecaid } from './decaid/state.ts';
import type { ShotPlayer } from './decaid/shotPlayer.ts';
import { mockOptionsFromUrl } from './decaid/urlOptions.ts';

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
  const fromUrl = mockOptionsFromUrl(window.location.search);
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
