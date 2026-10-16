/**
 * CafAI's own fun facts (D199), read the first time a fact is due: a dynamic
 * import, so the start-up bundle does not carry some 500 facts a session may
 * never need. Read once; a read that failed (a chunk the WebView could not
 * fetch) is tried again the next time.
 */
import type { FunFact } from './types.ts';

let facts: Promise<readonly FunFact[]> | null = null;

export function loadFacts(): Promise<readonly FunFact[]> {
  facts ??= import('./facts.json').then(
    // Its shape is checked by facts.test.ts, fact by fact.
    (module) => module.default as unknown as readonly FunFact[],
    (error: unknown) => {
      facts = null;
      throw error;
    },
  );
  return facts;
}
