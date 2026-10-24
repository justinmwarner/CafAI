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
import { createDisplayChannel } from '../api/display.ts';
import { createPluginDirectory, watchPlugins } from '../api/plugins.ts';
import { createToldList } from '../coach/facts/told.ts';
import { DEFAULT_MODEL, MODELS } from '../llm/index.ts';
import { KNOWN_MODELS } from '../llm/models.ts';
import { createBudgetNotes } from '../spend/budget.ts';
import { openSpendService } from '../spend/service.ts';
import { createIdbStorage, restoreFromMirrorIfEmpty, startLateRestore } from '../storage/index.ts';
import { openCoachSourceStore } from '../storage/coachSource.ts';
import { createCoachSourceBackup } from '../storage/coachSourceBackup.ts';
import { rememberSecret } from '../traffic/recorder.ts';
import { clarityProjectId } from '../usage/projectId.ts';
import { createUsageService } from '../usage/service.ts';
import { newId } from '../util/id.ts';
import { createApiPort, createCoachPort, createLlmPort } from './adapters.ts';
import { createAppearanceStore } from './appearance.ts';
import { createCareService, localTotalsCache } from './care/careService.ts';
import { withCoachCredential } from './coachAccess.ts';
import { createCoachEngine, type CoachEngine } from './engine/engine.ts';
import { createDisplayPrefsStore } from './displayPrefs.ts';
import { createDrinkScreensStore } from './drinkScreens.ts';
import { createSaverScreen } from './saverScreen.ts';
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
  // Where the coach runs: Anthropic, or CafAI Bridge on the user's computer. This device's, like the key.
  // Storage that refuses it leaves the coach on Anthropic rather than stopping CafAI.
  const coachSource = await openCoachSourceStore().catch(() => undefined);
  // Its copy in Decaid, unless the user turned that off (D229, D230: on while unset): a Decaid update that
  // moves CafAI to a new origin leaves this device's storage behind, and the copy brings where the coach runs back.
  const coachSourceBackup = coachSource
    ? createCoachSourceBackup(decaid.kv, coachSource, coachSource.copyState, {
        read: async () => (await storage.settings.get()).keepCoachSourceInDecaid ?? true,
        write: async (on) => {
          await storage.settings.update({ keepCoachSourceInDecaid: on });
        },
      })
    : undefined;
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
  // is owed has gone out (D99); and where the coach runs from its own copy (D229), which reads no
  // choice: the settings that hold it may be the ones coming back (D230).
  const [restore] = await Promise.all([
    restoreFromMirrorIfEmpty(storage),
    storage.keyBackup.restoreIfMissing(),
    coachSourceBackup?.restoreIfMissing(),
  ]);

  const appearance = createAppearanceStore(storage.settings, (await storage.settings.get()).appearance);
  // °C or °F (D172): the screens read it, and so does every request's prompt (D175).
  const temperatureUnit = createTemperatureUnitStore(storage.settings, (await storage.settings.get()).temperatureUnit);
  // Each drink's scene and going back by itself (D221): the drinks' views read them.
  const drinkScreens = createDrinkScreensStore(storage.settings, (await storage.settings.get()).drinkScreens);
  // Settings > Screensaver (D225): the overlay over the shell acts on it at once.
  const screensaver = createScreensaverSettingStore(storage.settings, (await storage.settings.get()).screensaver);
  // The clock and the TDS cell's switch (D245, D246): every screen that shows a time or a shot reads them.
  const displayPrefs = createDisplayPrefsStore(storage.settings, await storage.settings.get());

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
  // The tablet's screen while a screensaver shows (D224), through Decaid's display socket: inside Decaid only.
  // A dim left over from a page unloaded while one showed is put back now, so it is never kept as the barista's own.
  const saverScreen = host.insideDecaid
    ? createSaverScreen(createDisplayChannel({ wsOrigin: decaid.wsOrigin, visibility: win.document }), deviceStorage)
    : undefined;
  saverScreen?.restore();
  const care = createCareService({ storage, decaid, telemetry, cache: localTotalsCache(deviceStorage), visibility });
  await care.start();

  // Usage sharing (D210): a build with Clarity's project ID only, and nothing loads before the app has
  // rendered (App.tsx). The answer lives in the device's own storage, like the care counts' cache.
  const clarityProject = clarityProjectId(win);
  const usage = clarityProject
    ? createUsageService({ win, projectId: clarityProject, storage: deviceStorage, now: () => new Date() })
    : undefined;
  usage?.tag('cafai_version', APP_VERSION);
  usage?.tag('host', host.platform ?? 'browser');

  // The coach's usage and cost (D237-D240): every finished request counted per day on this device (cafai-spend,
  // a database of its own) and copied month by month to Decaid's store, so the totals and the budget add every
  // device and an iPad's Decaid update gets the month back. Read from Decaid at start, and when Decaid is back.
  const spend = await openSpendService({ kv: decaid.kv, deviceStorage, models: KNOWN_MODELS });

  const coach = createCoachEngine({
    // Its "is a key stored" means "has what the selected source needs".
    storage: withCoachCredential(storage, coachSource),
    telemetry,
    api: createApiPort(decaid),
    coach: createCoachPort({ temperatureUnit: temperatureUnit.get }),
    llm: createLlmPort(storage.secrets, coachSource, spend),
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
    usage,
    // The month's budget (D240): checked before each reply on the API key, its notices noted on the device.
    spend,
    budgetNotes: createBudgetNotes(deviceStorage),
    coachSource,
  });

  telemetry.start();
  await coach.start();
  void spend.refresh();

  // Which coach this device runs, for Clarity's filters (D213): none until the chosen source has its key or code.
  let sourceKind = (await coachSource?.get().catch(() => null))?.kind ?? 'anthropic';
  const tagCoachSource = () =>
    usage?.tag('coach_source', !coach.getState().hasApiKey ? 'none' : sourceKind === 'computer' ? 'bridge' : 'api-key');
  const stopSourceTag = usage
    ? coachSource?.subscribe((source) => {
        sourceKind = source.kind;
        tagCoachSource();
      })
    : undefined;
  const stopCoachTag = usage ? coach.subscribe(() => tagCoachSource()) : undefined;
  tagCoachSource();

  // Records that came back after start (D100): the chat, the look and machine care read them again.
  // The chat says the bags are back only when bags came back, not for machine care's last times alone (D189).
  const landed = ({ records }: { records: boolean }) => {
    if (records) void coach.restored();
    void appearance.reload();
    void temperatureUnit.reload();
    void displayPrefs.reload();
    void drinkScreens.reload();
    void screensaver.reload();
    void care.reload();
  };
  const stopRestoredWatch = storage.onRestored(landed);
  // Decaid did not answer the start-up restore (it may still be starting up,
  // after an update say): keep trying its backup, and at once when it may be back.
  const late =
    restore === 'unreachable'
      ? startLateRestore(storage, {
          coachSource: coachSourceBackup,
          onRestored({ records, care: careAlone, key, coachSource: sourceBack }) {
            if (records || careAlone) landed({ records });
            if ((key || sourceBack) && !records) void coach.refresh();
          },
        })
      : null;
  // The key's copy in Decaid (D99) and where the coach runs (D229): what Decaid did not take goes out when
  // it may be back, before anything is restored from it, and a key or a source it brings back reaches the coach.
  // While Decaid's backup is still to come back, the late restore's tries sync the source after it (D230).
  const syncSource = () => {
    if (late?.pending()) return;
    void coachSourceBackup?.sync().then((restored) => {
      if (restored) void coach.refresh();
    });
  };
  const syncCopies = () => {
    void storage.keyBackup.restoreIfMissing().then((restored) => {
      if (restored) void coach.refresh();
    });
    syncSource();
  };
  // The settings are back, or were never lost: what the source's copy is owed, a first copy (D229).
  syncSource();
  let machineConnected = telemetry.getState().machineConnected;
  let decaidOpen = telemetry.getState().sockets.devices === 'open';
  const stopTelemetryWatch = telemetry.subscribe(() => {
    const now = telemetry.getState();
    const back = (now.machineConnected && !machineConnected) || (now.sockets.devices === 'open' && !decaidOpen);
    machineConnected = now.machineConnected;
    decaidOpen = now.sockets.devices === 'open';
    if (!back) return;
    late?.retryNow();
    syncCopies();
    void spend.refresh();
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
      syncCopies();
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
    displayPrefs,
    drinkScreens,
    screensaver,
    saverScreen,
    plugins,
    coachSource,
    coachSourceBackup,
    care,
    usage,
    spend,
    dispose() {
      win.document.removeEventListener('visibilitychange', onVisibility);
      stopPluginWatch();
      late?.stop();
      stopTelemetryWatch();
      stopRestoredWatch();
      stopCodeWatch?.();
      stopSourceTag?.();
      stopCoachTag?.();
      usage?.dispose();
      spend.dispose();
      coach.dispose();
      care.dispose();
      saverScreen?.dispose();
      telemetry.stop();
    },
  };
}
