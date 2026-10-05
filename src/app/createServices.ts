/**
 * The composition root: builds every service once, in dependency order.
 */
import {
  createDecaidClient,
  createHeartbeat,
  createTelemetryStore,
  defaultGatewayOrigin,
  detectHost,
} from '../api/index.ts';
import { DEFAULT_MODEL, MODELS } from '../llm/index.ts';
import { createIdbStorage, restoreFromMirrorIfEmpty } from '../storage/index.ts';
import { newId } from '../util/id.ts';
import { createApiPort, createCoachPort, createLlmPort } from './adapters.ts';
import { createCoachEngine, type CoachEngine } from './engine/engine.ts';
import type { Services } from './types.ts';

export const APP_VERSION: string = typeof __CAFAI_VERSION__ === 'string' ? __CAFAI_VERSION__ : '0.0.0';

export interface AppServices extends Services {
  coach: CoachEngine;
  dispose(): void;
}

export async function createServices(win: Window): Promise<AppServices> {
  const decaid = createDecaidClient({ origin: defaultGatewayOrigin(win) });
  const host = detectHost(win);
  const telemetry = createTelemetryStore({ client: decaid, wsOrigin: decaid.wsOrigin });
  const heartbeat = createHeartbeat(decaid);

  const storage = await createIdbStorage({ kv: decaid.kv, appVersion: APP_VERSION, defaultModel: DEFAULT_MODEL });
  // Browser storage can be lost (a temporary origin, a reinstall): bring the
  // non-secret records back from Decaid's key-value backup before anything reads them.
  await restoreFromMirrorIfEmpty(storage);

  const coach = createCoachEngine({
    storage,
    telemetry,
    api: createApiPort(decaid),
    coach: createCoachPort(),
    llm: createLlmPort(storage.secrets),
    clock: { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    newId,
    visibility: {
      visible: () => win.document.visibilityState !== 'hidden',
      subscribe(listener) {
        win.document.addEventListener('visibilitychange', listener);
        return () => win.document.removeEventListener('visibilitychange', listener);
      },
    },
  });

  telemetry.start();
  await coach.start();

  // Backgrounding can unload the page after ten minutes: back up on the way out.
  const onVisibility = () => {
    if (win.document.visibilityState === 'hidden') void storage.mirror.pushNow();
  };
  win.document.addEventListener('visibilitychange', onVisibility);

  return {
    decaid,
    telemetry,
    heartbeat,
    host,
    storage,
    coach,
    models: MODELS,
    appVersion: APP_VERSION,
    dispose() {
      win.document.removeEventListener('visibilitychange', onVisibility);
      coach.dispose();
      telemetry.stop();
    },
  };
}
