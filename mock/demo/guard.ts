/**
 * The demo's guard: it never replaces someone's real data (D76).
 *
 * The demo writes only to an address with no CafAI data, or with data the
 * demo wrote itself: after a successful seed it leaves a marker in
 * localStorage, and a later load under that marker seeds again, replacing
 * whatever the viewer added in the demo. "CafAI data" is any bag, version,
 * iteration or conversation, a saved settings record, or an API key other
 * than the demo's placeholder.
 *
 * Under the marker, one thing still stops the seed: an API key the scripted
 * coach does not know. The demo never needs a real key, so one at this
 * address means someone has used it for real since (with a real Decaid and
 * the real coach), and their bags are no longer the demo's to replace.
 */
import { CAFAI_DB_NAME, createDbHandle, DATA_STORES, openCafaiDb, SETTINGS_KEY } from '../../src/storage/db.ts';
import { openSecretStore, SECRETS_DB_NAME } from '../../src/storage/secrets.ts';
import { DEMO_API_KEY } from './story.ts';

/** Set after a successful seed; its own prefix keeps it apart from CafAI's `cafai.*` and the mock's `cafai-mock:` keys. */
export const DEMO_MARKER_KEY = 'cafai-demo:seeded';

export const GUARD_NOTE =
  'The demo did not load: this address already has CafAI data of its own. Run npm run demo, which opens its own address (localhost:5175).';

/** The keys the scripted coach knows (mock/anthropic/scenario.ts): the demo's placeholder and the two that show its errors. */
export const MOCK_API_KEYS: readonly string[] = [DEMO_API_KEY, 'sk-ant-invalid', 'sk-ant-overloaded'];

/** Where CafAI keeps its data; tests use their own names. */
export interface DemoDbNames {
  dbName?: string;
  secretsDbName?: string;
}

/** What this address holds, as far as the guard cares. */
export interface StoredData {
  /** Bags, versions, iterations and conversations, counted together. */
  records: number;
  /** A settings record is saved (CafAI writes one when a bag opens or Settings saves). */
  settings: boolean;
  apiKey: string | null;
}

export type GuardVerdict = { seed: true } | { seed: false; reason: string };

/** Read what CafAI stores at this address, through its own database schema, and close again. */
export async function readStoredData(names: DemoDbNames = {}): Promise<StoredData> {
  const handle = createDbHandle((onLost) => openCafaiDb(names.dbName ?? CAFAI_DB_NAME, onLost));
  let records = 0;
  let settings = false;
  try {
    const db = await handle.get();
    for (const store of DATA_STORES) {
      if (store === 'settings') settings = (await db.get('settings', SETTINGS_KEY)) !== undefined;
      else records += await db.count(store);
    }
  } finally {
    handle.close();
  }
  const secrets = await openSecretStore(names.secretsDbName ?? SECRETS_DB_NAME);
  try {
    return { records, settings, apiKey: await secrets.getApiKey() };
  } finally {
    secrets.close();
  }
}

/** Whether the demo may replace what this address holds. */
export function judge(data: StoredData, marked: boolean): GuardVerdict {
  if (marked) {
    if (data.apiKey !== null && !MOCK_API_KEYS.includes(data.apiKey)) {
      return { seed: false, reason: 'an API key the demo does not use is stored here' };
    }
    return { seed: true };
  }
  if (data.records > 0) return { seed: false, reason: 'bags or chats are stored here' };
  if (data.settings) return { seed: false, reason: 'settings are saved here' };
  if (data.apiKey !== null && data.apiKey !== DEMO_API_KEY) return { seed: false, reason: 'an API key is stored here' };
  return { seed: true };
}

export function isMarked(storage: Pick<globalThis.Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(DEMO_MARKER_KEY) !== null;
  } catch {
    // Storage blocked: no marker can be read, so nothing counts as the demo's.
    return false;
  }
}

export function markSeeded(storage: Pick<globalThis.Storage, 'setItem'>, atMs: number): void {
  storage.setItem(DEMO_MARKER_KEY, JSON.stringify({ seededAt: new Date(atMs).toISOString() }));
}

/** The page a note goes on: plain DOM, outside the React root. */
export type NoteDocument = Pick<Document, 'createElement' | 'body'>;

/** A dismissible note at the bottom of the page, from mock code (the app itself knows nothing of the demo). */
export function showGuardNote(document: NoteDocument): HTMLElement {
  const note = document.createElement('div');
  note.setAttribute('role', 'status');
  note.style.cssText = [
    'position:fixed',
    'left:12px',
    'bottom:12px',
    'z-index:1500',
    'max-width:min(560px, calc(100% - 24px))',
    'box-sizing:border-box',
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:8px 8px 8px 16px',
    'border-radius:8px',
    'border:1px solid rgba(239, 230, 220, 0.3)',
    'background:#2b231d',
    'color:#efe6dc',
    'font:16px/1.4 Roboto, sans-serif',
    'box-shadow:0 4px 16px rgba(0, 0, 0, 0.5)',
  ].join(';');
  const text = document.createElement('span');
  text.textContent = GUARD_NOTE;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.style.cssText =
    'flex:none;min-width:48px;min-height:48px;border:0;border-radius:24px;background:transparent;color:inherit;font-size:24px;cursor:pointer';
  dismiss.addEventListener('click', () => note.remove());
  note.append(text, dismiss);
  document.body.append(note);
  return note;
}
