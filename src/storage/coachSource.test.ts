import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import {
  COACH_SOURCE_DB_NAME,
  createCoachSourceStore,
  createMemoryCoachSourceStore,
  normalizeAddress,
  normalizeCode,
  openCoachSourceStore,
  type CoachSource,
} from './coachSource.ts';
import { uniqueDbName } from './testing/fixtures.ts';

const COMPUTER: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };

describe('openCoachSourceStore', () => {
  it('starts with Anthropic and nothing for the computer', async () => {
    const store = await openCoachSourceStore(uniqueDbName('coach-source'));
    expect(await store.get()).toEqual({ kind: 'anthropic', address: '', code: '' });
  });

  it('keeps the choice, the address and the code across a reload', async () => {
    const name = uniqueDbName('coach-source');
    const first = await openCoachSourceStore(name);
    await first.set(COMPUTER);
    first.close();
    const second = await openCoachSourceStore(name);
    expect(await second.get()).toEqual(COMPUTER);
  });

  it('keeps the address and the code when the user switches back to Anthropic', async () => {
    const store = await openCoachSourceStore(uniqueDbName('coach-source'));
    await store.set(COMPUTER);
    await store.set({ ...COMPUTER, kind: 'anthropic' });
    expect(await store.get()).toEqual({ ...COMPUTER, kind: 'anthropic' });
  });

  it('keeps it in its own database, called cafai-coach-source by default', async () => {
    expect(COACH_SOURCE_DB_NAME).toBe('cafai-coach-source');
    const name = uniqueDbName('coach-source');
    const store = await openCoachSourceStore(name);
    await store.set(COMPUTER);
    const db = await openDB(name);
    expect([...db.objectStoreNames]).toEqual(['source']);
    db.close();
  });

  it('stores only the three fields, and reads anything else as the default', async () => {
    const name = uniqueDbName('coach-source');
    const store = await openCoachSourceStore(name);
    await store.set({ ...COMPUTER, extra: 'nope' } as CoachSource);
    expect(await store.get()).toEqual(COMPUTER);

    const db = await openDB(name);
    await db.put('source', { kind: 'moon', address: 7 }, 'current');
    db.close();
    expect(await store.get()).toEqual({ kind: 'anthropic', address: '', code: '' });
  });

  it('says whether anything was saved on this device: nothing on a first visit, or in storage a new origin left behind (D229)', async () => {
    const store = await openCoachSourceStore(uniqueDbName('coach-source'));
    expect(await store.getSaved()).toBeNull();
    await store.set({ ...COMPUTER, kind: 'anthropic' });
    expect(await store.getSaved()).toEqual({ ...COMPUTER, kind: 'anthropic' });
  });

  it('keeps what its copy in Decaid is owed beside the source, across a reload, and never as a source (D229)', async () => {
    const name = uniqueDbName('coach-source');
    const first = await openCoachSourceStore(name);
    expect(await first.copyState.get()).toEqual({ owed: false });
    await first.copyState.set({ owed: true });
    expect(await first.getSaved()).toBeNull();
    first.close();
    const second = await openCoachSourceStore(name);
    expect(await second.copyState.get()).toEqual({ owed: true });
    await second.copyState.set({ owed: false });
    expect(await second.copyState.get()).toEqual({ owed: false });

    const db = await openDB(name);
    await db.put('source', 'not a state', 'copy');
    db.close();
    expect(await second.copyState.get()).toEqual({ owed: false });
  });

  it('tells its subscribers what was saved', async () => {
    const store = await openCoachSourceStore(uniqueDbName('coach-source'));
    const seen: CoachSource[] = [];
    const stop = store.subscribe((source) => seen.push(source));
    await store.set(COMPUTER);
    stop();
    await store.set({ ...COMPUTER, kind: 'anthropic' });
    expect(seen).toEqual([COMPUTER]);
  });

  it('reopens a connection the browser closed', async () => {
    const name = uniqueDbName('coach-source');
    const store = await openCoachSourceStore(name);
    await store.set(COMPUTER);
    // Deleting the database closes this page's connection, as clearing site data does.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    expect(await store.get()).toEqual({ kind: 'anthropic', address: '', code: '' });
    await store.set(COMPUTER);
    expect(await store.get()).toEqual(COMPUTER);
  });

  it('says what failed in fixed sentences that never carry the code', async () => {
    const failing = createCoachSourceStore(() => Promise.reject(new Error(`could not store ${COMPUTER.code}`)));
    const error: unknown = await failing.set(COMPUTER).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'StorageError', message: 'Could not save where the coach runs on this device. Try again.' });
    expect(JSON.stringify(error)).not.toContain(COMPUTER.code);
    expect(String((error as Error).message)).not.toContain(COMPUTER.code);
    await expect(failing.get()).rejects.toThrow('Could not read where the coach runs on this device. Reload the page and try again.');
    const full = createCoachSourceStore(() => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')));
    await expect(full.set(COMPUTER)).rejects.toMatchObject({
      kind: 'quota',
      message: 'This device is out of storage space, so where the coach runs was not saved.',
    });
  });
});

describe('createMemoryCoachSourceStore', () => {
  it('behaves like the stored one', async () => {
    const store = createMemoryCoachSourceStore({ address: '10.0.0.5:8877' });
    expect(await store.get()).toEqual({ kind: 'anthropic', address: '10.0.0.5:8877', code: '' });
    const seen: CoachSource[] = [];
    store.subscribe((source) => seen.push(source));
    await store.set(COMPUTER);
    expect(await store.get()).toEqual(COMPUTER);
    expect(seen).toEqual([COMPUTER]);
    // A copy each time: changing what get() returned changes nothing stored.
    (await store.get()).code = 'XXXXXXXX';
    expect((await store.get()).code).toBe('ABCDEFGH');
  });

  it('has something saved once it starts with a source or one is saved', async () => {
    const empty = createMemoryCoachSourceStore();
    expect(await empty.getSaved()).toBeNull();
    expect(await empty.get()).toEqual({ kind: 'anthropic', address: '', code: '' });
    await empty.set(COMPUTER);
    expect(await empty.getSaved()).toEqual(COMPUTER);
    expect(await createMemoryCoachSourceStore(COMPUTER).getSaved()).toEqual(COMPUTER);
  });
});

describe('normalizeAddress', () => {
  it.each([
    ['192.168.1.20', 'http://192.168.1.20:8877', '192.168.1.20:8877'],
    ['  192.168.1.20:8877  ', 'http://192.168.1.20:8877', '192.168.1.20:8877'],
    ['192.168.1.20:80', 'http://192.168.1.20:80', '192.168.1.20:80'],
    ['http://192.168.1.20', 'http://192.168.1.20:8877', '192.168.1.20:8877'],
    ['HTTP://192.168.1.20:9000/', 'http://192.168.1.20:9000', '192.168.1.20:9000'],
    ['https://bridge.example:443', 'https://bridge.example:443', 'https://bridge.example:443'],
    ['https://bridge.example', 'https://bridge.example:8877', 'https://bridge.example:8877'],
    ['127.0.0.1', 'http://127.0.0.1:8877', '127.0.0.1:8877'],
    ['localhost', 'http://localhost:8877', 'localhost:8877'],
    ['Johns-MacBook.local', 'http://Johns-MacBook.local:8877', 'Johns-MacBook.local:8877'],
    ['[fe80::1]', 'http://[fe80::1]:8877', '[fe80::1]:8877'],
    ['[fe80::1]:9000', 'http://[fe80::1]:9000', '[fe80::1]:9000'],
    ['http://[::1]/', 'http://[::1]:8877', '[::1]:8877'],
    ['fe80::1', 'http://[fe80::1]:8877', '[fe80::1]:8877'],
    // In decimal, as typed: a browser would read the leading zeros as octal (192.168.1.16, or no address at all).
    ['192.168.001.020', 'http://192.168.1.20:8877', '192.168.1.20:8877'],
    ['192.168.1.08:08877', 'http://192.168.1.8:8877', '192.168.1.8:8877'],
  ])('reads %j', (text, baseUrl, display) => {
    expect(normalizeAddress(text)).toEqual({ ok: true, baseUrl, display });
  });

  it('asks for an address when there is none', () => {
    expect(normalizeAddress('   ')).toEqual({
      ok: false,
      error: 'Type the address CafAI Bridge shows on your computer, for example 192.168.1.20.',
    });
  });

  it.each([
    '192.168.1.20/v1/messages',
    'http://192.168.1.20:8877/v1',
    '192.168.1.20 8877',
    '192.168 .1.20',
    'ftp://192.168.1.20',
    'user@192.168.1.20',
    '192.168.1.20?x=1',
    '192.168.1',
    '192.168.1.256',
    '-mac.local',
    '[fe80::1',
    '[fe80::1]x',
    '[zz::1]',
    '[1:2:3:4:5:6:7:8:9]',
    'mac.1',
    'http://',
    ':8877',
  ])('refuses %j', (text) => {
    const result = normalizeAddress(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Type only the address CafAI Bridge shows, for example 192.168.1.20 or 192.168.1.20:8877.');
  });

  it.each(['192.168.1.20:', '192.168.1.20:0', '192.168.1.20:65536', '192.168.1.20:88a7', '[::1]:'])('refuses the port in %j', (text) => {
    expect(normalizeAddress(text)).toEqual({
      ok: false,
      error: 'The port after the colon is a number from 1 to 65535, for example 192.168.1.20:8877.',
    });
  });
});

describe('normalizeCode', () => {
  it('reads the code in any case, with or without its dash', () => {
    for (const text of ['ABCD-EFGH', 'abcd-efgh', ' abcdefgh ', 'AB CD EF GH', 'abcd–efgh']) {
      expect(normalizeCode(text)).toEqual({ ok: true, code: 'ABCDEFGH', display: 'ABCD-EFGH' });
    }
    expect(normalizeCode('2345-6789')).toEqual({ ok: true, code: '23456789', display: '2345-6789' });
  });

  it('says what a code looks like when it is missing or the wrong length', () => {
    expect(normalizeCode(' - ')).toEqual({ ok: false, error: 'Type the code CafAI Bridge shows on your computer, for example ABCD-EFGH.' });
    expect(normalizeCode('ABCD-EFG')).toEqual({ ok: false, error: 'The code is 8 letters and digits, for example ABCD-EFGH.' });
    expect(normalizeCode('ABCD-EFGHJ')).toEqual({ ok: false, error: 'The code is 8 letters and digits, for example ABCD-EFGH.' });
  });
});
