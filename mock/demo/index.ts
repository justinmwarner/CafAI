/**
 * The demo (npm run demo, ?demo=1; D76, docs/DEMO.md): a CafAI already in
 * use, on the mock Decaid and the scripted coach. src/main.tsx calls
 * startDemo() after the mock Decaid starts and before the app does.
 *
 * Each load starts the same demo from the beginning: the story is built
 * again for this moment (mock/demo/build.ts), CafAI's storage at this address
 * is replaced with it, the mock Decaid gets its shots, profiles and loaded
 * version, and the page opens on the coach, whatever route was saved. Only
 * where the guard allows (mock/demo/guard.ts); anywhere else nothing is
 * written, the normal mock app starts, and a note says why.
 */
import type { MockDecaid } from '../decaid/state.ts';
import { buildDemo } from './build.ts';
import { isMarked, judge, markSeeded, readStoredData, showGuardNote, type DemoDbNames, type NoteDocument } from './guard.ts';
import { seedMockDecaid, writeDemoStorage } from './seed.ts';

/** What the demo needs from the page: `window` in the app. */
export interface DemoHost {
  location: Pick<Location, 'pathname' | 'search' | 'hash' | 'replace'>;
  localStorage: Pick<globalThis.Storage, 'getItem' | 'setItem'>;
  document: NoteDocument;
}

export interface DemoOptions extends DemoDbNames {
  /** When the demo opens, in epoch ms (default now): the story's times count back from it. */
  now?: number;
}

export type DemoOutcome = { seeded: true } | { seeded: false; reason: string };

/** The coach screen, whatever route was saved: the app remembers it from there itself. */
function openOnCoach(location: DemoHost['location']): void {
  if (location.hash !== '#/') location.replace(`${location.pathname}${location.search}#/`);
}

export async function startDemo(state: MockDecaid, host: DemoHost = window, options: DemoOptions = {}): Promise<DemoOutcome> {
  const verdict = judge(await readStoredData(options), isMarked(host.localStorage));
  if (!verdict.seed) {
    showGuardNote(host.document);
    return { seeded: false, reason: verdict.reason };
  }
  const now = options.now ?? Date.now();
  // Built in memory first: a story that no longer plays writes nothing.
  const demo = await buildDemo(now);
  await writeDemoStorage(demo.data, options);
  seedMockDecaid(state, demo.decaid);
  openOnCoach(host.location);
  markSeeded(host.localStorage, now);
  return { seeded: true };
}

export { DEMO_MARKER_KEY, GUARD_NOTE } from './guard.ts';
export { DEMO_API_KEY } from './story.ts';
