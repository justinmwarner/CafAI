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

export type DiffStatus = 'pending' | 'applying' | 'applied' | 'declined' | 'failed' | 'undone';

export type CoachUiPart =
  | { kind: 'text'; text: string; streaming?: boolean }
  | {
      kind: 'templates';
      /** The tool_use id; the engine uses it to resolve the pick. */
      requestId: string;
      items: TemplateCardItem[];
      pickedTemplateId: string | null;
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
    }
  | { kind: 'shot'; shotId: string; summary: ShotSummary }
  | { kind: 'notice'; tone: 'info' | 'success' | 'warning' | 'error'; text: string };

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
  /** Re-send the last failed request. */
  retry(): Promise<void>;
  dismissError(): void;
  /** Re-read settings and the stored key (call after Settings saves or forgets the key). */
  refresh(): Promise<void>;
}
