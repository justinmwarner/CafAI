/**
 * The seam between the coach engine (src/app/engine) and the chat UI.
 *
 * The engine owns all state and persistence; the UI renders CoachState and
 * calls CoachController methods on taps. Neither side imports the other's
 * implementation, so the chat UI is built and tested against a fake
 * controller and the engine against fake UIs.
 */
import type { DecaidClient, Heartbeat, HostEnvironment, TelemetryStore } from '../api/types.ts';
import type { PluginDirectory } from '../api/plugins.ts';
import type { Confidence, OfferGrinder, RoastLevel, SaveBagDetails } from '../coach/contract.ts';
import type { FactTopic } from '../coach/facts/types.ts';
import type { ShotSummary } from '../coach/types.ts';
import type { BagPhoto } from '../llm/extractBag.ts';
import type { ModelInfo } from '../llm/types.ts';
import type { CoachSourceStore } from '../storage/coachSource.ts';
import type { Bag, ProfileVersion, Storage } from '../storage/types.ts';
import type { AppearanceStore } from './appearance.ts';
import type { DrinkScreensStore } from './drinkScreens.ts';
import type { SaverScreen } from './saverScreen.ts';
import type { ScreensaverSettingStore } from './screensaverSetting.ts';
import type { TemperatureUnitStore } from './temperatureUnit.ts';
import type { CareService } from './care/careService.ts';

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
  /** Which of Decaid's optional plugins are loaded (D103). */
  plugins: PluginDirectory;
  /** How CafAI looks: the appearance setting as live state. */
  appearance: AppearanceStore;
  /** °C or °F where the barista reads or sets a temperature (D172), as live state. */
  temperatureUnit: TemperatureUnitStore;
  /** Settings > Screensaver (D-SAVER-3), as live state. */
  screensaver: ScreensaverSettingStore;
  /**
   * The tablet's screen while a screensaver shows (D-SAVER-2): dimmed and
   * held on through Decaid's display socket. Only inside Decaid, whose
   * display it is; absent elsewhere, and in fakes and previews.
   */
  saverScreen?: SaverScreen;
  /**
   * Each drink's scene and whether its view goes back by itself (D217,
   * D221), as live state. Optional: previews leave it out, and then every
   * drink draws its default scene and goes back after 10 s.
   */
  drinkScreens?: DrinkScreensStore;
  /**
   * Where the coach runs: Anthropic, or CafAI Bridge on the user's computer
   * (src/app/coachAccess.ts). Optional: fakes and previews leave it out, and
   * Settings then offers only the API key.
   */
  coachSource?: CoachSourceStore;
  /**
   * Machine care's steps, their counts and marks (D183-D190,
   * src/app/care/careService.ts). Optional: fakes and previews leave it out,
   * and then no step shows a last time and the stats card no line.
   */
  care?: CareService;
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

/**
 * One batch of Decaid's bean library on the "Which coffee is it?" card
 * (D102), with everything a pick fills the bag with, so the card works
 * after a reload and while Decaid is away.
 */
export interface BeanPickerOption {
  beanId: string;
  batchId: string;
  /** The bean's name, at most 40 characters: it names the bag's profile versions. */
  name: string;
  roaster: string | null;
  /** The bean's country and region. */
  origin: string | null;
  process: string | null;
  notes: string | null;
  /** The batch's roast level when it is one of CafAI's five, else null. */
  roastLevel: RoastLevel | null;
  /** YYYY-MM-DD, or null when the batch has none. */
  roastDate: string | null;
  /** When the batch went into and came out of a freezer (YYYY-MM-DD), as Decaid recorded it. */
  freezeDate: string | null;
  unfreezeDate: string | null;
}

/** The answer on the bean card: a batch, a photo of the bag, or something else (the bag described in the chat). */
export type BeanChoice = { kind: 'batch'; batchId: string } | { kind: 'photo' } | { kind: 'other' };

/**
 * How a shot compared with the one it is set against (D126), in the
 * barista's words, from much worse to much better. Stored as these ids; the
 * card shows SHOT_VERDICT_WORDS and the coach hears them in lower case.
 */
export const SHOT_VERDICTS = ['muchWorse', 'worse', 'same', 'better', 'muchBetter'] as const;
export type ShotVerdict = (typeof SHOT_VERDICTS)[number];

/** The words on the shot card, the same words the coach hears. */
export const SHOT_VERDICT_WORDS: Readonly<Record<ShotVerdict, string>> = {
  muchWorse: 'Much worse',
  worse: 'Worse',
  same: 'About the same',
  better: 'Better',
  muchBetter: 'Much better',
};

/**
 * What a shot is compared with (D126): the shot before it in its bag's chat;
 * for a bag's first shot, the last shot of another coffee; for the very
 * first shot, the coffee the barista usually enjoys.
 */
export type ShotBaseline =
  | { kind: 'previous'; shotId: string }
  /** `coffee`: that bag's name, or null while it had none. */
  | { kind: 'otherCoffee'; shotId: string; coffee: string | null }
  | { kind: 'usual' };

/** The barista's answer on a shot's card (D126). */
export interface ShotRating {
  verdict: ShotVerdict;
  /**
   * The running score written to Decaid's `enjoyment`, out of 10 (ten times
   * it on a Decaid that rates out of 100, D101), so Decaid and Visualizer
   * have a number. Never shown.
   */
  score: number;
}

/** `expired`: the conversation moved on (the user typed instead of tapping). */
export type DiffStatus = 'pending' | 'applying' | 'applied' | 'declined' | 'failed' | 'undone' | 'expired';

/**
 * The coach's offer to add a grinder to Decaid's library (D125): `pending`
 * until a tap (and again after an Add that failed), `adding` while CafAI
 * writes it, `added` or `existing` (Decaid had it, so CafAI linked that one)
 * once CafAI uses it, `declined` (Not now), `expired` (set aside unanswered).
 */
export type GrinderOfferStatus = 'pending' | 'adding' | 'added' | 'existing' | 'declined' | 'expired';

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
      /**
       * What the card asks the barista to compare the shot with (D126).
       * Absent on cards made before CafAI compared shots until their chat is
       * opened, and on cards rated with stars.
       */
      baseline?: ShotBaseline;
      /** The barista's verdict against `baseline` (D126). Absent until rated. */
      rating?: ShotRating;
      /** A 1-5 star rating given before D126: kept as it was and shown, never asked again. */
      stars?: number;
      /** The shot's page on Visualizer, once Decaid's Visualizer plugin uploaded it (6.4). Absent until then. */
      visualizerUrl?: string;
    }
  | {
      kind: 'beanPicker';
      /**
       * "Which coffee is it?" (6.1): Decaid's unarchived batches, newest roast
       * first, at most 8; none when the library is empty or Decaid was out of
       * reach, and the card offers a photo of the bag and something else.
       */
      options: BeanPickerOption[];
      /**
       * True while CafAI reads Decaid's batches: the card is already up, and
       * a photo of the bag and something else already work. Absent once read.
       */
      loading?: boolean;
      /** Null while the card waits for an answer. */
      choice: BeanChoice | null;
      /** The user described the bag in the chat instead: the card is closed. */
      expired?: boolean;
      setAsideReason?: SetAsideReason;
    }
  | {
      kind: 'bagConfirm';
      /** The bag's details as read from its photo (a name not on the bag is empty), then as confirmed (6.8). */
      details: SaveBagDetails;
      confirmed: boolean;
      /** The user typed in the chat instead: the details were not saved. */
      expired?: boolean;
      setAsideReason?: SetAsideReason;
    }
  | {
      kind: 'grinderOffer';
      /** The offer_grinder tool_use id; the engine uses it to resolve the tap. */
      requestId: string;
      /** The grinder as the coach heard it from the barista: what Add sends to Decaid's library. */
      grinder: OfferGrinder;
      status: GrinderOfferStatus;
      /** Why the last Add failed: the card stays open to tap again. Null otherwise. */
      error: string | null;
      /** The grinder CafAI linked, as Decaid's library names it ("Niche Zero (63 mm conical)"); set once added or found. */
      linkedName?: string;
      /** Why the card was set aside (status `expired`). */
      setAsideReason?: SetAsideReason;
    }
  | {
      /**
       * A fun fact under the coach's reply to a shot that ran like the last
       * one on a recipe the barista kept (D197, D202): CafAI's own (D199) or
       * the coach's (share_fun_fact, D201). Kept in the chat like any part.
       */
      kind: 'fact';
      text: string;
      topic: FactTopic;
      /** The site the fact came from ("sca.coffee"), shown as plain text; null when none is shown. */
      source: string | null;
      /** The coach's share_fun_fact call that showed it (D201); absent for CafAI's own facts. */
      requestId?: string;
    }
  | {
      /**
       * The sites the coach's words just above cite (web search citations,
       * D203), shown as plain text under them, never as links: Anthropic asks
       * that search results shown to people say where they came from.
       */
      kind: 'sources';
      sites: string[];
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
  /**
   * True once bags came back from Decaid's backup this session (browser
   * storage was lost, or Decaid was updated): with no key, the key card says
   * why it asks again (5.5). Optional: a controller that does not restore
   * leaves it out.
   */
  restoredFromBackup?: boolean;
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
   * Answer the shot card's "Compared with ...?" (D126); a new answer
   * replaces the old. The verdict and what it was compared with stay on the
   * card, Decaid's `enjoyment` gets a running score on the scale Decaid uses
   * (D101), and the coach hears the verdict with the next message it is sent.
   */
  rateShot(shotId: string, verdict: ShotVerdict): Promise<void>;
  /**
   * The barista's TDS from a refractometer on a shot's card, in % (D162),
   * or null to remove it. The card and the shot's iteration keep it with the
   * EY CafAI works out from the card's dose and yield; both go to the shot's
   * record in Decaid (drinkTds, drinkEy); the coach hears it with the next
   * turn it is sent. A TDS outside 0.01-25 % is ignored.
   */
  setShotTds(shotId: string, tdsPct: number | null): Promise<void>;
  /**
   * The bean card (6.1): fill the bag from a batch of Decaid's bean library,
   * link it, and start the coach's intake with it.
   */
  pickBean(batchId: string): Promise<void>;
  /** The bean card's "Something else": close it; the barista describes the bag in the chat. */
  skipBeanPick(): Promise<void>;
  /** Read a photo of the bag (6.8) into a confirm card. The photo is sent once and never kept. */
  readBagPhoto(photo: BagPhoto): Promise<void>;
  /** The photo's details as the barista confirmed them: saved like save_bag_details, then the coach's intake. */
  confirmBag(details: SaveBagDetails): Promise<void>;
  /**
   * The coach's grinder card (D125): add the grinder to Decaid's grinder
   * library, or take the one Decaid already has, link it as Settings does,
   * and tell the coach. Nothing is added without this tap.
   */
  addGrinder(requestId: string): Promise<void>;
  /** The grinder card's Not now: nothing is added, and the coach hears so. */
  declineGrinder(requestId: string): Promise<void>;
  /** Re-send the last failed request. */
  retry(): Promise<void>;
  dismissError(): void;
  /** Re-read settings and the stored key (call after Settings saves or forgets the key). */
  refresh(): Promise<void>;
}
