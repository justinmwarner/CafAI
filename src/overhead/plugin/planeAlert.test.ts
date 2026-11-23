import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHost, fakeResponse } from './fakeHost.ts';
import type { PluginFetch } from './host.ts';
import { createPluginKv } from './kv.ts';
import { createPlaneAlert, parsePlaneAlertCsv, PLANE_ALERT_BASE, REFRESH_EVERY_MS, RETRY_FAILED_MS } from './planeAlert.ts';

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/overhead/${name}`, import.meta.url), 'utf8');
const CIV = fixture('plane-alert-civ.sample.csv');
const GOV = fixture('plane-alert-gov.sample.csv');

const timers = {
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

describe('plane-alert-db, read from real rows', () => {
  it('maps the columns by the header the files carry', () => {
    const rows = parsePlaneAlertCsv(CIV);
    expect(rows).toHaveLength(14);
    const abc7 = rows?.find((row) => row[0] === 'a046e7');
    expect(abc7).toEqual(['a046e7', 'N117HD', 'US Helicopters (ABC7 Chicago)', 'AS-350 Ecureuil', 'AS50', 'Civ', ['As Seen on TV', 'News', 'Chicago'], 'As Seen on TV', 'https://abc7chicago.com']);
    expect(parsePlaneAlertCsv(GOV)?.[0]?.[2]).toBe('Virginia Department of Aviation');
  });

  it('copes with quoted fields, commas and all (papaparse, not split)', () => {
    const header = fixture('plane-alert-civ.sample.csv').split('\n')[0];
    const rows = parsePlaneAlertCsv(`${header}\nA1B2C3,N1,"Acme, Inc.","Type ""X""",XX,Civ,One,,Three,Distinctive,https://example.org\n`);
    expect(rows?.[0]?.slice(0, 4)).toEqual(['a1b2c3', 'N1', 'Acme, Inc.', 'Type "X"']);
    expect(rows?.[0]?.[6]).toEqual(['One', 'Three']);
  });

  it('refuses a file without the columns it matches on', () => {
    expect(parsePlaneAlertCsv('ICAO,Operator\nA046E7,Someone\n')).toBeNull();
    expect(parsePlaneAlertCsv('')).toBeNull();
  });

  it('skips rows without an address or an operator', () => {
    const header = CIV.split('\n')[0];
    expect(parsePlaneAlertCsv(`${header}\nZZZ,N1,Acme,,,Civ,,,,,\nA1B2C3,N1,,,,Civ,,,,,\n`)).toEqual([]);
  });
});

describe('the lists, kept', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T13:22:28Z'));
  });
  afterEach(() => vi.useRealTimers());

  function lists(answer: PluginFetch) {
    const fake = createFakeHost();
    const kv = createPluginKv(fake.host, timers);
    fake.attach({ onEvent: (event) => event.name === 'storageRead' && kv.answered(event.payload) });
    const asked: Array<{ url: string; headers?: Record<string, string> }> = [];
    const fetch: PluginFetch = (url, init) => {
      asked.push({ url, headers: init?.headers });
      return answer(url, init);
    };
    return { fake, kv, asked, alert: createPlaneAlert({ fetch, now: () => Date.now() }, kv) };
  }

  const both: PluginFetch = async (url) => fakeResponse(200, url.endsWith('gov.csv') ? GOV : CIV, { etag: url.endsWith('gov.csv') ? '"g1"' : '"c1"' });

  it('downloads both lists, matches any case, and keeps them', async () => {
    const { alert, asked, fake } = lists(both);
    await alert.refreshIfDue();
    expect(asked.map((request) => request.url)).toEqual([`${PLANE_ALERT_BASE}/plane-alert-civ.csv`, `${PLANE_ALERT_BASE}/plane-alert-gov.csv`]);
    expect(alert.size()).toBe(26);
    expect(alert.match('A046E7')).toMatchObject({ operator: 'US Helicopters (ABC7 Chicago)', category: 'As Seen on TV', group: 'Civ', type: 'AS-350 Ecureuil', link: 'https://abc7chicago.com' });
    expect(alert.match('a022e9')).toMatchObject({ operator: 'Department of Homeland Security', group: 'Gov', category: 'Oxcart' });
    expect(alert.match('a12ac7')).toBeNull();
    expect(fake.store.get('planeAlert')).toMatchObject({ fetchedAt: Date.now() });
  });

  it('refreshes once a day, asking only whether the files changed', async () => {
    const { alert, asked } = lists(both);
    await alert.refreshIfDue();
    await alert.refreshIfDue();
    expect(asked).toHaveLength(2);
    vi.advanceTimersByTime(REFRESH_EVERY_MS);
    await alert.refreshIfDue();
    expect(asked.slice(2).map((request) => request.headers)).toEqual([{ 'If-None-Match': '"c1"' }, { 'If-None-Match': '"g1"' }]);
  });

  it('keeps the last good copy when a download fails or reads wrong, and tries again in an hour', async () => {
    let broken = false;
    const { alert, asked, kv } = lists(async (url) => (broken ? fakeResponse(200, 'not,a,list\n1,2,3') : both(url)));
    await alert.refreshIfDue();
    broken = true;
    vi.advanceTimersByTime(REFRESH_EVERY_MS);
    await alert.refreshIfDue();
    expect(alert.match('a046e7')).not.toBeNull();
    expect(asked).toHaveLength(4);
    await alert.refreshIfDue();
    expect(asked).toHaveLength(4);
    vi.advanceTimersByTime(RETRY_FAILED_MS);
    broken = false;
    await alert.refreshIfDue();
    expect(asked).toHaveLength(6);

    // A fresh start reads the kept copy before downloading anything.
    const again = createPlaneAlert({ fetch: async () => fakeResponse(500, ''), now: () => Date.now() }, kv);
    const loading = again.load();
    await vi.advanceTimersByTimeAsync(0);
    await loading;
    expect(again.match('A046E7')?.operator).toBe('US Helicopters (ABC7 Chicago)');
  });
});
