/**
 * The mock Decaid for Vitest (Node): an MSW server plus the state handle.
 *
 *   const mock = createMockServer();
 *   beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
 *   afterEach(() => mock.reset());   // optional: fresh state per test
 *   afterAll(() => mock.close());
 *
 * Requests to any host on port 8080 hit the mock; global fetch and
 * WebSocket are intercepted, so the real client and telemetry store run
 * unchanged against it.
 */
import './nodeListeners.ts';
import { setupServer, type SetupServer } from 'msw/node';
import { createDecaidMock, type CreateDecaidMockOptions, type MockHandler } from './decaid/index.ts';
import type { MockDecaid } from './decaid/state.ts';
import type { ShotPlayer } from './decaid/shotPlayer.ts';

export interface MockServer {
  server: SetupServer;
  state: MockDecaid;
  player: ShotPlayer;
  setSpeed(speed: number): void;
  /** Stop the player and close the server. */
  close(): void;
}

export function createMockServer(extraHandlers: MockHandler[] = [], options: CreateDecaidMockOptions = {}): MockServer {
  const mock = createDecaidMock(options);
  const server = setupServer(...mock.handlers, ...extraHandlers, ...mock.fallback);
  return {
    server,
    state: mock.state,
    player: mock.player,
    setSpeed: (speed) => mock.player.setSpeed(speed),
    close() {
      mock.player.dispose();
      server.close();
    },
  };
}
