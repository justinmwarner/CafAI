// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/store.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: a debounced mirror of all non-secret records to the cafai namespace, triggered by every commit (Crema's web/src/main.ts mirrorSettings only ran on a submit that never fired).
/**
 * The copy of CafAI's non-secret data in Decaid's key-value store.
 *
 * Browser storage is scoped to the origin Decaid serves the skin from, and
 * that origin can change (a temporary fallback port, a moved app-data path),
 * hiding everything. Decaid's own store survives that and is in Decaid's
 * backups, so every committed change is copied there, debounced, and an empty
 * database can be rebuilt from it.
 *
 * The API key is deliberately not among it: it is not part of the data, and
 * any value that happens to contain it (a key pasted into a note or the chat)
 * is redacted on the way out. Decaid's store has no auth and is readable over
 * the LAN; losing a key on reinstall is a re-paste, leaking it is not
 * recoverable.
 *
 * Key layout, namespace `cafai` (keys are [a-z0-9._-], every value JSON):
 *   meta            {schemaVersion, appVersion, updatedAt, pages, skipped}
 *   settings        the settings (model, grinder and its Decaid link, active bag)
 *   bags            Bag[], oldest first
 *   versions        ProfileVersion[], oldest first
 *   iterations      IterationRecord[], oldest first, without summary.series
 *   care            CareRecord[], machine care's steps by id (D189)
 *   bags.1, ...     further pages of a list, only when one passes 256 KiB
 *   conv.<bagId>    the bag's ConversationRecord, skipped over 512 KiB
 * Characters of a bag id outside [a-z0-9_-] are written as ".xxxx" (UTF-16
 * code unit in hex), so ids from newId() stay readable and no two ids share a
 * key. `meta.skipped` lists the keys left out for size.
 */
import type { KvClient } from '../api/types.ts';
import { byCreatedAt, byId } from './repositories.ts';
import { BagSchema, CareRecordSchema, ConversationSchema, IterationSchema, VersionSchema } from './schema.ts';
import { redactSecret } from './secrets.ts';
import { normalizeSettings } from './settings.ts';
import type { Bag, CafaiExport, CareRecord, ConversationRecord, IterationRecord, KvMirror, ProfileVersion } from './types.ts';

export const KV_NAMESPACE = 'cafai';
export const MIRROR_SCHEMA_VERSION = 1;
export const DEFAULT_DEBOUNCE_MS = 2000;
/** Conversations above this are left out (and listed in meta.skipped). */
export const CONVERSATION_MAX_BYTES = 512 * 1024;
/** Lists are cut into pages of about this size. */
export const PAGE_TARGET_BYTES = 256 * 1024;
/** Decaid answers 413 to request bodies over 1 MiB; keep a margin. */
export const VALUE_MAX_BYTES = 1024 * 1024 - 4096;
const DEFAULT_RETRY_MS = 15_000;
const MAX_RETRY_MS = 5 * 60_000;

const LIST_KEYS = ['bags', 'versions', 'iterations'] as const;
type ListKey = (typeof LIST_KEYS)[number];

/** Everything to mirror, as read from IndexedDB in one transaction. */
export interface MirrorSnapshot {
  settings: unknown;
  bags: Bag[];
  versions: ProfileVersion[];
  iterations: IterationRecord[];
  conversations: ConversationRecord[];
  /** Machine care's steps (D189); none when left out. */
  care?: CareRecord[];
}

export interface MirrorSource {
  read(): Promise<MirrorSnapshot>;
  /** Only to redact the key from anything about to be written. */
  apiKey(): Promise<string | null>;
}

export interface MirrorMeta {
  schemaVersion: number;
  appVersion: string;
  updatedAt: string;
  pages: Record<ListKey, number>;
  skipped: string[];
}

export interface KvMirrorOptions {
  kv: KvClient;
  source: MirrorSource;
  appVersion: string;
  defaultModel: string;
  now?: () => Date;
  debounceMs?: number;
  /** First retry delay after a failed push; doubles up to five minutes. */
  retryMs?: number;
}

const KEY_PATTERN = /^[a-z0-9._-]{1,200}$/;

export function isValidKvKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function conversationKey(bagId: string): string {
  let key = 'conv.';
  for (let i = 0; i < bagId.length; i += 1) {
    const char = bagId.charAt(i);
    key += /[a-z0-9_-]/.test(char) ? char : `.${bagId.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return key;
}

/** Keys this mirror may delete when the data behind them is gone. */
function isRemovableKey(key: string): boolean {
  return /^(bags|versions|iterations)\.[0-9]+$/.test(key) || key.startsWith('conv.');
}

function isMirrorKey(key: string): boolean {
  return key === 'meta' || key === 'settings' || key === 'care' || /^(bags|versions|iterations)(\.[0-9]+)?$/.test(key) || key.startsWith('conv.');
}

const encoder = new TextEncoder();

function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Summaries, not raw curves: the ~1 Hz series is most of an iteration's size. */
function withoutSeries(record: IterationRecord): unknown {
  const summary: unknown = record.summary;
  if (!isRecord(summary) || !('series' in summary)) return record;
  const { series: _series, ...rest } = summary;
  return { ...record, summary: rest };
}

/**
 * A restored summary gets an empty series rather than none, so every reader
 * can rely on ShotSummary's shape; the coach re-reads the curves from
 * Decaid's shot record when it needs them.
 */
function withEmptySeries(record: IterationRecord): IterationRecord {
  if (!record.summary || isRecord((record.summary as { series?: unknown }).series)) return record;
  const series = { tS: [], pressure: [], flow: [], weight: [], weightFlow: [], temperature: [], targetPressure: [], targetFlow: [] };
  return { ...record, summary: { ...record.summary, series } };
}

/** One conversation per bag; should there ever be two, keep the newest. */
function latestPerBag(conversations: ConversationRecord[]): ConversationRecord[] {
  const newer = (a: ConversationRecord, b: ConversationRecord) =>
    a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id);
  const byBag = new Map<string, ConversationRecord>();
  for (const conversation of conversations) {
    const current = byBag.get(conversation.bagId);
    if (!current || newer(conversation, current)) byBag.set(conversation.bagId, conversation);
  }
  return [...byBag.values()];
}

/** JSON arrays of about PAGE_TARGET_BYTES each, built from already-serialized items. */
function paginate(items: string[]): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const item of items) {
    const bytes = utf8Length(item);
    if (current.length > 0 && size + 1 + bytes > PAGE_TARGET_BYTES) {
      pages.push(`[${current.join(',')}]`);
      current = [];
      size = 2;
    }
    size += bytes + (current.length > 0 ? 1 : 0);
    current.push(item);
  }
  pages.push(`[${current.join(',')}]`);
  return pages;
}

export interface MirrorEntries {
  /** Key -> JSON text, redacted. */
  entries: Map<string, string>;
  pages: Record<ListKey, number>;
  skipped: string[];
}

export function buildMirrorEntries(snapshot: MirrorSnapshot, apiKey: string | null, defaultModel: string): MirrorEntries {
  const entries = new Map<string, string>();
  const skipped: string[] = [];
  const toText = (value: unknown) => redactSecret(JSON.stringify(value), apiKey);

  entries.set('settings', toText(normalizeSettings(snapshot.settings, defaultModel)));
  // A few hundred bytes a step: one key, never paged.
  entries.set('care', toText([...(snapshot.care ?? [])].sort(byId)));

  const lists: Record<ListKey, unknown[]> = {
    bags: [...snapshot.bags].sort(byCreatedAt),
    versions: [...snapshot.versions].sort(byCreatedAt),
    iterations: [...snapshot.iterations].sort(byCreatedAt).map(withoutSeries),
  };
  const pages: Record<ListKey, number> = { bags: 0, versions: 0, iterations: 0 };
  for (const name of LIST_KEYS) {
    const texts = paginate(lists[name].map(toText));
    pages[name] = texts.length;
    texts.forEach((text, index) => {
      const key = index === 0 ? name : `${name}.${index}`;
      if (utf8Length(text) > VALUE_MAX_BYTES) skipped.push(key);
      else entries.set(key, text);
    });
  }

  for (const conversation of latestPerBag(snapshot.conversations)) {
    const key = conversationKey(String(conversation.bagId));
    const text = toText(conversation);
    if (!isValidKvKey(key) || utf8Length(text) > CONVERSATION_MAX_BYTES) skipped.push(key);
    else entries.set(key, text);
  }
  return { entries, pages, skipped };
}

type Parsed<T> = { success: true; data: T } | { success: false };

function collectList<T>(data: Record<string, unknown>, name: ListKey, meta: Record<string, unknown> | null, parse: (value: unknown) => Parsed<T>): T[] {
  const declared = meta && isRecord(meta['pages']) ? meta['pages'][name] : undefined;
  let count = typeof declared === 'number' && Number.isInteger(declared) && declared > 0 ? declared : 0;
  if (count === 0) while (data[count === 0 ? name : `${name}.${count}`] !== undefined) count += 1;
  const records: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const page = data[index === 0 ? name : `${name}.${index}`];
    if (!Array.isArray(page)) continue;
    for (const item of page) {
      const result = parse(item);
      if (result.success) records.push(result.data);
    }
  }
  return records;
}

/**
 * Rebuild an export from the namespace's `?full=1` map, or null when nothing
 * of CafAI's is there. Records that no longer validate are dropped one by one
 * rather than failing the whole restore; summaries come back with an empty series.
 */
export function exportFromMirror(
  data: Record<string, unknown>,
  fallback: { appVersion: string; defaultModel: string; now: () => Date },
): CafaiExport | null {
  if (!Object.keys(data).some(isMirrorKey)) return null;
  const meta = isRecord(data['meta']) ? data['meta'] : null;
  const bags = collectList(data, 'bags', meta, (value) => BagSchema.safeParse(value));
  const versions = collectList(data, 'versions', meta, (value) => VersionSchema.safeParse(value));
  const iterations = collectList(data, 'iterations', meta, (value) => IterationSchema.safeParse(value)).map(withEmptySeries);
  const bagIds = new Set(bags.map((bag) => bag.id));
  const conversations: ConversationRecord[] = [];
  for (const key of Object.keys(data).filter((candidate) => candidate.startsWith('conv.')).sort()) {
    const result = ConversationSchema.safeParse(data[key]);
    if (result.success && bagIds.has(result.data.bagId)) conversations.push(result.data);
  }
  // Absent from a backup made before machine care's records; a record that no longer validates is dropped alone.
  const care: CareRecord[] = [];
  for (const item of Array.isArray(data['care']) ? data['care'] : []) {
    const result = CareRecordSchema.safeParse(item);
    if (result.success) care.push(result.data);
  }
  return {
    format: 'cafai-export',
    schemaVersion: 1,
    exportedAt: typeof meta?.['updatedAt'] === 'string' ? meta['updatedAt'] : fallback.now().toISOString(),
    appVersion: typeof meta?.['appVersion'] === 'string' ? meta['appVersion'] : fallback.appVersion,
    settings: normalizeSettings(data['settings'], fallback.defaultModel),
    bags,
    versions,
    iterations,
    conversations,
    care,
  };
}

/** Everything in meta except the time, to tell whether meta itself changed. */
function metaFingerprint(meta: Partial<MirrorMeta>): string {
  return JSON.stringify([meta.schemaVersion, meta.appVersion, meta.pages, meta.skipped]);
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === '' ? 'unknown error' : message;
}

export class DecaidKvMirror implements KvMirror {
  private readonly kv: KvClient;
  private readonly source: MirrorSource;
  private readonly appVersion: string;
  private readonly defaultModel: string;
  private readonly now: () => Date;
  private readonly debounceMs: number;
  private readonly retryMs: number;

  /** What Decaid holds, as far as we know: key -> JSON text. */
  private readonly sent = new Map<string, string>();
  private sentMeta: string | null = null;
  private remoteRead = false;
  private gate: (() => Promise<void>) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay: number;
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private disposed = false;
  private error: string | null = null;
  private pushedAt: string | null = null;
  /** Decaid held no record of a backup (no meta) when this page looked. */
  private noBackup = false;
  /** The look at Decaid's record of the last backup, while it runs (see subscribe). */
  private recordRead: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(options: KvMirrorOptions) {
    this.kv = options.kv;
    this.source = options.source;
    this.appVersion = options.appVersion;
    this.defaultModel = options.defaultModel;
    this.now = options.now ?? (() => new Date());
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    this.retryDelay = this.retryMs;
  }

  /** Why the last push failed, as a sentence, or null when it succeeded. Never contains the key. */
  get lastError(): string | null {
    return this.error;
  }

  /**
   * When Decaid last confirmed holding the current data (ISO time); until this
   * page pushes, when its copy was last completed, as Decaid's own record of
   * it says (meta.updatedAt, read by subscribe). Null when none is known.
   */
  get lastPushAt(): string | null {
    return this.pushedAt;
  }

  /** True once this page knows how the backup stands: a push ended, or Decaid's record of the last one was read. */
  get backupKnown(): boolean {
    return this.pushedAt !== null || this.error !== null || this.noBackup;
  }

  /**
   * Calls `listener` whenever lastPushAt, lastError or backupKnown changes;
   * returns the unsubscribe. While this page does not know how the backup
   * stands, a subscriber (Settings > Data and privacy) has Decaid's record of the last
   * backup read, so a fresh page never says "not backed up" over a backup
   * Decaid holds.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.backupKnown && this.recordRead === null && !this.disposed) {
      this.recordRead = this.readRecord().finally(() => {
        this.recordRead = null;
      });
    }
    return () => void this.listeners.delete(listener);
  }

  /**
   * Work that must succeed before the first push of this session; while it
   * fails, nothing is written (see createIdbStorage: a store that started
   * empty first merges the backup in, so it never overwrites it).
   */
  setGate(gate: (() => Promise<void>) | null): void {
    this.gate = gate;
  }

  /** Local data replaced everything on purpose (an import): it wins outright. */
  noteReplaced(): void {
    this.gate = null;
  }

  schedulePush(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pushNow();
    }, this.debounceMs);
  }

  pushNow(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.clearTimer();
    if (this.queued) return this.queued;
    if (this.running) {
      const queued = this.running.then(() => {
        this.queued = null;
        return this.start();
      });
      this.queued = queued;
      return queued;
    }
    return this.start();
  }

  /** Resolves when no push is running or queued (a pending debounce is not waited for). */
  settled(): Promise<void> {
    return this.queued ?? this.running ?? Promise.resolve();
  }

  /**
   * The mirrored copy as an export, or null when the namespace is empty.
   * Rejects when Decaid cannot be read, so a failed read is never mistaken
   * for an empty backup.
   */
  async pull(): Promise<CafaiExport | null> {
    const result = await this.kv.getAll(KV_NAMESPACE);
    if (result.notModified) throw new Error('Decaid answered "not modified" to a full read.');
    return exportFromMirror(result.data, { appVersion: this.appVersion, defaultModel: this.defaultModel, now: this.now });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private start(): Promise<void> {
    const run: Promise<void> = this.pushOnce().finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  private scheduleRetry(): void {
    if (this.disposed || this.timer !== null) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pushNow();
    }, delay);
  }

  /**
   * Learn what Decaid holds. A full read Decaid does not answer, or answers
   * with something CafAI cannot read, throws (kv.ts): the push waits and
   * retries rather than take it for an empty store (5.3).
   */
  private async readRemote(): Promise<void> {
    const remote = await this.kv.getAll(KV_NAMESPACE);
    if (remote.notModified) throw new Error('Decaid answered "not modified" to a full read.');
    for (const [key, value] of Object.entries(remote.data)) {
      if (key === 'meta') {
        if (isRecord(value)) this.sentMeta = metaFingerprint(value as Partial<MirrorMeta>);
      } else {
        this.sent.set(key, JSON.stringify(value));
      }
    }
    this.remoteRead = true;
  }

  /**
   * meta marks a complete push (pushOnce), so its updatedAt is when Decaid's
   * copy was last completed, by an earlier page or another device. No meta is
   * no backup; Decaid not answering, or a time CafAI cannot read, leaves it
   * unknown for the next subscriber or push to find out.
   */
  private async readRecord(): Promise<void> {
    let meta: unknown;
    try {
      meta = await this.kv.get<unknown>(KV_NAMESPACE, 'meta');
    } catch {
      return;
    }
    // A push that ended meanwhile knows better.
    if (this.backupKnown) return;
    const at = isRecord(meta) ? meta['updatedAt'] : undefined;
    if (meta === null) this.noBackup = true;
    else if (typeof at === 'string' && !Number.isNaN(Date.parse(at))) this.pushedAt = at;
    else return;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private async pushOnce(): Promise<void> {
    // A push queued before dispose() would otherwise run against closed databases.
    if (this.disposed) return;
    let apiKey: string | null = null;
    try {
      apiKey = await this.source.apiKey();
      if (this.gate) {
        const gate = this.gate;
        await gate();
        if (this.gate === gate) this.gate = null;
      }
      // Once per session: learn what Decaid already holds, so unchanged keys
      // are not rewritten after every page load and stale ones can be removed.
      if (!this.remoteRead) await this.readRemote();

      const built = buildMirrorEntries(await this.source.read(), apiKey, this.defaultModel);
      const failures: unknown[] = [];
      let changed = false;
      for (const [key, text] of built.entries) {
        if (this.sent.get(key) === text) continue;
        try {
          await this.kv.set(KV_NAMESPACE, key, JSON.parse(text) as unknown);
          this.sent.set(key, text);
          changed = true;
        } catch (error) {
          failures.push(error);
        }
      }
      for (const key of [...this.sent.keys()]) {
        if (built.entries.has(key) || built.skipped.includes(key) || !isRemovableKey(key)) continue;
        try {
          await this.kv.delete(KV_NAMESPACE, key);
          this.sent.delete(key);
          changed = true;
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw failures[0];

      // meta goes last: it marks a complete push.
      const fingerprint = metaFingerprint({ schemaVersion: MIRROR_SCHEMA_VERSION, appVersion: this.appVersion, pages: built.pages, skipped: built.skipped });
      const at = this.now().toISOString();
      if (changed || this.sentMeta !== fingerprint) {
        const meta: MirrorMeta = { schemaVersion: MIRROR_SCHEMA_VERSION, appVersion: this.appVersion, updatedAt: at, pages: built.pages, skipped: built.skipped };
        await this.kv.set(KV_NAMESPACE, 'meta', meta);
        this.sentMeta = fingerprint;
      }
      this.error = null;
      this.pushedAt = at;
      this.retryDelay = this.retryMs;
    } catch (error) {
      this.error = redactSecret(`Could not back up to Decaid: ${describeError(error)}`, apiKey);
      this.scheduleRetry();
    }
    this.notify();
  }
}
