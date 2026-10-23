/**
 * Microsoft Clarity's tag, loaded by CafAI itself (D215): the queue stub
 * Clarity's own snippet defines, then one async script, so calls made before
 * the script arrives wait in the queue. A load that fails or is blocked
 * changes nothing on screen and logs nothing: Decaid serves the console to
 * the network.
 */
export const CLARITY_TAG = 'https://www.clarity.ms/tag/';

export type ClarityCall = (...args: unknown[]) => void;

export interface ClarityHandle {
  /** Call Clarity; until its script has run, the call waits in the queue. */
  call: ClarityCall;
  /**
   * Stop Clarity for the rest of the page (D212). Once its script has
   * run: `stop`. Before: the calls waiting in the queue are dropped for a
   * lone `stop`, and the stub gets a version, which Clarity's script takes
   * for another Clarity tag already running ("CL001"), so it starts nothing.
   */
  halt(): void;
}

type ClarityStub = ClarityCall & { q?: ArrayLike<unknown>[]; v?: string };

export function loadClarity(win: Window, projectId: string): ClarityHandle {
  const host = win as unknown as { clarity?: ClarityStub };
  const stub: ClarityStub = function () {
    // Clarity reads its queue as its snippet leaves it: each call's own arguments object.
    // eslint-disable-next-line prefer-rest-params
    (stub.q = stub.q || []).push(arguments);
  };
  if (!host.clarity) host.clarity = stub;
  const doc = win.document;
  if (!doc.querySelector('script[data-cafai-clarity]')) {
    const script = doc.createElement('script');
    script.async = true;
    script.src = CLARITY_TAG + encodeURIComponent(projectId);
    script.setAttribute('data-cafai-clarity', '');
    (doc.head || doc.body).appendChild(script);
  }
  const call: ClarityCall = (...args) => {
    try {
      host.clarity?.(...args);
    } catch {
      // Clarity's own trouble is never CafAI's.
    }
  };
  return {
    call,
    halt() {
      if (host.clarity === stub) {
        stub.q = [['stop']];
        stub.v = 'cafai-halted';
      } else {
        call('stop');
      }
    },
  };
}

/** Clarity's own cookies: the user's (_clck) and the session's (_clsk). */
const COOKIES = ['_clck', '_clsk'];

/** The domains a cookie of this host may have been set on: none for a name without a dot or an IP address. */
function cookieDomains(host: string): string[] {
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return [];
  const parts = host.split('.');
  const domains: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) domains.push(parts.slice(i).join('.'));
  return domains;
}

/**
 * Erase Clarity's cookies (Turn off, D212): the host's own and any set on
 * a parent domain. CafAI does it itself, since Clarity's consent(false), which
 * also erases them, starts Clarity again without cookies.
 */
export function forgetClarityCookies(doc: Pick<Document, 'cookie'>, host: string): void {
  for (const name of COOKIES) {
    doc.cookie = `${name}=; Max-Age=0; path=/`;
    for (const domain of cookieDomains(host)) doc.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
  }
}
