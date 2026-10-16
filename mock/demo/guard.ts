/**
 * The demo's guard: it never replaces someone's real data (D76).
 *
 * The demo writes only to an address with no CafAI data, or with data the
 * demo wrote itself: after a successful seed it leaves a marker in
 * localStorage, and a later load under that marker seeds again, replacing
 * whatever the viewer added in the demo. "CafAI data" is any bag, version,
 * iteration or conversation, a step of machine care someone marked done, a
 * saved settings record, or an API key other than the demo's placeholder.
 * The care records CafAI makes by itself the first time it opens (D-CARE-8)
 * are not: they hold nothing anyone did.
 *
 * Under the marker, one thing still stops the seed: an API key the scripted
 * coach does not know. The demo never needs a real key, so one at this
 * address means someone has used it for real since (with a real Decaid and
 * the real coach), and their bags are no longer the demo's to replace.
 */
import { CAFAI_DB_NAME, createDbHandle, DATA_STORES, openCafaiDb, SETTINGS_KEY } from '../../src/storage/db.ts';
import { openSecretStore, SECRETS_DB_NAME } from '../../src/storage/secrets.ts';
import { TID } from '../../src/ui/testIds.ts';
import { DEMO_API_KEY } from './story.ts';

/** Set after a successful seed; its own prefix keeps it apart from CafAI's `cafai.*` and the mock's `cafai-mock:` keys. */
export const DEMO_MARKER_KEY = 'cafai-demo:seeded';

/** Short enough for one line beside its button on the smallest tablet layout (962 px). */
export const GUARD_NOTE = 'The demo did not load: this address already has CafAI data of its own. Run npm run demo.';

/** The note's one line, so the app keeps nearly all its height. */
export const GUARD_NOTE_HEIGHT_PX = 34;

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
      else if (store === 'care') records += (await db.getAll('care')).filter((record) => record.doneAt !== null).length;
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
export type NoteDocument = Pick<Document, 'createElement' | 'body' | 'head'>;

/**
 * A dismissible note across the top of the page, from mock code (the app
 * itself knows nothing of the demo). It covers nothing: the app's frame
 * (AppShell, fixed over the whole page) moves down by the note's height
 * until the note is dismissed, the way the app's own engine warning pushes
 * the columns down instead of covering a control. Over the page's bottom it
 * hid half of the chat's composer, and on Settings the grinder field.
 *
 * One slim line of a fixed height: with its text wrapped it took 76 px at
 * 962x602, which shrank the machine panel's graph until its legend lost its
 * "target" entry. A window too narrow for the text cuts it, with the whole
 * text on hover, rather than taking more of the app's height.
 */
export function showGuardNote(document: NoteDocument): HTMLElement {
  const note = document.createElement('div');
  note.setAttribute('role', 'status');
  note.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:1500',
    'box-sizing:border-box',
    `height:${GUARD_NOTE_HEIGHT_PX}px`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'padding:0 8px 0 16px',
    'border-bottom:1px solid rgba(239, 230, 220, 0.3)',
    'background:#2b231d',
    'color:#efe6dc',
    'font:14px/20px Roboto, sans-serif',
  ].join(';');
  const text = document.createElement('span');
  text.textContent = GUARD_NOTE;
  text.title = GUARD_NOTE;
  text.style.cssText = 'flex:0 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.style.cssText =
    'flex:none;height:26px;padding:0 12px;border:1px solid rgba(239, 230, 220, 0.5);border-radius:13px;background:transparent;color:inherit;font:inherit;font-weight:500;cursor:pointer';
  note.append(text, dismiss);

  // The room the note takes at the top: its one line.
  const room = document.createElement('style');
  room.textContent = `[data-testid="${TID.appReady}"]{top:${GUARD_NOTE_HEIGHT_PX}px !important}`;
  dismiss.addEventListener('click', () => {
    room.remove();
    note.remove();
  });
  document.head.append(room);
  document.body.append(note);
  return note;
}
