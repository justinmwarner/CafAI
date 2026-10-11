/**
 * What Decaid's optional plugins leave for CafAI to read (D103): DYE2's
 * setups and kit, and the shot visualizer.reaplugin uploaded last.
 *
 * These are the plugins' own payloads, not Decaid's API, so they live here
 * and not in types.ts, and are read leniently: a shape CafAI does not expect
 * is reported as drift and read as nothing, never a crash. CafAI only reads
 * them; it never writes a plugin's data (.ref/dye2/docs/KV_CONTRACT.md: DYE2
 * is the single writer of its keys).
 */
import { reportDrift } from './drift.ts';
import { describeValue } from './frames.ts';
import { PLUGIN } from './plugins.ts';

/** The reads a plugin's data takes through Decaid. */
export interface PluginReads {
  /** GET /api/v1/store/{namespace}/{key}: null when the key holds nothing. Throws when Decaid cannot be read. */
  readStore(namespace: string, key: string): Promise<unknown>;
  /** GET /api/v1/plugins/{id}/{endpoint} of a loaded plugin. Throws when it fails. */
  getPluginEndpoint(pluginId: string, endpoint: string): Promise<unknown>;
}

/** One setup DYE2 recorded: a recent or saved favourite (its snapshot), or a recipe (its dashboard values). */
export interface Dye2Setup {
  kind: 'recent' | 'favourite' | 'recipe';
  beanBatchId: string | null;
  /** A recipe names a bean of Decaid's library, not a batch. */
  beanId: string | null;
  coffeeName: string | null;
  coffeeRoaster: string | null;
  profileTitle: string | null;
  grindSetting: string | null;
  doseG: number | null;
  yieldG: number | null;
  rpm: number | null;
  basket: string | null;
  /** When DYE2 captured it, as DYE2 wrote it. */
  capturedAt: string | null;
}

/** DYE2's setups and the names of the kit it knows. */
export interface Dye2Data {
  setups: Dye2Setup[];
  equipment: string[];
  baskets: string[];
}

type Item = Record<string, unknown>;

const isItem = (value: unknown): value is Item => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A number, or one written as text ("18.5"). */
function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const written = text(value);
  return written !== null && Number.isFinite(Number(written)) ? Number(written) : null;
}

/** A grind setting as DYE2 keeps it: text, or a number. */
function setting(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
}

const DYE2_KEYS = ['autoFavourites', 'recipes', 'equipment', 'baskets'] as const;
const storeSource = (namespace: string, key: string) => `GET /api/v1/store/${namespace}/${key}`;
const RECENT_FAVS = `GET /api/v1/plugins/${PLUGIN.dye2}/recent-favs`;

/** A value that should be a list of objects: nothing stored reads as empty; anything else is reported and read as empty. */
function items(value: unknown, source: string, problem = 'value'): Item[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    reportDrift(source, `${problem}: ${describeValue(value, 'list')}`);
    return [];
  }
  const objects = value.filter(isItem);
  if (objects.length < value.length) reportDrift(source, 'item: not an object');
  return objects;
}

/** Favourites, recent or saved: what each snapshot recorded. */
function favourites(list: Item[], source: string): Dye2Setup[] {
  return list.flatMap((item) => {
    const snapshot = item.snapshot;
    if (!isItem(snapshot)) {
      reportDrift(source, 'snapshot: missing');
      return [];
    }
    return [
      {
        kind: item.auto === true ? ('recent' as const) : ('favourite' as const),
        beanBatchId: text(snapshot.beanBatchId),
        beanId: null,
        coffeeName: text(snapshot.coffeeName),
        coffeeRoaster: text(snapshot.coffeeRoaster),
        profileTitle: text(snapshot.profileTitle),
        grindSetting: setting(snapshot.grindSetting),
        doseG: number(snapshot.dose),
        yieldG: number(snapshot.drink),
        rpm: number(snapshot.rpm),
        basket: text(snapshot.basketName),
        capturedAt: text(item.capturedAt),
      },
    ];
  });
}

function recipes(list: Item[]): Dye2Setup[] {
  return list.map((item) => {
    const values = isItem(item.dashboardVariables) ? item.dashboardVariables : {};
    return {
      kind: 'recipe' as const,
      beanBatchId: null,
      beanId: text(item.beanId),
      coffeeName: text(item.beanName),
      coffeeRoaster: null,
      profileTitle: text(item.profileTitle),
      grindSetting: setting(values.grind),
      doseG: number(values.dose),
      yieldG: number(values.drink),
      rpm: number(values.rpm),
      basket: text(values.basketName),
      capturedAt: text(item.capturedAt),
    };
  });
}

const names = (list: Item[]) => list.flatMap((item) => text(item.name) ?? []);

/**
 * DYE2's setups and kit (6.5). While DYE2 is loaded its recent setups come
 * fresh from its recent-favs endpoint (which recomputes them from the shot
 * history); otherwise, or when that fails, from the copy it keeps in Decaid's
 * key-value store. Saved favourites, recipes, equipment and baskets are only
 * in the store. Null without DYE2: not loaded, and none of its keys hold
 * anything. Throws when Decaid's store cannot be read.
 */
export async function readDye2(reads: PluginReads, loaded: boolean): Promise<Dye2Data | null> {
  const [fresh, ...stored] = await Promise.all([
    loaded ? reads.getPluginEndpoint(PLUGIN.dye2, 'recent-favs').catch(() => undefined) : undefined,
    ...DYE2_KEYS.map((key) => reads.readStore(PLUGIN.dye2, key)),
  ]);
  const [storedFavourites, storedRecipes, equipment, baskets] = stored;
  if (!loaded && stored.every((value) => value === null || value === undefined)) return null;
  const source = (key: (typeof DYE2_KEYS)[number]) => storeSource(PLUGIN.dye2, key);
  const kept = favourites(items(storedFavourites, source('autoFavourites')), source('autoFavourites'));
  let recent = kept.filter((setup) => setup.kind === 'recent');
  if (fresh !== undefined) {
    if (Array.isArray(fresh)) recent = favourites(items(fresh, RECENT_FAVS), RECENT_FAVS);
    else reportDrift(RECENT_FAVS, `reply: ${describeValue(fresh, 'list')}`);
  }
  return {
    setups: [...recent, ...kept.filter((setup) => setup.kind !== 'recent'), ...recipes(items(storedRecipes, source('recipes')))],
    equipment: names(items(equipment, source('equipment'))),
    baskets: names(items(baskets, source('baskets'))),
  };
}

const VISUALIZER_ORIGIN = 'https://visualizer.coffee';
/** A shot's page on Visualizer, and nothing else: a stored link can only lead there. */
const VISUALIZER_SHOT_URL = /^https:\/\/visualizer\.coffee\/shots\/[A-Za-z0-9._~%-]+$/;

/**
 * Visualizer's id for `shotId` once visualizer.reaplugin uploaded it (6.4):
 * its lastUploadedShot names the shot (Decaid's local id), and
 * lastVisualizerId, written with it, is Visualizer's id for it
 * (rememberSuccessfulUpload, plugin.js). Null until then. Throws when
 * Decaid cannot be read.
 */
export async function visualizerIdFor(reads: Pick<PluginReads, 'readStore'>, shotId: string): Promise<string | null> {
  const last = await reads.readStore(PLUGIN.visualizer, 'lastUploadedShot');
  if (last === null || last === undefined) return null;
  if (typeof last !== 'string') {
    reportDrift(storeSource(PLUGIN.visualizer, 'lastUploadedShot'), `value: ${describeValue(last, 'string')}`);
    return null;
  }
  if (last !== shotId) return null;
  const id = await reads.readStore(PLUGIN.visualizer, 'lastVisualizerId');
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  if (typeof id === 'string' && id.trim() !== '') return id.trim();
  if (id !== null && id !== undefined) reportDrift(storeSource(PLUGIN.visualizer, 'lastVisualizerId'), `value: ${describeValue(id, 'string')}`);
  return null;
}

/** The shot's page on Visualizer: the plugin's own API path for it (/api/shots/<id>) without /api. */
export function visualizerShotUrl(visualizerId: string): string {
  return `${VISUALIZER_ORIGIN}/shots/${encodeURIComponent(visualizerId)}`;
}

export function isVisualizerShotUrl(value: unknown): value is string {
  return typeof value === 'string' && VISUALIZER_SHOT_URL.test(value);
}
