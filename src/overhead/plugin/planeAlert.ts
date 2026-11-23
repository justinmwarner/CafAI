/**
 * plane-alert-db (docs/overhead/DISCOVERY.md, section 7): the civil and the
 * government lists, read with papaparse by the header names the files
 * themselves carry (`$ICAO`, `$Operator`, `Category`, ...), refreshed once a
 * day. The last good copy is kept in plugin storage and used until a newer
 * one reads well: a download that fails, or reads without the columns
 * Overhead needs, changes nothing. An unchanged file is not downloaded
 * again (If-None-Match against GitHub's ETag).
 *
 * Matching is by ICAO address, any case.
 */
import Papa from 'papaparse';
import type { NotableInfo } from '../shared/payload.ts';
import type { PluginDeps } from './host.ts';
import type { PluginKv } from './kv.ts';

export const PLANE_ALERT_BASE = 'https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/main';
export const PLANE_ALERT_FILES = ['plane-alert-civ.csv', 'plane-alert-gov.csv'] as const;
export const REFRESH_EVERY_MS = 24 * 3600_000;
/** Between the two files: one request a second at most to any host (the brief). */
export const BETWEEN_FILES_MS = 1100;
/** After a failed refresh, try again this much later rather than tomorrow. */
export const RETRY_FAILED_MS = 3600_000;
const STORAGE_KEY = 'planeAlert';

/** The columns as the files name them. */
const COLUMN = {
  icao: '$ICAO',
  registration: '$Registration',
  operator: '$Operator',
  type: '$Type',
  icaoType: '$ICAO Type',
  group: '#CMPG',
  tags: ['$Tag 1', '$#Tag 2', '$#Tag 3'],
  category: 'Category',
  link: '$#Link',
} as const;

/** One row, kept compactly: [hex, registration, operator, type, icaoType, group, tags, category, link]. */
type Row = [string, string, string, string, string, string, string[], string, string];

interface StoredFile {
  etag: string | null;
  rows: Row[];
}

interface Stored {
  fetchedAt: number;
  files: Record<string, StoredFile>;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const orNull = (value: string): string | null => (value === '' ? null : value);

/** A file's rows, or null when it lacks the columns needed to match (a changed or broken download). */
export function parsePlaneAlertCsv(csv: string): Row[] | null {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes(COLUMN.icao) || !fields.includes(COLUMN.operator)) return null;
  const rows: Row[] = [];
  for (const record of parsed.data) {
    const hex = clean(record[COLUMN.icao]).toLowerCase();
    const operator = clean(record[COLUMN.operator]);
    if (!/^[0-9a-f]{6}$/.test(hex) || operator === '') continue;
    rows.push([
      hex,
      clean(record[COLUMN.registration]),
      operator,
      clean(record[COLUMN.type]),
      clean(record[COLUMN.icaoType]),
      clean(record[COLUMN.group]),
      COLUMN.tags.map((tag) => clean(record[tag])).filter((tag) => tag !== ''),
      clean(record[COLUMN.category]),
      clean(record[COLUMN.link]),
    ]);
  }
  return rows;
}

function toInfo(row: Row): NotableInfo {
  const [, registration, operator, type, icaoType, group, tags, category, link] = row;
  return {
    operator,
    registration: orNull(registration),
    type: orNull(type),
    icaoType: orNull(icaoType),
    category: orNull(category),
    group: orNull(group),
    tags,
    link: /^https?:\/\//.test(link) ? link : null,
  };
}

export interface PlaneAlert {
  /** Reads the copy kept in storage. */
  load(): Promise<void>;
  /** Downloads the lists if the copy is a day old (or there is none). */
  refreshIfDue(): Promise<void>;
  match(hex: string): NotableInfo | null;
  /** How many aircraft the lists name. */
  size(): number;
}

export interface PlaneAlertOptions {
  log?: (message: string) => void;
  /** Lists known beforehand (mock mode's recorded rows), by file name; never refreshed. */
  seed?: Partial<Record<(typeof PLANE_ALERT_FILES)[number], string>>;
}

export function createPlaneAlert(deps: Pick<PluginDeps, 'fetch' | 'now' | 'setTimeout'>, kv: Pick<PluginKv, 'read' | 'write'> | null, options: PlaneAlertOptions = {}): PlaneAlert {
  const log = options.log ?? (() => undefined);
  let stored: Stored = { fetchedAt: 0, files: {} };
  let index = new Map<string, Row>();
  if (options.seed) {
    const files: Record<string, StoredFile> = {};
    for (const [file, csv] of Object.entries(options.seed)) files[file] = { etag: null, rows: parsePlaneAlertCsv(csv ?? '') ?? [] };
    stored = { fetchedAt: Number.POSITIVE_INFINITY, files };
  }
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let refreshing: Promise<void> | null = null;

  function rebuild(): void {
    const next = new Map<string, Row>();
    for (const file of PLANE_ALERT_FILES) for (const row of stored.files[file]?.rows ?? []) next.set(row[0], row);
    index = next;
  }

  async function refresh(): Promise<void> {
    lastAttemptAt = deps.now();
    const files: Record<string, StoredFile> = { ...stored.files };
    let allGood = true;
    for (const [index, file] of PLANE_ALERT_FILES.entries()) {
      if (index > 0) await new Promise<void>((resolve) => deps.setTimeout(resolve, BETWEEN_FILES_MS));
      try {
        const etag = stored.files[file]?.etag ?? null;
        const response = await deps.fetch(`${PLANE_ALERT_BASE}/${file}`, etag ? { headers: { 'If-None-Match': etag } } : undefined);
        if (response.status === 304 && stored.files[file]) continue;
        if (!response.ok) throw new Error(`answered ${response.status}`);
        const rows = parsePlaneAlertCsv(await response.text());
        if (rows === null || rows.length === 0) throw new Error('did not have the columns expected');
        files[file] = { etag: response.headers.get('etag'), rows };
        // Matched from as soon as it has read, not once both have.
        stored = { ...stored, files: { ...stored.files, [file]: files[file] as StoredFile } };
        rebuild();
      } catch (error) {
        allGood = false;
        log(`[overhead] plane-alert-db ${file}: ${error instanceof Error ? error.message : String(error)}; keeping the last good copy`);
      }
    }
    stored = { fetchedAt: allGood ? deps.now() : stored.fetchedAt, files };
    rebuild();
    kv?.write(STORAGE_KEY, stored);
    log(`[overhead] plane-alert-db: ${index.size} aircraft`);
  }

  rebuild();
  return {
    async load() {
      const value = kv ? await kv.read(STORAGE_KEY) : null;
      if (typeof value === 'object' && value !== null && 'files' in value) {
        stored = value as Stored;
        rebuild();
      }
    },
    async refreshIfDue() {
      const now = deps.now();
      const due = now - stored.fetchedAt >= REFRESH_EVERY_MS && now - lastAttemptAt >= RETRY_FAILED_MS;
      if (!due) return;
      refreshing ??= refresh().finally(() => {
        refreshing = null;
      });
      await refreshing;
    },
    match(hex) {
      const row = index.get(hex.toLowerCase());
      return row ? toInfo(row) : null;
    },
    size: () => index.size,
  };
}
