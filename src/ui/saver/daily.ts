/**
 * "A different one each day" (D225), the pick for anyone who never
 * opens Settings > Screensaver: the screensavers this device can run, in a
 * fixed shuffled order, one a day by the local calendar day (random.ts's
 * localDayNumber), so each comes round in turn and none shows two days
 * running. The day's number is also the seed (SaverOverlay), so each day's
 * picture differs a little too.
 *
 * What a device can run: every screensaver but one that needs WebGL where
 * WebGL cannot start (Espresso Pipes, D262).
 */
import { createRandom } from './random.ts';
import { isSaverId, SAVERS, type SaverChoice } from './registry.ts';
import type { SaverId } from './types.ts';

/** The pick that means "A different one each day". */
export const DAILY = 'daily';

/** Seeds the one fixed order: the same on every device and every day. */
const ORDER_SEED = 0x5a7e2610;

/** Every screensaver this build has, shuffled once (Fisher-Yates over the registry's order). */
const SHUFFLED: readonly SaverId[] = (() => {
  const ids = SAVERS.map((saver) => saver.id);
  const random = createRandom(ORDER_SEED);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
})();

/**
 * The day's order for these screensavers: the fixed shuffle, less the ones
 * not available, so one this device cannot run leaves the others in turn.
 */
export function dailyOrder(available: readonly SaverId[]): SaverId[] {
  const known = SHUFFLED.filter((id) => available.includes(id));
  return [...known, ...available.filter((id) => !SHUFFLED.includes(id))];
}

/** "A different one each day": the ids in a fixed shuffled order, one a day; none twice running. Nightstand when none is available. */
export function dailyPick(available: readonly SaverId[], day: number): SaverId {
  const order = dailyOrder(available);
  if (order.length === 0) return 'nightstand';
  const whole = Number.isFinite(day) ? Math.floor(day) : 0;
  return order[((whole % order.length) + order.length) % order.length]!;
}

/** What shows for a pick: 'daily' resolved; an id this device cannot run, or does not know, is the day's pick. */
export function resolvePick(pick: string, available: readonly SaverId[], day: number): SaverId {
  if (pick !== DAILY && isSaverId(pick) && available.includes(pick)) return pick;
  return dailyPick(available, day);
}

/** Whether this screensaver can start on a device whose WebGL starts or not. */
export function canRun(saver: Pick<SaverChoice, 'context'>, webgl: boolean): boolean {
  return saver.context !== 'webgl' || webgl;
}

/** The screensavers a device can run, in Settings' order. */
export function runnableSavers(webgl: boolean): SaverId[] {
  return SAVERS.filter((saver) => canRun(saver, webgl)).map((saver) => saver.id);
}

/** Whether any screensaver needs WebGL: only then is it worth starting one to ask. */
export function anyNeedsWebgl(): boolean {
  return SAVERS.some((saver) => saver.context === 'webgl');
}

/** The screensavers this device can run, asking whether WebGL starts only when one needs it. */
export function runnableHere(): SaverId[] {
  return runnableSavers(anyNeedsWebgl() ? webglStarts() : false);
}

let webglAnswer: boolean | null = null;

/**
 * Whether WebGL starts on this device: asked once, of a canvas of its own,
 * and remembered for the page's life. False where there is no document.
 */
export function webglStarts(doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  if (webglAnswer !== null) return webglAnswer;
  if (!doc) return false;
  // A page with no WebGL at all (jsdom in the tests, among others) need not make a canvas to be told so.
  const view: { WebGLRenderingContext?: unknown } | null = doc.defaultView;
  if (typeof view?.WebGLRenderingContext === 'undefined') {
    webglAnswer = false;
    return webglAnswer;
  }
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    webglAnswer = gl !== null && gl !== undefined;
    // Let the context go at once: a weak tablet has only a few.
    (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglAnswer = false;
  }
  return webglAnswer;
}
