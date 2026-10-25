/**
 * Every setting Settings holds, for its search (D236): each one's words as
 * its card shows them, the other words people use for it ("theme", "dark
 * mode", "Fahrenheit", "alarm", "tokens"...), the group and the card it sits
 * in, and its control, by the test id the card gives it (TID, src/ui/testIds.ts)
 * or, for a control that has none (a drink's stepper), by its accessible
 * name. Static: the search never reads a screen to find a setting.
 *
 * In the order of the groups and of each page, so a search lists what it
 * finds equally well in the order the barista meets it. A unit test renders
 * each group and finds every entry's control in its card
 * (settingsIndex.pages.test.tsx), so a setting renamed or moved cannot drift
 * out of the search unnoticed.
 *
 * Matching (searchSettings): every word typed must be found in the setting's
 * name, its other words or its card's title; the best come first: a name
 * that starts with what was typed, then one where each word typed starts a
 * word of the name, then each word starting a word anywhere, then each found
 * anywhere at all. Case, accents and apostrophes never count.
 */
import { TID } from '../testIds.ts';
import type { SettingsGroupId } from './groupIds.ts';

/** How the search finds a setting's control on its group's page. */
export type SettingControl =
  /**
   * The control's test id. `chosen`: it is one of a set of choices (a radio
   * group, a segmented control), and the reveal focuses the chosen one;
   * `label`: the accessible name to find it by where the test id is not
   * rendered (a grinder Decaid lists has a picker in place of the name).
   */
  | { testId: string; chosen?: true; label?: string }
  /** The control's accessible name, for a control without a test id. */
  | { label: string };

export interface SettingsIndexEntry {
  /** Stable, for the result's test id (TID.settingsSearchResult). */
  id: string;
  /** The setting as its card names it, in a result over its group's name. */
  name: string;
  group: SettingsGroupId;
  /** The card that holds it, by its title: the region the reveal brings into view and washes. */
  card: string;
  control: SettingControl;
  /** Other words people use for it. */
  words: readonly string[];
}

/** A result list never runs longer than this. */
export const MAX_RESULTS = 8;

const STEAM_WORDS = ['steam', 'milk', 'wand', 'froth', 'latte', 'cappuccino'];
const HOT_WATER_WORDS = ['hot water', 'water', 'tea', 'americano'];
const FLUSH_WORDS = ['flush', 'rinse', 'purge', 'group head'];
const SCREEN_WORDS = ['animation', 'scene', 'screen', 'picture', 'view'];
const GO_BACK_WORDS = ['go back', 'return', 'countdown', 'screen', 'after'];

export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
  // Coach
  {
    id: 'coach-source',
    name: 'Where the coach runs',
    group: 'coach',
    card: 'Where the coach runs',
    control: { testId: TID.coachSourceAnthropic, chosen: true },
    words: ['Anthropic', 'API', 'source', 'provider', 'cloud', 'service'],
  },
  {
    id: 'coach-computer',
    name: 'Claude on my computer',
    group: 'coach',
    card: 'Where the coach runs',
    control: { testId: TID.coachSourceComputer },
    words: ['bridge', 'CafAI Bridge', 'computer', 'Mac', 'PC', 'laptop', 'local', 'Claude Code', 'Claude plan', 'subscription', 'address', 'pairing code'],
  },
  {
    id: 'api-key',
    name: 'Anthropic API key',
    group: 'coach',
    card: 'Anthropic API key',
    control: { testId: TID.apiKeyInput },
    words: ['key', 'API key', 'Claude', 'Anthropic', 'console', 'paste', 'secret', 'sk-ant'],
  },
  {
    id: 'key-in-decaid',
    name: 'Keep my API key in Decaid',
    group: 'coach',
    card: 'Anthropic API key',
    control: { testId: TID.keyInDecaid },
    words: ['key', 'backup', 'remember', 'store', 'Decaid update'],
  },
  {
    id: 'model',
    name: 'Model',
    group: 'coach',
    card: 'Model and replies',
    control: { testId: TID.modelSelect },
    words: ['Claude', 'Opus', 'Sonnet', 'Haiku', 'Fable', 'AI', 'LLM', 'price', 'smarter', 'cheaper'],
  },
  {
    id: 'coach-effort',
    name: 'How the coach replies',
    group: 'coach',
    card: 'Model and replies',
    control: { testId: TID.coachEffort('medium'), chosen: true },
    words: ['effort', 'thinking', 'think', 'reasoning', 'Quicker', 'Balanced', 'Thorough', 'speed', 'fast', 'quality'],
  },
  {
    id: 'fun-facts',
    name: 'Fun facts',
    group: 'coach',
    card: 'Model and replies',
    control: { testId: TID.funFacts },
    words: ['facts', 'trivia', 'web search', 'did you know'],
  },
  {
    id: 'coach-usage',
    name: 'Usage and cost',
    group: 'coach',
    card: 'Usage and cost',
    control: { testId: TID.coachUsage },
    words: ['cost', 'tokens', 'spend', 'spent', 'price', 'usage', 'bill', 'money', 'dollars', 'how much', 'this month', 'budget'],
  },
  {
    id: 'coach-budget',
    name: 'Monthly budget',
    group: 'coach',
    card: 'Usage and cost',
    control: { testId: TID.coachBudgetAmount },
    words: ['budget', 'limit', 'cap', 'spend', 'cost', 'money', 'dollars'],
  },
  {
    id: 'coach-budget-pause',
    name: 'Pause the coach at the budget',
    group: 'coach',
    card: 'Usage and cost',
    control: { testId: TID.coachBudgetPause },
    words: ['pause', 'stop', 'limit', 'cap'],
  },

  // Grinder
  {
    id: 'grinder',
    name: 'Grinder',
    group: 'grinder',
    card: 'Your grinder',
    control: { testId: TID.grinderName, label: 'Grinder from Decaid' },
    words: ['grinder', 'Niche', 'burr', 'burrs', 'mill', 'brand', 'model'],
  },
  {
    id: 'grinder-setting',
    name: 'Current grinder setting',
    group: 'grinder',
    card: 'Your grinder',
    control: { testId: TID.grinderSetting, label: 'Current grinder setting' },
    words: ['grind', 'grind size', 'setting', 'dial', 'number', 'click', 'size'],
  },
  {
    id: 'grinder-finer',
    name: 'Finer is',
    group: 'grinder',
    card: 'Your grinder',
    control: { testId: TID.grinderFinerLower, chosen: true },
    words: ['finer', 'coarser', 'direction', 'which way', 'higher numbers', 'lower numbers', 'reverse'],
  },
  {
    id: 'add-grinder',
    name: 'Add a grinder',
    group: 'grinder',
    card: 'Your grinder',
    control: { testId: TID.addGrinder },
    words: ['add', 'new grinder', 'library', "Decaid's grinders", 'DYE2'],
  },

  // Drinks: each card lists its temperature first, as the card does.
  { id: 'steam-temperature', name: 'Steam temperature', group: 'drinks', card: 'Steam', control: { label: 'Steam temperature' }, words: [...STEAM_WORDS, 'heat', 'hot'] },
  { id: 'steam-time', name: 'Steam time', group: 'drinks', card: 'Steam', control: { label: 'Steam time' }, words: [...STEAM_WORDS, 'duration', 'seconds', 'how long'] },
  { id: 'steam-flow', name: 'Steam flow', group: 'drinks', card: 'Steam', control: { label: 'Steam flow' }, words: [...STEAM_WORDS, 'power', 'pressure', 'flow rate'] },
  { id: 'steam-animation', name: 'Steam animation', group: 'drinks', card: 'Steam', control: { testId: TID.drinkScene('steam') }, words: [...SCREEN_WORDS, 'whirlpool', 'rosetta', 'wand and spray'] },
  { id: 'steam-go-back', name: 'Go back by itself after steam', group: 'drinks', card: 'Steam', control: { testId: TID.drinkGoBackSwitch('steam') }, words: GO_BACK_WORDS },
  {
    id: 'hot-water-temperature',
    name: 'Hot water temperature',
    group: 'drinks',
    card: 'Hot water',
    control: { label: 'Hot water temperature' },
    words: [...HOT_WATER_WORDS, 'heat'],
  },
  { id: 'hot-water-volume', name: 'Hot water volume', group: 'drinks', card: 'Hot water', control: { label: 'Hot water volume' }, words: [...HOT_WATER_WORDS, 'ml', 'amount', 'how much'] },
  { id: 'hot-water-time', name: 'Hot water time', group: 'drinks', card: 'Hot water', control: { label: 'Hot water time' }, words: [...HOT_WATER_WORDS, 'duration', 'seconds'] },
  { id: 'hot-water-flow', name: 'Hot water flow', group: 'drinks', card: 'Hot water', control: { label: 'Hot water flow' }, words: [...HOT_WATER_WORDS, 'flow rate'] },
  { id: 'hot-water-animation', name: 'Hot water animation', group: 'drinks', card: 'Hot water', control: { testId: TID.drinkScene('hotWater') }, words: [...SCREEN_WORDS, 'pour', 'from above'] },
  {
    id: 'hot-water-go-back',
    name: 'Go back by itself after hot water',
    group: 'drinks',
    card: 'Hot water',
    control: { testId: TID.drinkGoBackSwitch('hotWater') },
    words: GO_BACK_WORDS,
  },
  { id: 'flush-temperature', name: 'Flush temperature', group: 'drinks', card: 'Flush', control: { label: 'Flush temperature' }, words: [...FLUSH_WORDS, 'heat'] },
  { id: 'flush-time', name: 'Flush time', group: 'drinks', card: 'Flush', control: { label: 'Flush time' }, words: [...FLUSH_WORDS, 'duration', 'seconds'] },
  { id: 'flush-flow', name: 'Flush flow', group: 'drinks', card: 'Flush', control: { label: 'Flush flow' }, words: [...FLUSH_WORDS, 'flow rate'] },
  { id: 'flush-animation', name: 'Flush animation', group: 'drinks', card: 'Flush', control: { testId: TID.drinkScene('flush') }, words: [...SCREEN_WORDS, 'shower'] },
  { id: 'flush-go-back', name: 'Go back by itself after flush', group: 'drinks', card: 'Flush', control: { testId: TID.drinkGoBackSwitch('flush') }, words: GO_BACK_WORDS },

  // Machine
  {
    id: 'sleep-when-idle',
    name: 'Sleep when idle',
    group: 'machine',
    card: 'Sleep and wake',
    control: { testId: TID.sleepWhenIdle },
    words: ['sleep', 'idle', 'standby', 'power', 'auto off', 'turn off', 'energy'],
  },
  { id: 'sleep-after', name: 'Sleep after', group: 'machine', card: 'Sleep and wake', control: { label: 'Sleep after' }, words: ['sleep', 'minutes', 'idle', 'timeout', 'standby'] },
  {
    id: 'wake-times',
    name: 'Wake times',
    group: 'machine',
    card: 'Sleep and wake',
    control: { testId: TID.wakeAdd },
    words: ['wake', 'alarm', 'schedule', 'morning', 'timer', 'warm up', 'heat up', 'turn on', 'auto on'],
  },
  {
    id: 'cleaning-guide',
    name: 'Cleaning guide',
    group: 'machine',
    card: 'Machine care',
    control: { testId: TID.careOpen },
    words: ['clean', 'cleaning', 'descale', 'backflush', 'maintenance', 'care', 'video'],
  },
  {
    id: 'care-water',
    name: 'Your water',
    group: 'machine',
    card: 'Machine care',
    control: { testId: TID.careWater },
    words: ['water', 'hardness', 'ppm', 'descale', 'scale', 'minerals', 'distilled', 'RO'],
  },
  {
    id: 'care-filter',
    name: 'Intake filter',
    group: 'machine',
    card: 'Machine care',
    control: { testId: TID.careFilter },
    words: ['filter', 'water filter', 'V1', 'V2', 'citric acid', 'baking soda'],
  },
  {
    id: 'care-reminders',
    name: 'Remind me on the stats card',
    group: 'machine',
    card: 'Machine care',
    control: { testId: TID.careReminders },
    words: ['reminders', 'remind', 'due', 'notifications', 'descale reminder'],
  },

  // Display
  {
    id: 'mode',
    name: 'Mode',
    group: 'display',
    card: 'Appearance',
    control: { testId: TID.appearanceMode('dark'), chosen: true },
    words: ['theme', 'dark mode', 'light mode', 'dark', 'light', 'auto', 'night'],
  },
  {
    id: 'tint',
    name: 'Tint',
    group: 'display',
    card: 'Appearance',
    control: { testId: TID.tintSwatch('crema'), chosen: true },
    words: ['theme', 'colour', 'color', 'accent', 'Crema', 'Matcha', 'Cold Brew', 'Blueberry', 'Plum', 'Cherry', 'Tamper'],
  },
  { id: 'custom-hue', name: 'Custom hue', group: 'display', card: 'Appearance', control: { testId: TID.tintHue }, words: ['hue', 'colour', 'color', 'slider'] },
  {
    id: 'temperatures',
    name: 'Temperatures',
    group: 'display',
    card: 'Units',
    control: { testId: TID.temperatureUnit('celsius'), chosen: true },
    words: ['units', 'Fahrenheit', 'Celsius', '°F', '°C', 'degrees', 'temperature unit'],
  },
  {
    id: 'clock',
    name: 'Clock',
    group: 'display',
    card: 'Units',
    control: { testId: TID.clockFormat('24h'), chosen: true },
    words: ['12-hour', '24-hour', 'time format', 'am', 'pm', 'time'],
  },
  {
    id: 'show-tds',
    name: 'Show TDS and extraction',
    group: 'display',
    card: 'Shot cards',
    control: { testId: TID.showTds },
    words: ['TDS', 'refractometer', 'extraction', 'EY', 'strength'],
  },
  {
    id: 'screensaver',
    name: 'Screensaver',
    group: 'display',
    card: 'Screensaver',
    control: { testId: TID.saverOn },
    words: ['screen saver', 'idle screen', 'nightstand', 'burn-in'],
  },
  {
    id: 'screensaver-which',
    name: 'Which screensaver',
    group: 'display',
    card: 'Screensaver',
    control: { testId: TID.saverPick },
    words: ['Nightstand', 'Beanfield', 'Bouncing Portafilter', 'Rising Steam', 'Lava Latte', 'Brew Rain', 'Espresso Pipes', 'Latte Art'],
  },
  {
    id: 'screensaver-starts',
    name: 'Screensaver starts after',
    group: 'display',
    card: 'Screensaver',
    control: { testId: TID.saverStartAfter },
    words: ['wait', 'delay', 'minutes', 'timeout'],
  },
  {
    id: 'screensaver-dims',
    name: 'Screensaver dims the screen to',
    group: 'display',
    card: 'Screensaver',
    control: { testId: TID.saverDimTo },
    words: ['brightness', 'dimming', 'backlight'],
  },
  {
    id: 'screensaver-preview',
    name: 'Preview the screensaver',
    group: 'display',
    card: 'Screensaver',
    control: { testId: TID.saverPreview },
    words: ['try', 'show', 'test'],
  },

  // Data and privacy
  {
    id: 'backup',
    name: 'Backup in Decaid',
    group: 'data',
    card: 'Backup in Decaid',
    control: { testId: TID.backupHealth },
    words: ['backup', 'back up', 'restore', 'copy', 'sync', 'new device'],
  },
  {
    id: 'export',
    name: 'Export',
    group: 'data',
    card: 'Your data',
    control: { testId: TID.settingsExport },
    words: ['export', 'download', 'file', 'save', 'backup', 'move', 'transfer', 'data'],
  },
  {
    id: 'share-usage',
    name: "Share usage with CafAI's developer",
    group: 'data',
    card: 'Share usage',
    control: { testId: TID.usageSwitch },
    words: ['analytics', 'telemetry', 'privacy', 'tracking', 'Clarity', 'statistics'],
  },
  {
    id: 'log',
    name: 'Log',
    group: 'data',
    card: 'Log',
    control: { testId: TID.logOpen },
    words: ['traffic', 'debug', 'requests', 'network', 'troubleshoot'],
  },

  // About
  {
    id: 'versions',
    name: 'CafAI and Decaid versions',
    group: 'about',
    card: 'CafAI and Decaid',
    control: { testId: TID.aboutDecaid },
    words: ['version', 'about', 'build', 'update', 'drift'],
  },
  {
    id: 'whats-new',
    name: "What's new",
    group: 'about',
    card: 'CafAI and Decaid',
    control: { testId: TID.whatsNew },
    words: ['changelog', 'release notes', 'changes', 'new features', 'updates'],
  },
  {
    id: 'report-problem',
    name: 'Report a problem',
    group: 'about',
    card: 'CafAI and Decaid',
    control: { testId: TID.reportProblem },
    words: ['report', 'bug', 'issue', 'problem', 'feedback', 'GitHub', 'help', 'support'],
  },
];

/**
 * Words as the search compares them: lower case, accents and apostrophes
 * dropped ("What’s" is "whats"), anything else that is not a letter, a digit
 * or a degree sign a space ("12-hour" is "12 hour").
 */
export function foldWords(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9°]+/g, ' ')
    .trim();
}

/** `token` starts one of the words of `text` (both folded). */
function startsWord(text: string, token: string): boolean {
  return text.startsWith(token) || text.includes(` ${token}`);
}

interface Folded {
  name: string;
  /** The other words and the card's title. */
  rest: string[];
}

const folded = new WeakMap<SettingsIndexEntry, Folded>();

function foldedOf(entry: SettingsIndexEntry): Folded {
  let known = folded.get(entry);
  if (!known) {
    known = { name: foldWords(entry.name), rest: [...entry.words, entry.card].map(foldWords) };
    folded.set(entry, known);
  }
  return known;
}

/** How well an entry matches: 0 best, 3 worst, null when it does not. */
function rankOf(entry: SettingsIndexEntry, phrase: string, tokens: readonly string[]): number | null {
  const { name, rest } = foldedOf(entry);
  if (name.startsWith(phrase)) return 0;
  if (tokens.every((token) => startsWord(name, token))) return 1;
  const all = [name, ...rest];
  if (tokens.every((token) => all.some((text) => startsWord(text, token)))) return 2;
  if (tokens.every((token) => all.some((text) => text.includes(token)))) return 3;
  return null;
}

/** The settings matching what was typed, best first, then in the order of the pages; at most MAX_RESULTS. */
export function searchSettings(query: string, index: readonly SettingsIndexEntry[] = SETTINGS_INDEX): SettingsIndexEntry[] {
  const phrase = foldWords(query);
  if (phrase === '') return [];
  const tokens = phrase.split(' ');
  return index
    .map((entry, order) => ({ entry, order, rank: rankOf(entry, phrase, tokens) }))
    .filter((found): found is { entry: SettingsIndexEntry; order: number; rank: number } => found.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, MAX_RESULTS)
    .map((found) => found.entry);
}
