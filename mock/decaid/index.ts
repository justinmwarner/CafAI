/**
 * The mock Decaid: state, player and MSW handlers in one place.
 */
import type { HttpHandler, WebSocketHandler } from 'msw';
import { decaidFallbackHandlers, decaidHttpHandlers } from './handlers.ts';
import { createShotPlayer, type ShotPlayer } from './shotPlayer.ts';
import { createMockDecaid, type MockDecaid, type MockDecaidOptions } from './state.ts';
import { decaidWsHandlers } from './ws.ts';

export type MockHandler = HttpHandler | WebSocketHandler;

export interface MockDecaidSetup {
  state: MockDecaid;
  player: ShotPlayer;
  /** Decaid's REST and WebSocket handlers. */
  handlers: MockHandler[];
  /** The plain-text 404 for unknown :8080 routes; register after any extra handlers. */
  fallback: MockHandler[];
}

export interface CreateDecaidMockOptions extends MockDecaidOptions {
  /** Wall-clock compression for shots and machine activities (default 1). */
  speed?: number;
}

export function createDecaidMock(options: CreateDecaidMockOptions = {}): MockDecaidSetup {
  const state = createMockDecaid(options);
  const player = createShotPlayer(state, { speed: options.speed ?? 1 });
  return {
    state,
    player,
    handlers: [...decaidHttpHandlers(state, player), ...decaidWsHandlers(state)],
    fallback: decaidFallbackHandlers(),
  };
}

export { createMockDecaid, createShotPlayer, decaidFallbackHandlers, decaidHttpHandlers, decaidWsHandlers };
export type { MockDecaid, MockDecaidOptions, ShotPlayer };
export type { MockChannel, MockFault, MockRequestLog } from './state.ts';
export { DECAID_ORIGIN_PATTERN, MACHINE_STATES } from './handlers.ts';
export { WS_CHANNEL_PATHS } from './ws.ts';
export { createShotSimulation, FRAME_MS, type ShotSimulationInput, type SimFrame } from './shotPlayer.ts';
export { normalizeProfile, profileHash, metadataHash, compoundHash } from './profiles.ts';
export { DEFAULT_UPLOAD_MS, sameProfile } from './machine.ts';
export { MOCK_GRINDER_IDS, seedGrinders, type GrinderRecord } from './grinders.ts';
export { DRIFT_RENAMED_READING, sentMachineFrame, type RenamedReading } from './drift.ts';
export { mockOptionsFromUrl } from './urlOptions.ts';
