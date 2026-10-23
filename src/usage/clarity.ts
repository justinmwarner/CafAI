/**
 * Microsoft Clarity's tag, loaded by CafAI itself (D-USAGE-6): the queue stub
 * Clarity's own snippet defines, then one async script, so calls made before
 * the script arrives wait in the queue. A load that fails or is blocked
 * changes nothing on screen and logs nothing: Decaid serves the console to
 * the network.
 */
export const CLARITY_TAG = 'https://www.clarity.ms/tag/';

export type ClarityCall = (...args: unknown[]) => void;

type ClarityStub = ClarityCall & { q?: IArguments[] };

export function loadClarity(win: Window, projectId: string): ClarityCall {
  const host = win as unknown as { clarity?: ClarityStub };
  if (!host.clarity) {
    const stub: ClarityStub = function () {
      // Clarity reads its queue as its snippet leaves it: each call's own arguments object.
      // eslint-disable-next-line prefer-rest-params
      (stub.q = stub.q || []).push(arguments);
    };
    host.clarity = stub;
  }
  const doc = win.document;
  if (!doc.querySelector('script[data-cafai-clarity]')) {
    const script = doc.createElement('script');
    script.async = true;
    script.src = CLARITY_TAG + encodeURIComponent(projectId);
    script.setAttribute('data-cafai-clarity', '');
    (doc.head || doc.body).appendChild(script);
  }
  return (...args) => {
    try {
      host.clarity?.(...args);
    } catch {
      // Clarity's own trouble is never CafAI's.
    }
  };
}
