/**
 * The four plugins CafAI knows about, for the mock's GET /api/v1/plugins
 * (D3): the manifest fields each plugin's manifest.json carries (under
 * `.ref/decaid/assets/plugins/`), plus the load-state fields PluginsHandler
 * adds (af4e995: lib/src/services/webserver/plugins_handler.dart addRoutes
 * '/api/v1/plugins'): `loaded`, `autoLoad`, `source` and `pendingUpdate`.
 * `dye2.reaplugin` is a third-party plugin (`.ref/dye2`), not bundled with
 * Decaid, but the mock always lists it installed, matching a tester's Decaid
 * that has it added.
 */
import type { PluginInfo } from '../../src/api/types.ts';

export const PLUGIN_IDS = {
  timeToReady: 'time-to-ready.reaplugin',
  visualizer: 'visualizer.reaplugin',
  dye2: 'dye2.reaplugin',
  settings: 'settings.reaplugin',
} as const;

/** Every id the mock lists, loaded by default. */
export const ALL_PLUGIN_IDS: readonly string[] = Object.values(PLUGIN_IDS);

interface PluginManifestSeed {
  id: string;
  author: string;
  name: string;
  description: string;
  version: string;
  apiVersion: number;
  permissions: string[];
  settings: Record<string, unknown>;
  api: Array<Record<string, unknown>>;
}

const MANIFESTS: readonly PluginManifestSeed[] = [
  {
    id: PLUGIN_IDS.timeToReady,
    author: 'Decent Espresso',
    name: 'Time To Ready',
    description: "Examines current machine state and reports estimated time until it's ready for brewing",
    version: '1.0.4',
    apiVersion: 1,
    permissions: ['log', 'emit', 'pluginStorage', 'events.machine'],
    settings: {
      Stabilisation: {
        type: 'number',
        label: 'Stabilisation time',
        description: 'Time in minutes after machine has heated up, to be considered truly ready. Only shown here as example',
      },
    },
    api: [
      {
        id: 'timeToReady',
        type: 'websocket',
        data: {
          remainingTimeMs: { type: 'number', description: 'number of milliseconds estimated until the machine is ready to brew.' },
          heatingRate: { type: 'number', description: 'The rade at which the machine is heating up.' },
          status: { type: 'enum', values: ['reached', 'insufficient_data', 'not_heating', 'heating'], description: 'current plugin heating state' },
        },
        message: { type: 'string', description: 'The estimate to the machine being heated up, in human readable form' },
      },
    ],
  },
  {
    id: PLUGIN_IDS.visualizer,
    author: 'Decent Espresso',
    name: 'Visualizer upload',
    description: 'Uploads shots to Visualizer and syncs your edited shot metadata back',
    version: '1.5.11',
    apiVersion: 1,
    permissions: ['log', 'api', 'emit', 'pluginStorage', 'events.machine', 'events.shots'],
    settings: {
      Username: { type: 'string', label: 'Visualizer username', description: 'Visualiser username' },
      Password: { type: 'string', label: 'Visualizer password', secure: true, description: 'Visualiser password' },
      AutoUpload: { type: 'boolean', label: 'Upload shots automatically', description: 'Upload shots automatically', default: true },
      LengthThreshold: { type: 'number', label: 'Minimum shot length', description: 'Only upload shots that are longer than the threshold (in seconds)', default: 5 },
      BackSync: {
        type: 'boolean',
        label: 'Sync edits back from Visualizer',
        description: 'Sync metadata you edit on Visualizer (notes, TDS, EY, enjoyment, bean/grinder) back onto your local shots. Only your own uploaded shots are touched.',
        default: false,
      },
      BackSyncIntervalSeconds: { type: 'number', label: 'Back-sync check interval', description: 'How often to check Visualizer for back-sync changes (in seconds, minimum 60)', default: 300 },
    },
    api: [
      { id: 'status', type: 'http', data: {} },
      { id: 'upload', type: 'http', data: { shotId: { type: 'string' }, description: 'Send POST with shotID to upload in body' } },
      { id: 'verifyCredentials', type: 'http', data: { username: { type: 'string' }, password: { type: 'string' } } },
      { id: 'lastUpload', type: 'http', data: { reaId: { type: 'string', description: 'Last Decent shot id' }, visId: { type: 'string', description: 'Last Visualizer uploaded shot id' } } },
      { id: 'import', type: 'http', data: { shareCode: { type: 'string', description: '4-digit share code from visualizer.coffee' } } },
      { id: 'backSyncNow', type: 'http', data: { description: 'POST to run a Visualizer back-sync immediately' } },
      { id: 'backSyncStatus', type: 'http', data: { description: 'Last back-sync result, applied count, cursor and any error' } },
      { id: 'forwardSyncStatus', type: 'http', data: { description: 'Last forward-sync result and any error' } },
      { id: 'forwardSyncNow', type: 'http', data: { shotId: { type: 'string', description: 'Local shot id to sync to Visualizer' } } },
    ],
  },
  {
    id: PLUGIN_IDS.dye2,
    author: 'Streamline',
    name: 'Streamline/DYE2',
    description:
      'Beans, grinders, and shot workflow for Decent Espresso. Track roast batches and freshness, pick a bean and grinder before pulling, edit and rate shots afterwards, and manage auto-favourite recipes. Dashboard: http://localhost:8080/api/v1/plugins/dye2.reaplugin/dashboard',
    version: '0.1.19',
    apiVersion: 1,
    permissions: ['log', 'api', 'emit', 'pluginStorage', 'events.shots'],
    settings: {},
    api: [
      { id: 'dashboard', type: 'http', data: {} },
      { id: 'grinders', type: 'http', data: {} },
      { id: 'baskets', type: 'http', data: {} },
      { id: 'equipment', type: 'http', data: {} },
      { id: 'grinder-picker', type: 'http', data: {} },
      { id: 'basket-picker', type: 'http', data: {} },
      { id: 'bean-picker', type: 'http', data: {} },
      { id: 'roasters', type: 'http', data: {} },
      { id: 'add-bean', type: 'http', data: {} },
      { id: 'profile-picker', type: 'http', data: {} },
      { id: 'edit-shot', type: 'http', data: {} },
      { id: 'auto-favs', type: 'http', data: {} },
      { id: 'auto-fav-edit', type: 'http', data: {} },
      { id: 'recipe-edit', type: 'http', data: {} },
      { id: 'bc-import', type: 'http', data: {} },
      { id: 'recent-favs', type: 'http', data: {} },
      { id: 'plotly', type: 'http', data: {} },
    ],
  },
  {
    id: PLUGIN_IDS.settings,
    author: 'Decent Espresso',
    name: 'Settings Viewer',
    description: 'Displays Decent application and machine settings in an embeddable HTML page. http://localhost:8080/api/v1/plugins/settings.reaplugin/ui',
    version: '0.1.8',
    apiVersion: 1,
    permissions: ['log', 'api'],
    settings: {
      RefreshInterval: { type: 'number', label: 'Auto-refresh interval', description: 'Auto-refresh interval in seconds (0 to disable)', default: 5 },
    },
    api: [{ id: 'ui', type: 'http', data: { body: { type: 'string', description: 'Returns an HTML page displaying current Decent app and DE1 settings' } } }],
  },
];

/** GET /api/v1/plugins: every manifest, with `loaded` true for the ids in `loaded`. */
export function listPluginInfos(loaded: ReadonlySet<string>): PluginInfo[] {
  return MANIFESTS.map((manifest) => ({
    ...manifest,
    loaded: loaded.has(manifest.id),
    autoLoad: loaded.has(manifest.id),
    source: null,
    pendingUpdate: null,
  }));
}

export function pluginExists(id: string): boolean {
  return MANIFESTS.some((manifest) => manifest.id === id);
}
