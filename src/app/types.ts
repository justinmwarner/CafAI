/**
 * The seam between the coach engine (src/app/engine) and the chat UI.
 *
 * The engine owns all state and persistence; the UI renders CoachState and
 * calls CoachController methods on taps. Neither side imports the other's
 * implementation, so the chat UI is built and tested against a fake
 * controller and the engine against fake UIs.
 */
import type { DecaidClient, Heartbeat, HostEnvironment, TelemetryStore } from '../api/types.ts';
import type { Confidence } from '../coach/contract.ts';
import type { ShotSummary } from '../coach/types.ts';
import type { ModelInfo } from '../llm/types.ts';
import type { Bag, ProfileVersion, Storage } from '../storage/types.ts';

/** Everything the UI needs, provided once through ServicesProvider (src/app/services.tsx). */
export interface Services {
  decaid: DecaidClient;
  telemetry: TelemetryStore;
  heartbeat: Heartbeat;
  host: HostEnvironment;
  storage: Storage;
  coach: CoachController;
  models: readonly ModelInfo[];
  appVersion: string;
}

export type UiRole = 'user' | 'assistant' | 'system';

/** A template suggestion card (from propose_templates). */
export interface TemplateCardItem {
  templateId: string;
  name: string;
  /** e.g. "Blooming", "Adaptive (D-Flow)", "Lever" */
  style: string;
  /** One line describing the template's shape, e.g. "Bloom, then 9 bar decline". */
  shape: string;
  confidence: Confidence;
  reason: string;
}

/** `expired`: the conversation moved on (the user typed instead of tapping). */
export type DiffStatus = 'pending' | 'applying' | 'applied' | 'declined' | 'failed' | 'undone' | 'expired';

/**
 * Why the engine set a card aside unanswered: the barista typed in the chat,
 * tapped Undo, or a new shot came in; `other` for anything else (another card
 * of the same turn was answered, say).
 */
export type SetAsideReason = 'typed' | 'undo' | 'shot' | 'other';

export type CoachUiPart =
  | { kind: 'text'; text: string; streaming?: boolean }
  | {
      kind: 'templates';
      /** The tool_use id; the engine uses it to resolve the pick. */
      requestId: string;
      items: TemplateCardItem[];
      pickedTemplateId: string | null;
      /** The user typed instead of picking; the cards no longer answer anything. */
      expired?: boolean;
      /** Why the cards were set aside; absent in chats stored before CafAI recorded it. */
      setAsideReason?: SetAsideReason;
    }
  | {
      kind: 'options';
      requestId: string;
      question: string;
      /** Already ends with "Other". */
      options: string[];
      multiSelect: boolean;
      /** Null until answered. */
      answer: { selected: string[]; otherText: string | null } | null;
      /** The user typed instead of tapping (or pulled another shot); the chips are closed. */
      expired?: boolean;
      /** Why the question was set aside; absent in chats stored before CafAI recorded it. */
      setAsideReason?: SetAsideReason;
      /**
       * True when the question asks how the shot tasted (its text mentions
       * taste): only its answer is the shot's taste. Absent in chats stored
       * before CafAI marked it.
       */
      taste?: boolean;
    }
  | {
      kind: 'diff';
      requestId: string;
      /** "Raise brew temperature by 1 °C" */
      summary: string;
      /** Plain-language lines: "Brew temperature: 92.0 °C -> 93.0 °C (all steps)". */
      lines: string[];
      /** Grinder / scale instructions that need the user's hands. */
      manualSteps: string[];
      rationale: string;
      expectedEffect: string;
      /** "Kiambu AA v3" when confirming creates a version; null for manual-only changes. */
      versionLabel: string | null;
      status: DiffStatus;
      error: string | null;
      /**
       * True when the proposal keeps the recipe as it is (variable "none"):
       * nothing to change, by hand or on the machine. Absent for every other
       * change, and in chats stored before CafAI marked it.
       */
      keep?: boolean;
      /** Why the proposal was set aside (status `expired`); absent in chats stored before CafAI recorded it. */
      setAsideReason?: SetAsideReason;
    }
  | {
      kind: 'shot';
      shotId: string;
      summary: ShotSummary;
      /** The barista's 1-5 star rating, written to Decaid's record as enjoyment (stars x 2). Absent until rated. */
      stars?: number;
    }
  | {
      kind: 'notice';
      tone: 'info' | 'success' | 'warning' | 'error';
      text: string;
      /**
       * CafAI is still at it (loading a profile, looking for a shot). Such a
       * notice is transient: it is replaced when the work ends and never stored.
       */
      progress?: NoticeProgress;
    };

/** The progress shown on a transient notice. */
export interface NoticeProgress {
  /** 0-1 for a determinate bar; null while the length is unknown. */
  value: number | null;
  /** Short text beside the bar, e.g. "Try 3 of 6". */
  label: string | null;
}

export interface CoachUiMessage {
  id: string;
  role: UiRole;
  parts: CoachUiPart[];
  createdAt: string;
}

export type CoachPhase =
  | 'no_bag'
  | 'intake'
  | 'choosing_template'
  | 'awaiting_shot'
  | 'awaiting_feedback'
  | 'awaiting_confirmation'
  | 'idle';

/**
 * How far CafAI's last load of a version got (D55):
 * - loading: in Decaid's workflow; CafAI waits for the machine to hold it;
 * - loaded: Decaid's barrier said the machine holds it;
 * - waiting: no machine; Decaid uploads it when the machine connects;
 * - failed: the machine has not confirmed it (the barrier failed, or Decaid
 *   reported that the upload failed);
 * - assumed: an older Decaid without the barrier, so the workflow is trusted.
 */
export type VersionLoad = 'loading' | 'loaded' | 'waiting' | 'failed' | 'assumed';

export interface CoachState {
  ready: boolean;
  bags: Bag[];
  activeBag: Bag | null;
  activeVersion: ProfileVersion | null;
  versions: ProfileVersion[];
  phase: CoachPhase;
  messages: CoachUiMessage[];
  /** True while the model is streaming or tools are running. */
  busy: boolean;
  /** True when an API key is stored (the key itself never enters UI state). */
  hasApiKey: boolean;
  /** Last error, as a sentence the user can act on. */
  error: string | null;
  /** True when the last profile change can be undone. */
  canUndo: boolean;
  /**
   * How far the active version's load got this session (D55); null when
   * CafAI has not loaded it since it started (or there is no active
   * version). Optional: a controller that does not track it leaves it out.
   */
  activeLoad?: VersionLoad | null;
  /**
   * Counts the moments the engine looks at the machine's profile: every 30 s
   * while the page is in view, and when it comes back into view (the look
   * itself waits while something else is going on). The Profile line reads
   * Decaid's workflow on the same beat, so it and the banner change together.
   * Optional: without it the line keeps its own 30 s clock.
   */
  machineTick?: number;
}

export interface CoachController {
  getState(): CoachState;
  subscribe(listener: () => void): () => void;

  /** Start a new bag and its conversation (placeholder system message asks for details). */
  newBag(): Promise<void>;
  selectBag(bagId: string): Promise<void>;
  sendText(text: string): Promise<void>;
  pickTemplate(requestId: string, templateId: string): Promise<void>;
  answerOptions(requestId: string, selected: string[], otherText: string | null): Promise<void>;
  confirmChange(requestId: string): Promise<void>;
  declineChange(requestId: string): Promise<void>;
  /** Revert the machine to the previous version of the active bag. */
  undo(): Promise<void>;
  /**
   * Rate a shot 1-5 stars from its card. Written to Decaid's shot record as
   * `enjoyment` (stars x 2); never sent to the coach.
   */
  rateShot(shotId: string, stars: number): Promise<void>;
  /** Re-send the last failed request. */
  retry(): Promise<void>;
  dismissError(): void;
  /** Re-read settings and the stored key (call after Settings saves or forgets the key). */
  refresh(): Promise<void>;
}
