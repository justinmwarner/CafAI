/**
 * Persistent records and the repository interfaces that hide IndexedDB.
 *
 * Rules (from the platform research, see docs/VERIFIED.md):
 *   - Persist immediately on every change. The WebView is unloaded after ten
 *     minutes in the background; nothing may wait for unload.
 *   - Browser storage can still be lost (temporary fallback origin, older
 *     Decaid builds), so non-secret data is mirrored to Decaid's key-value
 *     store and can be restored from it.
 *   - The API key is a secret: it lives only in SecretStore, is never
 *     mirrored, exported, logged, or written into shot data.
 */
import type { ProfileJson, ShotSummary } from '../coach/types.ts';
import type { ProposeAdjustment, RoastLevel } from '../coach/contract.ts';
import type { LlmMessage } from '../llm/types.ts';
import type { CoachUiMessage } from '../app/types.ts';

export type IsoDateTime = string;

/** One bag of coffee. The dial-in trail is keyed on the bag, not the bean name. */
export interface Bag {
  id: string;
  /** Short display name used in profile titles ("<name> v1"). */
  name: string;
  roaster: string | null;
  origin: string | null;
  roastLevel: RoastLevel | null;
  process: string | null;
  notes: string | null;
  /** The template picked for v1, once picked. */
  templateId: string | null;
  /** The ProfileVersion currently on the machine for this bag. */
  activeVersionId: string | null;
  conversationId: string;
  archived: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type VersionStatus = 'active' | 'superseded' | 'undone';

/** A change the user confirmed, as applied. */
export interface AppliedChange {
  variable: ProposeAdjustment['variable'];
  lever: string | null;
  from: number | null;
  to: number | null;
  /** Plain-language diff lines exactly as shown on the confirm card. */
  diffLines: string[];
  summary: string;
}

/** One profile version of a bag: v1 from a template, v2+ from confirmed changes. */
export interface ProfileVersion {
  id: string;
  bagId: string;
  /** 1, 2, 3... */
  version: number;
  /** "<Bag name> v<version>" */
  title: string;
  templateId: string;
  /** The complete profile exactly as uploaded to Decaid. */
  profile: ProfileJson;
  /** Decaid's content-hash id; an opaque pointer, may change on Decaid's side. */
  decaidProfileId: string | null;
  parentVersionId: string | null;
  /** Null for v1. */
  change: AppliedChange | null;
  status: VersionStatus;
  createdAt: IsoDateTime;
}

/** Taste feedback as tapped (and optionally typed) by the user. */
export interface Feedback {
  question: string;
  selected: string[];
  otherText: string | null;
}

/** `superseded`: another shot came before this one's question was answered. */
export type IterationOutcome = 'pending' | 'applied' | 'declined' | 'undone' | 'kept' | 'superseded';

/**
 * The structured, exportable log of one dial-in iteration:
 * bean, profile version, shot summary, feedback, proposed change, outcome.
 */
export interface IterationRecord {
  id: string;
  bagId: string;
  bagName: string;
  profileVersionId: string | null;
  profileVersion: number | null;
  shotId: string | null;
  summary: ShotSummary | null;
  feedback: Feedback | null;
  proposal: ProposeAdjustment | null;
  change: AppliedChange | null;
  outcome: IterationOutcome;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The chat for one bag: the append-only API transcript plus what the UI shows. */
export interface ConversationRecord {
  id: string;
  bagId: string;
  /** Append-only; replayed to the provider exactly as stored. */
  apiMessages: LlmMessage[];
  uiMessages: CoachUiMessage[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Non-secret settings. Mirrored to Decaid. Never holds the API key. */
export interface Settings {
  model: string;
  /** The grinder's model when it is linked to Decaid's library, else what the user typed. */
  grinderName: string | null;
  grinderSetting: string | null;
  /**
   * The grinder in Decaid's library (GET /api/v1/grinders) the user picked,
   * or null when it is not linked. Storage always reads and writes it (null
   * when absent); it is optional only so that older Settings literals compile.
   */
  grinderId?: string | null;
  /** Last bag the user worked on, restored on start. */
  activeBagId: string | null;
}

export interface BagRepository {
  list(): Promise<Bag[]>;
  get(id: string): Promise<Bag | undefined>;
  put(bag: Bag): Promise<void>;
}

export interface VersionRepository {
  listByBag(bagId: string): Promise<ProfileVersion[]>;
  get(id: string): Promise<ProfileVersion | undefined>;
  put(version: ProfileVersion): Promise<void>;
}

export interface IterationRepository {
  listByBag(bagId: string): Promise<IterationRecord[]>;
  listAll(): Promise<IterationRecord[]>;
  get(id: string): Promise<IterationRecord | undefined>;
  put(record: IterationRecord): Promise<void>;
}

export interface ConversationRepository {
  get(id: string): Promise<ConversationRecord | undefined>;
  put(conversation: ConversationRecord): Promise<void>;
}

export interface SettingsRepository {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

/** The API key. Local to this device and origin only. */
export interface SecretStore {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  forgetApiKey(): Promise<void>;
}

/** The JSON export file. Contains no secrets. */
export interface CafaiExport {
  format: 'cafai-export';
  schemaVersion: 1;
  exportedAt: IsoDateTime;
  appVersion: string;
  settings: Settings;
  bags: Bag[];
  versions: ProfileVersion[];
  iterations: IterationRecord[];
  conversations: ConversationRecord[];
}

export interface DataPorter {
  exportAll(): Promise<CafaiExport>;
  /** Validates with a schema first; `merge` keeps existing records with newer updatedAt. */
  importAll(data: unknown, mode: 'merge' | 'replace'): Promise<{ imported: number }>;
}

/** Mirror of non-secret data into Decaid's key-value store. */
export interface KvMirror {
  /** Debounced write-through of everything that changed. Never throws. */
  schedulePush(): void;
  /** Push now (e.g. after an import). */
  pushNow(): Promise<void>;
  /** Read the mirrored copy, e.g. to restore after browser storage was lost. */
  pull(): Promise<CafaiExport | null>;
}

export interface Storage {
  bags: BagRepository;
  versions: VersionRepository;
  iterations: IterationRepository;
  conversations: ConversationRepository;
  settings: SettingsRepository;
  secrets: SecretStore;
  porter: DataPorter;
  mirror: KvMirror;
}
