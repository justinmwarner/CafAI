// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHOICE_KEY } from './choice.ts';
import type { ClarityHandle } from './clarity.ts';
import type { RegionSignals } from './region.ts';
import { createUsageService, type UsageService } from './service.ts';

const EUROPE: RegionSignals = { timeZone: 'Europe/Berlin', languages: ['de-DE'] };
const AMERICA: RegionSignals = { timeZone: 'America/Chicago', languages: ['en-US'] };

/** Every call into Clarity, a halt as ['halt'], in order. */
let calls: unknown[][];
let loads: number;
let store: Map<string, string>;
const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
const load = (): ClarityHandle => {
  loads += 1;
  return { call: (...args) => void calls.push(args), halt: () => void calls.push(['halt']) };
};
/** Every service a test made, disposed after it, so no field guard outlives its test. */
const made: UsageService[] = [];
const service = (signals: RegionSignals) => {
  const usage = createUsageService({ win: window, projectId: 'abc123', storage, now: () => new Date('2026-10-22T08:00:00Z'), load, signals });
  made.push(usage);
  return usage;
};
const named = (name: string) => calls.filter((call) => call[0] === name);

beforeEach(() => {
  calls = [];
  loads = 0;
  store = new Map();
  window.history.replaceState(null, '', '/#/');
});

afterEach(() => {
  for (const usage of made.splice(0)) usage.dispose();
  document.body.innerHTML = '';
});

describe('usage sharing (D-USAGE-3)', () => {
  it('asks first in Europe and loads nothing until yes', () => {
    const usage = service(EUROPE);
    expect(usage.getState()).toEqual({ sharing: false, prompt: 'card', rule: 'ask' });
    usage.start();
    usage.track('shot_read');
    usage.screen('coach');
    expect(loads).toBe(0);
    expect(window.location.search).toBe('');

    usage.choose(true);
    expect(loads).toBe(1);
    expect(calls[0]).toEqual(['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);
    expect(named('set')).toContainEqual(['set', 'rule', 'ask']);
    expect(named('event')).toEqual([]);
    expect(window.location.search).toBe('?screen=coach');
    expect(usage.getState()).toEqual({ sharing: true, prompt: null, rule: 'ask' });
    expect(JSON.parse(store.get(CHOICE_KEY)!)).toEqual({ choice: 'yes', at: '2026-10-22T08:00:00.000Z', wording: 1, rule: 'ask' });
  });

  it('No thanks loads nothing, now or at the next start', () => {
    service(EUROPE).choose(false);
    const again = service(EUROPE);
    again.start();
    expect(again.getState()).toEqual({ sharing: false, prompt: null, rule: 'ask' });
    expect(loads).toBe(0);
  });

  it('shares elsewhere from the start, with the notice, claiming no consent', () => {
    const usage = service(AMERICA);
    expect(usage.getState()).toEqual({ sharing: true, prompt: 'notice', rule: 'notice' });
    usage.track('coach_message');
    usage.start();
    expect(loads).toBe(1);
    expect(calls[0]).toEqual(['consentv2', { ad_Storage: 'denied' }]);
    // An event from before the start goes once Clarity is there.
    expect(named('event')).toEqual([['event', 'coach_message']]);
    usage.track('shot_read');
    expect(named('event')).toEqual([
      ['event', 'coach_message'],
      ['event', 'shot_read'],
    ]);
  });

  it('OK keeps sharing and puts the notice away', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.choose(true);
    expect(usage.getState()).toEqual({ sharing: true, prompt: null, rule: 'notice' });
    expect(named('consentv2')).toHaveLength(1);
  });

  it('Turn off stops Clarity before it touches the address, erases its cookies and sends nothing more', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.screen('settings');
    expect(window.location.search).toBe('?screen=settings');
    document.cookie = '_clck=user1; path=/';
    // The address changes only after the halt: Clarity's own hook would start it again otherwise.
    const replaceState = window.history.replaceState.bind(window.history);
    vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => {
      calls.push(['replaceState']);
      replaceState(...args);
    });
    usage.choose(false);
    expect(calls.slice(-2)).toEqual([['halt'], ['replaceState']]);
    // Never Clarity's consent(false), which starts it again without cookies: CafAI erases them itself.
    expect(named('consent')).toEqual([]);
    expect(document.cookie).not.toContain('_clck');
    expect(window.location.search).toBe('');
    usage.track('shot_read');
    usage.tag('layout', 'phone');
    usage.screen('coach');
    expect(named('event')).toEqual([]);
    expect(named('set').some((call) => call[1] === 'layout')).toBe(false);
    expect(window.location.search).toBe('');
  });

  it('turned back on in the same page, starts Clarity again', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.choose(false);
    usage.choose(true);
    expect(loads).toBe(1);
    expect(named('start')).toEqual([['start']]);
    expect(named('consentv2')).toHaveLength(2);
    expect(named('set').filter((call) => call[1] === 'rule')).toHaveLength(2);
  });

  it('a stored answer stands, under either rule', () => {
    store.set(CHOICE_KEY, JSON.stringify({ choice: 'no', at: '2026-10-01T00:00:00.000Z', wording: 1, rule: 'notice' }));
    const usage = service(AMERICA);
    usage.start();
    expect(usage.getState()).toEqual({ sharing: false, prompt: null, rule: 'notice' });
    expect(loads).toBe(0);
  });

  it('a yes given to the notice never claims analytics consent, even from a zone that now asks', () => {
    store.set(CHOICE_KEY, JSON.stringify({ choice: 'yes', at: '2026-10-01T00:00:00.000Z', wording: 1, rule: 'notice' }));
    const usage = service(EUROPE);
    usage.start();
    expect(usage.getState()).toEqual({ sharing: true, prompt: null, rule: 'ask' });
    expect(calls[0]).toEqual(['consentv2', { ad_Storage: 'denied' }]);
  });

  it("sends the tags again after each screen's new page view, since Clarity clears them with the last one", () => {
    const usage = service(AMERICA);
    usage.tag('cafai_version', '0.1.3');
    usage.start();
    usage.screen('settings');
    usage.screen('settings');
    const versionTags = () => named('set').filter((call) => call[1] === 'cafai_version');
    // Once at the start, once for the settings page view; the same screen again changes nothing.
    expect(versionTags()).toHaveLength(2);
    expect(named('set').filter((call) => call[1] === 'rule')).toHaveLength(2);
  });

  it('puts the screen in the address before Clarity starts, so its first page view is that screen', () => {
    const usage = service(EUROPE);
    usage.start();
    usage.screen('history');
    expect(window.location.search).toBe('');
    usage.choose(true);
    expect(window.location.search).toBe('?screen=history');
    expect(named('set').filter((call) => call[1] === 'rule')).toHaveLength(1);
  });

  it('sends each tag once, and again only when it changes', () => {
    const usage = service(AMERICA);
    usage.tag('cafai_version', '0.1.3');
    usage.start();
    usage.tag('coach_source', 'none');
    usage.tag('coach_source', 'none');
    usage.tag('coach_source', 'api-key');
    expect(named('set')).toEqual([
      ['set', 'rule', 'notice'],
      ['set', 'cafai_version', '0.1.3'],
      ['set', 'coach_source', 'none'],
      ['set', 'coach_source', 'api-key'],
    ]);
  });

  it('keeps every form field out of Clarity while the device shares, and only then (D-USAGE-5)', async () => {
    const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
    const before = document.body.appendChild(document.createElement('input'));
    const usage = service(EUROPE);
    usage.start();
    expect(before).not.toHaveAttribute('data-private');
    usage.choose(true);
    expect(before).toHaveAttribute('data-private', 'secret');
    const added = document.body.appendChild(document.createElement('textarea'));
    await settle();
    expect(added).toHaveAttribute('data-private', 'secret');
    usage.choose(false);
    const after = document.body.appendChild(document.createElement('input'));
    await settle();
    expect(after).not.toHaveAttribute('data-private');
  });

  it('stops watching the fields when disposed', async () => {
    const usage = service(AMERICA);
    usage.start();
    usage.dispose();
    const after = document.body.appendChild(document.createElement('input'));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(after).not.toHaveAttribute('data-private');
  });

  it('starts once', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.start();
    expect(loads).toBe(1);
    expect(named('consentv2')).toHaveLength(1);
  });

  it('holds at most 50 early events', () => {
    const usage = service(AMERICA);
    for (let i = 0; i < 60; i += 1) usage.track('coach_message');
    usage.start();
    expect(named('event')).toHaveLength(50);
  });

  it('tells its listeners when the state changes', () => {
    const usage = service(EUROPE);
    let heard = 0;
    const stop = usage.subscribe(() => {
      heard += 1;
    });
    usage.choose(true);
    stop();
    usage.choose(false);
    expect(heard).toBe(1);
  });
});
