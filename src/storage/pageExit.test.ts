import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAFAI_DB_NAME, openCafaiDb } from './db.ts';
import { watchTransactions, type TransactionWatch } from './openTransactions.ts';
import { releaseOnPageExit } from './pageExit.ts';

function fakePage() {
  const page = Object.assign(new EventTarget(), { location: { reload: vi.fn() } });
  return page;
}

function transition(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
  return Object.assign(new Event(type), { persisted });
}

function rawOpen(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** A write's outcome within `ms`: done, or still waiting. */
function writeWithin(db: IDBDatabase, ms: number): Promise<'done' | 'waiting'> {
  return new Promise((resolve) => {
    const tx = db.transaction(['settings'], 'readwrite');
    tx.objectStore('settings').put({ activeBagId: 'bag_1' }, 'current');
    const timer = setTimeout(() => resolve('waiting'), ms);
    tx.oncomplete = () => {
      clearTimeout(timer);
      resolve('done');
    };
  });
}

describe('releaseOnPageExit', () => {
  let watch: TransactionWatch | null = null;
  afterEach(() => {
    watch?.stop();
    watch = null;
  });

  it('aborts what a page put away still has open, so the next page can write', async () => {
    const factory = new IDBFactory();
    globalThis.indexedDB = factory;
    (await openCafaiDb()).close();
    watch = watchTransactions(globalThis);
    const page = fakePage();
    const lines: string[] = [];
    releaseOnPageExit(page, watch, (line) => lines.push(line));

    // The page that is put away: a read of the settings whose answer it never gets to.
    const old = await rawOpen(factory, CAFAI_DB_NAME);
    const held = old.transaction(['settings'], 'readonly');
    const keepAsking = () => {
      const request = held.objectStore('settings').get('current');
      request.onsuccess = keepAsking;
      // Aborted, its last read fails: that is the point.
      request.onerror = (event) => event.preventDefault();
    };
    keepAsking();
    // The next page in the same WebView, a page of its own with its own watch: not this one's.
    watch.stop();
    const next = await rawOpen(factory, CAFAI_DB_NAME);
    // Its write waits behind that read.
    expect(await writeWithin(next, 200)).toBe('waiting');

    page.dispatchEvent(transition('pagehide', true));
    expect(lines).toEqual([
      expect.stringMatching(/^\[CafAI\] put away, the browser keeping the page, with cafai readonly \[settings\] \d+ ms open: aborted, so the next page can write$/),
    ]);
    expect(await writeWithin(next, 1000)).toBe('done');
    old.close();
    next.close();
  });

  it('says nothing and changes nothing for a page with nothing open', () => {
    watch = watchTransactions(globalThis);
    const page = fakePage();
    const lines: string[] = [];
    releaseOnPageExit(page, watch, (line) => lines.push(line));
    page.dispatchEvent(transition('pagehide', false));
    page.dispatchEvent(transition('pageshow', true));
    expect(lines).toEqual([]);
    expect(page.location.reload).not.toHaveBeenCalled();
  });

  it('starts a page again that comes back from the cache after an abort, and only then', async () => {
    const factory = new IDBFactory();
    globalThis.indexedDB = factory;
    watch = watchTransactions(globalThis);
    const page = fakePage();
    releaseOnPageExit(page, watch, () => undefined);
    (await openCafaiDb()).close();
    const db = await rawOpen(factory, CAFAI_DB_NAME);
    db.transaction('settings').objectStore('settings').get('current').onerror = (event) => event.preventDefault();
    page.dispatchEvent(transition('pageshow', false));
    expect(page.location.reload).not.toHaveBeenCalled();
    page.dispatchEvent(transition('pagehide', true));
    page.dispatchEvent(transition('pageshow', false));
    expect(page.location.reload).not.toHaveBeenCalled();
    page.dispatchEvent(transition('pageshow', true));
    expect(page.location.reload).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('stops listening when asked', () => {
    watch = watchTransactions(globalThis);
    const page = fakePage();
    const abortAll = vi.spyOn(watch, 'abortAll');
    const stop = releaseOnPageExit(page, watch, () => undefined);
    stop();
    page.dispatchEvent(transition('pagehide', false));
    expect(abortAll).not.toHaveBeenCalled();
  });
});
