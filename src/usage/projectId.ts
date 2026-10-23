/**
 * Which Clarity project this build reports to (D215), or null. Only a
 * production build reads VITE_CLARITY_PROJECT_ID (release.yml sets it from a
 * repository variable, so a fork's build has none), never dev or the tests,
 * whatever the shell holds. Mock mode reports to a stand-in only when the e2e
 * asks with ?mockUsage=1, and only on the mock Decaid, whose service worker
 * answers Clarity's tag (mock/clarity.ts): the coach-only mock against a real
 * Decaid (?mockDecaid=0) has no worker to answer it. The demo never does.
 */
export const MOCK_PROJECT_ID = 'cafai-e2e';

export function clarityProjectId(win: Pick<Window, 'location'>): string | null {
  const mode = import.meta.env.MODE;
  if (mode === 'mock') {
    const params = new URLSearchParams(win.location.search);
    const asked = params.get('mockUsage') === '1' && params.get('demo') !== '1' && params.get('mockDecaid') !== '0';
    return asked ? MOCK_PROJECT_ID : null;
  }
  if (mode !== 'production') return null;
  const id = (import.meta.env.VITE_CLARITY_PROJECT_ID ?? '').trim();
  return id === '' ? null : id;
}
