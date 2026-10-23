// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CLARITY_TAG, forgetClarityCookies, loadClarity } from './clarity.ts';

type Stubbed = Window & { clarity?: ((...args: unknown[]) => void) & { q?: ArrayLike<unknown>[]; v?: string } };

afterEach(() => {
  document.querySelectorAll('script[data-cafai-clarity]').forEach((script) => script.remove());
  delete (window as Stubbed).clarity;
});

describe('loadClarity (D-USAGE-6)', () => {
  it("adds Clarity's tag once, async, and queues the calls made before it runs", () => {
    const { call } = loadClarity(window, 'abc123');
    loadClarity(window, 'abc123');
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-cafai-clarity]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe(`${CLARITY_TAG}abc123`);
    expect(scripts[0]!.async).toBe(true);
    call('event', 'shot_read');
    const queue = (window as Stubbed).clarity!.q!;
    expect(Array.from(queue[0]!)).toEqual(['event', 'shot_read']);
  });

  it('calls the Clarity that replaced the stub once its script ran', () => {
    const { call } = loadClarity(window, 'abc123');
    const heard: unknown[][] = [];
    (window as Stubbed).clarity = (...args: unknown[]) => void heard.push(args);
    call('set', 'layout', 'tablet');
    expect(heard).toEqual([['set', 'layout', 'tablet']]);
  });

  it("never lets Clarity's own trouble out", () => {
    (window as Stubbed).clarity = () => {
      throw new Error('broken');
    };
    const { call } = loadClarity(window, 'abc123');
    expect(() => call('event', 'shot_read')).not.toThrow();
  });
});

describe('halt (D-USAGE-3)', () => {
  it("stops a Clarity whose script has run", () => {
    const { halt } = loadClarity(window, 'abc123');
    const heard: unknown[][] = [];
    (window as Stubbed).clarity = (...args: unknown[]) => void heard.push(args);
    halt();
    expect(heard).toEqual([['stop']]);
  });

  it('before the script has run, drops what waits for a lone stop and marks the stub so the script starts nothing', () => {
    const { call, halt } = loadClarity(window, 'abc123');
    call('consentv2', { ad_Storage: 'denied' });
    call('event', 'coach_message');
    halt();
    const stub = (window as Stubbed).clarity!;
    expect(Array.from(stub.q!, (args) => Array.from(args))).toEqual([['stop']]);
    expect(stub.v).toBeTruthy();
  });
});

describe('forgetClarityCookies (D-USAGE-3)', () => {
  it("erases Clarity's cookies and leaves the others", () => {
    document.cookie = '_clck=user1; path=/';
    document.cookie = '_clsk=session1; path=/';
    document.cookie = 'other=kept; path=/';
    forgetClarityCookies(document, 'localhost');
    expect(document.cookie).not.toContain('_clck');
    expect(document.cookie).not.toContain('_clsk');
    expect(document.cookie).toContain('other=kept');
    document.cookie = 'other=; Max-Age=0; path=/';
  });

  it('tries every parent domain of a named host, and none for an address', () => {
    const written: string[] = [];
    const doc = {
      set cookie(value: string) {
        written.push(value);
      },
      get cookie() {
        return '';
      },
    };
    forgetClarityCookies(doc, 'cafai.example.com');
    expect(written).toContain('_clck=; Max-Age=0; path=/; domain=cafai.example.com');
    expect(written).toContain('_clck=; Max-Age=0; path=/; domain=example.com');
    expect(written.some((value) => value.endsWith('domain=com'))).toBe(false);
    written.length = 0;
    forgetClarityCookies(doc, '192.168.1.42');
    expect(written).toEqual(['_clck=; Max-Age=0; path=/', '_clsk=; Max-Age=0; path=/']);
  });
});
