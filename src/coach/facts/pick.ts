/**
 * Which of CafAI's facts to tell next (D200). The facts that fit the bag come
 * first while any is untold, every other one a general fact, so a bag with
 * three facts of its own does not tell them in its first three shots and then
 * nothing but general ones. Among the bag's own, a roaster fact comes before
 * a variety, an origin, a process, a notes and a roast-level one; within each
 * kind, in an order shuffled by the bag's id, the same every time for that
 * bag. A fact told, for any bag, by its id or as the coach's own under its
 * label, waits until every fact that fits the bag was told; then the one told
 * longest ago comes back first.
 */
import { factFits, isBagFact, MATCH_KEYS, matchedKeys, type BagFacts } from './match.ts';
import { coachKey, coachLabel, type ToldEntry } from './told.ts';
import type { FunFact } from './types.ts';

/** FNV-1a: a shuffle that is the same on every device and every page for a bag. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Where each key was last told: its place in the told list, the newest highest. */
function lastTold(told: readonly ToldEntry[]): Map<string, number> {
  const last = new Map<string, number>();
  told.forEach((entry, i) => last.set(entry.key, i));
  return last;
}

/** The kind of a bag's own fact, the first key that fits (a roaster 0, a roast level 5); a general fact after them all. */
function kindOf(fact: FunFact, bag: BagFacts): number {
  const [first] = matchedKeys(fact, bag);
  return first === undefined ? MATCH_KEYS.length : MATCH_KEYS.indexOf(first);
}

/** The next of CafAI's facts for the bag, given every fact told on this device; null when none fits it. */
export function pickFact(facts: readonly FunFact[], bag: BagFacts & { id: string }, told: readonly ToldEntry[]): FunFact | null {
  const last = lastTold(told);
  // Told under its id, or by the coach under its label: the latest telling counts.
  const toldAt = (fact: FunFact) => Math.max(last.get(fact.id) ?? -1, last.get(coachKey(fact.about)) ?? -1);
  const fitting = facts
    .filter((fact) => factFits(fact, bag))
    .map((fact) => ({ fact, kind: kindOf(fact, bag), shuffle: hash(`${bag.id}\n${fact.id}`) }))
    .sort((a, b) => a.kind - b.kind || a.shuffle - b.shuffle || a.fact.id.localeCompare(b.fact.id))
    .map(({ fact }) => fact);
  if (fitting.length === 0) return null;
  const untold = fitting.filter((fact) => toldAt(fact) < 0);
  if (untold.length === 0) {
    return fitting.reduce((oldest, fact) => (toldAt(fact) < toldAt(oldest) ? fact : oldest));
  }
  const own = untold.filter(isBagFact);
  const general = untold.filter((fact) => !isBagFact(fact));
  return (afterOwn(facts, bag.id, told) ? (general[0] ?? own[0]) : (own[0] ?? general[0])) ?? null;
}

/** Whether the bag's last fact was one of its own: a bag fact from the list, or the coach's, which is always about the bag. */
function afterOwn(facts: readonly FunFact[], bagId: string, told: readonly ToldEntry[]): boolean {
  for (let i = told.length - 1; i >= 0; i -= 1) {
    const entry = told[i]!;
    if (entry.bagId !== bagId) continue;
    if (coachLabel(entry.key) !== null) return true;
    const fact = facts.find((f) => f.id === entry.key);
    return fact !== undefined && isBagFact(fact);
  }
  return false;
}

/**
 * The labels of the facts told most recently, for any bag, newest first and
 * each once: what the coach hears with a due shot (D201), so it does not
 * share one again. A list fact by its `about`; the coach's by the label it
 * was told under. A fact no longer in the list is left out.
 */
export function toldLabels(told: readonly ToldEntry[], facts: readonly FunFact[], count = 40): string[] {
  const labels: string[] = [];
  for (let i = told.length - 1; i >= 0 && labels.length < count; i -= 1) {
    const key = told[i]!.key;
    const label = coachLabel(key) ?? facts.find((fact) => fact.id === key)?.about;
    if (label !== undefined && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
