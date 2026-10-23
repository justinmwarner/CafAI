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
import { createPluginDirectory, watchPlugins } from '../api/plugins.ts';
import { createToldList } from '../coach/facts/told.ts';
import { DEFAULT_MODEL, MODELS } from '../llm/index.ts';
import { createIdbStorage, restoreFromMirrorIfEmpty, startLateRestore } from '../storage/index.ts';
import { openCoachSourceStore } from '../storage/coachSource.ts';
import { rememberSecret } from '../traffic/recorder.ts';
import { newId } from '../util/id.ts';
import { createApiPort, createCoachPort, createLlmPort } from './adapters.ts';
import { createAppearanceStore } from './appearance.ts';
import { createCareService, localTotalsCache } from './care/careService.ts';
import { withCoachCredential } from './coachAccess.ts';
import { createCoachEngine, type CoachEngine } from './engine/engine.ts';
import { createScreensaverSettingStore } from './screensaverSetting.ts';
import { createTemperatureUnitStore } from './temperatureUnit.ts';
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
  // Decaid starts its plugins after it serves the skin: read now and keep reading for a while (D103).
  const stopPluginWatch = watchPlugins(plugins, { telemetry });

  const storage = await createIdbStorage({ kv: decaid.kv, appVersion: APP_VERSION, defaultModel: DEFAULT_MODEL });
  // Where the coach runs: Anthropic, or CafAI Bridge on the user's computer. This device only, like the key.
  // Storage that refuses it leaves the coach on Anthropic rather than stopping CafAI.
  const coachSource = await openCoachSourceStore().catch(() => undefined);
  // Settings > Log looks for the key and the bridge's code wherever they show, a chat
  // in a backup read back included, from before the restore on (D139).
  await Promise.all([
    storage.secrets.getApiKey().then(rememberSecret, () => undefined),
    coachSource?.get().then((source) => rememberSecret(source.code), () => undefined),
  ]);
  const stopCodeWatch = coachSource?.subscribe((source) => rememberSecret(source.code));
  // Browser storage can be lost (a temporary origin, a reinstall, a Decaid
  // update): bring the non-secret records back from Decaid's key-value backup
  // before anything reads them, and the API key from its copy in Decaid when
  // the user keeps one there and did not forget it here, once what that copy
  // is owed has gone out (D99).
  const [restore] = await Promise.all([restoreFromMirrorIfEmpty(storage), storage.keyBackup.restoreIfMissing()]);

  const appearance = createAppearanceStore(storage.settings, (await storage.settings.get()).appearance);
  // °C or °F (D172): the screens read it, and so does every request's prompt (D175).
  const temperatureUnit = createTemperatureUnitStore(storage.settings, (await storage.settings.get()).temperatureUnit);
  // Settings > Screensaver (D-SAVER-3): the overlay over the shell acts on it at once.
  const screensaver = createScreensaverSettingStore(storage.settings, (await storage.settings.get()).screensaver);

  // Machine care's steps (D183-D190): read now, counted from Decaid's totals behind the start.
  const visibility = {
    visible: () => win.document.visibilityState !== 'hidden',
    subscribe(listener: () => void) {
      win.document.addEventListener('visibilitychange', listener);
      return () => win.document.removeEventListener('visibilitychange', listener);
    },
  };
  let deviceStorage: globalThis.Storage | null = null;
  try {
    deviceStorage = win.localStorage;
  } catch {
    // Storage blocked: every page counts afresh.
  }
  const care = createCareService({ storage, decaid, telemetry, cache: localTotalsCache(deviceStorage), visibility });
  await care.start();

  const coach = createCoachEngine({
    // Its "is a key stored" means "has what the selected source needs".
    storage: withCoachCredential(storage, coachSource),
    telemetry,
    api: createApiPort(decaid),
    coach: createCoachPort({ temperatureUnit: temperatureUnit.get }),
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
    // The fun facts told, in the device's own storage beside the care counts' cache: never mirrored or exported (D200).
    told: createToldList(deviceStorage),
  });

  telemetry.start();
  await coach.start();

  // Records that came back after start (D100): the chat, the look and machine care read them again.
  // The chat says the bags are back only when bags came back, not for machine care's last times alone (D189).
  const landed = ({ records }: { records: boolean }) => {
    if (records) void coach.restored();
    void appearance.reload();
    void temperatureUnit.reload();
    void screensaver.reload();
    void care.reload();
  };
  const stopRestoredWatch = storage.onRestored(landed);
  // Decaid did not answer the start-up restore (it may still be starting up,
  // after an update say): keep trying its backup, and at once when it may be back.
  const late =
    restore === 'unreachable'
      ? startLateRestore(storage, {
          onRestored({ records, care: careAlone, key }) {
            if (records || careAlone) landed({ records });
            if (key && !records) void coach.refresh();
          },
        })
      : null;
  // The key's copy in Decaid (D99): a copy or delete Decaid did not take goes out when it may be back,
  // before anything is restored from it, and a key it brings back reaches the coach.
  const syncKey = () => {
    void storage.keyBackup.restoreIfMissing().then((restored) => {
      if (restored) void coach.refresh();
    });
  };
  let machineConnected = telemetry.getState().machineConnected;
  let decaidOpen = telemetry.getState().sockets.devices === 'open';
  const stopTelemetryWatch = telemetry.subscribe(() => {
    const now = telemetry.getState();
    const back = (now.machineConnected && !machineConnected) || (now.sockets.devices === 'open' && !decaidOpen);
    machineConnected = now.machineConnected;
    decaidOpen = now.sockets.devices === 'open';
    if (!back) return;
    late?.retryNow();
    syncKey();
  });

  // Backgrounding can unload the page after ten minutes: back up on the way out.
  // Coming back into view can mean a plugin was loaded or unloaded meanwhile,
  // or that Decaid answers again.
  const onVisibility = () => {
    if (win.document.visibilityState === 'hidden') {
      void storage.mirror.pushNow();
    } else {
      void plugins.refresh();
      late?.retryNow();
      syncKey();
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
    temperatureUnit,
    screensaver,
    plugins,
    coachSource,
    care,
    dispose() {
      win.document.removeEventListener('visibilitychange', onVisibility);
      stopPluginWatch();
      late?.stop();
      stopTelemetryWatch();
      stopRestoredWatch();
      stopCodeWatch?.();
      coach.dispose();
      care.dispose();
      telemetry.stop();
    },
  };
}
