/**
 * A page put away keeps none of CafAI's databases (D284). WebKit keeps a page
 * that was navigated away from in its back/forward cache, and a transaction
 * open there never ends: it commits once the results of its requests have
 * been handed to the page, and a cached page runs nothing. IndexedDB queues
 * every later write to the same stores behind it. So the next CafAI page in
 * the same WebView waits on its first write for as long as the cached one
 * lives ("still opening the coach's chat"). On an iPad that is the page Decaid
 * loads when it comes back after ten minutes away, and Try again reloads the
 * same WebView. Every transaction still open as the page is put away
 * (pagehide) is aborted. That loses nothing the page would have kept: an
 * unloaded page aborts its open transactions as well. A page brought back
 * from that cache after an abort (pageshow, persisted) starts again, since
 * work it was in the middle of failed.
 */
import { describeTransactions, type TransactionWatch } from './openTransactions.ts';

type PageScope = Pick<Window, 'addEventListener' | 'removeEventListener'> & { location: Pick<Location, 'reload'> };

export function releaseOnPageExit(win: PageScope, transactions: TransactionWatch, log: (line: string) => void = (line) => console.info(line)): () => void {
  let abortedSome = false;
  const onPageHide = (event: Event) => {
    const aborted = transactions.abortAll();
    if (aborted.length === 0) return;
    abortedSome = true;
    const kept = (event as PageTransitionEvent).persisted ? ', the browser keeping the page,' : '';
    log(`[CafAI] put away${kept} with ${describeTransactions(aborted)} open: aborted, so the next page can write`);
  };
  const onPageShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted && abortedSome) win.location.reload();
  };
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  return () => {
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
  };
}
