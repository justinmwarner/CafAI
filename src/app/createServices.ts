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
import { createPluginDirectory } from '../api/plugins.ts';
import { DEFAULT_MODEL, MODELS } from '../llm/index.ts';
import { createIdbStorage, restoreFromMirrorIfEmpty, startLateRestore } from '../storage/index.ts';
import { openCoachSourceStore } from '../storage/coachSource.ts';
import { newId } from '../util/id.ts';
import { createApiPort, createCoachPort, createLlmPort } from './adapters.ts';
import { createAppearanceStore } from './appearance.ts';
import { withCoachCredential } from './coachAccess.ts';
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
  const plugins = createPluginDirectory(decaid);
  void plugins.refresh();

  const storage = await createIdbStorage({ kv: decaid.kv, appVersion: APP_VERSION, defaultModel: DEFAULT_MODEL });
  // Browser storage can be lost (a temporary origin, a reinstall, a Decaid
  // update): bring the non-secret records back from Decaid's key-value backup
  // before anything reads them, and the API key from its copy in Decaid when
  // the user keeps one there (D99).
  const [restore] = await Promise.all([restoreFromMirrorIfEmpty(storage), storage.keyBackup.restoreIfMissing()]);

  const appearance = createAppearanceStore(storage.settings, (await storage.settings.get()).appearance);
  // Where the coach runs: Anthropic, or CafAI Bridge on the user's computer. This device only, like the key.
  // Storage that refuses it leaves the coach on Anthropic rather than stopping CafAI.
  const coachSource = await openCoachSourceStore().catch(() => undefined);

  const coach = createCoachEngine({
    // Its "is a key stored" means "has what the selected source needs".
    storage: withCoachCredential(storage, coachSource),
    telemetry,
    api: createApiPort(decaid),
    coach: createCoachPort(),
    llm: createLlmPort(storage.secrets, coachSource),
    clock: { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    newId,
    visibility: {
      visible: () => win.document.visibilityState !== 'hidden',
      subscribe(listener) {
        win.document.addEventListener('visibilitychange', listener);
        return () => win.document.removeEventListener('visibilitychange', listener);
      },
    },
    restoredFromBackup: restore === 'restored',
    // DYE2's setups for the coach and the Visualizer link on shot cards, while those plugins run (D103).
    plugins,
  });

  telemetry.start();
  await coach.start();

  // Records that came back after start (D100): the chat and the look read them again.
  const landed = () => {
    void coach.restored();
    void appearance.reload();
  };
  const stopRestoredWatch = storage.onRestored(landed);
  // Decaid did not answer the start-up restore (it may still be starting up,
  // after an update say): keep trying its backup, and at once when it may be back.
  const late =
    restore === 'unreachable'
      ? startLateRestore(storage, {
          onRestored({ records }) {
            if (records) landed();
            else void coach.refresh();
          },
        })
      : null;
  let machineConnected = telemetry.getState().machineConnected;
  let decaidOpen = telemetry.getState().sockets.devices === 'open';
  const stopTelemetryWatch = late
    ? telemetry.subscribe(() => {
        const now = telemetry.getState();
        const back = (now.machineConnected && !machineConnected) || (now.sockets.devices === 'open' && !decaidOpen);
        machineConnected = now.machineConnected;
        decaidOpen = now.sockets.devices === 'open';
        if (back) late.retryNow();
      })
    : () => undefined;

  // Backgrounding can unload the page after ten minutes: back up on the way out.
  // Coming back into view can mean a plugin was loaded or unloaded meanwhile,
  // or that Decaid answers again.
  const onVisibility = () => {
    if (win.document.visibilityState === 'hidden') {
      void storage.mirror.pushNow();
    } else {
      void plugins.refresh();
      late?.retryNow();
    }
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
    appearance,
    plugins,
    coachSource,
    dispose() {
      win.document.removeEventListener('visibilitychange', onVisibility);
      late?.stop();
      stopTelemetryWatch();
      stopRestoredWatch();
      coach.dispose();
      telemetry.stop();
    },
  };
}
