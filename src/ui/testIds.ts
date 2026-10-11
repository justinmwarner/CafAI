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
  openShotGraph: 'open-shot-graph',
  errorBanner: 'error-banner',
  retryButton: 'retry-button',

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
  apiKeyInput: 'api-key-input',
  apiKeySave: 'api-key-save',
  forgetKey: 'forget-key',
  forgetKeyConfirm: 'forget-key-confirm',
  modelSelect: 'model-select',
  grinderName: 'grinder-name',
  grinderSetting: 'grinder-setting',
  settingsSave: 'settings-save',

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
} as const;
