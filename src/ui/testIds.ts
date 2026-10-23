/**
 * data-testid contract shared by the UI and the Playwright suite (e2e/).
 * Change an id here and both sides follow; never inline these strings.
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const TID = {
  /** Present once the app has loaded storage and rendered the shell. */
  appReady: 'app-ready',

  // Shell / navigation
  navCoach: 'nav-coach',
  navHistory: 'nav-history',
  navSettings: 'nav-settings',
  navShot: 'nav-shot',
  exitToSkins: 'exit-to-skins',
  decaidSettings: 'open-decaid-settings',
  tabCoach: 'tab-coach',
  tabHistory: 'tab-history',
  tabSettings: 'tab-settings',
  liveStrip: 'live-strip',
  shotView: 'shot-view',
  coachNote: 'coach-note',
  tapGuard: 'tap-guard',
  tabShot: 'tab-shot',
  machineRow: 'machine-row',
  statsCard: 'stats-card',
  statsPrompt: 'stats-prompt',
  machineAlerts: 'machine-alerts',

  // Machine panel (baseline skin)
  connectionStatus: 'connection-status',
  machineState: 'machine-state',
  groupTemp: 'group-temp',
  steamTemp: 'steam-temp',
  waterLevel: 'water-level',
  scaleWeight: 'scale-weight',
  espressoButton: 'espresso-button',
  steamButton: 'steam-button',
  flushButton: 'flush-button',
  hotWaterButton: 'hot-water-button',
  stopButton: 'stop-button',
  sleepWakeButton: 'sleep-wake-button',
  tareButton: 'tare-button',
  liveGraph: 'live-graph',
  shotTimer: 'shot-timer',
  /** The shot drawn faintly under another (D180): its bands on a shot card, and its key on the card and over the Shot view's plot. */
  shotGuide: 'shot-guide',
  shotGuideKey: 'shot-guide-key',

  // Coach / chat
  newBag: 'new-bag',
  bagPicker: 'bag-picker',
  activeVersion: 'active-version',
  chat: 'chat',
  composerInput: 'composer-input',
  composerSend: 'composer-send',
  templateCard: (templateId: string) => `template-card-${templateId}`,
  templatePick: (templateId: string) => `template-pick-${templateId}`,
  optionChip: (label: string) => `option-${slug(label)}`,
  optionsSubmit: 'options-submit',
  otherInput: 'other-input',
  diffCard: 'diff-card',
  diffConfirm: 'diff-confirm',
  diffCancel: 'diff-cancel',
  undoButton: 'undo-button',
  /** Undo on the latest applied diff card (the header has undoButton). */
  diffUndo: 'diff-undo',
  /** The Why / What it changes block under a change card's decision. */
  diffReason: 'diff-reason',
  shotCard: 'shot-card',
  /** "Compared with ...?" on a shot card: the five words, a radio group (D126). */
  shotRating: 'shot-rating',
  openShotGraph: 'open-shot-graph',
  /** Taste words above the composer while the taste question is open (D127): the prompt that opens them, the panel, a group's tab and a word. */
  tastePrompt: 'taste-prompt',
  tasteWords: 'taste-words',
  tasteGroup: (groupId: string) => `taste-group-${slug(groupId)}`,
  tasteWord: (label: string) => `taste-word-${slug(label)}`,
  /** Need help? beside the taste words, and the guidance it opens. */
  tasteHelp: 'taste-help',
  tasteHelpDialog: 'taste-help-dialog',
  errorBanner: 'error-banner',
  retryButton: 'retry-button',
  /** A shot card's TDS (D162): its cell (Add, or the reading), its EY, the field with Save, Remove and Cancel, and the line under the numbers. */
  tdsCell: 'shot-tds',
  tdsEy: 'shot-ey',
  tdsInput: 'tds-input',
  tdsSave: 'tds-save',
  tdsRemove: 'tds-remove',
  tdsCancel: 'tds-cancel',
  tdsNote: 'tds-note',
  /** A fun fact's block in the chat (D202). */
  factCard: 'fact-card',
  /** The sites the coach's words cite, under them (D203). */
  sourcesLine: 'sources-line',

  // History
  historyBag: (bagId: string) => `history-bag-${bagId}`,
  historyVersion: (version: number) => `history-version-${version}`,
  historyIteration: (iterationId: string) => `history-iteration-${iterationId}`,
  exportData: 'export-data',
  importData: 'import-data',

  // Settings
  appearanceMode: (mode: string) => `appearance-mode-${mode}`,
  tintSwatch: (id: string) => `tint-${id}`,
  tintHue: 'tint-hue',
  /** Settings > Appearance > Temperatures (D172): 'celsius' or 'fahrenheit'. */
  temperatureUnit: (unit: string) => `temperature-unit-${unit}`,
  apiKeyInput: 'api-key-input',
  apiKeySave: 'api-key-save',
  forgetKey: 'forget-key',
  forgetKeyConfirm: 'forget-key-confirm',
  modelSelect: 'model-select',
  /** Settings > Coach > Fun facts (D198): where they come from. */
  funFacts: 'fun-facts',
  grinderName: 'grinder-name',
  grinderSetting: 'grinder-setting',
  settingsSave: 'settings-save',
  // Add a grinder to Decaid's library (D125), and DYE2's page to edit them
  addGrinder: 'add-grinder',
  addGrinderModel: 'add-grinder-model',
  addGrinderBurrs: 'add-grinder-burrs',
  addGrinderDial: 'add-grinder-dial',
  addGrinderSmallStep: 'add-grinder-small-step',
  addGrinderBigStep: 'add-grinder-big-step',
  addGrinderSettings: 'add-grinder-settings',
  addGrinderSubmit: 'add-grinder-submit',
  addGrinderNote: 'add-grinder-note',
  editGrindersInDye2: 'edit-grinders-dye2',
  // The coach's offer to add a grinder to Decaid's library (D125)
  grinderOffer: 'grinder-offer',
  grinderOfferAdd: 'grinder-offer-add',
  grinderOfferDecline: 'grinder-offer-decline',

  // Decaid alignment: bean library, gateway mode, connect, plugins, key backup, drift
  beanCard: 'bean-card',
  beanOption: 'bean-option',
  beanSomethingElse: 'bean-something-else',
  bagPhoto: 'bag-photo',
  bagPhotoInput: 'bag-photo-input',
  bagConfirm: 'bag-confirm',
  gatewayAlert: 'gateway-alert',
  gatewayFix: 'gateway-fix',
  connectMachine: 'connect-machine',
  connectScale: 'connect-scale',
  timeToReady: 'time-to-ready',
  visualizerLink: 'visualizer-link',
  drinkSettings: 'drink-settings',
  nextStep: 'next-step',
  // A drink's view while it runs (D146): steam, hot water or flush
  drinkView: 'drink-view',
  drinkPhase: 'drink-phase',
  drinkGoBack: 'drink-go-back',
  drinkDial: 'drink-dial',
  drinkDialValue: 'drink-dial-value',
  drinkDialOf: 'drink-dial-of',
  drinkReadout: (key: string) => `drink-readout-${slug(key)}`,
  drinkTrace: 'drink-trace',
  drinkSettingsCard: 'drink-settings-card',
  // Going back by itself (D221): Stay, and the seconds left on Go back
  drinkStay: 'drink-stay',
  drinkGoBackSeconds: 'drink-go-back-seconds',
  // Settings > Drink screens (D222): each drink's scene and its going back by itself
  drinkScreens: 'drink-screens',
  drinkScene: (kind: string) => `drink-scene-${slug(kind)}`,
  drinkGoBackSwitch: (kind: string) => `drink-go-back-switch-${slug(kind)}`,
  drinkScreensError: 'drink-screens-error',
  // Settings > Sleep and wake: Decaid's idle sleep and its wake times (D157-D160)
  sleepWake: 'sleep-wake',
  sleepWhenIdle: 'sleep-when-idle',
  nextWake: 'next-wake',
  wakeRow: (id: string) => `wake-row-${slug(id)}`,
  wakeEdit: (id: string) => `wake-edit-${slug(id)}`,
  wakeSwitch: (id: string) => `wake-switch-${slug(id)}`,
  wakeAdd: 'wake-add',
  wakeDialog: 'wake-dialog',
  wakeDialogHour: 'wake-dialog-hour',
  wakeDialogMinute: 'wake-dialog-minute',
  wakeDialogDay: (day: string) => `wake-dialog-day-${slug(day)}`,
  wakeDialogKeepAwake: 'wake-dialog-keep-awake',
  wakeDialogSave: 'wake-dialog-save',
  wakeDialogDelete: 'wake-dialog-delete',
  // Settings > Machine care and its cleaning guide (D152-D155)
  careSection: 'care-section',
  careOpen: 'care-open',
  careScreen: 'care-screen',
  careBack: 'care-back',
  careSegment: (routine: string) => `care-segment-${slug(routine)}`,
  careRoutine: 'care-routine',
  careStep: (id: string) => `care-step-${slug(id)}`,
  /** A step's moment by the step's id, a routine's by the routine's id. */
  careMoment: (id: string) => `care-moment-${slug(id)}`,
  careLink: (id: string) => `care-link-${slug(id)}`,
  careVideo: 'care-video',
  carePoster: 'care-poster',
  carePlayer: 'care-player',
  careWatch: 'care-watch',
  // Machine care's reminders (D183-D188): the stats card's line, a step's last time, Settings' fields
  careDueLine: 'care-due-line',
  careStepCare: (id: string) => `care-step-care-${slug(id)}`,
  careStepLine: (id: string) => `care-step-line-${slug(id)}`,
  careMarkDone: (id: string) => `care-mark-done-${slug(id)}`,
  careUndo: (id: string) => `care-undo-${slug(id)}`,
  /** The descale's and the intake filter's link to Settings > Machine care. */
  careSetIn: (id: string) => `care-set-in-${slug(id)}`,
  careWater: 'care-water',
  careFilter: 'care-filter',
  careReminders: 'care-reminders',
  keyInDecaid: 'key-in-decaid',
  aboutDecaid: 'about-decaid',
  driftReport: 'drift-report',
  copyDriftReport: 'copy-drift-report',
  backupHealth: 'backup-health',

  // Where the coach runs: Anthropic or CafAI Bridge on the user's computer
  coachSourceAnthropic: 'coach-source-anthropic',
  coachSourceComputer: 'coach-source-computer',
  computerAddress: 'computer-address',
  computerCode: 'computer-code',
  computerSave: 'computer-save',
  computerTest: 'computer-test',
  computerFind: 'computer-find',
  computerStatus: 'computer-status',

  // Settings > Log and the log view (D139); Share, Email and Copy carry the same ids in both
  logSection: 'log-section',
  logSummary: 'log-summary',
  logOpen: 'log-open',
  logShare: 'log-share',
  logEmail: 'log-email',
  logCopy: 'log-copy',
  logClear: 'log-clear',
  logSaid: 'log-said',
  logView: 'log-view',
  logClose: 'log-close',
  logFilter: (filter: string) => `log-filter-${filter}`,
  logPause: 'log-pause',
  logEntries: 'log-entries',
  logEntry: (id: number) => `log-entry-${id}`,
  logDetail: 'log-detail',
  logShowAll: 'log-show-all',
  logMore: 'log-more',

  // Usage sharing (D212): the card or the notice at the foot of the chat, and Settings > About's switch
  usagePrompt: 'usage-prompt',
  usageYes: 'usage-yes',
  usageNo: 'usage-no',
  usageSwitch: 'usage-switch',
} as const;
